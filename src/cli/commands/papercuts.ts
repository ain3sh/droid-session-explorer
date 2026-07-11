import { InvalidArgumentError, type Command } from "commander"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { reviewSessionForPapercuts } from "../../exec/papercutReview"
import {
  appendPapercut,
  listPapercuts,
  papercutFingerprint,
  readPapercuts,
  type PapercutSource,
} from "../../papercuts"
import { projectName, toSummary, type SessionRow, type SessionSummary } from "../../query/types"
import { fail, humanDate, output, renderTable } from "../format"
import { ensureFresh } from "../refresh"
import { resolveOrFail } from "./sessions"

const ACTIVE_SESSION_WINDOW_MS = 10 * 60_000

export function registerPapercutCommands(program: Command, ctx: AppContext): void {
  const papercut = program.command("papercut").description("record and review workflow friction")

  papercut
    .command("add <message>")
    .description("append one papercut to the durable log")
    .option("--session <id>", "attribute it to a session id or prefix")
    .option("--json", "JSON output")
    .action(async (message: string, opts) => {
      if (opts.session) await ensureFresh(ctx, !program.opts().refresh)
      const session = captureSession(ctx, opts.session)
      const cwd = session?.cwd ?? process.cwd()
      const fingerprint = papercutFingerprint(message)
      const duplicate = session
        ? readPapercuts(ctx.config.papercutsPath).find(
            (record) =>
              record.sessionId === session.id &&
              papercutFingerprint(record.message) === fingerprint,
          )
        : undefined
      if (duplicate) {
        output(opts.json, duplicate, () => pc.dim(`already logged ${duplicate.id.slice(0, 8)}`))
        return
      }

      const record = appendPapercut(ctx.config.papercutsPath, {
        message,
        source: "manual",
        cwd,
        project: session?.project ?? projectName(cwd, ""),
        sessionId: session?.id,
        model: session?.model,
      })
      output(opts.json, record, () => `${pc.green("logged")} ${pc.cyan(record.id.slice(0, 8))}`)
    })

  papercut
    .command("list")
    .description("list recorded papercuts, newest first")
    .option("-p, --project <name>", "filter by project substring")
    .option("--session <id>", "filter by session id prefix")
    .option("--source <source>", "manual|review")
    .option("-n, --limit <n>", "max rows", parsePositiveInteger, 25)
    .option("--json", "JSON output")
    .action((opts) => {
      const source = parseSource(opts.source)
      const records = listPapercuts(ctx.config.papercutsPath, {
        project: opts.project,
        sessionId: opts.session,
        source,
        limit: opts.limit,
      })
      output(opts.json, records, () =>
        records.length === 0
          ? pc.dim("no papercuts match")
          : renderTable(records, [
              {
                header: "WHEN",
                value: (record) => humanDate(Date.parse(record.createdAt)),
              },
              { header: "PROJECT", value: (record) => record.project.slice(0, 20) },
              { header: "SOURCE", value: (record) => record.source },
              {
                header: "SESSION",
                value: (record) => record.sessionId?.slice(0, 8) ?? "-",
                color: (value) => pc.cyan(value),
              },
              { header: "MESSAGE", value: (record) => record.message.replaceAll("\n", " ") },
            ]),
      )
    })

  papercut
    .command("review <session>")
    .description("mine one transcript for missed papercuts (preview by default)")
    .option("--save", "append candidates to the durable log")
    .option(
      "-m, --model <id>",
      "model for the review (default: $DSX_PAPERCUT_MODEL or gpt-5.6-luna)",
    )
    .option("--reasoning <effort>", "reasoning effort for the review")
    .option("--json", "JSON output")
    .action(async (ref: string, opts) => {
      await ensureFresh(ctx, !program.opts().refresh)
      const session = resolveOrFail(ctx, ref)
      try {
        const result = await reviewSessionForPapercuts(ctx, session, {
          save: opts.save,
          model: opts.model,
          reasoningEffort: opts.reasoning,
          onStatus: opts.json ? undefined : (status) => console.error(pc.dim(`dsx: ${status}`)),
        })
        output(opts.json, result, () => {
          if (result.candidates.length === 0) return pc.green("no papercuts found")
          const lines = result.candidates.map(
            (candidate, index) => `${pc.dim(`${index + 1}.`)} ${candidate.message}`,
          )
          lines.push(
            "",
            opts.save
              ? pc.green(`saved ${result.saved.length} papercut(s)`)
              : pc.yellow("preview only; rerun with --save to append these candidates"),
          )
          return lines.join("\n")
        })
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error))
      }
    })
}

function captureSession(ctx: AppContext, ref: string | undefined): SessionSummary | null {
  if (ref) return resolveOrFail(ctx, ref)
  const row = ctx.db
    .query<SessionRow, [string, number]>(
      `SELECT * FROM sessions
       WHERE cwd = ? AND is_subagent = 0 AND is_exec = 0 AND updated_at >= ?
       ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(process.cwd(), Date.now() - ACTIVE_SESSION_WINDOW_MS)
  return row ? toSummary(row) : null
}

function parseSource(source: string | undefined): PapercutSource | undefined {
  if (source === undefined || source === "manual" || source === "review") return source
  fail("--source must be manual or review")
}

export function parsePositiveInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError("must be a positive integer")
  }
  return parsed
}
