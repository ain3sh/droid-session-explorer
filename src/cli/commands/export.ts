import type { Command } from "commander"
import { writeFileSync } from "node:fs"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { loadTranscript, type Transcript, type TranscriptEntry } from "../../query/transcript"
import { fail, isoDate } from "../format"
import { ensureFresh } from "../refresh"
import { resolveOrFail } from "./sessions"

export function registerExportCommand(program: Command, ctx: AppContext): void {
  program
    .command("export <session>")
    .description("export a full transcript as markdown or HTML")
    .option("-f, --format <fmt>", "md|html", "md")
    .option("-o, --out <file>", "write to file instead of stdout")
    .option("--no-thinking", "omit thinking blocks")
    .option("--no-tools", "omit tool calls/results")
    .action(async (ref: string, opts) => {
      await ensureFresh(ctx, !program.opts().refresh)
      const s = resolveOrFail(ctx, ref)
      if (!s.transcriptPath) fail("no transcript on disk for this session")
      const transcript = await loadTranscript(s.transcriptPath)

      let rendered: string
      if (opts.format === "md") {
        rendered = toMarkdown(transcript, opts)
      } else if (opts.format === "html") {
        rendered = toHtml(transcript, opts)
      } else {
        fail("--format must be md or html")
      }

      if (opts.out) {
        writeFileSync(opts.out, rendered)
        console.error(pc.dim(`wrote ${opts.out}`))
      } else {
        console.log(rendered)
      }
    })
}

interface ExportOpts {
  thinking: boolean
  tools: boolean
}

function entryVisible(entry: TranscriptEntry, opts: ExportOpts): boolean {
  if (entry.kind === "thinking" && !opts.thinking) return false
  if (entry.kind === "tool_call" && !opts.tools) return false
  return true
}

function toMarkdown(t: Transcript, opts: ExportOpts): string {
  const lines: string[] = []
  lines.push(`# ${t.title ?? "Untitled session"}`)
  lines.push("")
  lines.push(`- session: \`${t.sessionId}\``)
  if (t.cwd) lines.push(`- cwd: \`${t.cwd}\``)
  if (t.forkParent) lines.push(`- forked from: \`${t.forkParent}\``)
  lines.push("")

  for (const entry of t.entries) {
    if (!entryVisible(entry, opts)) continue
    const when = entry.ts ? ` <sub>${isoDate(entry.ts)}</sub>` : ""
    switch (entry.kind) {
      case "user":
        lines.push(`## User${when}`)
        lines.push("")
        lines.push(entry.text)
        break
      case "assistant":
        lines.push(`## Assistant${when}`)
        lines.push("")
        lines.push(entry.text)
        break
      case "thinking":
        lines.push(`<details><summary>thinking</summary>`)
        lines.push("")
        lines.push(entry.text)
        lines.push("")
        lines.push(`</details>`)
        break
      case "tool_call": {
        const status = entry.isError ? " (error)" : ""
        lines.push(`<details><summary>tool: ${entry.tool}${status}</summary>`)
        lines.push("")
        lines.push("```json")
        lines.push(truncate(entry.input, 4000))
        lines.push("```")
        if (entry.result !== null) {
          lines.push("")
          lines.push("```")
          lines.push(truncate(entry.result, 8000))
          lines.push("```")
        }
        lines.push("")
        lines.push(`</details>`)
        break
      }
      case "todo":
        lines.push(`> **todos**`)
        for (const l of entry.text.split("\n")) lines.push(`> ${l}`)
        break
      case "compaction":
        lines.push(`> **context compacted**`)
        break
      case "session_end":
        lines.push(`---`)
        lines.push(`*session ended*${entry.finalText ? `: ${entry.finalText.slice(0, 400)}` : ""}`)
        break
    }
    lines.push("")
  }
  return lines.join("\n")
}

function toHtml(t: Transcript, opts: ExportOpts): string {
  const esc = (s: string) =>
    s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  const parts: string[] = []
  for (const entry of t.entries) {
    if (!entryVisible(entry, opts)) continue
    switch (entry.kind) {
      case "user":
        parts.push(`<div class="msg user"><h3>user</h3><pre>${esc(entry.text)}</pre></div>`)
        break
      case "assistant":
        parts.push(`<div class="msg assistant"><h3>assistant</h3><pre>${esc(entry.text)}</pre></div>`)
        break
      case "thinking":
        parts.push(
          `<details class="thinking"><summary>thinking</summary><pre>${esc(entry.text)}</pre></details>`,
        )
        break
      case "tool_call":
        parts.push(
          `<details class="tool${entry.isError ? " error" : ""}"><summary>${esc(entry.tool)}${
            entry.isError ? " (error)" : ""
          }</summary><pre class="input">${esc(truncate(entry.input, 4000))}</pre>${
            entry.result !== null ? `<pre class="result">${esc(truncate(entry.result, 8000))}</pre>` : ""
          }</details>`,
        )
        break
      case "todo":
        parts.push(`<blockquote class="todos"><pre>${esc(entry.text)}</pre></blockquote>`)
        break
      case "compaction":
        parts.push(`<hr class="compaction" title="context compacted">`)
        break
      case "session_end":
        parts.push(`<footer>session ended</footer>`)
        break
    }
  }
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(t.title ?? t.sessionId)}</title>
<style>
  body { font: 14px/1.5 ui-monospace, monospace; max-width: 60rem; margin: 2rem auto; padding: 0 1rem; background: #0d1117; color: #e6edf3; }
  h1 { font-size: 1.3rem; } h3 { margin: 0 0 .4rem; font-size: .8rem; text-transform: uppercase; letter-spacing: .08em; color: #8b949e; }
  pre { white-space: pre-wrap; word-break: break-word; margin: 0; }
  .msg { padding: .8rem 1rem; border-radius: 8px; margin: .8rem 0; }
  .user { background: #161b22; border-left: 3px solid #58a6ff; }
  .assistant { background: #161b22; border-left: 3px solid #3fb950; }
  details { margin: .5rem 0 .5rem 1rem; padding: .4rem .8rem; border-radius: 6px; background: #161b2280; }
  details.error summary { color: #f85149; }
  summary { cursor: pointer; color: #8b949e; }
  .input { color: #79c0ff; margin-top: .4rem; } .result { color: #8b949e; margin-top: .4rem; }
  .thinking pre { color: #d2a8ff; }
  blockquote.todos { border-left: 3px solid #d29922; margin: .5rem 0; padding: .4rem .8rem; color: #d29922; }
  footer { margin: 2rem 0; color: #8b949e; }
</style></head><body>
<h1>${esc(t.title ?? "Untitled session")}</h1>
<p><code>${t.sessionId}</code>${t.cwd ? ` &middot; <code>${esc(t.cwd)}</code>` : ""}</p>
${parts.join("\n")}
</body></html>`
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n\u2026 (${s.length - max} more chars)` : s
}
