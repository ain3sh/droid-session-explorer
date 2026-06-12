import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import type { Database } from "bun:sqlite"
import { openDb } from "../src/indexer/db"
import { insightsReport } from "../src/query/insights"

let db: Database

beforeEach(() => {
  db = openDb(":memory:")
})

afterEach(() => {
  db.close()
})

interface SessionSpec {
  id: string
  credits?: number
  toolCalls?: number
  toolErrors?: number
  cancels?: number
  retryLoops?: number
  userMessages?: number
  messages?: number
}

function insertSession(spec: SessionSpec): void {
  db.query(
    `INSERT INTO sessions (
       id, dir_slug, credits, tool_call_count, tool_error_count,
       cancel_count, retry_loop_count, user_message_count, message_count,
       ended, updated_at
     ) VALUES (?, '-home-test-demo', ?, ?, ?, ?, ?, ?, ?, 1, 1000)`,
  ).run(
    spec.id,
    spec.credits ?? 0,
    spec.toolCalls ?? 0,
    spec.toolErrors ?? 0,
    spec.cancels ?? 0,
    spec.retryLoops ?? 0,
    spec.userMessages ?? 3,
    spec.messages ?? 10,
  )
}

/** A baseline population: 30 ordinary sessions at ~100 credits each. */
function seedBaseline(count = 30, credits = 100): void {
  for (let i = 0; i < count; i++) {
    insertSession({ id: `baseline-${String(i).padStart(3, "0")}`, credits })
  }
}

describe("expensive signal", () => {
  test("flags only true outliers above max(p95, 3x median)", () => {
    seedBaseline()
    insertSession({ id: "slightly-above", credits: 150 })
    insertSession({ id: "outlier", credits: 10_000 })

    const report = insightsReport(db, { kind: "expensive" })
    const ids = report.insights.map((i) => i.session.id)
    expect(ids).toContain("outlier")
    expect(ids).not.toContain("slightly-above")
    expect(ids).not.toContain("baseline-000")
  })

  test("requires a minimum credit-bearing sample", () => {
    seedBaseline(5)
    insertSession({ id: "outlier", credits: 10_000 })
    const report = insightsReport(db, { kind: "expensive" })
    expect(report.insights).toHaveLength(0)
  })

  test("severity is log-scaled into [0, 1]", () => {
    seedBaseline()
    insertSession({ id: "ten-x", credits: 1_000 })
    insertSession({ id: "thousand-x", credits: 100_000 })

    const byId = new Map(
      insightsReport(db, { kind: "expensive" }).insights.map((i) => [i.session.id, i]),
    )
    expect(byId.get("ten-x")!.severity).toBeCloseTo(1 / 3, 2)
    expect(byId.get("thousand-x")!.severity).toBeCloseTo(1, 2)
  })

  test("detail reports median ratio and percentile, not a bare p95 label", () => {
    seedBaseline()
    insertSession({ id: "outlier", credits: 10_000 })
    const [ins] = insightsReport(db, { kind: "expensive" }).insights
    expect(ins!.detail).toContain("100x your median")
    expect(ins!.detail).toMatch(/top \d+(\.\d+)?%/)
    expect(ins!.detail).not.toContain("p95")
  })

  test("all severities are commensurable (within [0, 1])", () => {
    seedBaseline()
    insertSession({ id: "outlier", credits: 1_000_000_000 })
    insertSession({ id: "cancelled", cancels: 5, userMessages: 1 })
    insertSession({ id: "errors", toolCalls: 20, toolErrors: 10 })
    for (const ins of insightsReport(db).insights) {
      expect(ins.severity).toBeGreaterThanOrEqual(0)
      expect(ins.severity).toBeLessThanOrEqual(1)
    }
  })
})

describe("per-kind cap", () => {
  test("one kind cannot monopolize the findings list", () => {
    seedBaseline(300)
    for (let i = 0; i < 15; i++) {
      insertSession({ id: `costly-${String(i).padStart(2, "0")}`, credits: 50_000 + i })
    }
    insertSession({ id: "error-dense", toolCalls: 20, toolErrors: 10 })

    const report = insightsReport(db, { limit: 50 })
    const expensive = report.insights.filter((i) => i.kind === "expensive")
    expect(expensive.length).toBeLessThanOrEqual(10)
    expect(report.insights.some((i) => i.kind === "error_dense")).toBe(true)
  })

  test("kind filter bypasses the cap", () => {
    seedBaseline(300)
    for (let i = 0; i < 15; i++) {
      insertSession({ id: `costly-${String(i).padStart(2, "0")}`, credits: 50_000 + i })
    }
    const report = insightsReport(db, { kind: "expensive", limit: 50 })
    expect(report.insights.length).toBe(15)
  })
})
