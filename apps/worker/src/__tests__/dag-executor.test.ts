import { describe, it, expect } from "vitest";
import { buildExecutionLevels, type CanvasGraphEdge, type CanvasGraphNode } from "@shared/types";

function makeNode(id: string, type: string): CanvasGraphNode {
  return { id, type };
}

function makeEdge(source: string, target: string): CanvasGraphEdge {
  return { id: `${source}-${target}`, source, target };
}

describe("DAG Executor — buildExecutionLevels", () => {
  it("returns empty levels for graph with only input nodes", () => {
    const nodes = [
      makeNode("p1", "prompt"),
      makeNode("img", "image-input"),
    ];
    const edges = [makeEdge("p1", "img")];

    const { levels, error } = buildExecutionLevels(nodes, edges);
    expect(error).toBeUndefined();
    expect(levels).toHaveLength(0);
  });

  it("groups generate nodes by level", () => {
    // prompt → txt2img → img2video
    const nodes = [
      makeNode("p1", "prompt"),
      makeNode("t1", "txt2img"),
      makeNode("v1", "img2video"),
    ];
    const edges = [
      makeEdge("p1", "t1"),
      makeEdge("t1", "v1"),
    ];

    const { levels, error } = buildExecutionLevels(nodes, edges);
    expect(error).toBeUndefined();
    expect(levels).toHaveLength(2);
    expect(levels[0]).toEqual(["t1"]); // level 1 (after prompt at level 0)
    expect(levels[1]).toEqual(["v1"]); // level 2
  });

  it("places independent generate nodes at the same level", () => {
    // prompt → txt2img
    // image-input → img2video
    const nodes = [
      makeNode("p1", "prompt"),
      makeNode("img", "image-input"),
      makeNode("t1", "txt2img"),
      makeNode("v1", "img2video"),
    ];
    const edges = [
      makeEdge("p1", "t1"),
      makeEdge("img", "v1"),
    ];

    const { levels, error } = buildExecutionLevels(nodes, edges);
    expect(error).toBeUndefined();
    expect(levels).toHaveLength(1);
    // Both generation nodes are at level 1 (after their inputs at level 0)
    expect(levels[0].sort()).toEqual(["t1", "v1"]);
  });

  it("returns error for cyclic graph", () => {
    const nodes = [
      makeNode("a", "txt2img"),
      makeNode("b", "img2video"),
    ];
    const edges = [makeEdge("a", "b"), makeEdge("b", "a")];

    const { levels, error } = buildExecutionLevels(nodes, edges);
    expect(error).toBe("Graph contains cycles");
    expect(levels).toHaveLength(0);
  });

  it("handles diamond with sequential levels", () => {
    // prompt ───────┐
    //                v
    // image-input → img2video
    // txt2img ──────┘
    const nodes = [
      makeNode("p1", "prompt"),
      makeNode("img", "image-input"),
      makeNode("t1", "txt2img"),
      makeNode("v1", "img2video"),
    ];
    const edges = [
      makeEdge("p1", "t1"),
      makeEdge("p1", "v1"),
      makeEdge("img", "v1"),
      makeEdge("t1", "v1"),
    ];

    const { levels, error } = buildExecutionLevels(nodes, edges);
    expect(error).toBeUndefined();
    expect(levels).toHaveLength(2);
    // Level 0: txt2img, Level 1: img2video depends on txt2img
    expect(levels[0]).toEqual(["t1"]);
    // Level 1: img2video (depends on both above)
    expect(levels[1]).toEqual(["v1"]);
  });

  it("handles empty graph", () => {
    const { levels, error } = buildExecutionLevels([], []);
    expect(error).toBeUndefined();
    expect(levels).toHaveLength(0);
  });
});
