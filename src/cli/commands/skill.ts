import type { Command } from "commander"
import { closeSync, openSync, readSync, writeSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { loadPrefs, savePrefs, syncSkill, type SkillPrefs } from "../../skill/sync"

/** Skills parent dirs offered by the questionnaire, with first-run defaults. */
const knownDirs = () => [
  { dir: join(homedir(), ".agents", "skills"), defaultOn: true },
  { dir: join(homedir(), ".factory", "skills"), defaultOn: false },
]

export function registerSkillCommands(program: Command, ctx: AppContext): void {
  const skill = program
    .command("skill")
    .description("manage the dsx companion skill for droids")

  skill
    .command("sync")
    .description(
      "install/update the companion skill into agent skills dirs; remembers your choice.\nRun bare to (re)answer the questionnaire.",
    )
    .option("--to <dir...>", "skills parent dir(s) to install into (skips the prompt, replaces the saved choice)")
    .option("--apply", "non-interactive: reapply the saved choice, prompt only if none exists")
    .action((opts: { to?: string[]; apply?: boolean }) => {
      const prefsPath = ctx.config.skillPrefsPath
      const previous = loadPrefs(prefsPath)
      let prefs: SkillPrefs

      if (opts.to) {
        prefs = { targets: opts.to.map(normalizeDir) }
      } else if (opts.apply && previous) {
        prefs = previous
      } else {
        const tty = openTty()
        if (tty === null) {
          // No terminal (agent harness, CI, headless curl|bash): never prompt,
          // never fail. Reuse the saved choice, else install the default and
          // save it so a later interactive decline knows what to remove.
          prefs = previous ?? { targets: knownDirs().filter((d) => d.defaultOn).map((d) => d.dir) }
          if (previous === null) {
            console.log("no terminal detected; installing the companion skill to the default location (`dsx skill sync` to change)")
          }
        } else {
          try {
            prefs = questionnaire(tty, previous)
          } finally {
            closeSync(tty)
          }
        }
      }

      const { installed, removed } = syncSkill(prefs, previous)
      savePrefs(prefsPath, prefs)

      for (const dir of installed) console.log(`companion skill → ${tildify(dir)}`)
      for (const dir of removed) console.log(`removed ${tildify(dir)}`)
      if (prefs.targets.length === 0) {
        console.log(pc.dim("companion skill skipped; run `dsx skill sync` any time to change that"))
      }
    })
}

function questionnaire(tty: number, previous: SkillPrefs | null): SkillPrefs {
  writeSync(
    tty,
    `\n${pc.bold("dsx companion skill")}: teaches droids to mine your session history\n(a few markdown files copied into your agent skills dir, refreshed on every dsx update)\n\n`,
  )
  const wantedBefore = previous === null || previous.targets.length > 0
  if (!askYesNo(tty, "install/update the companion skill?", wantedBefore)) return { targets: [] }

  const targets: string[] = []
  for (const { dir, defaultOn } of knownDirs()) {
    const def = previous ? previous.targets.includes(dir) : defaultOn
    if (askYesNo(tty, `  → ${tildify(join(dir, "dsx"))}?`, def)) targets.push(dir)
  }
  if (targets.length === 0) writeSync(tty, "no directories selected\n")
  return { targets }
}

/** Under `curl | bash` stdin is the script, so prompts go through /dev/tty. */
function openTty(): number | null {
  try {
    return openSync("/dev/tty", "r+")
  } catch {
    // any open failure (ENXIO, ENOENT, EACCES) means "no usable terminal";
    // callers then take the non-interactive path instead of prompting
    return null
  }
}

function askYesNo(tty: number, question: string, def: boolean): boolean {
  writeSync(tty, `${question} ${pc.dim(def ? "[Y/n]" : "[y/N]")} `)
  const answer = readLine(tty).trim().toLowerCase()
  if (answer === "") return def
  return answer.startsWith("y")
}

function readLine(tty: number): string {
  const buf = Buffer.alloc(1)
  let line = ""
  while (true) {
    let n: number
    try {
      n = readSync(tty, buf, 0, 1, null)
    } catch {
      break
    }
    if (n === 0) break
    const ch = buf.toString("utf8")
    if (ch === "\n" || ch === "\r") break
    line += ch
  }
  return line
}

function normalizeDir(raw: string): string {
  return resolve(raw.startsWith("~") ? raw.replace(/^~/, homedir()) : raw)
}

function tildify(path: string): string {
  const home = homedir()
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
