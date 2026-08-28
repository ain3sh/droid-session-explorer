import { homedir } from "node:os"
import { join } from "node:path"

export interface DsxConfig {
  /** Root of droid session storage (dirs of <slug>/<uuid>.jsonl) */
  sessionsRoot: string
  /** Path to droid prompt history.json */
  historyPath: string
  /** Path to the SQLite index */
  dbPath: string
  /** Durable append-only papercut log */
  papercutsPath: string
  /** Cached companion-skill install choices (`dsx skill sync`) */
  skillPrefsPath: string
  /** Max bytes of a single content block stored for FTS (full content always read from source) */
  maxIndexedBlockBytes: number
  /** Model used for `dsx insights --deep` sub-droid runs */
  insightsModel: string
  /** Model used for transcript papercut extraction */
  papercutModel: string
  /** Reasoning effort for the insights sub-droid */
  insightsReasoning: string
}

export function loadConfig(): DsxConfig {
  const home = homedir()
  const sessionsRoot =
    process.env.DROID_SESSION_ROOT ?? join(home, ".factory", "sessions")
  const cacheDir =
    process.env.DSX_CACHE_DIR ??
    join(process.env.XDG_CACHE_HOME ?? join(home, ".cache"), "dsx")
  const dataDir =
    process.env.DSX_DATA_DIR ??
    join(process.env.XDG_DATA_HOME ?? join(home, ".local", "share"), "dsx")
  return {
    sessionsRoot,
    historyPath: join(home, ".factory", "history.json"),
    dbPath: process.env.DSX_DB_PATH ?? join(cacheDir, "index.db"),
    papercutsPath:
      process.env.DSX_PAPERCUTS_PATH ?? join(dataDir, "papercuts.jsonl"),
    skillPrefsPath: join(dataDir, "skill-prefs.json"),
    maxIndexedBlockBytes: 8192,
    insightsModel: process.env.DSX_INSIGHTS_MODEL ?? "kimi-k2.6",
    papercutModel: process.env.DSX_PAPERCUT_MODEL ?? "gpt-5.6-luna",
    insightsReasoning: process.env.DSX_INSIGHTS_REASONING ?? "low",
  }
}
