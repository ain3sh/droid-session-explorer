import type { Command } from "commander"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { DSX_CHEATSHEET, dsxOnPath } from "../../exec/cheatsheet"
import { ensureFresh } from "../refresh"

const PREAMBLE = `
You are answering a question about the user's past Factory Droid sessions.
${DSX_CHEATSHEET}
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

      if (!dsxOnPath()) {
        console.error(
          pc.yellow("dsx: warning: `dsx` is not on PATH; the sub-droid cannot call it. Run `bun run build && bun link` first."),
        )
      }

      const args = ["exec", "--auto", "low", "--cwd", opts.cwd]
      if (opts.model) args.push("--model", opts.model)
      args.push(PREAMBLE + question)

      console.error(pc.dim("dsx: asking droid exec (this may take a minute)..."))
      const proc = Bun.spawn(["droid", ...args], {
        stdio: ["inherit", "inherit", "inherit"],
      })
      process.exit(await proc.exited)
    })
}
