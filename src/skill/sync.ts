import { lstatSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { SKILL_FILES } from "./embedded"

/**
 * Cached questionnaire answers: skills parent dirs (e.g. ~/.agents/skills)
 * that should hold a copy of the companion skill. Empty = user declined.
 */
export interface SkillPrefs {
  targets: string[]
}

export function loadPrefs(path: string): SkillPrefs | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    if (Array.isArray(parsed?.targets) && parsed.targets.every((t: unknown) => typeof t === "string")) {
      return { targets: parsed.targets }
    }
  } catch {
    // missing or corrupt prefs behave like "never asked"
  }
  return null
}

export function savePrefs(path: string, prefs: SkillPrefs): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(prefs, null, 2) + "\n")
}

/**
 * Write (or overwrite) the embedded skill into <skillsDir>/dsx.
 * A pre-existing symlink (the old manual `ln -s` install) or stale copy is
 * replaced wholesale so removed files don't linger. Returns the skill dir.
 */
export function writeSkill(skillsDir: string): string {
  const dir = join(skillsDir, "dsx")
  removeSkill(skillsDir)
  for (const [rel, content] of Object.entries(SKILL_FILES)) {
    const path = join(dir, rel)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, content)
  }
  return dir
}

/** Remove <skillsDir>/dsx, whether it's a symlink or an installed copy. */
export function removeSkill(skillsDir: string): boolean {
  const dir = join(skillsDir, "dsx")
  let stat
  try {
    stat = lstatSync(dir)
  } catch {
    return false
  }
  if (stat.isSymbolicLink()) unlinkSync(dir)
  else rmSync(dir, { recursive: true })
  return true
}

export interface SyncResult {
  installed: string[]
  removed: string[]
}

/**
 * Apply prefs: install the skill into every selected dir and remove copies
 * from previously selected dirs that were deselected this time.
 */
export function syncSkill(prefs: SkillPrefs, previous: SkillPrefs | null): SyncResult {
  const result: SyncResult = { installed: [], removed: [] }
  for (const target of prefs.targets) {
    result.installed.push(writeSkill(target))
  }
  for (const old of previous?.targets ?? []) {
    if (prefs.targets.includes(old)) continue
    if (removeSkill(old)) result.removed.push(join(old, "dsx"))
  }
  return result
}
