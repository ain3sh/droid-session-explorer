import type { Database } from "bun:sqlite"

export interface UsageTotals {
  sessions: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  thinkingTokens: number
  credits: number
  activeTimeMs: number
  messages: number
  toolCalls: number
  toolErrors: number
}

export interface StatsFilters {
  project?: string
  model?: string
  since?: number
  until?: number
  includeSubagents?: boolean
  includeExec?: boolean
}

function sessionWhere(
  filters: StatsFilters,
  alias = "",
): { sql: string; params: (string | number)[] } {
  const p = alias ? `${alias}.` : ""
  const where: string[] = ["1=1"]
  const params: (string | number)[] = []
  if (filters.project) {
    where.push(`(${p}cwd LIKE ? OR ${p}dir_slug LIKE ?)`)
    params.push(`%${filters.project}%`, `%${filters.project}%`)
  }
  if (filters.model) {
    where.push(`${p}model LIKE ?`)
    params.push(`%${filters.model}%`)
  }
  if (filters.since !== undefined) {
    where.push(`${p}updated_at >= ?`)
    params.push(filters.since)
  }
  if (filters.until !== undefined) {
    where.push(`${p}created_at <= ?`)
    params.push(filters.until)
  }
  if (!filters.includeSubagents) where.push(`${p}is_subagent = 0`)
  if (!filters.includeExec) where.push(`${p}is_exec = 0`)
  return { sql: where.join(" AND "), params }
}

export type UsageMetric =
  | "credits"
  | "inputTokens"
  | "outputTokens"
  | "totalTokens"
  | "messages"
  | "sessions"
  | "toolCalls"
  | "toolErrors"
  | "errorRate"
  | "creditsPerOutputToken"
  | "creditsPerActiveHour"
  | "tokensPerMessage"

export interface UsageRates {
  totalTokens: number
  errorRate: number
  creditsPerOutputToken: number
  creditsPerActiveHour: number
  tokensPerMessage: number
}

export interface UsageLike {
  inputTokens: number
  outputTokens: number
  credits: number
  activeTimeMs?: number
  messages?: number
  sessions?: number
  toolCalls?: number
  toolErrors?: number
}

const safeRate = (n: number, d: number): number => (d > 0 ? n / d : 0)

export function deriveUsageRates(row: UsageLike): UsageRates {
  const totalTokens = row.inputTokens + row.outputTokens
  return {
    totalTokens,
    errorRate: safeRate(row.toolErrors ?? 0, row.toolCalls ?? 0),
    creditsPerOutputToken: safeRate(row.credits, row.outputTokens),
    creditsPerActiveHour: safeRate(row.credits, (row.activeTimeMs ?? 0) / 3600_000),
    tokensPerMessage: safeRate(totalTokens, row.messages ?? 0),
  }
}

export function metricValue(row: UsageLike, metric: UsageMetric): number {
  switch (metric) {
    case "credits":
      return row.credits
    case "inputTokens":
      return row.inputTokens
    case "outputTokens":
      return row.outputTokens
    case "totalTokens":
      return deriveUsageRates(row).totalTokens
    case "messages":
      return row.messages ?? 0
    case "sessions":
      return row.sessions ?? 0
    case "toolCalls":
      return row.toolCalls ?? 0
    case "toolErrors":
      return row.toolErrors ?? 0
    case "errorRate":
      return deriveUsageRates(row).errorRate
    case "creditsPerOutputToken":
      return deriveUsageRates(row).creditsPerOutputToken
    case "creditsPerActiveHour":
      return deriveUsageRates(row).creditsPerActiveHour
    case "tokensPerMessage":
      return deriveUsageRates(row).tokensPerMessage
  }
}

export function totals(db: Database, filters: StatsFilters = {}): UsageTotals {
  const { sql, params } = sessionWhere(filters)
  return db
    .query<UsageTotals, (string | number)[]>(
      `SELECT COUNT(*) AS sessions,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens,
              COALESCE(SUM(cache_read_tokens), 0) AS cacheReadTokens,
              COALESCE(SUM(cache_creation_tokens), 0) AS cacheCreationTokens,
              COALESCE(SUM(thinking_tokens), 0) AS thinkingTokens,
              COALESCE(SUM(credits), 0) AS credits,
              COALESCE(SUM(active_time_ms), 0) AS activeTimeMs,
              COALESCE(SUM(message_count), 0) AS messages,
              COALESCE(SUM(tool_call_count), 0) AS toolCalls,
              COALESCE(SUM(tool_error_count), 0) AS toolErrors
       FROM sessions WHERE ${sql}`,
    )
    .get(...params)!
}

