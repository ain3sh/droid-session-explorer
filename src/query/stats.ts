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
  since?: number
  until?: number
  includeSubagents?: boolean
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
  if (filters.since !== undefined) {
    where.push(`${p}updated_at >= ?`)
    params.push(filters.since)
  }
  if (filters.until !== undefined) {
    where.push(`${p}created_at <= ?`)
    params.push(filters.until)
  }
  return { sql: where.join(" AND "), params }
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
  messages: number
  sessions: number
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
              SUM(a.msgs) AS messages,
              COUNT(DISTINCT a.session_id) AS sessions
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
              COALESCE(SUM(active_time_ms), 0) AS activeTimeMs
       FROM sessions WHERE ${sql}
       GROUP BY key ORDER BY credits DESC, inputTokens DESC`,
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
