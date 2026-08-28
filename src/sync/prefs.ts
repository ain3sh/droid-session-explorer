import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

/**
 * Cached questionnaire answers for `dsx sync`. Each section lists the
 * install locations for one companion asset; empty = user declined,
 * absent = never asked (so `--apply` fills it with the default).
 */
export interface SyncPrefs {
  /** Skills parent dirs (e.g. ~/.agents/skills) holding a copy of the skill. */
  skill?: { targets: string[] }
  /** AGENTS.md files carrying the dsx-managed guidance block. */
  agents?: { targets: string[] }
}

export function loadPrefs(path: string): SyncPrefs | null {
  const parsed = readJson(path) ?? readJson(legacyPath(path))
  if (parsed === null || typeof parsed !== "object") return null
  // Legacy boundary: pre-0.4 skill-prefs.json persisted `{ targets }` for the
  // skill alone; read it as an answered skill section so saved choices
  // (deselection, non-default dirs) survive the upgrade.
  if (isTargets((parsed as Record<string, unknown>).targets)) {
    return { skill: { targets: (parsed as { targets: string[] }).targets } }
  }
  const prefs: SyncPrefs = {}
  for (const section of ["skill", "agents"] as const) {
    const raw = (parsed as Record<string, unknown>)[section]
    if (raw === undefined) continue
    const targets = (raw as Record<string, unknown>)?.targets
    if (!isTargets(targets)) return null
    prefs[section] = { targets }
  }
  return prefs.skill || prefs.agents ? prefs : null
}

export function savePrefs(path: string, prefs: SyncPrefs): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(prefs, null, 2) + "\n")
  rmSync(legacyPath(path), { force: true })
}

function legacyPath(path: string): string {
  return join(dirname(path), "skill-prefs.json")
}

function isTargets(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((t) => typeof t === "string")
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"))
  } catch {
    // missing or corrupt prefs behave like "never asked"
    return null
  }
}
