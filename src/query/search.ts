import type { Database } from "bun:sqlite"
import { closeSync, openSync, readSync } from "node:fs"
import {
  blockText,
  normalizeMessage,
  type MessageRecord,
} from "../indexer/records"
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
           s.cwd AS cwd, s.dir_slug AS dirSlug, s.transcript_path AS transcriptPath,
           b.seq AS seq, b.block_idx AS blockIdx, b.role AS role, b.type AS type,
           b.tool_name AS toolName, b.ts AS ts,
           m.byte_offset AS byteOffset, m.byte_length AS byteLength
    FROM blocks_fts f, blocks b, sessions s
    JOIN messages m ON m.session_id = b.session_id AND m.seq = b.seq
    WHERE blocks_fts MATCH ? AND ${where.join(" AND ")}
    ORDER BY rank LIMIT ?`

  type Row = Omit<SearchHit, "project" | "snippet"> & {
    cwd: string | null
    dirSlug: string
    transcriptPath: string | null
    byteOffset: number
    byteLength: number
  }
  const run = (match: string): Row[] =>
    db.query<Row, (string | number)[]>(sql).all(match, ...params, limit)

  let rows: Row[]
  let terms: string[]
  try {
    rows = run(query)
    terms = matchTerms(query)
  } catch {
    // User query is not valid FTS5 syntax: quote each token and AND them.
    const tokens = query.split(/\s+/).filter(Boolean)
    rows = run(tokens.map((t) => `"${t.replaceAll('"', '""')}"`).join(" "))
    terms = tokens
  }

  return rows.map(({ cwd, dirSlug, transcriptPath, byteOffset, byteLength, ...rest }) => ({
    ...rest,
    project: projectName(cwd, dirSlug),
    snippet: readSnippet(transcriptPath, byteOffset, byteLength, rest.blockIdx, terms),
  }))
}

/**
 * Bare words an FTS5 query matches on, for highlighting. Operators, column
 * filters and punctuation are dropped; phrases contribute their words.
 */
function matchTerms(query: string): string[] {
  const terms: string[] = []
  for (const raw of query.match(/"[^"]*"|[^\s()]+/g) ?? []) {
    const token = raw.startsWith('"') ? raw.slice(1, -1) : raw
    if (/^(AND|OR|NOT|NEAR)$/.test(token)) continue
    for (const word of token.split(/[^\p{L}\p{N}_]+/u)) {
      if (word) terms.push(word.toLowerCase())
    }
  }
  return terms
}

/**
 * Rebuild a highlighted snippet by re-reading the block's source line. The FTS
 * index is contentless, so the transcript on disk is the only copy of the text.
 */
function readSnippet(
  transcriptPath: string | null,
  byteOffset: number,
  byteLength: number,
  blockIdx: number,
  terms: string[],
): string {
  if (!transcriptPath || byteLength <= 0) return ""
  let text: string
  try {
    const line = readFileSyncSlice(transcriptPath, byteOffset, byteLength)
    const record = JSON.parse(line) as MessageRecord
    const normalized = normalizeMessage(record)
    const block = normalized?.blocks[blockIdx]
    if (!block) return ""
    text = blockText(block)
  } catch {
    return ""
  }
  return buildSnippet(text, terms)
}

function readFileSyncSlice(path: string, offset: number, length: number): string {
  const fd = openSync(path, "r")
  try {
    const buf = Buffer.allocUnsafe(length)
    const read = readSync(fd, buf, 0, length, offset)
    return buf.subarray(0, read).toString("utf-8")
  } finally {
    closeSync(fd)
  }
}

const SNIPPET_WORDS = 24

/** Window the text around the first match and wrap hits in sentinels. */
function buildSnippet(text: string, terms: string[]): string {
  const words = text.split(/(\s+)/)
  const isHit = (word: string): boolean => {
    const lower = word.toLowerCase()
    return terms.some((t) => lower.includes(t))
  }

  let firstHit = words.findIndex((w) => w.trim() && isHit(w))
  if (firstHit === -1) firstHit = 0

  // Center the window on the first hit, in whitespace-preserving pairs.
  const span = SNIPPET_WORDS * 2
  const start = Math.max(0, firstHit - span / 2)
  const end = Math.min(words.length, start + span)
  const parts = words.slice(start, end).map((w) => (w.trim() && isHit(w) ? highlight(w, terms) : w))

  const out = parts.join("")
  return `${start > 0 ? "\u2026" : ""}${out}${end < words.length ? "\u2026" : ""}`
}

function highlight(word: string, terms: string[]): string {
  const lower = word.toLowerCase()
  let best = -1
  let bestLen = 0
  for (const term of terms) {
    const at = lower.indexOf(term)
    if (at !== -1 && (best === -1 || at < best)) {
      best = at
      bestLen = term.length
    }
  }
  if (best === -1) return word
  return `${word.slice(0, best)}\u0001${word.slice(best, best + bestLen)}\u0002${word.slice(best + bestLen)}`
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

/** The subset of ripgrep's --json event stream regexSearch consumes. */
interface RgEvent {
  type: string
  data?: {
    path?: { text?: string }
    line_number?: number
    lines?: { text?: string }
    submatches?: Array<{ match?: { text?: string } }>
  }
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

  const ingest = (line: string): void => {
    let event: RgEvent
    try {
      event = JSON.parse(line) as RgEvent
    } catch {
      return // rg --json emits only JSON lines; anything else is stream noise to skip
    }
    if (event.type !== "match" || !event.data) return
    const path = event.data.path?.text ?? ""
    const m = /([0-9a-f-]{36})\.jsonl$/.exec(path)
    if (!m) return
    const lineText = event.data.lines?.text ?? ""
    hits.push({
      sessionId: m[1]!,
      path,
      lineNumber: event.data.line_number ?? 0,
      matchText: event.data.submatches?.[0]?.match?.text ?? lineText.slice(0, 200),
    })
  }

  // Stream events and stop ripgrep as soon as the limit is reached, instead
  // of buffering its entire output.
  const decoder = new TextDecoder()
  let buf = ""
  outer: for await (const chunk of proc.stdout) {
    buf += decoder.decode(chunk, { stream: true })
    let nl: number
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line) ingest(line)
      if (hits.length >= limit) break outer
    }
  }
  if (hits.length >= limit) proc.kill()
  else if (buf) ingest(buf)
  await proc.exited
  return hits.slice(0, limit)
}
