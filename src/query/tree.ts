import type { Database } from "bun:sqlite"
import { toSummary, type SessionRow, type SessionSummary } from "./types"

export interface TreeNode {
  session: SessionSummary | null
  /** Sessions can reference parents whose files no longer exist */
  id: string
  edgeKind: "fork" | "subagent" | "root"
  toolUseId: string | null
  children: TreeNode[]
}

interface Edge {
  parent_id: string
  child_id: string
  kind: "fork" | "subagent"
  tool_use_id: string | null
}

/**
 * Build the lineage tree containing a session: walk up to the topmost
 * ancestor, then expand all descendants (forks + subagents).
 */
export function lineage(db: Database, sessionId: string): TreeNode {
  const parentOf = (id: string): Edge | null =>
    db
      .query<Edge, [string]>(
        "SELECT parent_id, child_id, kind, tool_use_id FROM edges WHERE child_id = ? LIMIT 1",
      )
      .get(id)

  let rootId = sessionId
  const seen = new Set([rootId])
  for (;;) {
    const edge = parentOf(rootId)
    if (!edge || seen.has(edge.parent_id)) break
    rootId = edge.parent_id
    seen.add(rootId)
  }

  return expand(db, rootId, "root", null, new Set())
}

function expand(
  db: Database,
  id: string,
  edgeKind: TreeNode["edgeKind"],
  toolUseId: string | null,
  visited: Set<string>,
): TreeNode {
  visited.add(id)
  const row = db
    .query<SessionRow, [string]>("SELECT * FROM sessions WHERE id = ?")
    .get(id)
  const childEdges = db
    .query<Edge, [string]>(
      "SELECT parent_id, child_id, kind, tool_use_id FROM edges WHERE parent_id = ? ORDER BY kind, child_id",
    )
    .all(id)
  return {
    id,
    session: row ? toSummary(row) : null,
    edgeKind,
    toolUseId,
    children: childEdges
      .filter((e) => !visited.has(e.child_id))
      .map((e) => expand(db, e.child_id, e.kind, e.tool_use_id, visited)),
  }
}
