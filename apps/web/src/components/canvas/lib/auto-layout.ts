import type { Edge, Node, XYPosition } from "@xyflow/react";

const NODE_WIDTH = 280;
const DEFAULT_NODE_HEIGHT = 220;
const NODE_HEIGHT_BY_TYPE: Record<string, number> = {
  prompt: 220,
  "image-input": 250,
  txt2img: 360,
  img2video: 300,
};

const COLUMN_GAP = 180;
const ROW_GAP = 72;
const DEFAULT_ORIGIN: XYPosition = { x: 120, y: 120 };

function getNodeHeight(node: Node): number {
  if (typeof node.height === "number" && node.height > 0) return node.height;
  if (node.type && NODE_HEIGHT_BY_TYPE[node.type]) return NODE_HEIGHT_BY_TYPE[node.type];
  return DEFAULT_NODE_HEIGHT;
}

function getNodeWidth(node: Node): number {
  if (typeof node.width === "number" && node.width > 0) return node.width;
  return NODE_WIDTH;
}

function getLayoutOrigin(nodes: Node[]): XYPosition {
  if (nodes.length === 0) return DEFAULT_ORIGIN;

  return nodes.reduce(
    (origin, node) => ({
      x: Math.min(origin.x, node.position.x),
      y: Math.min(origin.y, node.position.y),
    }),
    { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY }
  );
}

function getLayeredNodeIds(nodes: Node[], edges: Edge[]): Map<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const indegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  const layerById = new Map<string, number>();

  for (const node of nodes) {
    indegree.set(node.id, 0);
    outgoing.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    outgoing.get(edge.source)?.push(edge.target);
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);

  for (const id of queue) {
    layerById.set(id, 0);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const currentLayer = layerById.get(current) ?? 0;

    for (const target of outgoing.get(current) ?? []) {
      layerById.set(target, Math.max(layerById.get(target) ?? 0, currentLayer + 1));
      indegree.set(target, (indegree.get(target) ?? 1) - 1);

      if ((indegree.get(target) ?? 0) === 0) {
        queue.push(target);
      }
    }
  }

  // Cycles have no clear topological layer. Keep them visible by assigning them
  // after the deepest incoming dependency we already resolved, or layer 0.
  for (const node of nodes) {
    if (layerById.has(node.id)) continue;
    const incomingLayers = edges
      .filter((edge) => edge.target === node.id)
      .map((edge) => layerById.get(edge.source))
      .filter((layer): layer is number => typeof layer === "number");
    layerById.set(node.id, incomingLayers.length > 0 ? Math.max(...incomingLayers) + 1 : 0);
  }

  return layerById;
}

function compareNodesByFlow(a: Node, b: Node, edges: Edge[], nodeOrder: Map<string, number>): number {
  const aIncoming = edges.filter((edge) => edge.target === a.id);
  const bIncoming = edges.filter((edge) => edge.target === b.id);
  const aParentOrder =
    aIncoming.reduce((sum, edge) => sum + (nodeOrder.get(edge.source) ?? 0), 0) / Math.max(aIncoming.length, 1);
  const bParentOrder =
    bIncoming.reduce((sum, edge) => sum + (nodeOrder.get(edge.source) ?? 0), 0) / Math.max(bIncoming.length, 1);

  if (aParentOrder !== bParentOrder) return aParentOrder - bParentOrder;
  if (a.position.y !== b.position.y) return a.position.y - b.position.y;
  return (nodeOrder.get(a.id) ?? 0) - (nodeOrder.get(b.id) ?? 0);
}

export function getAutoLayoutNodes(nodes: Node[], edges: Edge[]): Node[] {
  if (nodes.length <= 1) return nodes;

  const origin = getLayoutOrigin(nodes);
  const nodeOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const layerById = getLayeredNodeIds(nodes, edges);
  const nodesByLayer = new Map<number, Node[]>();

  for (const node of nodes) {
    const layer = layerById.get(node.id) ?? 0;
    nodesByLayer.set(layer, [...(nodesByLayer.get(layer) ?? []), node]);
  }

  const positionedNodes = new Map<string, Node>();
  const sortedLayers = [...nodesByLayer.keys()].sort((a, b) => a - b);
  let maxLayerWidth = NODE_WIDTH;

  for (const layer of sortedLayers) {
    const layerNodes = [...(nodesByLayer.get(layer) ?? [])].sort((a, b) =>
      compareNodesByFlow(a, b, edges, nodeOrder)
    );
    const x = origin.x + layer * (maxLayerWidth + COLUMN_GAP);
    let y = origin.y;

    for (const node of layerNodes) {
      positionedNodes.set(node.id, {
        ...node,
        position: { x, y },
        selected: false,
      });
      y += getNodeHeight(node) + ROW_GAP;
      maxLayerWidth = Math.max(maxLayerWidth, getNodeWidth(node));
    }
  }

  return nodes.map((node) => positionedNodes.get(node.id) ?? node);
}
