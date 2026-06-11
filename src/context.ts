import type { Database } from "bun:sqlite"
import { loadConfig, type DsxConfig } from "./config"
import { openDb } from "./indexer/db"
import { Indexer, type IndexResult, type ProgressFn } from "./indexer/indexer"

export interface AppContext {
  config: DsxConfig
  db: Database
  indexer: Indexer
  refresh: (onProgress?: ProgressFn) => Promise<IndexResult>
}

export function createContext(overrides?: Partial<DsxConfig>): AppContext {
  const config = { ...loadConfig(), ...overrides }
  const db = openDb(config.dbPath)
  const indexer = new Indexer(db, config)
  return {
    config,
    db,
    indexer,
    refresh: (onProgress) => indexer.refresh(onProgress),
  }
}
