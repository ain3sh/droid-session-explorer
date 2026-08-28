import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import { AGENTS_BLOCK_CONTENT } from "./embedded"

/**
 * The AGENTS.md guidance is a marker-fenced managed block. The begin marker
 * carries a hash of the content we wrote, so the file itself tells a later
 * sync whether the user hand-edited the block (hash mismatch -> skip unless
 * forced). Users may move the whole block anywhere in the file; updates
 * replace it in place.
 */
const BEGIN_RE = /<!-- dsx:begin(?: ([0-9a-f]{8}))?[^\n]*?-->/
const END_MARKER = "<!-- dsx:end -->"

interface FoundBlock {
  start: number
  end: number
  hash: string | null
  inner: string
}

function hashOf(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 8)
}

export function renderAgentsBlock(content: string = AGENTS_BLOCK_CONTENT): string {
  const body = content.trim()
  return `<!-- dsx:begin ${hashOf(body)} (managed by \`dsx sync\`) -->\n${body}\n${END_MARKER}`
}

export function findAgentsBlock(text: string): FoundBlock | null {
  const begin = text.match(BEGIN_RE)
  if (!begin || begin.index === undefined) return null
  const endIdx = text.indexOf(END_MARKER, begin.index)
  if (endIdx === -1) return null
  return {
    start: begin.index,
    end: endIdx + END_MARKER.length,
    hash: begin[1] ?? null,
    inner: text.slice(begin.index + begin[0].length, endIdx).trim(),
  }
}

export type AgentsWriteResult = "installed" | "skipped"

/**
 * Install or update the managed block in one AGENTS.md file. Creates the
 * file when missing, appends when no block exists, otherwise replaces the
 * block in place -- unless the user edited inside it (skip, unless forced).
 */
export function writeAgentsBlock(file: string, force = false): AgentsWriteResult {
  const block = renderAgentsBlock()
  let text: string | null
  try {
    text = readFileSync(file, "utf8")
  } catch {
    text = null
  }
  if (text === null) {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, block + "\n")
    return "installed"
  }
  const found = findAgentsBlock(text)
  if (found === null) {
    const head = text.trimEnd()
    writeFileSync(file, head === "" ? block + "\n" : `${head}\n\n${block}\n`)
    return "installed"
  }
  if (hashOf(found.inner) !== found.hash && !force) return "skipped"
  writeFileSync(file, text.slice(0, found.start) + block + text.slice(found.end))
  return "installed"
}

/** Remove the managed block from one AGENTS.md file, leaving the rest. */
export function removeAgentsBlock(file: string): boolean {
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    // unreadable = nothing to remove; deselection must not fail the sync
    return false
  }
  const found = findAgentsBlock(text)
  if (found === null) return false
  const before = text.slice(0, found.start).trimEnd()
  const after = text.slice(found.end).trimStart()
  const merged = before === "" ? after : after === "" ? before + "\n" : `${before}\n\n${after}`
  writeFileSync(file, merged === "" ? "" : merged.endsWith("\n") ? merged : merged + "\n")
  return true
}

export interface AgentsSyncResult {
  installed: string[]
  skipped: string[]
  removed: string[]
}

/**
 * Install/update the block in every selected file and remove it from
 * previously selected files that were deselected this time.
 */
export function syncAgents(targets: string[], previousTargets: string[], force = false): AgentsSyncResult {
  const result: AgentsSyncResult = { installed: [], skipped: [], removed: [] }
  for (const file of targets) {
    result[writeAgentsBlock(file, force) === "installed" ? "installed" : "skipped"].push(file)
  }
  for (const old of previousTargets) {
    if (targets.includes(old)) continue
    if (removeAgentsBlock(old)) result.removed.push(old)
  }
  return result
}
