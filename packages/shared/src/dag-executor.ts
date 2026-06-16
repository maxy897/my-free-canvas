import { buildExecutionPlan, type CanvasGraphEdge, type CanvasGraphNode } from "./dag-solver";

const NON_EXECUTABLE_TYPES = new Set([
  "prompt",
  "image-input",
]);

/**
 * Group executable nodes into levels based on DAG topology.
 * Level 0 = no dependencies, Level 1 = depends on Level 0, etc.
 */
export function buildExecutionLevels(
  nodes: CanvasGraphNode[],
  edges: CanvasGraphEdge[]
): { levels: string[][]; error?: string } {
  const plan = buildExecutionPlan(nodes, edges);

  if (plan.cycles.length > 0) {
    return { levels: [], error: "Graph contains cycles" };
  }

  const nodeDepth = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    nodeDepth.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  for (const nodeId of plan.order) {
    const currentDepth = nodeDepth.get(nodeId) || 0;
    for (const neighbor of adjacency.get(nodeId) || []) {
      const neighborDepth = nodeDepth.get(neighbor) || 0;
      if (currentDepth + 1 > neighborDepth) {
        nodeDepth.set(neighbor, currentDepth + 1);
      }
    }
  }

  const nodeTypeMap = new Map(nodes.map((n) => [n.id, n.type || ""]));
  const maxDepth = Math.max(0, ...nodeDepth.values());
  const levels: string[][] = [];

  for (let depth = 0; depth <= maxDepth; depth++) {
    const level: string[] = [];
    for (const [id, nodeDepthValue] of nodeDepth) {
      if (nodeDepthValue === depth && !NON_EXECUTABLE_TYPES.has(nodeTypeMap.get(id) || "")) {
        level.push(id);
      }
    }
    if (level.length > 0) {
      levels.push(level);
    }
  }

  return { levels };
}
