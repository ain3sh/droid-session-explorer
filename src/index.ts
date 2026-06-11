#!/usr/bin/env bun
import { createContext } from "./context"
import { buildProgram } from "./cli/program"

const ctx = createContext()

if (process.argv.length <= 2) {
  const { launchTui } = await import("./tui/app")
  await launchTui(ctx)
} else {
  const program = buildProgram(ctx)
  await program.parseAsync()
}
