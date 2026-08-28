import { lstatSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { SKILL_FILES } from "./embedded"

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

export interface SkillSyncResult {
  installed: string[]
  removed: string[]
}

/**
 * Install the skill into every selected dir and remove copies from
 * previously selected dirs that were deselected this time.
 */
export function syncSkill(targets: string[], previousTargets: string[]): SkillSyncResult {
  const result: SkillSyncResult = { installed: [], removed: [] }
  for (const target of targets) {
    result.installed.push(writeSkill(target))
  }
  for (const old of previousTargets) {
    if (targets.includes(old)) continue
    if (removeSkill(old)) result.removed.push(join(old, "dsx"))
  }
  return result
}