export interface DailyUsage {
  day: string
  credits: number
  inputTokens: number
  outputTokens: number
  activeTimeMs: number
  messages: number
  sessions: number
  toolCalls: number
  toolErrors: number
}

/**
 * Daily usage. Session-level token totals are pro-rated across the days the
 * session was active, weighted by assistant message count per day.
 */
export function byDay(db: Database, filters: StatsFilters = {}): DailyUsage[] {
  const { sql, params } = sessionWhere(filters, "s")
  return db
    .query<DailyUsage, (string | number)[]>(
      `WITH activity AS (
         SELECT m.session_id, m.day, COUNT(*) AS msgs
         FROM messages m JOIN sessions s ON s.id = m.session_id
         WHERE m.role = 'assistant' AND m.day IS NOT NULL AND ${sql}
         GROUP BY m.session_id, m.day
       ),
       per_session AS (
         SELECT session_id, SUM(msgs) AS total FROM activity GROUP BY session_id
       )
       SELECT a.day AS day,
              CAST(ROUND(SUM(s.credits * 1.0 * a.msgs / p.total)) AS INTEGER) AS credits,
              CAST(ROUND(SUM(s.input_tokens * 1.0 * a.msgs / p.total)) AS INTEGER) AS inputTokens,
              CAST(ROUND(SUM(s.output_tokens * 1.0 * a.msgs / p.total)) AS INTEGER) AS outputTokens,
              CAST(ROUND(SUM(s.active_time_ms * 1.0 * a.msgs / p.total)) AS INTEGER) AS activeTimeMs,
              SUM(a.msgs) AS messages,
              COUNT(DISTINCT a.session_id) AS sessions,
              CAST(ROUND(SUM(s.tool_call_count * 1.0 * a.msgs / p.total)) AS INTEGER) AS toolCalls,
              CAST(ROUND(SUM(s.tool_error_count * 1.0 * a.msgs / p.total)) AS INTEGER) AS toolErrors
       FROM activity a
       JOIN per_session p ON p.session_id = a.session_id
       JOIN sessions s ON s.id = a.session_id
       GROUP BY a.day ORDER BY a.day`,
    )
    .all(...params)
}

export interface GroupUsage {
  key: string
  sessions: number
  inputTokens: number
  outputTokens: number
  credits: number
  activeTimeMs: number
  messages: number
  toolCalls: number
  toolErrors: number
}

export function byGroup(
  db: Database,
  group: "model" | "project",
  filters: StatsFilters = {},
): GroupUsage[] {
  const { sql, params } = sessionWhere(filters)
  const keyExpr =
    group === "model"
      ? "COALESCE(model, 'unknown')"
      : "COALESCE(cwd, dir_slug)"
  return db
    .query<GroupUsage, (string | number)[]>(
      `SELECT ${keyExpr} AS key,
              COUNT(*) AS sessions,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens,
              COALESCE(SUM(credits), 0) AS credits,
              COALESCE(SUM(active_time_ms), 0) AS activeTimeMs,
              COALESCE(SUM(message_count), 0) AS messages,
              COALESCE(SUM(tool_call_count), 0) AS toolCalls,
              COALESCE(SUM(tool_error_count), 0) AS toolErrors
       FROM sessions WHERE ${sql}
       GROUP BY key ORDER BY credits DESC, inputTokens DESC`,
    )
    .all(...params)
}

export interface DailyGroupUsage {
  day: string
  key: string
  credits: number
  inputTokens: number
  outputTokens: number
  activeTimeMs: number
  messages: number
  sessions: number
  toolCalls: number
  toolErrors: number
}

