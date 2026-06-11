import type { Command } from "commander"
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs"
import { isAbsolute, join, resolve } from "node:path"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { fail, output } from "../format"

export function registerMaintenanceCommands(program: Command, ctx: AppContext): void {
  program
    .command("index")
    .description("update the search index (incremental by default)")
    .option("--rebuild", "drop and re-ingest everything")
    .option("--json", "JSON output")
    .action(async (opts) => {
      const started = performance.now()
      let last = 0
      const progress = (done: number, total: number) => {
        if (opts.json) return
        const now = performance.now()
        if (now - last < 200 && done < total - 1) return
        last = now
        process.stderr.write(`\r${pc.dim(`indexing ${done}/${total} files...`)}  `)
      }
      const result = opts.rebuild
        ? await ctx.indexer.rebuild(progress)
        : await ctx.refresh(progress)
      if (!opts.json) process.stderr.write("\r")
      const stats = {
        ...result,
        durationMs: Math.round(performance.now() - started),
        dbPath: ctx.config.dbPath,
      }
      output(opts.json, stats, () =>
        [
          `${pc.bold("index updated")} (${(stats.durationMs / 1000).toFixed(1)}s)`,
          `  files seen        ${result.filesSeen}`,
          `  transcripts       ${result.transcriptsIngested}`,
          `  settings          ${result.settingsIngested}`,
          `  lines parsed      ${result.linesParsed}`,
          `  sessions removed  ${result.sessionsRemoved}`,
          `  db                ${ctx.config.dbPath}`,
        ].join("\n"),
      )
    })

  program
    .command("migrate-path <oldPrefix> <newPrefix>")
    .description("rewrite session cwd metadata + encoded dirs after moving a project tree (dry-run by default)")
    .option("--apply", "actually write changes (creates a backup first)")
    .option("--cwd-only", "only rewrite top-level JSONL cwd fields")
    .option("--dirs-only", "only rename encoded session directories")
    .option("--rename-conflicts", "keep both copies when target files conflict")
    .option("--backup-dir <dir>", "backup parent directory")
    .action(async (oldPrefixRaw: string, newPrefixRaw: string, opts) => {
      if (opts.cwdOnly && opts.dirsOnly) fail("--cwd-only and --dirs-only are mutually exclusive")
      const oldPrefix = normalizePrefix(oldPrefixRaw)
      const newPrefix = normalizePrefix(newPrefixRaw)
      if (oldPrefix === newPrefix) fail("old and new prefix resolve to the same path")
      if (oldPrefix === "/") fail("refusing to use / as a migration prefix")

      const root = ctx.config.sessionsRoot
      const oldSlug = oldPrefix.replaceAll("/", "-")
      const newSlug = newPrefix.replaceAll("/", "-")
      const doCwd = !opts.dirsOnly
      const doDirs = !opts.cwdOnly

      const plan = await scanMigration(root, oldPrefix, newPrefix, oldSlug, newSlug, doCwd, doDirs)

      console.log(`${pc.bold("mode")}        ${opts.apply ? pc.red("APPLY") : pc.green("DRY RUN")}`)
      console.log(`${pc.bold("root")}        ${root}`)
      console.log(`${pc.bold("old prefix")}  ${oldPrefix}  ${pc.dim(`(slug ${oldSlug})`)}`)
      console.log(`${pc.bold("new prefix")}  ${newPrefix}  ${pc.dim(`(slug ${newSlug})`)}`)
      console.log("")
      console.log(`cwd fields to update:        ${plan.cwdUpdates.reduce((a, f) => a + f.lines, 0)} in ${plan.cwdUpdates.length} file(s)`)
      console.log(`session dirs to rename:      ${plan.dirRenames.length}`)
      console.log(`target file conflicts:       ${plan.conflicts.length}`)
      for (const c of plan.conflicts.slice(0, 10)) console.log(pc.yellow(`  conflict: ${c}`))

      if (!opts.apply) {
        console.log("")
        console.log(pc.dim("no changes made; re-run with --apply to write changes"))
        return
      }
      if (plan.conflicts.length && !opts.renameConflicts) {
        fail("target file conflicts exist; re-run with --rename-conflicts or resolve manually")
      }

      const backupParent =
        opts.backupDir ?? join(process.env.HOME ?? "~", ".factory", "session-migration-backups")
      const stamp = new Date().toISOString().replace(/[:.]/g, "-")
      const backupPath = join(backupParent, stamp)
      mkdirSync(backupPath, { recursive: true })
      const cp = Bun.spawnSync(["cp", "-al", root, join(backupPath, "sessions.before")])
      if (cp.exitCode !== 0) {
        const full = Bun.spawnSync(["cp", "-a", root, join(backupPath, "sessions.before")])
        if (full.exitCode !== 0) fail("backup failed; aborting")
      }
      console.log(pc.dim(`backup: ${backupPath}`))

      let rewrittenLines = 0
      if (doCwd) {
        for (const file of plan.cwdUpdates) {
          rewrittenLines += await rewriteCwdFields(file.path, oldPrefix, newPrefix)
        }
      }
      let renamedDirs = 0
      if (doDirs) {
        for (const { from, to } of plan.dirRenames) {
          mergeDir(from, to, Boolean(opts.renameConflicts), stamp)
          renamedDirs++
        }
      }
      console.log("")
      console.log(`${pc.bold("done")}  rewrote ${rewrittenLines} cwd field(s), renamed/merged ${renamedDirs} dir(s)`)
      console.log(pc.dim("the index will pick up new paths on next dsx command"))
    })
}

