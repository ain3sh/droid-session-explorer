import { Command } from "commander"
import type { AppContext } from "../context"
import { registerAskCommand } from "./commands/ask"
import { registerExportCommand } from "./commands/export"
import { registerMaintenanceCommands } from "./commands/maintenance"
import { registerSearchCommands } from "./commands/search"
import { registerSessionCommands } from "./commands/sessions"
import { registerStatsCommands } from "./commands/stats"

export function buildProgram(ctx: AppContext): Command {
  const program = new Command("dsx")
    .description(
      "Droid Session Explorer: search, analyze, and navigate your Factory Droid sessions.\nRun with no arguments to open the TUI.",
    )
    .version("0.2.3")
    .option("--no-refresh", "skip the index freshness check (fastest)")

  registerSessionCommands(program, ctx)
  registerSearchCommands(program, ctx)
  registerStatsCommands(program, ctx)
  registerExportCommand(program, ctx)
  registerAskCommand(program, ctx)
  registerMaintenanceCommands(program, ctx)

  program
    .command("tui", { isDefault: false })
    .description("open the interactive TUI (same as running dsx with no arguments)")
    .action(async () => {
      const { launchTui } = await import("../tui/app")
      await launchTui(ctx)
    })

  return program
}
