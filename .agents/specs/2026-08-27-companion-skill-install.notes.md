# Companion skill install via `dsx skill sync` (2026-08-27)

Decisions and gotchas from wiring the companion skill into the install flow.

- **Copy, not symlink.** curl|bash installs have no repo checkout, so there is
  nothing to symlink to. Staleness is solved by overwriting on every update
  (installer runs `skill sync --apply`). A pre-existing symlink at
  `<skills>/dsx` (the old manual `ln -s` setup) is deliberately replaced with
  a real copy; the link target is left untouched.
- **Skill embedded in the binary**, not downloaded by install.sh. SKILL.md
  plus references are text imports in `src/skill/embedded.ts` (the references
  were already embedded for the sub-droid cheatsheet; cheatsheet.ts now
  composes from the same map). This locks skill version to binary version and
  gives from-source users the same one command.
- **/dev/tty, not stdin.** Under `curl | bash`, stdin is the script pipe, so
  the questionnaire opens `/dev/tty` directly (`openSync("/dev/tty", "r+")`,
  byte-wise readSync). "Interactive" is defined as "that open succeeds". Test
  interactively with `script -qec '... skill sync' /dev/null` and piped
  answers; a plain pipe cannot exercise the prompt.
- **Re-ask vs apply split.** Bare `dsx skill sync` always re-asks (cached
  choices become the prompt defaults) so users can change their mind;
  `--apply` (what install.sh calls) reapplies the cached choice silently and
  only prompts when no prefs exist yet.
- **No tty never prompts, fails, or hangs** (agent-driven `curl | bash` is a
  real path). Both bare and `--apply` fall back to the saved choice, else
  install the default (`~/.agents/skills` only), print a stdout line the
  driving agent can relay, and save that as prefs — saving matters because a
  later interactive decline only removes copies listed in previous prefs.
- **Prefs** live at `$DSX_DATA_DIR/skill-prefs.json` (`{"targets": [...]}`;
  empty array = declined). Sync removes copies from previously selected dirs
  that were deselected, so state always mirrors the latest answers.
- `writeSkill` rm-rf's `<skills>/dsx` before writing so files removed from
  the skill in a newer version don't linger.
- First release cut after this lands is the first whose installer actually
  offers the skill; older installers just install the binary as before.
