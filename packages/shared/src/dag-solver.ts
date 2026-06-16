export interface CanvasGraphNode {
  id: string;
  type?: string;
}

export interface CanvasGraphEdge {
  id?: string;
  source: string;
  target: string;
}

export interface ExecutionPlan {
  /** Nodes in topological order */
  order: string[];
  /** Detected cycles (should error) */
  cycles: string[][];
}

/**
 * Kahn's algorithm: topological sort of DAG.
 * Returns execution order. If cycles exist, reports them.
 */
export function buildExecutionPlan(nodes: CanvasGraphNode[], edges: CanvasGraphEdge[]): ExecutionPlan {
  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)!.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) || 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) {
    if (degree === 0) queue.push(id);
  }

  const order: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.push(current);

    for (const neighbor of adjacency.get(current) || []) {
      const newDegree = (inDegree.get(neighbor) || 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  const cycles: string[][] = [];
  if (order.length < nodeIds.size) {
    const remaining = [...nodeIds].filter((id) => !order.includes(id));
    cycles.push(remaining);
  }

  return { order, cycles };
}

/**
 * Resolve subgraph: find all upstream nodes that affect targetNodeId.
 */
export function resolveSubgraph(
  targetNodeId: string,
  nodes: CanvasGraphNode[],
  edges: CanvasGraphEdge[]
): string[] {
  const visited = new Set<string>();
  const queue = [targetNodeId];
  visited.add(targetNodeId);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.target === current && !visited.has(edge.source)) {
        visited.add(edge.source);
        queue.push(edge.source);
      }
    }
  }

  return [...visited];
}
