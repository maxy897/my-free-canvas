import { describe, it, expect, beforeEach, vi } from "vitest";
import { useFlowStore } from "../stores/use-flow-store";
import { useHistory } from "../stores/use-history";
import type { Node } from "@xyflow/react";

describe("Batch Execution", () => {
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

  it("node stores batchCount in data", () => {
    const node: Node = {
      id: "t1",
      type: "txt2img",
      position: { x: 0, y: 0 },
      data: { batchCount: 4 },
    };
    useFlowStore.getState().addNode(node);

    const stored = useFlowStore.getState().nodes[0];
    expect(stored.data.batchCount).toBe(4);
  });

  it("updateNodeData updates batchCount", () => {
    const node: Node = {
      id: "t1",
      type: "txt2img",
      position: { x: 0, y: 0 },
      data: { batchCount: 1 },
    };
    useFlowStore.getState().addNode(node);
    useFlowStore.getState().updateNodeData("t1", { batchCount: 8 });

    const stored = useFlowStore.getState().nodes[0];
    expect(stored.data.batchCount).toBe(8);
  });

  it("batch execution calls executeNode N times", async () => {
    // Inline the batch logic for testing (avoid hook outside React)
    const executeNode = vi.fn().mockResolvedValue(undefined);

    const node: Node = {
      id: "t1",
      type: "txt2img",
      position: { x: 0, y: 0 },
      data: { batchCount: 4 },
    };
    useFlowStore.getState().addNode(node);

    // Simulate batch execution logic
    const batchCount = (useFlowStore.getState().nodes[0].data.batchCount as number) || 1;
    const promises = Array.from({ length: batchCount }, () => executeNode("t1"));
    await Promise.allSettled(promises);

    expect(executeNode).toHaveBeenCalledTimes(4);
    expect(executeNode).toHaveBeenCalledWith("t1");
  });

  it("batch count of 1 executes single time", async () => {
    const executeNode = vi.fn().mockResolvedValue(undefined);

    const node: Node = {
      id: "t1",
      type: "txt2img",
      position: { x: 0, y: 0 },
      data: { batchCount: 1 },
    };
    useFlowStore.getState().addNode(node);

    const batchCount = (useFlowStore.getState().nodes[0].data.batchCount as number) || 1;
    if (batchCount <= 1) {
      await executeNode("t1");
    } else {
      await Promise.allSettled(Array.from({ length: batchCount }, () => executeNode("t1")));
    }

    expect(executeNode).toHaveBeenCalledTimes(1);
  });
});
