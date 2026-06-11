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
    medianCredits: number
  }
  insights: Insight[]
}

const MIN_TOOL_CALLS = 10

export function insightsReport(
  db: Database,
  filters: StatsFilters & { limit?: number } = {},
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
  const credits: number[] = []

  for (const row of rows) {
    const s = toSummary(row)
    credits.push(s.usage.credits)
    totalCalls += s.counts.toolCalls
    totalErrors += s.counts.toolErrors
    if (s.counts.cancels > 0) interrupted++

    if (s.counts.toolCalls >= MIN_TOOL_CALLS) {
      const errRate = s.counts.toolErrors / s.counts.toolCalls
      if (errRate >= 0.15) {
        insights.push({
          kind: "error_dense",
          severity: errRate,
          session: s,
          detail: `${s.counts.toolErrors}/${s.counts.toolCalls} tool calls failed (${Math.round(errRate * 100)}%)`,
        })
      }
    }

    if (s.counts.retryLoops >= 3) {
      insights.push({
        kind: "retry_loops",
        severity: s.counts.retryLoops / Math.max(1, s.counts.toolCalls),
        session: s,
        detail: `${s.counts.retryLoops} consecutive identical tool calls`,
      })
    }

    if (s.counts.cancels >= 3) {
      insights.push({
        kind: "interrupted",
        severity: s.counts.cancels / Math.max(1, s.counts.userMessages),
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
        severity: s.counts.compactions / Math.max(20, s.counts.messages / 10),
        session: s,
        detail: `${s.counts.compactions} compactions over ${s.counts.messages} messages`,
      })
    }
  }

  const sortedCredits = [...credits].sort((a, b) => a - b)
  const medianCredits = sortedCredits[Math.floor(sortedCredits.length / 2)] ?? 0
  const p95 = sortedCredits[Math.floor(sortedCredits.length * 0.95)] ?? Infinity

  for (const row of rows) {
    const s = toSummary(row)
    if (s.usage.credits > p95 && s.usage.credits > 0) {
      insights.push({
        kind: "expensive",
        severity: medianCredits > 0 ? s.usage.credits / medianCredits / 100 : 1,
        session: s,
        detail: `${s.usage.credits.toLocaleString()} credits (p95+ outlier)`,
      })
    }
    if (s.activeTimeMs > 4 * 3600_000) {
      insights.push({
        kind: "marathon",
        severity: s.activeTimeMs / (24 * 3600_000),
        session: s,
        detail: `${(s.activeTimeMs / 3600_000).toFixed(1)}h of assistant active time`,
      })
    }
  }

  insights.sort((a, b) => b.severity - a.severity)
  return {
    generatedAt: Date.now(),
    overall: {
      sessions: rows.length,
      toolErrorRate: totalCalls ? totalErrors / totalCalls : 0,
      interruptionRate: rows.length ? interrupted / rows.length : 0,
      abandonRate: rows.length ? abandoned / rows.length : 0,
      medianCredits,
    },
    insights: insights.slice(0, filters.limit ?? 50),
  }
}