function normalizePrefix(p: string): string {
  if (p.startsWith("~")) p = p.replace(/^~/, process.env.HOME ?? "~")
  if (!isAbsolute(p)) fail("prefixes must be absolute paths")
  const r = resolve(p)
  return r === "/" ? "/" : r.replace(/\/+$/, "")
}

const hasPrefix = (path: string, prefix: string) =>
  path === prefix || path.startsWith(prefix + "/")

interface MigrationPlan {
  cwdUpdates: Array<{ path: string; lines: number }>
  dirRenames: Array<{ from: string; to: string }>
  conflicts: string[]
}

async function scanMigration(
  root: string,
  oldPrefix: string,
  newPrefix: string,
  oldSlug: string,
  newSlug: string,
  doCwd: boolean,
  doDirs: boolean,
): Promise<MigrationPlan> {
  const plan: MigrationPlan = { cwdUpdates: [], dirRenames: [], conflicts: [] }
  let dirs: string[] = []
  try {
    dirs = readdirSync(root)
  } catch {
    fail(`session root does not exist: ${root}`)
  }

  for (const name of dirs) {
    const dirPath = join(root, name)
    if (!statSync(dirPath).isDirectory() || name === "attachments" || name === "cache") continue

    if (doDirs && (name === oldSlug || name.startsWith(oldSlug + "-"))) {
      const target = join(root, newSlug + name.slice(oldSlug.length))
      plan.dirRenames.push({ from: dirPath, to: target })
      if (existsSync(target)) {
        for (const child of readdirSync(dirPath)) {
          const targetChild = join(target, child)
          if (existsSync(targetChild)) plan.conflicts.push(targetChild)
        }
      }
    }

    if (doCwd) {
      for (const file of readdirSync(dirPath)) {
        if (!file.endsWith(".jsonl")) continue
        const path = join(dirPath, file)
        const text = await Bun.file(path).text()
        let lines = 0
        for (const line of text.split("\n")) {
          if (!line.includes(oldPrefix)) continue
          try {
            const record = JSON.parse(line)
            if (typeof record.cwd === "string" && hasPrefix(record.cwd, oldPrefix)) lines++
          } catch {
            // malformed line left untouched
          }
        }
        if (lines > 0) plan.cwdUpdates.push({ path, lines })
      }
    }
  }
  return plan
}

async function rewriteCwdFields(path: string, oldPrefix: string, newPrefix: string): Promise<number> {
  const text = await Bun.file(path).text()
  const endsWithNewline = text.endsWith("\n")
  const lines = text.split("\n")
  if (endsWithNewline) lines.pop()
  let updated = 0
  const out = lines.map((line) => {
    if (!line.includes(oldPrefix)) return line
    try {
      const record = JSON.parse(line)
      if (typeof record.cwd === "string" && hasPrefix(record.cwd, oldPrefix)) {
        record.cwd = newPrefix + record.cwd.slice(oldPrefix.length)
        updated++
        return JSON.stringify(record)
      }
    } catch {
      // keep malformed lines verbatim
    }
    return line
  })
  if (updated > 0) {
    const tmp = `${path}.dsx-tmp`
    writeFileSync(tmp, out.join("\n") + (endsWithNewline ? "\n" : ""))
    renameSync(tmp, path)
  }
  return updated
}

function mergeDir(from: string, to: string, renameConflicts: boolean, stamp: string): void {
  if (!existsSync(to)) {
    renameSync(from, to)
    return
  }
  for (const child of readdirSync(from)) {
    const src = join(from, child)
    const dst = join(to, child)
    if (!existsSync(dst)) {
      renameSync(src, dst)
      continue
    }
    const identical =
      statSync(src).size === statSync(dst).size &&
      Bun.spawnSync(["cmp", "-s", src, dst]).exitCode === 0
    if (identical) {
      unlinkSync(src)
      continue
    }
    if (!renameConflicts) fail(`target file already exists: ${dst}`)
    renameSync(src, join(to, `${child}.from-migration-${stamp}`))
  }
  rmdirSync(from)
}
