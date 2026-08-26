/** Typed views of droid session JSONL records and settings files. */

export interface SessionStartRecord {
  type: "session_start"
  id: string
  title?: string
  sessionTitle?: string
  owner?: string
  version?: number
  cwd?: string
  hostId?: string
  /** Present when this session was forked from another */
  parent?: string
}

export interface TextBlock {
  type: "text"
  text: string
}

export interface ThinkingBlock {
  type: "thinking"
  thinking: string
  durationMs?: number
}

export interface ToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: unknown
}

export type ToolResultContent =
  | string
  | Array<{ type: string; text?: string }>

export interface ToolResultBlock {
  type: "tool_result"
  tool_use_id: string
  content: ToolResultContent
  is_error?: boolean
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock

export type MessageRole = "user" | "assistant"

/**
 * The common shape: content blocks nested under `message`.
 */
export interface NestedMessageRecord {
  type: "message"
  id: string
  parentId?: string | null
  timestamp?: string | number
  message: {
    role: MessageRole
    content: string | ContentBlock[]
  }
}

/**
 * Flat variant emitted by some subagent transcripts: role and plain text live
 * on the record itself and `timestamp` is epoch milliseconds.
 */
export interface FlatMessageRecord {
  type: "message"
  id: string
  timestamp?: string | number
  role: MessageRole
  text: string
  session_id?: string
}

export type MessageRecord = NestedMessageRecord | FlatMessageRecord

export interface TodoStateRecord {
  type: "todo_state"
  id: string
  timestamp?: string | number
  todos?: { todos?: TodoStateValue }
}

export interface TodoItem {
  [key: string]: unknown
}

export type TodoStateValue = string | TodoItem[]

export interface CompactionStateRecord {
  type: "compaction_state"
  id: string
  timestamp?: string | number
  summaryText?: string
}

export interface SessionEndRecord {
  type: "session_end"
  timestamp?: string | number
  durationMs?: number
  toolCount?: number
  finalText?: string
}

export type SessionRecord =
  | SessionStartRecord
  | MessageRecord
  | TodoStateRecord
  | CompactionStateRecord
  | SessionEndRecord

export interface TokenUsage {
  inputTokens?: number
  outputTokens?: number
  cacheCreationTokens?: number
  cacheReadTokens?: number
  thinkingTokens?: number
  factoryCredits?: number
}

export interface SessionTag {
  name: string
  metadata?: {
    callingSessionId?: string
    callingToolUseId?: string
    [key: string]: unknown
  }
}

export interface SessionSettings {
  model?: string
  reasoningEffort?: string
  autonomyLevel?: string
  autonomyMode?: string
  interactionMode?: string
  assistantActiveTimeMs?: number
  tokenUsage?: TokenUsage
  inclusiveTokenUsage?: TokenUsage
  tags?: SessionTag[]
}

export interface HistoryEntry {
  command: string
  timestamp?: string
  type?: string
  mode?: string
}

/** Extract plain text from a tool_result content payload. */
export function toolResultText(content: ToolResultContent): string {
  if (typeof content === "string") return content
  return content
    .map((part) => (part.type === "text" && part.text ? part.text : ""))
    .filter(Boolean)
    .join("\n")
}

/** Normalize message content to an array of blocks. */
export function contentBlocks(
  content: string | ContentBlock[],
): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }]
  return content
}

export interface NormalizedMessage {
  role: MessageRole
  blocks: ContentBlock[]
}

/** The searchable text of a content block, matching what the indexer stores. */
export function blockText(block: ContentBlock): string {
  switch (block.type) {
    case "text":
      return block.text
    case "thinking":
      return block.thinking
    case "tool_use":
      return typeof block.input === "string" ? block.input : JSON.stringify(block.input)
    case "tool_result":
      return toolResultText(block.content)
  }
}

/**
 * Collapse the message record variants into one shape.
 *
 * Returns null for records that claim `type: "message"` but carry neither
 * shape — permission audit verdicts leak into some transcripts that way.
 */
export function normalizeMessage(
  record: MessageRecord,
): NormalizedMessage | null {
  const nested = (record as NestedMessageRecord).message
  if (nested && typeof nested === "object") {
    return { role: nested.role, blocks: contentBlocks(nested.content) }
  }
  const flat = record as FlatMessageRecord
  if (typeof flat.text === "string" && typeof flat.role === "string") {
    return { role: flat.role, blocks: [{ type: "text", text: flat.text }] }
  }
  return null
}

/** Normalize known todo_state payload variants into text safe for SQLite. */
export function todoStateText(todos: TodoStateValue | undefined): string | null {
  if (typeof todos === "string") return todos
  if (!Array.isArray(todos)) return null
  const lines = todos
    .map((todo) => {
      if (!todo || typeof todo !== "object") return String(todo)
      const content = typeof todo.content === "string" ? todo.content : ""
      if (!content) return JSON.stringify(todo)
      return typeof todo.status === "string"
        ? `- [${todo.status}] ${content}`
        : `- ${content}`
    })
    .filter(Boolean)
  return lines.join("\n")
}

/** Accepts ISO strings and epoch milliseconds; both appear in transcripts. */
export function parseTimestamp(ts: string | number | undefined): number | null {
  if (ts == null) return null
  if (typeof ts === "number") return Number.isFinite(ts) ? ts : null
  const ms = Date.parse(ts)
  return Number.isNaN(ms) ? null : ms
}
