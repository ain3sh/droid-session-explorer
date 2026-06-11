import type { Database } from "bun:sqlite"
import { readFileSync, statSync } from "node:fs"
import type { DsxConfig } from "../config"
import type { ScannedFile } from "./scanner"
import { scanSessions } from "./scanner"
import {
  contentBlocks,
  parseTimestamp,
  toolResultText,
  type HistoryEntry,
  type SessionRecord,
  type SessionSettings,
} from "./records"

export interface IndexResult {
  filesSeen: number
  transcriptsIngested: number
  settingsIngested: number
  linesParsed: number
  sessionsRemoved: number
  durationMs: number
}

export type ProgressFn = (done: number, total: number, path: string) => void

const CANCEL_RE = /(?:request )?cancell?ed by (?:the )?user|interrupted by user/i

interface SessionCounters {
  message_count: number
  user_message_count: number
  assistant_message_count: number
  tool_call_count: number
  tool_error_count: number
  cancel_count: number
  retry_loop_count: number
  compaction_count: number
  todo_count: number
  created_at: number | null
  updated_at: number | null
  last_tool_sig: string | null
  last_todos: string | null
  ended: number
}

export class Indexer {
  constructor(
    private db: Database,
    private config: DsxConfig,
  ) {}

  /** Incrementally bring the index up to date with disk. */
  async refresh(onProgress?: ProgressFn): Promise<IndexResult> {
    const start = performance.now()
    const scanned = scanSessions(this.config.sessionsRoot)
    const known = new Map<string, { size: number; mtime_ms: number; byte_offset: number }>()
    for (const row of this.db
      .query<{ path: string; size: number; mtime_ms: number; byte_offset: number }, []>(
        "SELECT path, size, mtime_ms, byte_offset FROM files",
      )
      .all()) {
      known.set(row.path, row)
    }

    const result: IndexResult = {
      filesSeen: scanned.length,
      transcriptsIngested: 0,
      settingsIngested: 0,
      linesParsed: 0,
      sessionsRemoved: 0,
      durationMs: 0,
    }

    const pending = scanned.filter((f) => {
      const prev = known.get(f.path)
      return !prev || prev.size !== f.size || prev.mtime_ms !== f.mtimeMs
    })
    // Settings before transcripts so usage/tags land even for brand-new sessions,
    // and transcripts sorted for deterministic ingest order.
    pending.sort((a, b) =>
      a.kind === b.kind ? a.path.localeCompare(b.path) : a.kind === "settings" ? -1 : 1,
    )

    let done = 0
    for (const file of pending) {
      onProgress?.(done++, pending.length, file.path)
      if (file.kind === "settings") {
        await this.ingestSettings(file)
        result.settingsIngested++
      } else {
        result.linesParsed += await this.ingestTranscript(file, known.get(file.path)?.byte_offset ?? 0)
        result.transcriptsIngested++
      }
    }

    result.sessionsRemoved = this.removeDeleted(scanned, known)
    this.ingestHistory()
    result.durationMs = performance.now() - start
    return result
  }

  /** Drop all indexed data and re-ingest from scratch. */
  async rebuild(onProgress?: ProgressFn): Promise<IndexResult> {
    this.db.exec(
      "DELETE FROM files; DELETE FROM sessions; DELETE FROM edges; DELETE FROM messages; DELETE FROM blocks; DELETE FROM blocks_fts; DELETE FROM history;",
    )
    this.db.query("DELETE FROM meta WHERE key='history_mtime'").run()
    return this.refresh(onProgress)
  }

  // ---------------------------------------------------------------- settings

