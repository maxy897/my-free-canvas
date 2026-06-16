import { describe, it, expect, beforeEach } from "vitest";

/**
 * Unit tests for keyboard shortcut logic.
 * Tests the store-level deleteSelectedNodes and history integration.
 */

import { useFlowStore } from "../stores/use-flow-store";
import { useHistory } from "../stores/use-history";
import type { Node, Edge, NodeChange } from "@xyflow/react";

function makeNode(id: string, selected = false): Node {
  return { id, type: "prompt", position: { x: 0, y: 0 }, data: {}, selected };
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target };
}

describe("Keyboard Shortcuts - Store Logic", () => {
  beforeEach(() => {
    useHistory.getState().clear();
    useFlowStore.setState({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      isDirty: false,
      enableHistory: true,
      projectId: null,
      canvasId: null,
    });
  });

  describe("deleteSelectedNodes", () => {
    it("deletes a single selected node", () => {
      useFlowStore.setState({
        nodes: [makeNode("A", true), makeNode("B", false)],
        edges: [makeEdge("A", "B")],
      });

      useFlowStore.getState().deleteSelectedNodes();

      const { nodes, edges } = useFlowStore.getState();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe("B");
      expect(edges).toHaveLength(0);
    });

    it("deletes multiple selected nodes", () => {
      useFlowStore.setState({
        nodes: [makeNode("A", true), makeNode("B", true), makeNode("C", false)],
        edges: [makeEdge("A", "B"), makeEdge("B", "C")],
      });

      useFlowStore.getState().deleteSelectedNodes();

      const { nodes, edges } = useFlowStore.getState();
      expect(nodes).toHaveLength(1);
      expect(nodes[0].id).toBe("C");
      expect(edges).toHaveLength(0);
    });

    it("does nothing when no nodes are selected", () => {
      useFlowStore.setState({
        nodes: [makeNode("A", false), makeNode("B", false)],
        edges: [makeEdge("A", "B")],
      });

      useFlowStore.getState().deleteSelectedNodes();

      const { nodes, edges } = useFlowStore.getState();
      expect(nodes).toHaveLength(2);
      expect(edges).toHaveLength(1);
    });

    it("marks state as dirty after deletion", () => {
      useFlowStore.setState({
        nodes: [makeNode("A", true)],
        edges: [],
        isDirty: false,
      });

      useFlowStore.getState().deleteSelectedNodes();
      expect(useFlowStore.getState().isDirty).toBe(true);
    });

    it("pushes to history before deleting (enables undo)", () => {
      useFlowStore.setState({
        nodes: [makeNode("A", true), makeNode("B", false)],
        edges: [makeEdge("A", "B")],
        enableHistory: true,
      });

      useFlowStore.getState().deleteSelectedNodes();
      expect(useHistory.getState().canUndo()).toBe(true);
    });

    it("undo restores deleted nodes", () => {
      useFlowStore.setState({
        nodes: [makeNode("A", true), makeNode("B", false)],
        edges: [makeEdge("A", "B")],
        enableHistory: true,
      });

      useFlowStore.getState().deleteSelectedNodes();
      expect(useFlowStore.getState().nodes).toHaveLength(1);

      useFlowStore.getState().undo();
      const { nodes, edges } = useFlowStore.getState();
      expect(nodes).toHaveLength(2);
      expect(edges).toHaveLength(1);
    });
  });

  describe("undo/redo", () => {
    it("undo reverts addNode", () => {
      useFlowStore.getState().addNode(makeNode("A"));
      expect(useFlowStore.getState().nodes).toHaveLength(1);

      useFlowStore.getState().undo();
      expect(useFlowStore.getState().nodes).toHaveLength(0);
    });

    it("redo restores undone action", () => {
      useFlowStore.getState().addNode(makeNode("A"));
      useFlowStore.getState().undo();
      expect(useFlowStore.getState().nodes).toHaveLength(0);

      useFlowStore.getState().redo();
      expect(useFlowStore.getState().nodes).toHaveLength(1);
    });

    it("canUndo returns false when history is empty", () => {
      expect(useFlowStore.getState().canUndo()).toBe(false);
    });

    it("canRedo returns false when no undo has been done", () => {
      useFlowStore.getState().addNode(makeNode("A"));
      expect(useFlowStore.getState().canRedo()).toBe(false);
    });

    it("deduplicates equivalent history snapshots without stringifying the full graph", () => {
      const state = {
        nodes: [{ ...makeNode("A"), data: { text: "hello", tags: ["one"] } }],
        edges: [],
        viewport: { x: 0, y: 0, zoom: 1 },
      };

      useHistory.getState().push(state);
      useHistory.getState().push(structuredClone(state));

      expect(useHistory.getState().past).toHaveLength(1);
    });

    it("does not add history entries for selection changes", () => {
      useFlowStore.setState({
        nodes: [makeNode("A", false)],
        edges: [],
        enableHistory: true,
      });

      useFlowStore.getState().onNodesChange([
        { id: "A", type: "select", selected: true },
      ]);

      expect(useFlowStore.getState().nodes[0].selected).toBe(true);
      expect(useHistory.getState().canUndo()).toBe(false);
    });

    it("records a node drag as one undoable action", () => {
      useFlowStore.setState({
        nodes: [makeNode("A", false)],
        edges: [],
        enableHistory: true,
      });

      const dragChanges: NodeChange[] = [
        { id: "A", type: "position", position: { x: 10, y: 0 }, dragging: true },
        { id: "A", type: "position", position: { x: 20, y: 0 }, dragging: true },
        { id: "A", type: "position", position: { x: 30, y: 0 }, dragging: false },
      ];

      for (const change of dragChanges) {
        useFlowStore.getState().onNodesChange([change]);
      }

      expect(useHistory.getState().past).toHaveLength(1);
      expect(useFlowStore.getState().nodes[0].position).toEqual({ x: 30, y: 0 });

      useFlowStore.getState().undo();
      expect(useFlowStore.getState().nodes[0].position).toEqual({ x: 0, y: 0 });
    });

    it("setFlow replaces nodes and edges as one undoable action", () => {
      useFlowStore.setState({
        nodes: [makeNode("A")],
        edges: [],
        enableHistory: true,
      });

      useFlowStore.getState().setFlow({
        nodes: [makeNode("B"), makeNode("C")],
        edges: [makeEdge("B", "C")],
      });

      expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(["B", "C"]);
      expect(useFlowStore.getState().edges).toHaveLength(1);
      expect(useHistory.getState().past).toHaveLength(1);

      useFlowStore.getState().undo();
      expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(["A"]);
      expect(useFlowStore.getState().edges).toHaveLength(0);
    });

    it("batches transient text updates into one undoable history entry", () => {
      useFlowStore.setState({
        nodes: [{ ...makeNode("A"), data: { text: "" } }],
        edges: [],
        enableHistory: true,
      });

      useFlowStore.getState().updateNodeData("A", { text: "h" }, { recordHistory: false });
      useFlowStore.getState().updateNodeData("A", { text: "hello" }, { recordHistory: false });

      expect(useHistory.getState().past).toHaveLength(0);

      useFlowStore.getState().commitNodeDataHistory();

      expect(useHistory.getState().past).toHaveLength(1);
      expect(useFlowStore.getState().nodes[0].data.text).toBe("hello");

      useFlowStore.getState().undo();
      expect(useFlowStore.getState().nodes[0].data.text).toBe("");
    });

    it("flushes pending text history before the next recorded action", () => {
      useFlowStore.setState({
        nodes: [{ ...makeNode("A"), data: { text: "" } }],
        edges: [],
        enableHistory: true,
      });

      useFlowStore.getState().updateNodeData("A", { text: "hello" }, { recordHistory: false });
      useFlowStore.getState().addNode(makeNode("B"));

      expect(useHistory.getState().past).toHaveLength(2);

      useFlowStore.getState().undo();
      expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(["A"]);
      expect(useFlowStore.getState().nodes[0].data.text).toBe("hello");

      useFlowStore.getState().undo();
      expect(useFlowStore.getState().nodes[0].data.text).toBe("");
    });
  });
});
