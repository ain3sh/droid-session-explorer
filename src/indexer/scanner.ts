import { readdirSync, statSync } from "node:fs"
import { join } from "node:path"

export interface ScannedFile {
  path: string
  dirSlug: string
  sessionId: string
  kind: "transcript" | "settings"
  size: number
  mtimeMs: number
}

const SKIP_DIRS = new Set(["attachments", "cache"])

const TRANSCRIPT_RE = /^([0-9a-f-]{36})\.jsonl$/
const SETTINGS_RE = /^([0-9a-f-]{36})\.settings\.json$/

/** Discover all session transcript and settings files under the sessions root. */
export function scanSessions(root: string): ScannedFile[] {
  const out: ScannedFile[] = []
  let dirs: string[]
  try {
    dirs = readdirSync(root)
  } catch {
    return out
  }
  for (const slug of dirs) {
    if (SKIP_DIRS.has(slug)) continue
    const dirPath = join(root, slug)
    let entries: string[]
    try {
      entries = readdirSync(dirPath)
    } catch {
      continue
    }
    for (const name of entries) {
      const transcript = TRANSCRIPT_RE.exec(name)
      const settings = transcript ? null : SETTINGS_RE.exec(name)
      const match = transcript ?? settings
      if (!match) continue
      const path = join(dirPath, name)
      let st
      try {
        st = statSync(path)
      } catch {
        continue
      }
      if (!st.isFile()) continue
      out.push({
        path,
        dirSlug: slug,
        sessionId: match[1]!,
        kind: transcript ? "transcript" : "settings",
        size: st.size,
        mtimeMs: Math.floor(st.mtimeMs),
      })
    }
  }
  return out
}
