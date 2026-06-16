import { describe, expect, it } from "vitest";
import type { Edge, Node } from "@xyflow/react";
import { getAutoLayoutNodes } from "../lib/auto-layout";

function makeNode(id: string, type = "prompt", x = 400, y = 400): Node {
  return { id, type, position: { x, y }, data: {}, selected: true };
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

describe("getAutoLayoutNodes", () => {
  it("places connected nodes from left to right by dependency depth", () => {
    const layouted = getAutoLayoutNodes(
      [makeNode("prompt"), makeNode("generate", "txt2img"), makeNode("result", "image-input")],
      [makeEdge("prompt", "generate"), makeEdge("generate", "result")]
    );

    const prompt = layouted.find((node) => node.id === "prompt")!;
    const generate = layouted.find((node) => node.id === "generate")!;
    const result = layouted.find((node) => node.id === "result")!;

    expect(prompt.position.x).toBeLessThan(generate.position.x);
    expect(generate.position.x).toBeLessThan(result.position.x);
  });

  it("stacks nodes in the same layer vertically", () => {
    const layouted = getAutoLayoutNodes(
      [makeNode("prompt-a"), makeNode("prompt-b"), makeNode("generate", "txt2img")],
      [makeEdge("prompt-a", "generate"), makeEdge("prompt-b", "generate")]
    );

    const promptA = layouted.find((node) => node.id === "prompt-a")!;
    const promptB = layouted.find((node) => node.id === "prompt-b")!;
    const generate = layouted.find((node) => node.id === "generate")!;

    expect(promptA.position.x).toBe(promptB.position.x);
    expect(promptA.position.y).toBeLessThan(promptB.position.y);
    expect(promptA.position.x).toBeLessThan(generate.position.x);
  });

  it("keeps cyclic graphs visible instead of dropping nodes", () => {
    const layouted = getAutoLayoutNodes(
      [makeNode("a"), makeNode("b")],
      [makeEdge("a", "b"), makeEdge("b", "a")]
    );

    expect(layouted.map((node) => node.id)).toEqual(["a", "b"]);
    expect(layouted.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
  });

  it("clears selection so layout does not leave stale selected boxes", () => {
    const layouted = getAutoLayoutNodes([makeNode("a"), makeNode("b")], []);

    expect(layouted.every((node) => node.selected === false)).toBe(true);
  });
});
