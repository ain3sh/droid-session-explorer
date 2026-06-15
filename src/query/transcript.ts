import {
  contentBlocks,
  parseTimestamp,
  todoStateText,
  toolResultText,
  type SessionRecord,
} from "../indexer/records"

/** Render-model entry for transcript viewers and exporters. */
export type TranscriptEntry =
  | { kind: "user"; ts: number | null; text: string }
  | { kind: "assistant"; ts: number | null; text: string }
  | { kind: "thinking"; ts: number | null; text: string; durationMs?: number }
  | {
      kind: "tool_call"
      ts: number | null
      tool: string
      input: string
      result: string | null
      isError: boolean
    }
  | { kind: "todo"; ts: number | null; text: string }
  | { kind: "compaction"; ts: number | null; text: string }
  | { kind: "session_end"; ts: number | null; finalText: string | null }

export interface Transcript {
  sessionId: string
  title: string | null
  cwd: string | null
  forkParent: string | null
  entries: TranscriptEntry[]
}

/** Parse a full session JSONL into a linear render model (full fidelity, from source). */
export async function loadTranscript(path: string): Promise<Transcript> {
  const text = await Bun.file(path).text()
  const transcript: Transcript = {
    sessionId: "",
    title: null,
    cwd: null,
    forkParent: null,
    entries: [],
  }
  // tool_use blocks awaiting their tool_result
  const pendingTools = new Map<
    string,
    Extract<TranscriptEntry, { kind: "tool_call" }>
  >()

  for (const line of text.split("\n")) {
    if (!line) continue
    let record: SessionRecord
    try {
      record = JSON.parse(line) as SessionRecord
    } catch {
      continue
    }
    const ts = parseTimestamp("timestamp" in record ? record.timestamp : undefined)
    switch (record.type) {
      case "session_start":
        transcript.sessionId = record.id
        transcript.title = record.sessionTitle ?? record.title ?? null
        transcript.cwd = record.cwd ?? null
        transcript.forkParent = record.parent ?? null
        break
      case "message": {
        const role = record.message.role
        for (const block of contentBlocks(record.message.content)) {
          switch (block.type) {
            case "text":
              if (block.text.trim()) {
                transcript.entries.push({ kind: role, ts, text: block.text })
              }
              break
            case "thinking":
              transcript.entries.push({
                kind: "thinking",
                ts,
                text: block.thinking,
                durationMs: block.durationMs,
              })
              break
            case "tool_use": {
              const entry: Extract<TranscriptEntry, { kind: "tool_call" }> = {
                kind: "tool_call",
                ts,
                tool: block.name,
                input:
                  typeof block.input === "string"
                    ? block.input
                    : JSON.stringify(block.input, null, 2),
                result: null,
                isError: false,
              }
              transcript.entries.push(entry)
              pendingTools.set(block.id, entry)
              break
            }
            case "tool_result": {
              const pending = pendingTools.get(block.tool_use_id)
              const resultText = toolResultText(block.content)
              if (pending) {
                pending.result = resultText
                pending.isError = Boolean(block.is_error)
                pendingTools.delete(block.tool_use_id)
              }
              break
            }
          }
        }
        break
      }
      case "todo_state":
        {
          const todos = todoStateText(record.todos?.todos)
          if (todos) transcript.entries.push({ kind: "todo", ts, text: todos })
        }
        break
      case "compaction_state":
        transcript.entries.push({
          kind: "compaction",
          ts,
          text: record.summaryText ?? "(compacted)",
        })
        break
      case "session_end":
        transcript.entries.push({
          kind: "session_end",
          ts,
          finalText: record.finalText ?? null,
        })
        break
    }
  }
  return transcript
}
