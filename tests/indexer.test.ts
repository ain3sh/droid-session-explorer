import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import type { Database } from "bun:sqlite"
import { openDb } from "../src/indexer/db"
import { Indexer } from "../src/indexer/indexer"
import { listSessions, resolveSession, sessionToolStats } from "../src/query/sessions"
import { searchBlocks } from "../src/query/search"
import { totals, byDay, byTool } from "../src/query/stats"
import { lineage } from "../src/query/tree"
import { insightsReport } from "../src/query/insights"
import {
  makeFixture,
  appendToTranscriptA,
  addArrayTodoSession,
  addClearedTodoSession,
  SESSION_A,
  SESSION_B,
  SESSION_SUB,
  SESSION_TODO_ARRAY,
  SESSION_TODO_CLEARED,
  type Fixture,
} from "./fixtures"

let fixture: Fixture
let db: Database
let indexer: Indexer

beforeEach(async () => {
  fixture = makeFixture()
  db = openDb(":memory:")
  indexer = new Indexer(db, {
    sessionsRoot: fixture.root,
    historyPath: "/nonexistent/history.json",
    maxIndexedBlockBytes: 8192,
  })
  await indexer.refresh()
})

afterEach(() => {
  db.close()
  rmSync(fixture.root, { recursive: true, force: true })
})

describe("indexing", () => {
  test("indexes all sessions with metadata and usage", () => {
    const a = resolveSession(db, SESSION_A)
    expect(a.title).toBe("Fix flaky parser test")
    expect(a.cwd).toBe("/home/test/projects/demo")
    expect(a.model).toBe("claude-fable-5")
    expect(a.usage.credits).toBe(4242)
    expect(a.usage.inputTokens).toBe(1000)
    expect(a.counts.messages).toBe(5)
    expect(a.counts.userMessages).toBe(3)
    expect(a.counts.toolCalls).toBe(2)
    expect(a.counts.toolErrors).toBe(1)
    expect(a.counts.todos).toBe(1)
    expect(a.lastTodos).toContain("fix test")
  })

  test("detects retry loops (identical consecutive tool calls)", () => {
    const a = resolveSession(db, SESSION_A)
    expect(a.counts.retryLoops).toBe(1)
  })

  test("marks ended sessions and fork lineage", () => {
    const b = resolveSession(db, SESSION_B)
    expect(b.ended).toBe(true)
    expect(b.forkParent).toBe(SESSION_A)
  })

  test("subagent tagged sessions are flagged and linked", () => {
    const sub = resolveSession(db, SESSION_SUB)
    expect(sub.isSubagent).toBe(true)
    const edge = db
      .query("SELECT * FROM edges WHERE kind = 'subagent'")
      .get() as any
    expect(edge.parent_id).toBe(SESSION_A)
    expect(edge.child_id).toBe(SESSION_SUB)
  })

  test("incremental refresh ingests only appended lines", async () => {
    appendToTranscriptA(fixture)
    const result = await indexer.refresh()
    expect(result.transcriptsIngested).toBe(1)
    expect(result.linesParsed).toBe(1)
    const a = resolveSession(db, SESSION_A)
    expect(a.counts.messages).toBe(6)
    expect(a.counts.userMessages).toBe(4)
  })

  test("refresh with no changes is a no-op", async () => {
    const result = await indexer.refresh()
    expect(result.transcriptsIngested).toBe(0)
    expect(result.settingsIngested).toBe(0)
  })

  test("removes sessions whose files are deleted", async () => {
    rmSync(fixture.transcriptA)
    rmSync(fixture.transcriptA.replace(".jsonl", ".settings.json"))
    const result = await indexer.refresh()
    expect(result.sessionsRemoved).toBe(1)
    expect(() => resolveSession(db, SESSION_A)).toThrow()
  })

  test("normalizes structured todo arrays", async () => {
    addArrayTodoSession(fixture)
    await indexer.refresh()
    const session = resolveSession(db, SESSION_TODO_ARRAY)
    expect(session.lastTodos).toContain("[completed] fix array todo handling")
  })

  test("clears stale todo snapshots with empty arrays", async () => {
    addClearedTodoSession(fixture)
    await indexer.refresh()
    const session = resolveSession(db, SESSION_TODO_CLEARED)
    expect(session.lastTodos).toBe("")
  })
})

describe("queries", () => {
  test("listSessions filters and sorts", () => {
    const all = listSessions(db, { includeSubagents: true })
    expect(all.length).toBe(3)
    const main = listSessions(db)
    expect(main.length).toBe(2)
    const byCredits = listSessions(db, { sort: "credits" })
    expect(byCredits[0]!.id).toBe(SESSION_A)
    const fuzzy = listSessions(db, { query: "flaky parser" })
    expect(fuzzy[0]!.id).toBe(SESSION_A)
  })

  test("resolveSession by prefix", () => {
    expect(resolveSession(db, "aaaaaaaa").id).toBe(SESSION_A)
    expect(() => resolveSession(db, "zzzz")).toThrow("no session")
  })

  test("full-text search finds thinking and tool output", () => {
    const hits = searchBlocks(db, "race condition")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]!.sessionId).toBe(SESSION_A)
    expect(hits[0]!.type).toBe("thinking")

    const toolHits = searchBlocks(db, "tests pass", { types: ["tool_result"] })
    expect(toolHits.length).toBe(1)
  })

  test("search survives FTS-hostile syntax", () => {
    expect(() => searchBlocks(db, 'tokenizer AND (')).not.toThrow()
  })

  test("stats totals and grouping", () => {
    const t = totals(db)
    expect(t.sessions).toBe(3)
    expect(t.credits).toBe(4242 + 7 + 99)
    const days = byDay(db)
    expect(days.length).toBe(1)
    expect(days[0]!.day).toMatch(/2026-06-01/)
    const tools = byTool(db)
    expect(tools[0]!.tool).toBe("Execute")
    expect(tools[0]!.calls).toBe(2)
    expect(tools[0]!.errors).toBe(1)
  })

  test("lineage builds the full family tree", () => {
    const tree = lineage(db, SESSION_B)
    expect(tree.id).toBe(SESSION_A)
    const kinds = tree.children.map((c) => c.edgeKind).sort()
    expect(kinds).toEqual(["fork", "subagent"])
  })

  test("insights flags retry loops session", () => {
    const report = insightsReport(db)
    expect(report.overall.sessions).toBe(2)
    expect(report.overall.toolErrorRate).toBeCloseTo(0.5)
  })

  test("session tool stats", () => {
    const stats = sessionToolStats(db, SESSION_A)
    expect(stats).toEqual([{ tool: "Execute", calls: 2, errors: 1 }])
  })
})
