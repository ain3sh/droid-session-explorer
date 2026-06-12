# Interpreting dsx numbers

Rules for turning index data into correct claims about usage, cost, and
session health. Misreading these is the main way analyses of dsx output go
wrong.

## Fork chains inflate per-session totals

Forked sessions inherit the parent's cumulative token/credit usage at fork
time, so every `[Fork]` session reports its whole lineage's spend, not its own
increment. Consequences:

- Never sum credits across a fork chain; that double-counts. A linear chain's
  true total is roughly the deepest fork's figure alone.
- Before attributing cost to a session titled `[Fork] ...`, run
  `dsx tree <id>` and reason about the lineage root.
- Expect fork-heavy projects to dominate any naive "most expensive sessions"
  ranking.

## What is excluded, and from where

- Subagent and droid-exec sessions are excluded from `dsx stats` and
  `dsx insights`, and hidden from `dsx list` unless `--all`.
- dsx's own LLM features (`dsx ask`, `dsx insights --deep`) run as droid exec
  sessions tagged `exec` + `dsx-insights`, so they never pollute their own
  reports.

## Insight signals

`dsx insights` emits findings with `kind`, `severity`, `session`, `detail`.
Severity is comparable across kinds and always in [0, 1]. Without `--kind`,
each kind is capped at 10 findings so no signal monopolizes the list; pass
`--kind <kind>` for the uncapped set of one signal.

| kind | fires when |
|---|---|
| `error_dense` | >=15% of tool calls failed (min 10 calls); severity = error rate |
| `retry_loops` | >=3 consecutive identical tool calls |
| `interrupted` | >=3 user cancellations; severity = cancels per user message |
| `abandoned` | unended session with <=2 user messages and at least one tool error |
| `compaction_churn` | >=4 context compactions |
| `expensive` | credits above max(p95, 3x median) of this user's credit-bearing sessions (min 20 samples); severity = log10(median ratio)/3 |
| `marathon` | >4h of assistant active time |

`expensive` is relative to the user's own distribution, never an absolute
threshold; details cite the median ratio and percentile (e.g. "44x your
median session (top 1%)"). Remember the fork-inflation rule above when
reading cost findings.

## Report-level rates

The `overall` block of `dsx insights --json` reports `toolErrorRate` (over
all tool calls), `interruptionRate` and `abandonRate` (over sessions), and
`medianCredits` (median over credit-bearing sessions only; zero-credit
sessions are typically empty shells and are excluded from the median).
