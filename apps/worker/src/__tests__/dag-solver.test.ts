import { describe, it, expect } from "vitest";
import {
  buildExecutionPlan,
  resolveSubgraph,
  NODE_REGISTRY,
  type CanvasGraphEdge,
  type CanvasGraphNode,
} from "@shared/types";

function makeNode(id: string): CanvasGraphNode {
  return { id, type: "test" };
}

function makeEdge(source: string, target: string): CanvasGraphEdge {
  return { id: `${source}-${target}`, source, target };
}

describe("DAG Solver", () => {
  describe("buildExecutionPlan", () => {
    it("returns correct topological order for linear graph", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const edges = [makeEdge("A", "B"), makeEdge("B", "C")];

      const plan = buildExecutionPlan(nodes, edges);
      expect(plan.order).toEqual(["A", "B", "C"]);
      expect(plan.cycles).toHaveLength(0);
    });

    it("handles diamond dependency", () => {
      //   A
      //  / \
      // B   C
      //  \ /
      //   D
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C"), makeNode("D")];
      const edges = [
        makeEdge("A", "B"),
        makeEdge("A", "C"),
        makeEdge("B", "D"),
        makeEdge("C", "D"),
      ];

      const plan = buildExecutionPlan(nodes, edges);
      expect(plan.cycles).toHaveLength(0);
      expect(plan.order.indexOf("A")).toBeLessThan(plan.order.indexOf("B"));
      expect(plan.order.indexOf("A")).toBeLessThan(plan.order.indexOf("C"));
      expect(plan.order.indexOf("B")).toBeLessThan(plan.order.indexOf("D"));
      expect(plan.order.indexOf("C")).toBeLessThan(plan.order.indexOf("D"));
    });

    it("detects cycles", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const edges = [makeEdge("A", "B"), makeEdge("B", "C"), makeEdge("C", "A")];

      const plan = buildExecutionPlan(nodes, edges);
      expect(plan.cycles.length).toBeGreaterThan(0);
      expect(plan.order.length).toBeLessThan(3);
    });

    it("handles disconnected nodes", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C")];
      const edges = [makeEdge("A", "B")];

      const plan = buildExecutionPlan(nodes, edges);
      expect(plan.order).toHaveLength(3);
      expect(plan.cycles).toHaveLength(0);
    });

    it("handles empty graph", () => {
      const plan = buildExecutionPlan([], []);
      expect(plan.order).toEqual([]);
      expect(plan.cycles).toHaveLength(0);
    });

    it("handles full pipeline: prompt → txt2img → img2video", () => {
      const nodes = [
        { ...makeNode("p1"), type: "prompt" },
        { ...makeNode("t1"), type: "txt2img" },
        { ...makeNode("v1"), type: "img2video" },
      ];
      const edges = [
        makeEdge("p1", "t1"),
        makeEdge("t1", "v1"),
      ];

      const plan = buildExecutionPlan(nodes, edges);
      expect(plan.cycles).toHaveLength(0);
      expect(plan.order).toEqual(["p1", "t1", "v1"]);
    });

    it("handles image-input feeding img2video", () => {
      const nodes = [
        { ...makeNode("img"), type: "image-input" },
        { ...makeNode("i2v"), type: "img2video" },
      ];
      const edges = [
        makeEdge("img", "i2v"),
      ];

      const plan = buildExecutionPlan(nodes, edges);
      expect(plan.cycles).toHaveLength(0);
      expect(plan.order.indexOf("img")).toBeLessThan(plan.order.indexOf("i2v"));
    });
  });

  describe("resolveSubgraph", () => {
    it("finds all upstream nodes", () => {
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C"), makeNode("D")];
      const edges = [makeEdge("A", "B"), makeEdge("B", "C"), makeEdge("A", "C")];

      const subgraph = resolveSubgraph("C", nodes, edges);
      expect(subgraph.sort()).toEqual(["A", "B", "C"]);
    });

    it("returns only target when no upstream", () => {
      const nodes = [makeNode("A"), makeNode("B")];
      const edges = [makeEdge("A", "B")];

      const subgraph = resolveSubgraph("A", nodes, edges);
      expect(subgraph).toEqual(["A"]);
    });

    it("handles complex upstream graph", () => {
      // A → B → D
      //       ↗
      // C → E
      const nodes = [makeNode("A"), makeNode("B"), makeNode("C"), makeNode("D"), makeNode("E")];
      const edges = [
        makeEdge("A", "B"),
        makeEdge("B", "D"),
        makeEdge("C", "E"),
        makeEdge("E", "D"),
      ];

      const subgraph = resolveSubgraph("D", nodes, edges);
      expect(subgraph.sort()).toEqual(["A", "B", "C", "D", "E"]);
    });

    it("resolves subgraph for img2video with upstream chain", () => {
      const nodes = [makeNode("prompt"), makeNode("txt2img"), makeNode("img2video")];
      const edges = [
        makeEdge("prompt", "txt2img"),
        makeEdge("txt2img", "img2video"),
      ];

      const subgraph = resolveSubgraph("img2video", nodes, edges);
      expect(subgraph.sort()).toEqual(["img2video", "prompt", "txt2img"]);
    });
  });

  describe("NODE_REGISTRY", () => {
    it("contains all expected node types", () => {
      expect(NODE_REGISTRY).toHaveProperty("prompt");
      expect(NODE_REGISTRY).toHaveProperty("image-input");
      expect(NODE_REGISTRY).toHaveProperty("txt2img");
      expect(NODE_REGISTRY).toHaveProperty("img2video");
      expect(Object.keys(NODE_REGISTRY).sort()).toEqual([
        "image-input",
        "img2video",
        "prompt",
        "txt2img",
      ]);
    });

    it("image-input has correct ports", () => {
      const node = NODE_REGISTRY["image-input"];
      expect(node.category).toBe("input");
      expect(node.inputs).toHaveLength(0);
      expect(node.outputs).toHaveLength(1);
      expect(node.outputs[0].dataType).toBe("image");
    });

    it("img2video has correct ports", () => {
      const node = NODE_REGISTRY["img2video"];
      expect(node.category).toBe("generate");
      expect(node.inputs.find((p) => p.id === "image")?.required).toBe(true);
      expect(node.outputs[0].dataType).toBe("video");
    });

    it("txt2img has text and optional reference image inputs", () => {
      const node = NODE_REGISTRY["txt2img"];
      expect(node.inputs).toHaveLength(2);
      expect(node.inputs.find((p) => p.id === "prompt")?.dataType).toBe("text");
      expect(node.inputs.find((p) => p.id === "reference_images")?.dataType).toBe("image");
      expect(node.inputs.find((p) => p.id === "reference_images")?.multiple).toBe(true);
      expect(node.outputs[0].dataType).toBe("image");
    });
  });
});
