import type { Command } from "commander"
import { closeSync, openSync, readSync, writeSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import pc from "picocolors"
import type { AppContext } from "../../context"
import { syncAgents } from "../../sync/agents"
import { loadPrefs, savePrefs, type SyncPrefs } from "../../sync/prefs"
import { syncSkill } from "../../sync/skill"

/** Install locations offered by the questionnaire, with first-run defaults. */
const skillDirs = () => [
  { target: join(homedir(), ".agents", "skills"), defaultOn: true, label: tildify(join(homedir(), ".agents", "skills", "dsx")) },
  { target: join(homedir(), ".factory", "skills"), defaultOn: false, label: tildify(join(homedir(), ".factory", "skills", "dsx")) },
]
const agentsFiles = () => [
  { target: join(homedir(), ".agents", "AGENTS.md"), defaultOn: true },
  { target: join(homedir(), ".factory", "AGENTS.md"), defaultOn: false },
]

const defaults = (options: { target: string; defaultOn: boolean; label?: string }[]) =>
  options.filter((o) => o.defaultOn).map((o) => o.target)

export function registerSyncCommands(program: Command, ctx: AppContext): void {
  program
    .command("sync")
    .description(
      "install/update the companion assets for droids: the dsx skill and the AGENTS.md guidance block; remembers your choices.\nRun bare to (re)answer the questionnaire.",
    )
    .option("--apply", "non-interactive: reapply saved choices, ask only questions never answered")
    .option("--force", "overwrite a hand-edited AGENTS.md block")
    .action((opts: { apply?: boolean; force?: boolean }) => {
      const prefsPath = ctx.config.syncPrefsPath
      const previous = loadPrefs(prefsPath) ?? {}
      const askSkill = !(opts.apply && previous.skill)
      const askAgents = !(opts.apply && previous.agents)

      let prefs: Required<SyncPrefs>
      const tty = askSkill || askAgents ? openTty() : null
      if (tty === null) {
        // No terminal (agent harness, CI, headless curl|bash): never prompt,
        // never fail. Reuse saved answers and install the default for
        // anything never asked, so a later interactive decline knows what
        // to remove.
        if ((askSkill && !previous.skill) || (askAgents && !previous.agents)) {
          console.log("no terminal detected; installing defaults for unanswered choices (`dsx sync` to change)")
        }
        prefs = {
          skill: previous.skill ?? { targets: defaults(skillDirs()) },
          agents: previous.agents ?? { targets: defaults(agentsFiles()) },
        }
      } else {
        try {
          prefs = questionnaire(tty, previous, { askSkill, askAgents })
        } finally {
          closeSync(tty)
        }
      }

      const skill = syncSkill(prefs.skill.targets, previous.skill?.targets ?? [])
      const agents = syncAgents(prefs.agents.targets, previous.agents?.targets ?? [], opts.force)
      savePrefs(prefsPath, prefs)

      for (const dir of skill.installed) console.log(`companion skill → ${tildify(dir)}`)
      for (const dir of skill.removed) console.log(`removed ${tildify(dir)}`)
      for (const file of agents.installed) console.log(`AGENTS.md guidance → ${tildify(file)}`)
      for (const file of agents.skipped) {
        console.log(pc.yellow(`skipped ${tildify(file)}: dsx block was hand-edited (\`dsx sync --force\` overwrites)`))
      }
      for (const file of agents.removed) console.log(`removed dsx block from ${tildify(file)}`)
      if (prefs.skill.targets.length === 0 && prefs.agents.targets.length === 0) {
        console.log(pc.dim("companion assets skipped; run `dsx sync` any time to change that"))
      }
    })
}

function questionnaire(
  tty: number,
  previous: SyncPrefs,
  ask: { askSkill: boolean; askAgents: boolean },
): Required<SyncPrefs> {
  writeSync(
    tty,
    `\n${pc.bold("dsx companion assets")}: teach droids to mine your session history\n(refreshed on every dsx update; choices are remembered)\n\n`,
  )
  const skill = ask.askSkill
    ? askSection(tty, "install/update the companion skill (markdown files in your agent skills dir)?", skillDirs(), previous.skill)
    : previous.skill!
  const agents = ask.askAgents
    ? askSection(tty, "add dsx guidance (papercut logging + failure recovery) to your AGENTS.md?", agentsFiles(), previous.agents)
    : previous.agents!
  return { skill, agents }
}

function askSection(
  tty: number,
  question: string,
  options: { target: string; defaultOn: boolean; label?: string }[],
  previous: { targets: string[] } | undefined,
): { targets: string[] } {
  const wantedBefore = previous === undefined || previous.targets.length > 0
  if (!askYesNo(tty, question, wantedBefore)) return { targets: [] }

  const targets: string[] = []
  for (const { target, defaultOn, label } of options) {
    const def = previous ? previous.targets.includes(target) : defaultOn
    if (askYesNo(tty, `  → ${label ?? tildify(target)}?`, def)) targets.push(target)
  }
  if (targets.length === 0) writeSync(tty, "no locations selected\n")
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

function tildify(path: string): string {
  const home = homedir()
  return path.startsWith(home) ? `~${path.slice(home.length)}` : path
}