export function byDayGroup(
  db: Database,
  group: "model" | "project",
  filters: StatsFilters = {},
): DailyGroupUsage[] {
  const { sql, params } = sessionWhere(filters, "s")
  const keyExpr =
    group === "model"
      ? "COALESCE(s.model, 'unknown')"
      : "COALESCE(s.cwd, s.dir_slug)"
  return db
    .query<DailyGroupUsage, (string | number)[]>(
      `WITH activity AS (
         SELECT m.session_id, m.day, COUNT(*) AS msgs
         FROM messages m JOIN sessions s ON s.id = m.session_id
         WHERE m.role = 'assistant' AND m.day IS NOT NULL AND ${sql}
         GROUP BY m.session_id, m.day
       ),
       per_session AS (
         SELECT session_id, SUM(msgs) AS total FROM activity GROUP BY session_id
       )
       SELECT a.day AS day,
              ${keyExpr} AS key,
              CAST(ROUND(SUM(s.credits * 1.0 * a.msgs / p.total)) AS INTEGER) AS credits,
              CAST(ROUND(SUM(s.input_tokens * 1.0 * a.msgs / p.total)) AS INTEGER) AS inputTokens,
              CAST(ROUND(SUM(s.output_tokens * 1.0 * a.msgs / p.total)) AS INTEGER) AS outputTokens,
              CAST(ROUND(SUM(s.active_time_ms * 1.0 * a.msgs / p.total)) AS INTEGER) AS activeTimeMs,
              SUM(a.msgs) AS messages,
              COUNT(DISTINCT a.session_id) AS sessions,
              CAST(ROUND(SUM(s.tool_call_count * 1.0 * a.msgs / p.total)) AS INTEGER) AS toolCalls,
              CAST(ROUND(SUM(s.tool_error_count * 1.0 * a.msgs / p.total)) AS INTEGER) AS toolErrors
       FROM activity a
       JOIN per_session p ON p.session_id = a.session_id
       JOIN sessions s ON s.id = a.session_id
       GROUP BY a.day, key ORDER BY a.day, credits DESC, inputTokens DESC`,
    )
    .all(...params)
}

export interface GroupPairUsage {
  leftKey: string
  rightKey: string
  sessions: number
  inputTokens: number
  outputTokens: number
  credits: number
  activeTimeMs: number
  messages: number
  toolCalls: number
  toolErrors: number
}

export function byGroupPair(
  db: Database,
  left: "model" | "project",
  right: "model" | "project",
  filters: StatsFilters = {},
): GroupPairUsage[] {
  if (left === right) throw new Error("left and right groups must differ")
  const { sql, params } = sessionWhere(filters)
  const expr = (group: "model" | "project") =>
    group === "model" ? "COALESCE(model, 'unknown')" : "COALESCE(cwd, dir_slug)"
  return db
    .query<GroupPairUsage, (string | number)[]>(
      `SELECT ${expr(left)} AS leftKey,
              ${expr(right)} AS rightKey,
              COUNT(*) AS sessions,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens,
              COALESCE(SUM(credits), 0) AS credits,
              COALESCE(SUM(active_time_ms), 0) AS activeTimeMs,
              COALESCE(SUM(message_count), 0) AS messages,
              COALESCE(SUM(tool_call_count), 0) AS toolCalls,
              COALESCE(SUM(tool_error_count), 0) AS toolErrors
       FROM sessions WHERE ${sql}
       GROUP BY leftKey, rightKey ORDER BY credits DESC, inputTokens DESC`,
    )
    .all(...params)
}

export interface ToolUsage {
  tool: string
  calls: number
  errors: number
  sessions: number
}

export function byTool(db: Database, filters: StatsFilters = {}): ToolUsage[] {
  const { sql, params } = sessionWhere(filters, "s")
  return db
    .query<ToolUsage, (string | number)[]>(
      `SELECT u.tool_name AS tool,
              COUNT(*) AS calls,
              COALESCE(SUM(r.is_error), 0) AS errors,
              COUNT(DISTINCT u.session_id) AS sessions
       FROM blocks u
       JOIN sessions s ON s.id = u.session_id
       LEFT JOIN blocks r ON r.tool_use_id = u.tool_use_id AND r.type = 'tool_result'
       WHERE u.type = 'tool_use' AND ${sql}
       GROUP BY u.tool_name ORDER BY calls DESC`,
    )
    .all(...params)
}

export interface ToolMatrixUsage {
  key: string
  tool: string
  calls: number
  errors: number
  sessions: number
  errorRate: number
}

export function byToolMatrix(
  db: Database,
  group: "day" | "project" | "model",
  filters: StatsFilters = {},
): ToolMatrixUsage[] {
  const { sql, params } = sessionWhere(filters, "s")
  const keyExpr =
    group === "day"
      ? "date(u.ts / 1000, 'unixepoch', 'localtime')"
      : group === "model"
        ? "COALESCE(s.model, 'unknown')"
        : "COALESCE(s.cwd, s.dir_slug)"
  const dayWhere = group === "day" ? " AND u.ts IS NOT NULL" : ""
  return db
    .query<ToolMatrixUsage, (string | number)[]>(
      `SELECT ${keyExpr} AS key,
              u.tool_name AS tool,
              COUNT(*) AS calls,
              COALESCE(SUM(r.is_error), 0) AS errors,
              COUNT(DISTINCT u.session_id) AS sessions,
              COALESCE(SUM(r.is_error), 0) * 1.0 / COUNT(*) AS errorRate
       FROM blocks u
       JOIN sessions s ON s.id = u.session_id
       LEFT JOIN blocks r ON r.tool_use_id = u.tool_use_id AND r.type = 'tool_result'
       WHERE u.type = 'tool_use' AND ${sql}${dayWhere}
       GROUP BY key, u.tool_name ORDER BY key, calls DESC`,
    )
    .all(...params)
}

