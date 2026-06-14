import type { Command } from "commander"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { scanSessions } from "../../indexer/scanner"
import { listSessions, resolveSession, sessionToolStats, SessionResolutionError } from "../../query/sessions"
import { lineage, type TreeNode } from "../../query/tree"
import {
  fail,
  humanDate,
  humanDuration,
  humanTokens,
  isoDate,
  output,
  parseWhen,
  renderTable,
} from "../format"
import { ensureFresh } from "../refresh"

export function resolveOrFail(ctx: AppContext, ref: string) {
  try {
    return resolveSession(ctx.db, ref)
  } catch (error) {
    if (error instanceof SessionResolutionError) {
      if (error.candidates.length) {
        console.error(pc.red(`dsx: ${error.message}`))
        for (const c of error.candidates) console.error(`  ${c}`)
        process.exit(1)
      }
      fail(error.message)
    }
    throw error
  }
}

export function registerSessionCommands(program: Command, ctx: AppContext): void {
  program
    .command("list")
    .description("list sessions, newest first")
    .option("-p, --project <name>", "filter by project (cwd substring)")
    .option("--since <when>", "only sessions updated since (7d, 24h, 2026-05-01)")
    .option("--until <when>", "only sessions created before")
    .option("--model <model>", "filter by model substring")
    .option("-q, --query <text>", "fuzzy match on title")
    .option("--all", "include subagent and droid-exec sessions")
    .option("--min-credits <n>", "minimum factory credits", Number)
    .option(
      "-s, --sort <key>",
      "sort: updated|created|tokens|credits|messages|active",
      "updated",
    )
    .option("-n, --limit <n>", "max rows", Number, 25)
    .option("--json", "JSON output")
    .action(async (opts) => {
      await ensureFresh(ctx, !program.opts().refresh)
      const sessions = listSessions(ctx.db, {
        project: opts.project,
        since: opts.since ? parseWhen(opts.since) : undefined,
        until: opts.until ? parseWhen(opts.until) : undefined,
        model: opts.model,
        query: opts.query,
        includeSubagents: opts.all,
        includeExec: opts.all,
        minCredits: opts.minCredits,
        sort: opts.sort,
        limit: opts.limit,
      })
      output(opts.json, sessions, () =>
        sessions.length === 0
          ? pc.dim("no sessions match")
          : renderTable(sessions, [
              { header: "ID", value: (s) => s.id.slice(0, 8), color: (v) => pc.cyan(v) },
              { header: "UPDATED", value: (s) => humanDate(s.updatedAt) },
              { header: "PROJECT", value: (s) => s.project.slice(0, 24) },
              {
                header: "TITLE",
                value: (s) => (s.title ?? pc.dim("(untitled)")).slice(0, 56),
              },
              { header: "MODEL", value: (s) => shortModel(s.model) },
              {
                header: "MSGS",
                value: (s) => String(s.counts.messages),
                align: "right",
              },
              {
                header: "CREDITS",
                value: (s) => humanTokens(s.usage.credits),
                align: "right",
              },
              {
                header: "",
                value: (s) =>
                  [
                    s.isSubagent ? pc.magenta("sub") : "",
                    s.isExec ? pc.blue("exec") : "",
                    s.forkParent ? pc.yellow("fork") : "",
                  ]
                    .filter(Boolean)
                    .join(" "),
              },
            ]),
      )
    })

  program
    .command("show <session>")
    .description("session summary: metadata, usage, tools, todos")
    .option("--json", "JSON output")
    .action(async (ref: string, opts) => {
      await ensureFresh(ctx, !program.opts().refresh)
      const s = resolveOrFail(ctx, ref)
      const tools = sessionToolStats(ctx.db, s.id)
      const data = { ...s, tools }
      output(opts.json, data, () => {
        const lines: string[] = []
        const label = (k: string, v: string) => `${pc.dim(k.padEnd(14))}${v}`
        lines.push(pc.bold(s.title ?? "(untitled)"))
        lines.push(label("id", pc.cyan(s.id)))
        lines.push(label("project", `${s.project} ${pc.dim(s.cwd ?? "")}`))
        lines.push(
          label(
            "when",
            `${isoDate(s.createdAt) ?? "?"} \u2192 ${isoDate(s.updatedAt) ?? "?"} (${humanDate(s.updatedAt)})`,
          ),
        )
        lines.push(
          label(
            "model",
            `${s.model ?? "?"} ${pc.dim(`effort=${s.reasoningEffort ?? "?"} autonomy=${s.autonomy ?? "?"}`)}`,
          ),
        )
        lines.push(label("active", humanDuration(s.activeTimeMs)))
        lines.push(
          label(
            "usage",
            `in=${humanTokens(s.usage.inputTokens)} out=${humanTokens(s.usage.outputTokens)} ` +
              `cache=${humanTokens(s.usage.cacheReadTokens)} think=${humanTokens(s.usage.thinkingTokens)} ` +
              pc.bold(`credits=${s.usage.credits.toLocaleString()}`),
          ),
        )
        lines.push(
          label(
            "messages",
            `${s.counts.messages} (${s.counts.userMessages} user / ${s.counts.assistantMessages} assistant)` +
              `${s.counts.compactions ? pc.yellow(` ${s.counts.compactions} compactions`) : ""}`,
          ),
        )
        const flags = [
          s.isSubagent && pc.magenta("subagent"),
          s.isExec && pc.blue("exec"),
          s.forkParent && pc.yellow(`fork of ${s.forkParent.slice(0, 8)}`),
          s.ended && pc.green("ended"),
        ].filter(Boolean)
        if (flags.length) lines.push(label("flags", flags.join(" ")))
        if (tools.length) {
          lines.push("")
          lines.push(pc.bold("tools"))
          lines.push(
            renderTable(tools.slice(0, 12), [
              { header: "TOOL", value: (t) => t.tool },
              { header: "CALLS", value: (t) => String(t.calls), align: "right" },
              {
                header: "ERRORS",
                value: (t) => String(t.errors),
                align: "right",
                color: (v, t) => (t.errors > 0 ? pc.red(v) : pc.dim(v)),
              },
            ]),
          )
        }
        if (s.lastTodos) {
          lines.push("")
          lines.push(pc.bold("final todos"))
          lines.push(s.lastTodos)
        }
        lines.push("")
        lines.push(pc.dim(`transcript: ${s.transcriptPath ?? "-"}`))
        return lines.join("\n")
      })
    })

  program
    .command("path <session>")
    .description("print transcript and settings paths")
    .option("--json", "JSON output")
    .option("--transcript", "print only the transcript path")
    .option("--all", "scan disk for every matching transcript/settings file (orphans, duplicates)")
    .action(async (ref: string, opts) => {
      if (opts.all) {
        printDiskMatches(ctx, ref, Boolean(opts.json))
        return
      }
      await ensureFresh(ctx, !program.opts().refresh)
      const s = resolveOrFail(ctx, ref)
      if (opts.transcript) {
        if (!s.transcriptPath) fail("no transcript on disk")
        console.log(s.transcriptPath)
        return
      }
      output(
        opts.json,
        { id: s.id, transcript: s.transcriptPath, settings: s.settingsPath },
        () => `JSONL=${s.transcriptPath ?? ""}\nSETTINGS=${s.settingsPath ?? ""}`,
      )
    })

  program
    .command("resume <session>")
    .description("print (or run) the droid command to resume a session")
    .option("--run", "exec droid directly in the session cwd")
    .action(async (ref: string, opts) => {
      await ensureFresh(ctx, !program.opts().refresh)
      const s = resolveOrFail(ctx, ref)
      const cmd = ["droid", "--resume", s.id]
      if (!opts.run) {
        if (s.cwd) console.log(`cd ${shellQuote(s.cwd)} && ${cmd.join(" ")}`)
        else console.log(cmd.join(" "))
        return
      }
      const proc = Bun.spawn(cmd, {
        cwd: s.cwd ?? process.cwd(),
        stdio: ["inherit", "inherit", "inherit"],
      })
      process.exit(await proc.exited)
    })

  program
    .command("tree <session>")
    .description("fork + subagent lineage tree")
    .option("--json", "JSON output")
    .action(async (ref: string, opts) => {
      await ensureFresh(ctx, !program.opts().refresh)
      const s = resolveOrFail(ctx, ref)
      const tree = lineage(ctx.db, s.id)
      output(opts.json, tree, () => renderTree(tree, s.id))
    })
}

