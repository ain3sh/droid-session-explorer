import { homedir } from "node:os"
import { join } from "node:path"

export interface DsxConfig {
  /** Root of droid session storage (dirs of <slug>/<uuid>.jsonl) */
  sessionsRoot: string
  /** Path to droid prompt history.json */
  historyPath: string
  /** Path to the SQLite index */
  dbPath: string
  /** Max bytes of a single content block stored for FTS (full content always read from source) */
  maxIndexedBlockBytes: number
}

export function loadConfig(): DsxConfig {
  const home = homedir()
  const factory = process.env.DROID_SESSION_ROOT
    ? null
    : join(home, ".factory")
  const sessionsRoot =
    process.env.DROID_SESSION_ROOT ?? join(factory!, "sessions")
  const cacheDir =
    process.env.DSX_CACHE_DIR ??
    join(process.env.XDG_CACHE_HOME ?? join(home, ".cache"), "dsx")
  return {
    sessionsRoot,
    historyPath: join(home, ".factory", "history.json"),
    dbPath: process.env.DSX_DB_PATH ?? join(cacheDir, "index.db"),
    maxIndexedBlockBytes: 8192,
  }
}
