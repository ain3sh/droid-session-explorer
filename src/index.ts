#!/usr/bin/env bun
import { createContext } from "./context"
import { buildProgram } from "./cli/program"

const ctx = createContext()

if (process.argv.length <= 2) {
  const { launchTui } = await import("./tui/app")
  await launchTui(ctx)
  // Don't hold the shell hostage to an in-flight background refresh; a
  // mid-transaction kill rolls back cleanly under WAL and the next run redoes it.
  process.exit(0)
} else {
  const program = buildProgram(ctx)
  await program.parseAsync()
}
