import type { Command } from "commander"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { regexSearch, searchBlocks, searchHistory } from "../../query/search"
import {
  fail,
  humanDate,
  output,
  parseWhen,
  renderSnippet,
  renderTable,
} from "../format"
import { ensureFresh } from "../refresh"

const BLOCK_TYPES = ["text", "thinking", "tool_use", "tool_result"] as const

export function registerSearchCommands(program: Command, ctx: AppContext): void {
  program
    .command("search <query>")
    .description("full-text search across all session transcripts (FTS5 syntax supported)")
    .option("-p, --project <name>", "filter by project")
    .option("--session <id>", "restrict to one session (id prefix)")
    .option("-r, --role <role>", "user|assistant")
    .option(
      "-t, --type <types>",
      `comma list of ${BLOCK_TYPES.join("|")}`,
      (v: string) => v.split(",").map((x) => x.trim()),
    )
    .option("--tool <name>", "only tool_use/tool_result blocks of this tool")
    .option("--errors", "only failed tool results")
    .option("--since <when>", "blocks newer than (7d, 2026-05-01)")
    .option("--until <when>", "blocks older than")
    .option("--regex", "regex mode: ripgrep over the raw JSONL source files")
    .option("-i, --ignore-case", "case-insensitive (regex mode)")
    .option("--history", "search the droid prompt history instead of transcripts")
    .option("-n, --limit <n>", "max hits", Number, 25)
    .option("--json", "JSON output")
    .action(async (query: string, opts) => {
      await ensureFresh(ctx, !program.opts().refresh)

      if (opts.history) {
        const hits = searchHistory(ctx.db, query, opts.limit)
        output(opts.json, hits, () =>
          hits.length === 0
            ? pc.dim("no history entries match")
            : renderTable(hits, [
                { header: "WHEN", value: (h) => humanDate(h.ts) },
                { header: "MODE", value: (h) => h.mode ?? "-" },
                {
                  header: "PROMPT",
                  value: (h) => h.command.replaceAll("\n", " ").slice(0, 100),
                },
              ]),
        )
        return
      }

      if (opts.regex) {
        const hits = await regexSearch(ctx.config.sessionsRoot, query, {
          limit: opts.limit,
          ignoreCase: opts.ignoreCase,
        })
        output(opts.json, hits, () =>
          hits.length === 0
            ? pc.dim("no matches")
            : renderTable(hits, [
                {
                  header: "SESSION",
                  value: (h) => h.sessionId.slice(0, 8),
                  color: (v) => pc.cyan(v),
                },
                { header: "LINE", value: (h) => String(h.lineNumber), align: "right" },
                {
                  header: "MATCH",
                  value: (h) => h.matchText.replaceAll("\n", " ").slice(0, 110),
                },
              ]),
        )
        return
      }

      if (opts.type?.some((t: string) => !BLOCK_TYPES.includes(t as any))) {
        fail(`--type must be a comma list of ${BLOCK_TYPES.join("|")}`)
      }

      const hits = searchBlocks(ctx.db, query, {
        role: opts.role,
        types: opts.type,
        tool: opts.tool,
        project: opts.project,
        session: opts.session,
        errorsOnly: opts.errors,
        since: opts.since ? parseWhen(opts.since) : undefined,
        until: opts.until ? parseWhen(opts.until) : undefined,
        limit: opts.limit,
      })

      output(
        opts.json,
        hits.map((h) => ({ ...h, snippet: renderSnippet(h.snippet, false) })),
        () => {
          if (hits.length === 0) return pc.dim("no matches")
          const lines: string[] = []
          for (const h of hits) {
            const loc = `${pc.cyan(h.sessionId.slice(0, 8))}${pc.dim(`#${h.seq}`)}`
            const kind =
              h.type === "tool_use" || h.type === "tool_result"
                ? pc.blue(`${h.type}${h.toolName ? `:${h.toolName}` : ""}`)
                : h.type === "thinking"
                  ? pc.magenta("thinking")
                  : pc.dim(h.role)
            lines.push(
              `${loc} ${kind} ${pc.dim(h.project)} ${pc.dim(humanDate(h.ts))}  ${pc.dim(
                (h.sessionTitle ?? "").slice(0, 48),
              )}`,
            )
            lines.push(`  ${renderSnippet(h.snippet)}`)
          }
          lines.push("")
          lines.push(pc.dim(`${hits.length} hit(s). dsx show <id> | dsx export <id> to dig in.`))
          return lines.join("\n")
        },
      )
    })
}
