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
import {
  findAgentsBlock,
  removeAgentsBlock,
  renderAgentsBlock,
  syncAgents,
  writeAgentsBlock,
} from "../src/sync/agents"
import { AGENTS_BLOCK_CONTENT, SKILL_FILES } from "../src/sync/embedded"
import { loadPrefs, savePrefs } from "../src/sync/prefs"
import { syncSkill, writeSkill } from "../src/sync/skill"

const scratch = () => mkdtempSync(join(tmpdir(), "dsx-sync-test-"))

describe("embedding", () => {
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

  test("carries the AGENTS.md guidance block", () => {
    expect(AGENTS_BLOCK_CONTENT).toContain("<papercuts>")
    expect(AGENTS_BLOCK_CONTENT).toContain("<recovery>")
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
    const first = syncSkill([kept, dropped], [])
    expect(first.installed.sort()).toEqual([join(dropped, "dsx"), join(kept, "dsx")].sort())

    const second = syncSkill([kept], [kept, dropped])
    expect(second.installed).toEqual([join(kept, "dsx")])
    expect(second.removed).toEqual([join(dropped, "dsx")])
    expect(existsSync(join(dropped, "dsx"))).toBe(false)
    expect(existsSync(join(kept, "dsx", "SKILL.md"))).toBe(true)
  })

  test("declining removes previously installed copies", () => {
    const dir = scratch()
    syncSkill([dir], [])
    const result = syncSkill([], [dir])
    expect(result.removed).toEqual([join(dir, "dsx")])
    expect(existsSync(join(dir, "dsx"))).toBe(false)
  })
})

describe("agents block", () => {
  test("creates a missing file containing only the block", () => {
    const file = join(scratch(), "nested", "AGENTS.md")
    expect(writeAgentsBlock(file)).toBe("installed")
    expect(readFileSync(file, "utf8")).toBe(renderAgentsBlock() + "\n")
  })

  test("appends to an existing file with a separating blank line", () => {
    const file = join(scratch(), "AGENTS.md")
    writeFileSync(file, "# my rules\n\nbe kind\n")
    writeAgentsBlock(file)
    expect(readFileSync(file, "utf8")).toBe(`# my rules\n\nbe kind\n\n${renderAgentsBlock()}\n`)
  })

  test("updates in place, preserving the block's position in the file", () => {
    const file = join(scratch(), "AGENTS.md")
    writeFileSync(file, `top\n\n${renderAgentsBlock("old dsx guidance")}\n\nbottom\n`)
    writeAgentsBlock(file)
    expect(readFileSync(file, "utf8")).toBe(`top\n\n${renderAgentsBlock()}\n\nbottom\n`)
  })

  test("is idempotent", () => {
    const file = join(scratch(), "AGENTS.md")
    writeAgentsBlock(file)
    const once = readFileSync(file, "utf8")
    writeAgentsBlock(file)
    expect(readFileSync(file, "utf8")).toBe(once)
  })

  test("skips a hand-edited block unless forced", () => {
    const file = join(scratch(), "AGENTS.md")
    writeAgentsBlock(file)
    const edited = readFileSync(file, "utf8").replace("<papercuts>", "<papercuts>\nmy tweak")
    writeFileSync(file, edited)

    expect(writeAgentsBlock(file)).toBe("skipped")
    expect(readFileSync(file, "utf8")).toBe(edited)

    expect(writeAgentsBlock(file, true)).toBe("installed")
    expect(readFileSync(file, "utf8")).toBe(renderAgentsBlock() + "\n")
  })

  test("treats a marker without our hash as hand-edited", () => {
    const file = join(scratch(), "AGENTS.md")
    writeFileSync(file, "<!-- dsx:begin -->\nhand-rolled\n<!-- dsx:end -->\n")
    expect(writeAgentsBlock(file)).toBe("skipped")
    expect(writeAgentsBlock(file, true)).toBe("installed")
  })

  test("removal excises the block and leaves the rest intact", () => {
    const file = join(scratch(), "AGENTS.md")
    writeFileSync(file, "top\n")
    writeAgentsBlock(file)
    expect(removeAgentsBlock(file)).toBe(true)
    expect(readFileSync(file, "utf8")).toBe("top\n")
    expect(removeAgentsBlock(file)).toBe(false)
  })

  test("removal of a block-only file leaves it empty", () => {
    const file = join(scratch(), "AGENTS.md")
    writeAgentsBlock(file)
    removeAgentsBlock(file)
    expect(readFileSync(file, "utf8")).toBe("")
  })

  test("findAgentsBlock reads the marker hash and inner content", () => {
    const found = findAgentsBlock(`before\n${renderAgentsBlock()}\nafter\n`)
    expect(found).not.toBeNull()
    expect(found!.hash).toMatch(/^[0-9a-f]{8}$/)
    expect(found!.inner).toBe(AGENTS_BLOCK_CONTENT.trim())
  })
})

describe("syncAgents", () => {
  test("installs selected files and removes the block from deselected ones", () => {
    const kept = join(scratch(), "AGENTS.md")
    const dropped = join(scratch(), "AGENTS.md")
    writeFileSync(dropped, "keep my prose\n")

    const first = syncAgents([kept, dropped], [])
    expect(first.installed.sort()).toEqual([kept, dropped].sort())

    const second = syncAgents([kept], [kept, dropped])
    expect(second.installed).toEqual([kept])
    expect(second.removed).toEqual([dropped])
    expect(readFileSync(dropped, "utf8")).toBe("keep my prose\n")
  })

  test("reports hand-edited files as skipped", () => {
    const file = join(scratch(), "AGENTS.md")
    writeAgentsBlock(file)
    writeFileSync(file, readFileSync(file, "utf8").replace("<recovery>", "<recovery>\nmine"))
    const result = syncAgents([file], [file])
    expect(result.skipped).toEqual([file])
    expect(result.installed).toEqual([])
  })
})

describe("prefs", () => {
  test("round-trips both sections", () => {
    const path = join(scratch(), "nested", "sync-prefs.json")
    const prefs = { skill: { targets: ["/a/skills"] }, agents: { targets: ["/a/AGENTS.md"] } }
    savePrefs(path, prefs)
    expect(loadPrefs(path)).toEqual(prefs)
  })

  test("reads legacy skill-prefs.json as an answered skill section", () => {
    const dir = scratch()
    writeFileSync(join(dir, "skill-prefs.json"), JSON.stringify({ targets: ["/a/skills"] }))
    expect(loadPrefs(join(dir, "sync-prefs.json"))).toEqual({ skill: { targets: ["/a/skills"] } })
  })

  test("saving migrates away the legacy file", () => {
    const dir = scratch()
    const legacy = join(dir, "skill-prefs.json")
    writeFileSync(legacy, JSON.stringify({ targets: [] }))
    savePrefs(join(dir, "sync-prefs.json"), { skill: { targets: [] }, agents: { targets: [] } })
    expect(existsSync(legacy)).toBe(false)
    expect(loadPrefs(join(dir, "sync-prefs.json"))).toEqual({ skill: { targets: [] }, agents: { targets: [] } })
  })

  test("missing or corrupt prefs read as null", () => {
    const dir = scratch()
    expect(loadPrefs(join(dir, "nope.json"))).toBeNull()
    const corrupt = join(dir, "corrupt.json")
    writeFileSync(corrupt, "{not json")
    expect(loadPrefs(corrupt)).toBeNull()
    const wrongShape = join(dir, "wrong.json")
    writeFileSync(wrongShape, JSON.stringify({ skill: { targets: [42] } }))
    expect(loadPrefs(wrongShape)).toBeNull()
  })
})
