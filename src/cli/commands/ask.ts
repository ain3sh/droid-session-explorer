import type { Command } from "commander"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { ensureFresh } from "../refresh"

const CHEATSHEET = `
You are answering a question about the user's past Factory Droid sessions.
You have the \`dsx\` CLI available. It indexes every local droid session
(transcripts, token usage, tool calls, lineage). Mine it to answer.

Core commands (all support --json for stable machine-readable output):
  dsx list [--project X] [--since 7d] [--query "fuzzy title"] [--sort credits|tokens|messages] [-n 50]
  dsx search "<fts query>" [--role user|assistant] [--type text,thinking,tool_use,tool_result] [--tool Execute] [--project X] [--since 30d] [-n 50]
      FTS5 syntax supported: "exact phrase", AND/OR/NOT, NEAR(a b, 5)
  dsx search "<regex>" --regex          # ripgrep over raw transcripts
  dsx search "<text>" --history         # the user's typed prompt history
  dsx show <id-or-prefix>               # full session summary, tool stats, todos
  dsx export <id> --no-tools            # readable markdown transcript to stdout
  dsx tree <id>                         # fork/subagent lineage
  dsx stats [--by day|model|project|tool|hour] [--since 30d]
  dsx insights [--since 30d]            # error-dense, loops, abandoned sessions

Guidelines:
- Start broad (dsx search / dsx list), then drill into specific sessions with dsx show / dsx export.
- ALWAYS cite session ids (8-char prefixes are fine) for every claim.
- Prefer --json output when you need to reason over many rows.
- Keep the final answer concise and structured.

User question:
`

export function registerAskCommand(program: Command, ctx: AppContext): void {
  program
    .command("ask <question>")
    .description("ask an LLM (via droid exec) a question about your session history")
    .option("-m, --model <id>", "model for the sub-droid")
    .option("--cwd <path>", "working directory for the sub-droid", process.cwd())
    .action(async (question: string, opts) => {
      await ensureFresh(ctx, !program.opts().refresh)

      const probe = Bun.spawnSync(["which", "dsx"], { stdout: "ignore", stderr: "ignore" })
      if (probe.exitCode !== 0) {
        console.error(
          pc.yellow("dsx: warning: `dsx` is not on PATH; the sub-droid cannot call it. Run `bun run build && bun link` first."),
        )
      }

      const args = ["exec", "--auto", "low", "--cwd", opts.cwd]
      if (opts.model) args.push("--model", opts.model)
      args.push(CHEATSHEET + question)

      console.error(pc.dim("dsx: asking droid exec (this may take a minute)..."))
      const proc = Bun.spawn(["droid", ...args], {
        stdio: ["inherit", "inherit", "inherit"],
      })
      process.exit(await proc.exited)
    })
}