interface DiskMatches {
  ref: string
  root: string
  pairs: Array<{ id: string; transcript: string; settings: string }>
  transcriptOnly: Array<{ id: string; transcript: string }>
  settingsOnly: Array<{ id: string; settings: string }>
}

/** Raw on-disk scan, bypassing the index, to surface orphans and duplicates. */
function collectDiskMatches(root: string, ref: string): DiskMatches {
  const groups = new Map<string, { id: string; transcript?: string; settings?: string }>()
  for (const f of scanSessions(root)) {
    if (f.sessionId !== ref && !f.sessionId.startsWith(ref)) continue
    const key = `${f.dirSlug}\u0000${f.sessionId}`
    const g = groups.get(key) ?? { id: f.sessionId }
    if (f.kind === "transcript") g.transcript = f.path
    else g.settings = f.path
    groups.set(key, g)
  }
  const result: DiskMatches = { ref, root, pairs: [], transcriptOnly: [], settingsOnly: [] }
  for (const g of [...groups.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (g.transcript && g.settings) result.pairs.push({ id: g.id, transcript: g.transcript, settings: g.settings })
    else if (g.transcript) result.transcriptOnly.push({ id: g.id, transcript: g.transcript })
    else if (g.settings) result.settingsOnly.push({ id: g.id, settings: g.settings })
  }
  return result
}

function printDiskMatches(ctx: AppContext, ref: string, json: boolean): void {
  const m = collectDiskMatches(ctx.config.sessionsRoot, ref)
  output(json, m, () => {
    const lines = [`${pc.dim("session")}  ${ref}`, `${pc.dim("root")}     ${m.root}`]
    if (!m.pairs.length && !m.transcriptOnly.length && !m.settingsOnly.length) {
      lines.push("", pc.dim("no matching files on disk"))
      return lines.join("\n")
    }
    if (m.pairs.length) {
      lines.push("", pc.bold("complete pairs:"))
      m.pairs.forEach((p, i) => {
        lines.push(`  [${i + 1}] JSONL=${p.transcript}`, `      SETTINGS=${p.settings}`)
      })
    }
    if (m.transcriptOnly.length) {
      lines.push("", pc.bold("transcript-only:"))
      for (const t of m.transcriptOnly) lines.push(`  - ${t.transcript}`)
    }
    if (m.settingsOnly.length) {
      lines.push("", pc.bold("settings-only:"))
      for (const s of m.settingsOnly) lines.push(`  - ${s.settings}`)
    }
    return lines.join("\n")
  })
}

function shortModel(model: string | null): string {
  if (!model) return pc.dim("?")
  return model.replace(/-\d{8}$/, "")
}

function shellQuote(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replaceAll("'", `'\\''`)}'`
}

