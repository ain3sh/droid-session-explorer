# AGENTS.md guidance sync (`dsx sync`) — implementation notes

- `dsx skill sync` became a unified `dsx sync` managing two companion assets:
  the skill dir copy and a marker-fenced guidance block (papercuts + recovery)
  in AGENTS.md. One prefs file, one questionnaire, one `--apply` hook in
  install.sh. No alias for the old command.
- The managed block's begin marker carries a short sha256 of the content we
  wrote (`<!-- dsx:begin <hash> ... -->`). That makes the file self-describing:
  hand-edit detection needs no state in prefs (comparing against the *current*
  embedded content would misread every version bump as a user edit). Hash
  mismatch → sync skips the file and points at `--force`.
- Updates replace the block **in place**, so users can move it anywhere in
  their AGENTS.md and reorganize around it. A marker pair is the sole identity;
  a hand-pasted unfenced copy is the user's and is never touched.
- Prefs sections are independently optional: absent = never asked (so
  `--apply`/non-tty fills the default and a legacy user gets the new agents
  question defaulted), empty = declined. Legacy boundary lives entirely in
  `src/sync/prefs.ts`: `loadPrefs` reads pre-0.4 `skill-prefs.json`
  (`{ targets }`) as an answered skill section, and `savePrefs` deletes the
  legacy file after writing canonical `sync-prefs.json`.
- Source of truth for the block content is `src/sync/agents-block.md`
  (text-imported like the skill files; both build.ts and scripts/compile.ts
  already had the `.md` text loader).
