import type { Database } from "bun:sqlite"
import { projectName } from "./types"

export interface SearchFilters {
  role?: "user" | "assistant"
  /** Block types to include */
  types?: Array<"text" | "thinking" | "tool_use" | "tool_result">
  tool?: string
  project?: string
  session?: string
  since?: number
  until?: number
  errorsOnly?: boolean
  limit?: number
}

export interface SearchHit {
  sessionId: string
  sessionTitle: string | null
  project: string
  seq: number
  blockIdx: number
  role: string
  type: string
  toolName: string | null
  ts: number | null
  snippet: string
}

export function searchBlocks(
  db: Database,
  query: string,
  filters: SearchFilters = {},
): SearchHit[] {
  const where: string[] = ["f.rowid = b.id", "s.id = b.session_id"]
  const params: (string | number)[] = []

  if (filters.role) {
    where.push("b.role = ?")
    params.push(filters.role)
  }
  if (filters.types?.length) {
    where.push(`b.type IN (${filters.types.map(() => "?").join(",")})`)
    params.push(...filters.types)
  }
  if (filters.tool) {
    where.push("b.tool_name = ?")
    params.push(filters.tool)
  }
  if (filters.project) {
    where.push("(s.cwd LIKE ? OR s.dir_slug LIKE ?)")
    params.push(`%${filters.project}%`, `%${filters.project}%`)
  }
  if (filters.session) {
    where.push("b.session_id LIKE ?")
    params.push(`${filters.session}%`)
  }
  if (filters.since !== undefined) {
    where.push("b.ts >= ?")
    params.push(filters.since)
  }
  if (filters.until !== undefined) {
    where.push("b.ts <= ?")
    params.push(filters.until)
  }
  if (filters.errorsOnly) where.push("b.is_error = 1")

  const limit = filters.limit ?? 50
  const sql = `
    SELECT b.session_id AS sessionId,
           COALESCE(s.session_title, s.title) AS sessionTitle,
           s.cwd AS cwd, s.dir_slug AS dirSlug,
           b.seq AS seq, b.block_idx AS blockIdx, b.role AS role, b.type AS type,
           b.tool_name AS toolName, b.ts AS ts,
           snippet(blocks_fts, 0, '\u0001', '\u0002', '\u2026', 24) AS snippet
    FROM blocks_fts f, blocks b, sessions s
    WHERE blocks_fts MATCH ? AND ${where.join(" AND ")}
    ORDER BY rank LIMIT ?`

  type Row = Omit<SearchHit, "project"> & { cwd: string | null; dirSlug: string }
  const run = (match: string): Row[] =>
    db.query<Row, (string | number)[]>(sql).all(match, ...params, limit)

  let rows: Row[]
  try {
    rows = run(query)
  } catch {
    // User query is not valid FTS5 syntax: quote each token and AND them.
    const safe = query
      .split(/\s+/)
      .filter(Boolean)
      .map((t) => `"${t.replaceAll('"', '""')}"`)
      .join(" ")
    rows = run(safe)
  }

  return rows.map(({ cwd, dirSlug, ...rest }) => ({
    ...rest,
    project: projectName(cwd, dirSlug),
  }))
}

export interface HistoryHit {
  idx: number
  ts: number | null
  mode: string | null
  command: string
}

export function searchHistory(db: Database, query: string, limit = 50): HistoryHit[] {
  return db
    .query<HistoryHit, [string, number]>(
      "SELECT idx, ts, mode, command FROM history WHERE command LIKE ? ORDER BY idx DESC LIMIT ?",
    )
    .all(`%${query}%`, limit)
}

export interface RegexHit {
  sessionId: string
  path: string
  lineNumber: number
  matchText: string
}

/** Regex search delegated to ripgrep over the raw JSONL source files. */
export async function regexSearch(
  sessionsRoot: string,
  pattern: string,
  opts: { limit?: number; ignoreCase?: boolean } = {},
): Promise<RegexHit[]> {
  const limit = opts.limit ?? 50
  const args = [
    "--json",
    "--glob",
    "*.jsonl",
    "--glob",
    "!attachments/**",
    "--glob",
    "!cache/**",
    "-m",
    "5",
  ]
  if (opts.ignoreCase) args.push("-i")
  args.push(pattern, sessionsRoot)

  const proc = Bun.spawn(["rg", ...args], { stdout: "pipe", stderr: "ignore" })
  const hits: RegexHit[] = []
  const text = await new Response(proc.stdout).text()
  for (const line of text.split("\n")) {
    if (hits.length >= limit) break
    if (!line) continue
    let event: any
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (event.type !== "match") continue
    const path: string = event.data.path?.text ?? ""
    const m = /([0-9a-f-]{36})\.jsonl$/.exec(path)
    if (!m) continue
    const sub = event.data.submatches?.[0]
    const lineText: string = event.data.lines?.text ?? ""
    hits.push({
      sessionId: m[1]!,
      path,
      lineNumber: event.data.line_number ?? 0,
      matchText: sub?.match?.text ?? lineText.slice(0, 200),
    })
  }
  await proc.exited
  return hits
}