function renderTree(node: TreeNode, highlight: string): string {
  const lines: string[] = []
  const walk = (n: TreeNode, prefix: string, isLast: boolean, isRoot: boolean) => {
    const connector = isRoot ? "" : isLast ? "\u2514\u2500 " : "\u251c\u2500 "
    const badge =
      n.edgeKind === "fork"
        ? pc.yellow("[fork]")
        : n.edgeKind === "subagent"
          ? pc.magenta("[subagent]")
          : ""
    const title = n.session?.title ?? pc.dim("(missing)")
    const id = n.id.slice(0, 8)
    const idText = n.id === highlight ? pc.bold(pc.cyan(id)) : pc.cyan(id)
    const meta = n.session
      ? pc.dim(
          ` ${n.session.counts.messages} msgs, ${humanTokens(n.session.usage.credits)} credits, ${humanDate(n.session.updatedAt)}`,
        )
      : ""
    lines.push(`${prefix}${connector}${idText} ${badge} ${title}${meta}`)
    const nextPrefix = isRoot ? "" : prefix + (isLast ? "   " : "\u2502  ")
    n.children.forEach((child, i) =>
      walk(child, nextPrefix, i === n.children.length - 1, false),
    )
  }
  walk(node, "", true, true)
  return lines.join("\n")
}
