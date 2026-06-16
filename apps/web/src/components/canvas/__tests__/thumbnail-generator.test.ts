import { describe, it, expect } from "vitest";
import { generateThumbnailSvg } from "../lib/thumbnail-generator";
import type { Node, Edge } from "@xyflow/react";

describe("Thumbnail Generator", () => {
  it("returns empty string for empty nodes", () => {
    expect(generateThumbnailSvg([], [])).toBe("");
  });

  it("generates a valid SVG data URL for single node", () => {
    const nodes: Node[] = [
      { id: "n1", type: "prompt", position: { x: 100, y: 100 }, data: {} },
    ];
    const result = generateThumbnailSvg(nodes, []);

    expect(result).toMatch(/^data:image\/svg\+xml;base64,/);

    // Decode and check it's valid SVG
    const svg = atob(result.replace("data:image/svg+xml;base64,", ""));
    expect(svg).toContain("<svg");
    expect(svg).toContain("<rect");
  });

  it("generates edges as lines", () => {
    const nodes: Node[] = [
      { id: "n1", type: "prompt", position: { x: 0, y: 0 }, data: {} },
      { id: "n2", type: "txt2img", position: { x: 200, y: 0 }, data: {} },
    ];
    const edges: Edge[] = [
      { id: "e1", source: "n1", target: "n2" },
    ];
    const result = generateThumbnailSvg(nodes, edges);

    const svg = atob(result.replace("data:image/svg+xml;base64,", ""));
    expect(svg).toContain("<line");
  });

  it("uses different colors for different node categories", () => {
    const nodes: Node[] = [
      { id: "n1", type: "prompt", position: { x: 0, y: 0 }, data: {} },
      { id: "n2", type: "txt2img", position: { x: 200, y: 0 }, data: {} },
    ];
    const result = generateThumbnailSvg(nodes, []);

    const svg = atob(result.replace("data:image/svg+xml;base64,", ""));
    // Should contain blue (input) and green (generate) colors.
    expect(svg).toContain("#93c5fd"); // blue - input
    expect(svg).toContain("#86efac"); // green - generate
  });

  it("respects custom dimensions", () => {
    const nodes: Node[] = [
      { id: "n1", type: "prompt", position: { x: 0, y: 0 }, data: {} },
    ];
    const result = generateThumbnailSvg(nodes, [], 300, 200);

    const svg = atob(result.replace("data:image/svg+xml;base64,", ""));
    expect(svg).toContain('width="300"');
    expect(svg).toContain('height="200"');
  });

  it("handles multiple nodes at same position", () => {
    const nodes: Node[] = [
      { id: "n1", type: "prompt", position: { x: 50, y: 50 }, data: {} },
      { id: "n2", type: "txt2img", position: { x: 50, y: 50 }, data: {} },
    ];
    // Should not throw
    const result = generateThumbnailSvg(nodes, []);
    expect(result).toMatch(/^data:image\/svg\+xml;base64,/);
  });
});
