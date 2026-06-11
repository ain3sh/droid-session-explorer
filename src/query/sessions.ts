import type { Database } from "bun:sqlite"
import { toSummary, type SessionRow, type SessionSummary } from "./types"

export interface ListFilters {
  /** Substring match against cwd and dir slug */
  project?: string
  since?: number
  until?: number
  model?: string
  minCredits?: number
  minTokens?: number
  /** Fuzzy match against the session title */
  query?: string
  includeSubagents?: boolean
  includeExec?: boolean
  sort?: "updated" | "created" | "tokens" | "credits" | "messages" | "active"
  limit?: number
  offset?: number
}

const SORT_SQL: Record<NonNullable<ListFilters["sort"]>, string> = {
  updated: "updated_at DESC",
  created: "created_at DESC",
  tokens: "(input_tokens + output_tokens) DESC",
  credits: "credits DESC",
  messages: "message_count DESC",
  active: "active_time_ms DESC",
}

export function listSessions(db: Database, filters: ListFilters = {}): SessionSummary[] {
  const where: string[] = []
  const params: (string | number)[] = []

  if (filters.project) {
    where.push("(cwd LIKE ? OR dir_slug LIKE ?)")
    params.push(`%${filters.project}%`, `%${filters.project}%`)
  }
  if (filters.since !== undefined) {
    where.push("updated_at >= ?")
    params.push(filters.since)
  }
  if (filters.until !== undefined) {
    where.push("created_at <= ?")
    params.push(filters.until)
  }
  if (filters.model) {
    where.push("model LIKE ?")
    params.push(`%${filters.model}%`)
  }
  if (filters.minCredits !== undefined) {
    where.push("credits >= ?")
    params.push(filters.minCredits)
  }
  if (filters.minTokens !== undefined) {
    where.push("(input_tokens + output_tokens) >= ?")
    params.push(filters.minTokens)
  }
  if (!filters.includeSubagents) where.push("is_subagent = 0")
  if (!filters.includeExec) where.push("is_exec = 0")

  const sort = SORT_SQL[filters.sort ?? "updated"]
  let sql = `SELECT * FROM sessions${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${sort} NULLS LAST`

  const rows = db.query<SessionRow, (string | number)[]>(sql).all(...params)
  let summaries = rows.map(toSummary)

  if (filters.query) {
    const scored = summaries
      .map((s) => ({ s, score: fuzzyScore(filters.query!, s.title ?? "") }))
      .filter((x) => x.score > 0)
    scored.sort((a, b) => b.score - a.score)
    summaries = scored.map((x) => x.s)
  }

  const offset = filters.offset ?? 0
  const limit = filters.limit ?? summaries.length
  return summaries.slice(offset, offset + limit)
}

export class SessionResolutionError extends Error {
  constructor(
    message: string,
    public readonly candidates: string[] = [],
  ) {
    super(message)
  }
}

/** Resolve a session by full id or unique prefix. */
export function resolveSession(db: Database, ref: string): SessionSummary {
  const exact = db
    .query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?")
    .get(ref)
  if (exact) return toSummary(exact)

  const matches = db
    .query<SessionRow, [string]>("SELECT * FROM sessions WHERE id LIKE ? LIMIT 10")
    .all(`${ref}%`)
  if (matches.length === 1) return toSummary(matches[0]!)
  if (matches.length === 0) {
    throw new SessionResolutionError(`no session matching '${ref}'`)
  }
  throw new SessionResolutionError(
    `ambiguous session prefix '${ref}' (${matches.length} matches)`,
    matches.map((m) => m.id),
  )
}

/** Tool usage histogram for one session. */
export function sessionToolStats(
  db: Database,
  sessionId: string,
): Array<{ tool: string; calls: number; errors: number }> {
  return db
    .query<{ tool: string; calls: number; errors: number }, [string]>(
      `SELECT u.tool_name AS tool, COUNT(*) AS calls,
              COALESCE(SUM(r.is_error), 0) AS errors
       FROM blocks u
       LEFT JOIN blocks r ON r.tool_use_id = u.tool_use_id AND r.type = 'tool_result'
       WHERE u.type = 'tool_use' AND u.session_id = ?
       GROUP BY u.tool_name ORDER BY calls DESC`,
    )
    .all(sessionId)
}

/**
 * Subsequence fuzzy score: 0 = no match. Rewards consecutive runs and
 * word-boundary hits; light, dependency-free, good enough for titles.
 */
export function fuzzyScore(needle: string, haystack: string): number {
  const n = needle.toLowerCase()
  const h = haystack.toLowerCase()
  if (!n) return 1
  let score = 0
  let hi = 0
  let lastHit = -2
  for (let ni = 0; ni < n.length; ni++) {
    const ch = n[ni]!
    if (ch === " ") {
      lastHit = -2
      continue
    }
    const found = h.indexOf(ch, hi)
    if (found === -1) return 0
    score += found === lastHit + 1 ? 3 : 1
    if (found === 0 || h[found - 1] === " " || h[found - 1] === "-") score += 2
    lastHit = found
    hi = found + 1
  }
  return score / Math.max(1, h.length / 16)
}
