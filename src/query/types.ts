export interface SessionRow {
  id: string
  dir_slug: string
  transcript_path: string | null
  settings_path: string | null
  cwd: string | null
  title: string | null
  session_title: string | null
  version: number | null
  fork_parent: string | null
  created_at: number | null
  updated_at: number | null
  model: string | null
  reasoning_effort: string | null
  autonomy: string | null
  active_time_ms: number
  input_tokens: number
  output_tokens: number
  cache_read_tokens: number
  cache_creation_tokens: number
  thinking_tokens: number
  credits: number
  tags: string | null
  is_subagent: number
  is_exec: number
  message_count: number
  user_message_count: number
  assistant_message_count: number
  tool_call_count: number
  tool_error_count: number
  cancel_count: number
  retry_loop_count: number
  compaction_count: number
  todo_count: number
  ended: number
  last_todos: string | null
}

export interface SessionSummary {
  id: string
  project: string
  cwd: string | null
  title: string | null
  createdAt: number | null
  updatedAt: number | null
  model: string | null
  reasoningEffort: string | null
  autonomy: string | null
  activeTimeMs: number
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheCreationTokens: number
    thinkingTokens: number
    credits: number
  }
  counts: {
    messages: number
    userMessages: number
    assistantMessages: number
    toolCalls: number
    toolErrors: number
    cancels: number
    retryLoops: number
    compactions: number
    todos: number
  }
  isSubagent: boolean
  isExec: boolean
  forkParent: string | null
  ended: boolean
  transcriptPath: string | null
  settingsPath: string | null
  lastTodos: string | null
}

export function toSummary(row: SessionRow): SessionSummary {
  return {
    id: row.id,
    project: projectName(row.cwd, row.dir_slug),
    cwd: row.cwd,
    title: row.session_title ?? row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    model: row.model,
    reasoningEffort: row.reasoning_effort,
    autonomy: row.autonomy,
    activeTimeMs: row.active_time_ms,
    usage: {
      inputTokens: row.input_tokens,
      outputTokens: row.output_tokens,
      cacheReadTokens: row.cache_read_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      thinkingTokens: row.thinking_tokens,
      credits: row.credits,
    },
    counts: {
      messages: row.message_count,
      userMessages: row.user_message_count,
      assistantMessages: row.assistant_message_count,
      toolCalls: row.tool_call_count,
      toolErrors: row.tool_error_count,
      cancels: row.cancel_count,
      retryLoops: row.retry_loop_count,
      compactions: row.compaction_count,
      todos: row.todo_count,
    },
    isSubagent: row.is_subagent === 1,
    isExec: row.is_exec === 1,
    forkParent: row.fork_parent,
    ended: row.ended === 1,
    transcriptPath: row.transcript_path,
    settingsPath: row.settings_path,
    lastTodos: row.last_todos,
  }
}

/** Short human project name derived from cwd (or the dir slug as fallback). */
export function projectName(cwd: string | null, dirSlug: string): string {
  if (cwd) {
    const parts = cwd.split("/").filter(Boolean)
    return parts[parts.length - 1] ?? cwd
  }
  const parts = dirSlug.split("-").filter(Boolean)
  return parts[parts.length - 1] ?? dirSlug
}

export const SESSION_COLUMNS = "*"