export interface SegmentUsage {
  segment: "main" | "subagent" | "exec"
  sessions: number
  inputTokens: number
  outputTokens: number
  credits: number
  activeTimeMs: number
  messages: number
  toolCalls: number
  toolErrors: number
}

export function bySegment(db: Database, filters: StatsFilters = {}): SegmentUsage[] {
  const { sql, params } = sessionWhere({
    ...filters,
    includeSubagents: true,
    includeExec: true,
  })
  return db
    .query<SegmentUsage, (string | number)[]>(
      `SELECT CASE
                WHEN is_subagent = 1 THEN 'subagent'
                WHEN is_exec = 1 THEN 'exec'
                ELSE 'main'
              END AS segment,
              COUNT(*) AS sessions,
              COALESCE(SUM(input_tokens), 0) AS inputTokens,
              COALESCE(SUM(output_tokens), 0) AS outputTokens,
              COALESCE(SUM(credits), 0) AS credits,
              COALESCE(SUM(active_time_ms), 0) AS activeTimeMs,
              COALESCE(SUM(message_count), 0) AS messages,
              COALESCE(SUM(tool_call_count), 0) AS toolCalls,
              COALESCE(SUM(tool_error_count), 0) AS toolErrors
       FROM sessions WHERE ${sql}
       GROUP BY segment
       ORDER BY CASE segment WHEN 'main' THEN 0 WHEN 'subagent' THEN 1 ELSE 2 END`,
    )
    .all(...params)
}

export interface HourActivity {
  hour: number
  messages: number
}

export function byHour(db: Database, filters: StatsFilters = {}): HourActivity[] {
  const { sql, params } = sessionWhere(filters, "s")
  return db
    .query<HourActivity, (string | number)[]>(
      `SELECT CAST(strftime('%H', m.ts / 1000, 'unixepoch', 'localtime') AS INTEGER) AS hour,
              COUNT(*) AS messages
       FROM messages m JOIN sessions s ON s.id = m.session_id
       WHERE m.ts IS NOT NULL AND ${sql}
       GROUP BY hour ORDER BY hour`,
    )
    .all(...params)
}

export interface DistributionBucket {
  from: number
  to: number
  count: number
}

export interface UsageDistribution {
  metric: "credits" | "tokens" | "active" | "toolErrors"
  count: number
  min: number
  p50: number
  p90: number
  p95: number
  max: number
  buckets: DistributionBucket[]
}

const DISTRIBUTION_EXPR: Record<UsageDistribution["metric"], string> = {
  credits: "credits",
  tokens: "input_tokens + output_tokens",
  active: "active_time_ms",
  toolErrors: "tool_error_count",
}

export function distribution(
  db: Database,
  metric: UsageDistribution["metric"],
  filters: StatsFilters = {},
): UsageDistribution {
  const { sql, params } = sessionWhere(filters)
  const values = db
    .query<{ value: number }, (string | number)[]>(
      `SELECT ${DISTRIBUTION_EXPR[metric]} AS value
       FROM sessions WHERE ${sql} ORDER BY value`,
    )
    .all(...params)
    .map((r) => r.value)

  const q = (pct: number): number => {
    if (values.length === 0) return 0
    const idx = Math.min(values.length - 1, Math.floor(values.length * pct))
    return values[idx]!
  }

  const min = values[0] ?? 0
  const max = values[values.length - 1] ?? 0
  const buckets: DistributionBucket[] = []
  if (values.length > 0) {
    if (min === max) {
      buckets.push({ from: min, to: max, count: values.length })
    } else {
      const bucketCount = 10
      const width = (max - min) / bucketCount
      for (let i = 0; i < bucketCount; i++) {
        const from = min + width * i
        const to = i === bucketCount - 1 ? max : min + width * (i + 1)
        buckets.push({ from, to, count: 0 })
      }
      for (const value of values) {
        const idx = Math.min(bucketCount - 1, Math.floor((value - min) / width))
        buckets[idx]!.count++
      }
    }
  }

  return {
    metric,
    count: values.length,
    min,
    p50: q(0.5),
    p90: q(0.9),
    p95: q(0.95),
    max,
    buckets,
  }
}
