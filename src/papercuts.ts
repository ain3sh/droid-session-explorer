import { appendFileSync, mkdirSync, readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { dirname } from "node:path"

export type PapercutSource = "manual" | "review"

export interface PapercutRecord {
  id: string
  createdAt: string
  message: string
  source: PapercutSource
  cwd: string
  project: string
  sessionId: string | null
  model: string | null
}

export interface PapercutDraft {
  message: string
  source: PapercutSource
  cwd: string
  project: string
  sessionId?: string | null
  model?: string | null
}

export interface PapercutFilters {
  project?: string
  sessionId?: string
  source?: PapercutSource
  limit?: number
}

export function appendPapercut(path: string, draft: PapercutDraft): PapercutRecord {
  const message = draft.message.trim()
  if (!message) throw new Error("papercut message cannot be empty")

  const record: PapercutRecord = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    message,
    source: draft.source,
    cwd: draft.cwd,
    project: draft.project,
    sessionId: draft.sessionId ?? null,
    model: draft.model ?? null,
  }
  mkdirSync(dirname(path), { recursive: true })
  appendFileSync(path, `${JSON.stringify(record)}\n`, "utf8")
  return record
}

export function readPapercuts(path: string): PapercutRecord[] {
  let text: string
  try {
    text = readFileSync(path, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
    throw error
  }

  const records: PapercutRecord[] = []
  for (const line of text.split("\n")) {
    if (!line.trim()) continue
    try {
      const record = JSON.parse(line) as Partial<PapercutRecord>
      if (
        typeof record.id === "string" &&
        typeof record.createdAt === "string" &&
        Number.isFinite(Date.parse(record.createdAt)) &&
        typeof record.message === "string" &&
        (record.source === "manual" || record.source === "review") &&
        typeof record.cwd === "string" &&
        typeof record.project === "string"
      ) {
        records.push({
          ...record,
          sessionId: typeof record.sessionId === "string" ? record.sessionId : null,
          model: typeof record.model === "string" ? record.model : null,
        } as PapercutRecord)
      }
    } catch {
      continue
    }
  }
  return records
}

export function listPapercuts(
  path: string,
  filters: PapercutFilters = {},
): PapercutRecord[] {
  const project = filters.project?.toLowerCase()
  const sessionId = filters.sessionId?.toLowerCase()
  return readPapercuts(path)
    .filter((record) => {
      if (project && !record.project.toLowerCase().includes(project)) return false
      if (sessionId && !record.sessionId?.toLowerCase().startsWith(sessionId)) return false
      if (filters.source && record.source !== filters.source) return false
      return true
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, filters.limit ?? 25)
}

export function papercutFingerprint(message: string): string {
  return message.trim().toLowerCase().replaceAll(/\s+/g, " ")
}
