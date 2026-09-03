import { Database } from "bun:sqlite"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"

export const SCHEMA_VERSION = 2

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('transcript', 'settings')),
  size INTEGER NOT NULL,
  mtime_ms INTEGER NOT NULL,
  byte_offset INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_files_session ON files(session_id);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  dir_slug TEXT NOT NULL,
  transcript_path TEXT,
  settings_path TEXT,
  cwd TEXT,
  title TEXT,
  session_title TEXT,
  version INTEGER,
  fork_parent TEXT,
  created_at INTEGER,
  updated_at INTEGER,
  model TEXT,
  reasoning_effort TEXT,
  autonomy TEXT,
  active_time_ms INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  credits INTEGER NOT NULL DEFAULT 0,
  tags TEXT,
  is_subagent INTEGER NOT NULL DEFAULT 0,
  is_exec INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  user_message_count INTEGER NOT NULL DEFAULT 0,
  assistant_message_count INTEGER NOT NULL DEFAULT 0,
  tool_call_count INTEGER NOT NULL DEFAULT 0,
  tool_error_count INTEGER NOT NULL DEFAULT 0,
  cancel_count INTEGER NOT NULL DEFAULT 0,
  retry_loop_count INTEGER NOT NULL DEFAULT 0,
  compaction_count INTEGER NOT NULL DEFAULT 0,
  todo_count INTEGER NOT NULL DEFAULT 0,
  ended INTEGER NOT NULL DEFAULT 0,
  last_tool_sig TEXT,
  last_todos TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_slug ON sessions(dir_slug);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);

CREATE TABLE IF NOT EXISTS edges (
  parent_id TEXT NOT NULL,
  child_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('fork', 'subagent')),
  tool_use_id TEXT,
  PRIMARY KEY (parent_id, child_id, kind)
);
CREATE INDEX IF NOT EXISTS idx_edges_child ON edges(child_id);

CREATE TABLE IF NOT EXISTS messages (
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  record_id TEXT,
  role TEXT NOT NULL,
  ts INTEGER,
  day TEXT,
  -- Byte span of this record's line in the source JSONL, so block text can be
  -- read back on demand instead of duplicated into the index.
  byte_offset INTEGER NOT NULL DEFAULT 0,
  byte_length INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_messages_day ON messages(day, role);
-- Covering index for the per-session daily activity CTE behind byDay/byDayGroup.
CREATE INDEX IF NOT EXISTS idx_messages_activity ON messages(session_id, day)
  WHERE role = 'assistant' AND day IS NOT NULL;

CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  block_idx INTEGER NOT NULL,
  role TEXT NOT NULL,
  type TEXT NOT NULL,
  tool_name TEXT,
  tool_use_id TEXT,
  is_error INTEGER NOT NULL DEFAULT 0,
  ts INTEGER,
  full_length INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_blocks_session ON blocks(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_blocks_tool ON blocks(tool_name) WHERE tool_name IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_blocks_tooluse ON blocks(tool_use_id) WHERE tool_use_id IS NOT NULL;

-- Contentless: the tokenized text is never stored, only the inverted index.
-- Snippets are rebuilt from the source JSONL via messages.byte_offset.
CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
  content,
  tokenize='porter unicode61',
  content='',
  contentless_delete=1
);

CREATE TABLE IF NOT EXISTS history (
  idx INTEGER PRIMARY KEY,
  ts INTEGER,
  mode TEXT,
  command TEXT NOT NULL
);
`

export function openDb(dbPath: string): Database {
  if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath, { create: true })
  // Several dsx processes share this file (a live TUI's background refresh vs
  // a freshly launched command); bun:sqlite defaults busy_timeout to 0, which
  // turns any overlap into an instant SQLITE_BUSY crash. Set it before any
  // statement that can write, journal_mode included.
  db.exec("PRAGMA busy_timeout = 5000")
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
  db.exec("PRAGMA foreign_keys = ON")
  migrate(db)
  return db
}

function migrate(db: Database): void {
  const row = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='meta' LIMIT 1",
    )
    .get()
  if (row) {
    const version = db
      .query<{ value: string }, []>(
        "SELECT value FROM meta WHERE key='schema_version'",
      )
      .get()
    // Schema is current: write nothing, so concurrent dsx processes never
    // contend on the index at startup.
    if (version && Number(version.value) === SCHEMA_VERSION) return
    // Unknown or stale version: drop and rebuild from source.
    rebuildSchema(db)
    return
  }
  db.exec(SCHEMA)
  db.query(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
  ).run(String(SCHEMA_VERSION))
}

/** Schema changed: drop everything and let the indexer rebuild from source. */
function rebuildSchema(db: Database): void {
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
  for (const { name } of tables) db.exec(`DROP TABLE IF EXISTS "${name}"`)
  // Dropping tables only frees pages inside the file; hand them back to the OS
  // so an upgrade does not leave the old index's footprint behind.
  db.exec("VACUUM")
  db.exec(SCHEMA)
  db.query(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
  ).run(String(SCHEMA_VERSION))
}