  private async ingestSettings(file: ScannedFile): Promise<void> {
    let settings: SessionSettings
    try {
      settings = (await Bun.file(file.path).json()) as SessionSettings
    } catch {
      return
    }
    this.ensureSession(file.sessionId, file.dirSlug)
    const usage = settings.tokenUsage ?? {}
    const tags = settings.tags ?? []
    const isSubagent = tags.some((t) => t.name === "subagent") ? 1 : 0
    const isExec = tags.some((t) => t.name === "exec") ? 1 : 0

    this.db
      .query(
        `UPDATE sessions SET
           settings_path = ?, model = ?, reasoning_effort = ?, autonomy = ?,
           active_time_ms = ?, input_tokens = ?, output_tokens = ?,
           cache_read_tokens = ?, cache_creation_tokens = ?, thinking_tokens = ?,
           credits = ?, tags = ?, is_subagent = ?, is_exec = ?
         WHERE id = ?`,
      )
      .run(
        file.path,
        settings.model ?? null,
        settings.reasoningEffort ?? null,
        settings.autonomyMode ?? settings.autonomyLevel ?? null,
        settings.assistantActiveTimeMs ?? 0,
        usage.inputTokens ?? 0,
        usage.outputTokens ?? 0,
        usage.cacheReadTokens ?? 0,
        usage.cacheCreationTokens ?? 0,
        usage.thinkingTokens ?? 0,
        usage.factoryCredits ?? 0,
        tags.length ? JSON.stringify(tags) : null,
        isSubagent,
        isExec,
        file.sessionId,
      )

    for (const tag of tags) {
      const caller = tag.metadata?.callingSessionId
      if (tag.name === "subagent" && caller) {
        this.db
          .query(
            "INSERT OR REPLACE INTO edges (parent_id, child_id, kind, tool_use_id) VALUES (?, ?, 'subagent', ?)",
          )
          .run(caller, file.sessionId, tag.metadata?.callingToolUseId ?? null)
      }
    }

    this.rememberFile(file, file.size)
  }

  // -------------------------------------------------------------- transcript

