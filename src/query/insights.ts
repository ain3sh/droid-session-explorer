import type { Database } from "bun:sqlite"
import { toSummary, type SessionRow, type SessionSummary } from "./types"
import type { StatsFilters } from "./stats"

export type SignalKind =
  | "error_dense"
  | "retry_loops"
  | "interrupted"
  | "abandoned"
  | "compaction_churn"
  | "expensive"
  | "marathon"

export interface Insight {
  kind: SignalKind
  /** Comparable across kinds: always in [0, 1]. */
  severity: number
  session: SessionSummary
  detail: string
}

export interface InsightsReport {
  generatedAt: number
  overall: {
    sessions: number
    toolErrorRate: number
    interruptionRate: number
    abandonRate: number
    /** Median credits across sessions that recorded any credits. */
    medianCredits: number
  }
  insights: Insight[]
}

export interface InsightsFilters extends StatsFilters {
  limit?: number
  kind?: SignalKind
}

const MIN_TOOL_CALLS = 10
/** Minimum credit-bearing sessions before cost percentiles mean anything. */
const MIN_COST_SAMPLE = 20
/** Without a kind filter, no single signal kind may claim more than this many findings. */
const MAX_PER_KIND = 10

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

/** Nearest-rank quantile over an ascending-sorted array; 0 when empty. */
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q))
  return sorted[idx]!
}

export function insightsReport(
  db: Database,
  filters: InsightsFilters = {},
): InsightsReport {
  const where: string[] = ["is_subagent = 0", "is_exec = 0"]
  const params: (string | number)[] = []
  if (filters.project) {
    where.push("(cwd LIKE ? OR dir_slug LIKE ?)")
    params.push(`%${filters.project}%`, `%${filters.project}%`)
  }
  if (filters.since !== undefined) {
    where.push("updated_at >= ?")
    params.push(filters.since)
  }

  const rows = db
    .query<SessionRow, (string | number)[]>(
      `SELECT * FROM sessions WHERE ${where.join(" AND ")}`,
    )
    .all(...params)

  const insights: Insight[] = []
  let totalCalls = 0
  let totalErrors = 0
  let interrupted = 0
  let abandoned = 0
  const positiveCredits: number[] = []

  for (const row of rows) {
    const s = toSummary(row)
    if (s.usage.credits > 0) positiveCredits.push(s.usage.credits)
    totalCalls += s.counts.toolCalls
    totalErrors += s.counts.toolErrors
    if (s.counts.cancels > 0) interrupted++

    if (s.counts.toolCalls >= MIN_TOOL_CALLS) {
      const errRate = s.counts.toolErrors / s.counts.toolCalls
      if (errRate >= 0.15) {
        insights.push({
          kind: "error_dense",
          severity: clamp01(errRate),
          session: s,
          detail: `${s.counts.toolErrors}/${s.counts.toolCalls} tool calls failed (${Math.round(errRate * 100)}%)`,
        })
      }
    }

    if (s.counts.retryLoops >= 3) {
      insights.push({
        kind: "retry_loops",
        severity: clamp01(s.counts.retryLoops / Math.max(1, s.counts.toolCalls)),
        session: s,
        detail: `${s.counts.retryLoops} consecutive identical tool calls`,
      })
    }

    if (s.counts.cancels >= 3) {
      insights.push({
        kind: "interrupted",
        severity: clamp01(s.counts.cancels / Math.max(1, s.counts.userMessages)),
        session: s,
        detail: `${s.counts.cancels} user interruptions/cancellations`,
      })
    }

    const isAbandoned =
      !s.ended &&
      s.counts.userMessages <= 2 &&
      s.counts.toolErrors > 0 &&
      s.counts.messages > 0
    if (isAbandoned) {
      abandoned++
      insights.push({
        kind: "abandoned",
        severity: 0.5,
        session: s,
        detail: `short session ending after ${s.counts.toolErrors} tool error(s)`,
      })
    }

    if (s.counts.compactions >= 4) {
      insights.push({
        kind: "compaction_churn",
        severity: clamp01(s.counts.compactions / Math.max(20, s.counts.messages / 10)),
        session: s,
        detail: `${s.counts.compactions} compactions over ${s.counts.messages} messages`,
      })
    }

    if (s.activeTimeMs > 4 * 3600_000) {
      insights.push({
        kind: "marathon",
        severity: clamp01(s.activeTimeMs / (24 * 3600_000)),
        session: s,
        detail: `${(s.activeTimeMs / 3600_000).toFixed(1)}h of assistant active time`,
      })
    }
  }

  // Cost outliers, measured against this user's own credit distribution.
  // Heavy-tailed by nature, so the bar is the stricter of p95 and 3x median,
  // and severity grows with the log of the median ratio (10x median = 0.33,
  // 1000x = 1.0) so cost can be ranked fairly against the other signals.
  positiveCredits.sort((a, b) => a - b)
  const medianCredits = quantile(positiveCredits, 0.5)
  if (positiveCredits.length >= MIN_COST_SAMPLE && medianCredits > 0) {
    const threshold = Math.max(quantile(positiveCredits, 0.95), 3 * medianCredits)
    for (const row of rows) {
      const s = toSummary(row)
      if (s.usage.credits < threshold || s.usage.credits <= 0) continue
      const ratio = s.usage.credits / medianCredits
      const above = positiveCredits.filter((c) => c >= s.usage.credits).length
      const topPct = (above / positiveCredits.length) * 100
      insights.push({
        kind: "expensive",
        severity: clamp01(Math.log10(Math.max(1, ratio)) / 3),
        session: s,
        detail: `${s.usage.credits.toLocaleString()} credits, ${ratio >= 10 ? Math.round(ratio) : ratio.toFixed(1)}x your median session (top ${topPct < 1 ? topPct.toFixed(1) : Math.round(topPct)}%)`,
      })
    }
  }

  insights.sort((a, b) => b.severity - a.severity)

  let selected: Insight[]
  if (filters.kind) {
    selected = insights.filter((i) => i.kind === filters.kind)
  } else {
    const perKind = new Map<SignalKind, number>()
    selected = insights.filter((i) => {
      const n = perKind.get(i.kind) ?? 0
      if (n >= MAX_PER_KIND) return false
      perKind.set(i.kind, n + 1)
      return true
    })
  }

  return {
    generatedAt: Date.now(),
    overall: {
      sessions: rows.length,
      toolErrorRate: totalCalls ? totalErrors / totalCalls : 0,
      interruptionRate: rows.length ? interrupted / rows.length : 0,
      abandonRate: rows.length ? abandoned / rows.length : 0,
      medianCredits,
    },
    insights: selected.slice(0, filters.limit ?? 50),
  }
}
