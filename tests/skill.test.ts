import { describe, expect, test } from "bun:test"
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { SKILL_FILES } from "../src/skill/embedded"
import { loadPrefs, savePrefs, syncSkill, writeSkill } from "../src/skill/sync"

const scratch = () => mkdtempSync(join(tmpdir(), "dsx-skill-test-"))

describe("skill embedding", () => {
  test("carries SKILL.md and every reference", () => {
    expect(Object.keys(SKILL_FILES).sort()).toEqual([
      "SKILL.md",
      "references/commands.md",
      "references/insights.md",
      "references/stats-analytics.md",
      "references/usage-semantics.md",
    ])
    expect(SKILL_FILES["SKILL.md"]).toContain("name: dsx")
  })
})

describe("writeSkill", () => {
  test("writes the full skill into <dir>/dsx", () => {
    const skillsDir = scratch()
    const dir = writeSkill(skillsDir)
    expect(dir).toBe(join(skillsDir, "dsx"))
    for (const [rel, content] of Object.entries(SKILL_FILES)) {
      expect(readFileSync(join(dir, rel), "utf8")).toBe(content)
    }
  })

  test("replaces a manual symlink with a real copy, leaving the target intact", () => {
    const skillsDir = scratch()
    const clone = scratch()
    writeFileSync(join(clone, "SKILL.md"), "clone content")
    symlinkSync(clone, join(skillsDir, "dsx"))

    const dir = writeSkill(skillsDir)
    expect(lstatSync(dir).isSymbolicLink()).toBe(false)
    expect(readFileSync(join(dir, "SKILL.md"), "utf8")).toBe(SKILL_FILES["SKILL.md"]!)
    expect(readFileSync(join(clone, "SKILL.md"), "utf8")).toBe("clone content")
  })

  test("overwrite drops stale files from a previous version", () => {
    const skillsDir = scratch()
    const dir = join(skillsDir, "dsx")
    mkdirSync(join(dir, "references"), { recursive: true })
    writeFileSync(join(dir, "references", "removed-in-new-version.md"), "stale")

    writeSkill(skillsDir)
    expect(existsSync(join(dir, "references", "removed-in-new-version.md"))).toBe(false)
    expect(existsSync(join(dir, "SKILL.md"))).toBe(true)
  })
})

describe("syncSkill", () => {
  test("installs selected targets and removes deselected previous ones", () => {
    const kept = scratch()
    const dropped = scratch()
    const first = syncSkill({ targets: [kept, dropped] }, null)
    expect(first.installed.sort()).toEqual([join(dropped, "dsx"), join(kept, "dsx")].sort())

    const second = syncSkill({ targets: [kept] }, { targets: [kept, dropped] })
    expect(second.installed).toEqual([join(kept, "dsx")])
    expect(second.removed).toEqual([join(dropped, "dsx")])
    expect(existsSync(join(dropped, "dsx"))).toBe(false)
    expect(existsSync(join(kept, "dsx", "SKILL.md"))).toBe(true)
  })

  test("declining removes previously installed copies", () => {
    const dir = scratch()
    syncSkill({ targets: [dir] }, null)
    const result = syncSkill({ targets: [] }, { targets: [dir] })
    expect(result.removed).toEqual([join(dir, "dsx")])
    expect(existsSync(join(dir, "dsx"))).toBe(false)
  })
})

describe("prefs", () => {
  test("round-trips", () => {
    const path = join(scratch(), "nested", "skill-prefs.json")
    savePrefs(path, { targets: ["/a/skills"] })
    expect(loadPrefs(path)).toEqual({ targets: ["/a/skills"] })
  })

  test("missing or corrupt prefs read as null", () => {
    const dir = scratch()
    expect(loadPrefs(join(dir, "nope.json"))).toBeNull()
    const corrupt = join(dir, "corrupt.json")
    writeFileSync(corrupt, "{not json")
    expect(loadPrefs(corrupt)).toBeNull()
    const wrongShape = join(dir, "wrong.json")
    writeFileSync(wrongShape, JSON.stringify({ targets: [42] }))
    expect(loadPrefs(wrongShape)).toBeNull()
  })
})
