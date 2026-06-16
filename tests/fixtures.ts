import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

export const SESSION_A = "aaaaaaaa-1111-2222-3333-444444444444"
export const SESSION_B = "bbbbbbbb-1111-2222-3333-444444444444"
export const SESSION_SUB = "cccccccc-1111-2222-3333-444444444444"
export const SESSION_TODO_ARRAY = "dddddddd-1111-2222-3333-444444444444"
export const SESSION_TODO_CLEARED = "eeeeeeee-1111-2222-3333-444444444444"

export interface Fixture {
  root: string
  slugDir: string
  transcriptA: string
}

const ts = (minute: number) =>
  `2026-06-01T10:${String(minute).padStart(2, "0")}:00.000Z`

function jsonl(records: object[]): string {
  return records.map((r) => JSON.stringify(r)).join("\n") + "\n"
}

export function makeFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "dsx-test-"))
  const slug = "-home-test-projects-demo"
  const slugDir = join(root, slug)
  mkdirSync(slugDir, { recursive: true })

  const transcriptA = join(slugDir, `${SESSION_A}.jsonl`)
  writeFileSync(
    transcriptA,
    jsonl([
      {
        type: "session_start",
        id: SESSION_A,
        title: "fix the flaky test",
        sessionTitle: "Fix flaky parser test",
        cwd: "/home/test/projects/demo",
        version: 2,
      },
      {
        type: "message",
        id: "m1",
        timestamp: ts(0),
        message: {
          role: "user",
          content: [{ type: "text", text: "please fix the flaky tokenizer test" }],
        },
      },
      {
        type: "message",
        id: "m2",
        timestamp: ts(1),
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "the tokenizer race condition is suspicious" },
            { type: "text", text: "Looking at the tokenizer now." },
            {
              type: "tool_use",
              id: "tu1",
              name: "Execute",
              input: { command: "bun test tokenizer" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "m3",
        timestamp: ts(2),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu1",
              content: "1 fail: tokenizer race",
              is_error: true,
            },
          ],
        },
      },
      {
        type: "message",
        id: "m4",
        timestamp: ts(3),
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "tu2",
              name: "Execute",
              input: { command: "bun test tokenizer" },
            },
          ],
        },
      },
      {
        type: "message",
        id: "m5",
        timestamp: ts(4),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tu2",
              content: [{ type: "text", text: "all tests pass now" }],
              is_error: false,
            },
          ],
        },
      },
      { type: "todo_state", id: "t1", timestamp: ts(4), todos: { todos: "1. [completed] fix test" } },
    ]),
  )
  writeFileSync(
    join(slugDir, `${SESSION_A}.settings.json`),
    JSON.stringify({
      model: "claude-fable-5",
      reasoningEffort: "high",
      autonomyMode: "auto-high",
      assistantActiveTimeMs: 60000,
      tokenUsage: {
        inputTokens: 1000,
        outputTokens: 200,
        cacheReadTokens: 5000,
        cacheCreationTokens: 0,
        thinkingTokens: 50,
        factoryCredits: 4242,
      },
    }),
  )

  // Fork of A
  writeFileSync(
    join(slugDir, `${SESSION_B}.jsonl`),
    jsonl([
      {
        type: "session_start",
        id: SESSION_B,
        title: "[Fork] fix the flaky test",
        cwd: "/home/test/projects/demo",
        parent: SESSION_A,
      },
      {
        type: "message",
        id: "m1",
        timestamp: ts(10),
        message: { role: "user", content: [{ type: "text", text: "try a different approach" }] },
      },
      {
        type: "session_end",
        timestamp: ts(11),
        durationMs: 1000,
        toolCount: 0,
        finalText: "done",
      },
    ]),
  )
  writeFileSync(
    join(slugDir, `${SESSION_B}.settings.json`),
    JSON.stringify({
      model: "gpt-5.5",
      tokenUsage: { inputTokens: 10, outputTokens: 5, factoryCredits: 7 },
    }),
  )

  // Subagent called from A
  writeFileSync(
    join(slugDir, `${SESSION_SUB}.jsonl`),
    jsonl([
      { type: "session_start", id: SESSION_SUB, title: "explore codebase", cwd: "/home/test/projects/demo" },
      {
        type: "message",
        id: "m1",
        timestamp: ts(2),
        message: { role: "user", content: [{ type: "text", text: "find the tokenizer module" }] },
      },
    ]),
  )
  writeFileSync(
    join(slugDir, `${SESSION_SUB}.settings.json`),
    JSON.stringify({
      model: "claude-fable-5",
      tokenUsage: { inputTokens: 100, outputTokens: 20, factoryCredits: 99 },
      tags: [
        {
          name: "subagent",
          metadata: { callingSessionId: SESSION_A, callingToolUseId: "call_x" },
        },
      ],
    }),
  )

  return { root, slugDir, transcriptA }
}

export function appendToTranscriptA(fixture: Fixture): void {
  appendFileSync(
    fixture.transcriptA,
    jsonl([
      {
        type: "message",
        id: "m6",
        timestamp: ts(20),
        message: {
          role: "user",
          content: [{ type: "text", text: "also add a regression test for unicode handling" }],
        },
      },
    ]),
  )
}

export function addArrayTodoSession(fixture: Fixture): void {
  writeFileSync(
    join(fixture.slugDir, `${SESSION_TODO_ARRAY}.jsonl`),
    jsonl([
      {
        type: "session_start",
        id: SESSION_TODO_ARRAY,
        title: "array todos",
        cwd: "/home/test/projects/demo",
      },
      {
        type: "todo_state",
        id: "todos-array",
        timestamp: ts(30),
        todos: {
          todos: [
            {
              id: "fix-test",
              content: "fix array todo handling",
              status: "completed",
              priority: "high",
            },
          ],
        },
      },
    ]),
  )
}

export function addClearedTodoSession(fixture: Fixture): void {
  writeFileSync(
    join(fixture.slugDir, `${SESSION_TODO_CLEARED}.jsonl`),
    jsonl([
      {
        type: "session_start",
        id: SESSION_TODO_CLEARED,
        title: "cleared todos",
        cwd: "/home/test/projects/demo",
      },
      {
        type: "todo_state",
        id: "todos-array",
        timestamp: ts(30),
        todos: {
          todos: [
            {
              id: "stale-test",
              content: "clear stale todo snapshot",
              status: "pending",
              priority: "high",
            },
          ],
        },
      },
      {
        type: "todo_state",
        id: "todos-empty",
        timestamp: ts(31),
        todos: { todos: [] },
      },
    ]),
  )
}