  private async ingestTranscript(file: ScannedFile, prevOffset: number): Promise<number> {
    const canonical = this.db
      .query<{ transcript_path: string | null }, [string]>(
        "SELECT transcript_path FROM sessions WHERE id = ?",
      )
      .get(file.sessionId)
    if (canonical?.transcript_path && canonical.transcript_path !== file.path) {
      // Duplicate session id in another dir; first indexed path stays canonical.
      this.rememberFile(file, file.size)
      return 0
    }

    let offset = prevOffset
    if (offset > file.size) {
      // File shrank (rewritten, e.g. migrate-path): reparse from scratch.
      this.purgeTranscriptData(file.sessionId)
      offset = 0
    }

    this.ensureSession(file.sessionId, file.dirSlug)
    this.db
      .query("UPDATE sessions SET transcript_path = ?, dir_slug = ?, ended = 0 WHERE id = ?")
      .run(file.path, file.dirSlug, file.sessionId)

    const counters = this.loadCounters(file.sessionId)
    const insertMessage = this.db.query(
      "INSERT OR REPLACE INTO messages (session_id, seq, record_id, role, ts, day) VALUES (?, ?, ?, ?, ?, ?)",
    )
    const insertBlock = this.db.query(
      `INSERT INTO blocks (session_id, seq, block_idx, role, type, tool_name, tool_use_id, is_error, ts, full_length)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    )
    const insertFts = this.db.query("INSERT INTO blocks_fts (rowid, content) VALUES (?, ?)")
    const maxBytes = this.config.maxIndexedBlockBytes

    let lines = 0
    const ingestLine = (line: string): void => {
      let record: SessionRecord
      try {
        record = JSON.parse(line) as SessionRecord
      } catch {
        return
      }
      lines++
      const ts = parseTimestamp("timestamp" in record ? record.timestamp : undefined)
      if (ts !== null) {
        counters.created_at = counters.created_at === null ? ts : Math.min(counters.created_at, ts)
        counters.updated_at = counters.updated_at === null ? ts : Math.max(counters.updated_at, ts)
      }

      switch (record.type) {
        case "session_start": {
          this.db
            .query(
              "UPDATE sessions SET title = ?, session_title = ?, cwd = ?, version = ?, fork_parent = ? WHERE id = ?",
            )
            .run(
              record.title ?? null,
              record.sessionTitle ?? null,
              record.cwd ?? null,
              record.version ?? null,
              record.parent ?? null,
              file.sessionId,
            )
          if (record.parent) {
            this.db
              .query(
                "INSERT OR REPLACE INTO edges (parent_id, child_id, kind, tool_use_id) VALUES (?, ?, 'fork', NULL)",
              )
              .run(record.parent, file.sessionId)
          }
          break
        }
        case "message": {
          const seq = counters.message_count++
          const role = record.message.role
          if (role === "user") counters.user_message_count++
          else counters.assistant_message_count++
          insertMessage.run(file.sessionId, seq, record.id ?? null, role, ts, dayOf(ts))

          const blocks = contentBlocks(record.message.content)
          for (let i = 0; i < blocks.length; i++) {
            const block = blocks[i]!
            let text = ""
            let toolName: string | null = null
            let toolUseId: string | null = null
            let isError = 0
            switch (block.type) {
              case "text":
                text = block.text
                break
              case "thinking":
                text = block.thinking
                break
              case "tool_use": {
                toolName = block.name
                toolUseId = block.id
                text = typeof block.input === "string" ? block.input : JSON.stringify(block.input)
                counters.tool_call_count++
                const sig = `${block.name}\u0000${text}`
                if (sig === counters.last_tool_sig) counters.retry_loop_count++
                counters.last_tool_sig = sig
                break
              }
              case "tool_result":
                toolUseId = block.tool_use_id
                text = toolResultText(block.content)
                isError = block.is_error ? 1 : 0
                if (isError) counters.tool_error_count++
                break
              default:
                continue
            }
            if (CANCEL_RE.test(text.slice(0, 4096))) counters.cancel_count++
            const row = insertBlock.get(
              file.sessionId,
              seq,
              i,
              role,
              block.type,
              toolName,
              toolUseId,
              isError,
              ts,
              text.length,
            ) as { id: number }
            if (text) insertFts.run(row.id, text.slice(0, maxBytes))
          }
          break
        }
        case "todo_state":
          counters.todo_count++
          counters.last_todos = record.todos?.todos ?? counters.last_todos
          break
        case "compaction_state":
          counters.compaction_count++
          break
        case "session_end":
          counters.ended = 1
          break
      }
    }

    const tx = this.db.transaction((batch: string[]) => {
      for (const line of batch) ingestLine(line)
    })

    const BATCH = 2000
    let batch: string[] = []
    let consumed = offset
    for await (const { line, byteLength, terminated } of readLines(file.path, offset)) {
      if (!terminated) {
        // Trailing line without newline: only consume if it is complete JSON.
        try {
          JSON.parse(line)
        } catch {
          break
        }
      }
      batch.push(line)
      consumed += byteLength
      if (batch.length >= BATCH) {
        tx(batch)
        batch = []
      }
    }
    if (batch.length) tx(batch)
    this.flushCounters(file.sessionId, counters)
    this.rememberFile(file, consumed)
    return lines
  }

  // ----------------------------------------------------------------- history

  private ingestHistory(): void {
    let st
    try {
      st = statSync(this.config.historyPath)
    } catch {
      return
    }
    const mtime = String(Math.floor(st.mtimeMs))
    const prev = this.db
      .query<{ value: string }, [string]>("SELECT value FROM meta WHERE key = ?")
      .get("history_mtime")
    if (prev?.value === mtime) return

    let entries: HistoryEntry[]
    try {
      const raw = JSON.parse(readFileSync(this.config.historyPath, "utf-8"))
      entries = Array.isArray(raw) ? raw : []
    } catch {
      return
    }
    const tx = this.db.transaction(() => {
      this.db.query("DELETE FROM history").run()
      const insert = this.db.query(
        "INSERT INTO history (idx, ts, mode, command) VALUES (?, ?, ?, ?)",
      )
      entries.forEach((entry, idx) => {
        if (typeof entry?.command !== "string") return
        insert.run(idx, parseTimestamp(entry.timestamp), entry.mode ?? null, entry.command)
      })
      this.db
        .query("INSERT OR REPLACE INTO meta (key, value) VALUES ('history_mtime', ?)")
        .run(mtime)
    })
    tx()
  }

  // ----------------------------------------------------------------- helpers

  private ensureSession(id: string, dirSlug: string): void {
    this.db
      .query("INSERT OR IGNORE INTO sessions (id, dir_slug) VALUES (?, ?)")
      .run(id, dirSlug)
  }

  private rememberFile(file: ScannedFile, byteOffset: number): void {
    this.db
      .query(
        `INSERT INTO files (path, session_id, kind, size, mtime_ms, byte_offset)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET size = excluded.size, mtime_ms = excluded.mtime_ms, byte_offset = excluded.byte_offset`,
      )
      .run(file.path, file.sessionId, file.kind, file.size, file.mtimeMs, byteOffset)
  }

  private loadCounters(sessionId: string): SessionCounters {
    return this.db
      .query<SessionCounters, [string]>(
        `SELECT message_count, user_message_count, assistant_message_count,
                tool_call_count, tool_error_count, cancel_count, retry_loop_count,
                compaction_count, todo_count, created_at, updated_at,
                last_tool_sig, last_todos, ended
         FROM sessions WHERE id = ?`,
      )
      .get(sessionId)!
  }

  private flushCounters(sessionId: string, c: SessionCounters): void {
    this.db
      .query(
        `UPDATE sessions SET
           message_count = ?, user_message_count = ?, assistant_message_count = ?,
           tool_call_count = ?, tool_error_count = ?, cancel_count = ?,
           retry_loop_count = ?, compaction_count = ?, todo_count = ?,
           created_at = ?, updated_at = ?, last_tool_sig = ?, last_todos = ?, ended = ?
         WHERE id = ?`,
      )
      .run(
        c.message_count,
        c.user_message_count,
        c.assistant_message_count,
        c.tool_call_count,
        c.tool_error_count,
        c.cancel_count,
        c.retry_loop_count,
        c.compaction_count,
        c.todo_count,
        c.created_at,
        c.updated_at,
        c.last_tool_sig,
        c.last_todos,
        c.ended,
        sessionId,
      )
  }

  private purgeTranscriptData(sessionId: string): void {
    this.db
      .query(
        "DELETE FROM blocks_fts WHERE rowid IN (SELECT id FROM blocks WHERE session_id = ?)",
      )
      .run(sessionId)
    this.db.query("DELETE FROM blocks WHERE session_id = ?").run(sessionId)
    this.db.query("DELETE FROM messages WHERE session_id = ?").run(sessionId)
    this.db
      .query(
        `UPDATE sessions SET
           message_count = 0, user_message_count = 0, assistant_message_count = 0,
           tool_call_count = 0, tool_error_count = 0, cancel_count = 0,
           retry_loop_count = 0, compaction_count = 0, todo_count = 0,
           created_at = NULL, updated_at = NULL, last_tool_sig = NULL,
           last_todos = NULL, ended = 0
         WHERE id = ?`,
      )
      .run(sessionId)
  }

  private removeDeleted(
    scanned: ScannedFile[],
    known: Map<string, { size: number; mtime_ms: number; byte_offset: number }>,
  ): number {
    const onDisk = new Set(scanned.map((f) => f.path))
    const goneTranscripts = new Set<string>()
    const gonePaths: string[] = []
    for (const path of known.keys()) {
      if (onDisk.has(path)) continue
      gonePaths.push(path)
      const row = this.db
        .query<{ session_id: string; kind: string }, [string]>(
          "SELECT session_id, kind FROM files WHERE path = ?",
        )
        .get(path)
      if (row?.kind === "transcript") goneTranscripts.add(row.session_id)
    }
    for (const path of gonePaths) {
      this.db.query("DELETE FROM files WHERE path = ?").run(path)
    }

    let removed = 0
    for (const sessionId of goneTranscripts) {
      const canonical = this.db
        .query<{ transcript_path: string | null }, [string]>(
          "SELECT transcript_path FROM sessions WHERE id = ?",
        )
        .get(sessionId)
      const stillExists = canonical?.transcript_path && onDisk.has(canonical.transcript_path)
      if (stillExists) continue
      this.purgeTranscriptData(sessionId)
      this.db.query("DELETE FROM edges WHERE child_id = ? OR parent_id = ?").run(sessionId, sessionId)
      this.db.query("DELETE FROM sessions WHERE id = ?").run(sessionId)
      removed++
    }
    return removed
  }
}

function dayOf(ts: number | null): string | null {
  if (ts === null) return null
  const d = new Date(ts)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

interface LineChunk {
  line: string
  /** Bytes consumed including the trailing newline when present */
  byteLength: number
  terminated: boolean
}

/** Stream complete lines from a byte offset, tracking exact byte consumption. */
async function* readLines(path: string, offset: number): AsyncGenerator<LineChunk> {
  const file = Bun.file(path)
  const stream = file.slice(offset).stream()
  const decoder = new TextDecoder("utf-8", { fatal: false })
  let buffer = new Uint8Array(0)

  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const merged = new Uint8Array(buffer.length + value.length)
      merged.set(buffer)
      merged.set(value, buffer.length)
      buffer = merged

      let start = 0
      let nl: number
      while ((nl = buffer.indexOf(0x0a, start)) !== -1) {
        const lineBytes = buffer.subarray(start, nl)
        yield {
          line: decoder.decode(lineBytes),
          byteLength: nl - start + 1,
          terminated: true,
        }
        start = nl + 1
      }
      buffer = buffer.subarray(start)
    }
  } finally {
    reader.releaseLock()
  }

  if (buffer.length > 0) {
    yield { line: decoder.decode(buffer), byteLength: buffer.length, terminated: false }
  }
}
