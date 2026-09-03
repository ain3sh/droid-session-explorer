# SQLITE_BUSY crash on concurrent launch — implementation notes

- `bun:sqlite` ships with `PRAGMA busy_timeout = 0` (verified empirically, not
  assumed): any cross-process write overlap crashes instantly with
  `SQLITE_BUSY`, even for a 1 ms overlap. WAL does not save you — WAL removes
  reader/writer contention, not writer/writer contention.
- Every `dsx` invocation opened the DB through `migrate`, which ended with an
  unconditional `INSERT OR REPLACE INTO meta` — a write on every launch even
  when the schema was already current. That made plain concurrent launches
  (live TUI background refresh vs a fresh command) collide at startup.
- Fix is two moves in `src/indexer/db.ts`: set `busy_timeout = 5000` as the
  *first* pragma (before `journal_mode = WAL`, which can itself need the write
  lock on a fresh DB), and make `migrate` a write-free early return when the
  schema version already matches. Only a stale/unknown version still writes.
- `dsx sync` was checked as a suspect writer and is innocent: it only touches
  companion files (skill dirs, AGENTS.md), never the index DB.
- Proven with a two-process /tmp test (holder holds `BEGIN IMMEDIATE`,
  contender inserts): fails in 1 ms without the pragma, succeeds after ~2.5 s
  with it. Repo gate green: 62 tests, tsc clean.
