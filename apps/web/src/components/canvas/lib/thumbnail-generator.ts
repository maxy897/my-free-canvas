import type { Node, Edge } from "@xyflow/react";

/** Category to color mapping for thumbnail rendering */
const CATEGORY_COLORS: Record<string, string> = {
  input: "#93c5fd",     // blue-300
  generate: "#86efac",  // green-300
};

/** Node type to category */
const TYPE_CATEGORY: Record<string, string> = {
  prompt: "input",
  "image-input": "input",
  txt2img: "generate",
  img2video: "generate",
};

/**
 * Generate an SVG thumbnail data URL from canvas nodes and edges.
 * Lightweight: no DOM manipulation, pure string SVG generation.
 */
export function generateThumbnailSvg(
  nodes: Node[],
  edges: Edge[],
  width = 200,
  height = 120
): string {
  if (nodes.length === 0) {
    return "";
  }

  // Calculate bounding box of all nodes
  const xs = nodes.map((n) => n.position.x);
  const ys = nodes.map((n) => n.position.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  // Add padding
  const padding = 20;
  const rangeX = maxX - minX + padding * 2 || 1;
  const rangeY = maxY - minY + padding * 2 || 1;

  // Scale to fit in thumbnail
  const scale = Math.min(width / rangeX, height / rangeY) * 0.85;
  const offsetX = (width - rangeX * scale) / 2;
  const offsetY = (height - rangeY * scale) / 2;

  const toX = (x: number) => (x - minX + padding) * scale + offsetX;
  const toY = (y: number) => (y - minY + padding) * scale + offsetY;

  // Build SVG
  const nodeRects = nodes.map((n) => {
    const x = toX(n.position.x);
    const y = toY(n.position.y);
    const color = CATEGORY_COLORS[TYPE_CATEGORY[n.type || ""] || "input"] || "#d1d5db";
    const w = 24;
    const h = 14;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${color}" stroke="#9ca3af" stroke-width="0.5"/>`;
  });

  // Build node position map for edges
  const nodePos = new Map(nodes.map((n) => [n.id, { x: toX(n.position.x), y: toY(n.position.y) }]));

  const edgeLines = edges.map((e) => {
    const src = nodePos.get(e.source);
    const tgt = nodePos.get(e.target);
    if (!src || !tgt) return "";
    return `<line x1="${src.x + 24}" y1="${src.y + 7}" x2="${tgt.x}" y2="${tgt.y + 7}" stroke="#9ca3af" stroke-width="0.8" stroke-dasharray="2,1"/>`;
  });

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="#f9fafb" rx="4"/>
    ${edgeLines.join("\n    ")}
    ${nodeRects.join("\n    ")}
  </svg>`;

  return `data:image/svg+xml;base64,${btoa(svg)}`;
}
