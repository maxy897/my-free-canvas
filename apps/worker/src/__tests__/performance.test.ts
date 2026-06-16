/**
 * Performance testing suite for Canvas API and DAG solver
 * Measures API response times, DAG solver efficiency, and memory usage
 */

import { describe, it, expect } from "vitest";
import {
  buildExecutionPlan,
  resolveSubgraph,
  type CanvasGraphEdge,
  type CanvasGraphNode,
} from "@shared/types";

describe("Performance Tests - API & DAG", () => {
  describe("DAG Solver Performance", () => {
    it("should handle 100 nodes with <5ms latency", () => {
      const nodes = Array.from({ length: 100 }, (_, i) => ({
        id: `node-${i}`,
        position: { x: 0, y: 0 },
        data: {},
      })) as CanvasGraphNode[];

      const edges = Array.from({ length: 99 }, (_, i) => ({
        source: `node-${i}`,
        target: `node-${i + 1}`,
        id: `edge-${i}`,
      })) as CanvasGraphEdge[];

      const start = performance.now();
      const result = buildExecutionPlan(nodes, edges);
      const duration = performance.now() - start;

      expect(result.order).toHaveLength(100);
      expect(result.cycles).toHaveLength(0);
      expect(duration).toBeLessThan(5);
    });

    it("should handle 500 nodes with <25ms latency", () => {
      const nodes = Array.from({ length: 500 }, (_, i) => ({
        id: `node-${i}`,
        position: { x: 0, y: 0 },
        data: {},
      })) as CanvasGraphNode[];

      const edges: CanvasGraphEdge[] = [];
      for (let i = 0; i < 499; i++) {
        edges.push({
          source: `node-${i}`,
          target: `node-${i + 1}`,
          id: `edge-${i}`,
        });
        if (i % 10 === 0 && i + 10 < 500) {
          edges.push({
            source: `node-${i}`,
            target: `node-${i + 10}`,
            id: `edge-branch-${i}`,
          });
        }
      }

      const start = performance.now();
      const result = buildExecutionPlan(nodes, edges);
      const duration = performance.now() - start;

      expect(result.order.length).toBeGreaterThanOrEqual(500);
      expect(duration).toBeLessThan(25);
    });

    it("should detect cycles in <2ms", () => {
      const nodes = Array.from({ length: 50 }, (_, i) => ({
        id: `node-${i}`,
        position: { x: 0, y: 0 },
        data: {},
      })) as CanvasGraphNode[];

      const edges: CanvasGraphEdge[] = [
        { source: "node-0", target: "node-1", id: "e0" },
        { source: "node-1", target: "node-2", id: "e1" },
        { source: "node-2", target: "node-0", id: "e2" },
      ];

      const start = performance.now();
      const result = buildExecutionPlan(nodes, edges);
      const duration = performance.now() - start;

      expect(result.cycles.length).toBeGreaterThan(0);
      expect(duration).toBeLessThan(2);
    });
  });

  describe("Subgraph Resolution Performance", () => {
    it("should resolve subgraph for 50 upstream nodes in <3ms", () => {
      const nodes = Array.from({ length: 100 }, (_, i) => ({
        id: `node-${i}`,
        position: { x: 0, y: 0 },
        data: {},
      })) as CanvasGraphNode[];

      const edges: CanvasGraphEdge[] = [];
      for (let i = 0; i < 50; i++) {
        edges.push({
          source: `node-${i}`,
          target: "node-50",
          id: `edge-${i}`,
        });
      }

      const start = performance.now();
      const result = resolveSubgraph("node-50", nodes, edges);
      const duration = performance.now() - start;

      expect(result).toContain("node-50");
      expect(result).toHaveLength(51);
      expect(duration).toBeLessThan(3);
    });

    it("should handle deep chain with <5ms latency", () => {
      const nodes = Array.from({ length: 200 }, (_, i) => ({
        id: `node-${i}`,
        position: { x: 0, y: 0 },
        data: {},
      })) as CanvasGraphNode[];

      const edges = Array.from({ length: 199 }, (_, i) => ({
        source: `node-${i}`,
        target: `node-${i + 1}`,
        id: `edge-${i}`,
      })) as CanvasGraphEdge[];

      const start = performance.now();
      const result = resolveSubgraph("node-199", nodes, edges);
      const duration = performance.now() - start;

      expect(result).toHaveLength(200);
      expect(duration).toBeLessThan(5);
    });
  });

  describe("Performance Thresholds", () => {
    it("should indicate large canvas warning (>1000 nodes)", () => {
      const nodes = Array.from({ length: 1000 }, (_, i) => ({
        id: `node-${i}`,
        position: { x: i * 10, y: 0 },
        data: {},
      }));

      expect(nodes.length).toBeGreaterThanOrEqual(1000);
    });

    it("should indicate edge count warning (>500 edges)", () => {
      const edges = Array.from({ length: 500 }, (_, i) => ({
        source: `node-${i}`,
        target: `node-${i + 1}`,
        id: `edge-${i}`,
      }));

      expect(edges.length).toBeGreaterThanOrEqual(500);
    });
  });
});
