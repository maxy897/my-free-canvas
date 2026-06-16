import { describe, it, expect, beforeEach } from "vitest";
import { useExecutionHistory } from "../stores/use-execution-history";

describe("Execution History Store", () => {
  beforeEach(() => {
    useExecutionHistory.getState().clearAll();
  });

  it("adds a record to node history", () => {
    useExecutionHistory.getState().addRecord({
      id: "r1",
      nodeId: "node-1",
      taskType: "txt2img",
      status: "success",
      outputUrl: "https://example.com/img.png",
      inputParams: { prompt: "test" },
      timestamp: Date.now(),
    });

    const history = useExecutionHistory.getState().getNodeHistory("node-1");
    expect(history).toHaveLength(1);
    expect(history[0].outputUrl).toBe("https://example.com/img.png");
  });

  it("stores records in reverse chronological order (most recent first)", () => {
    useExecutionHistory.getState().addRecord({
      id: "r1",
      nodeId: "node-1",
      taskType: "txt2img",
      status: "success",
      inputParams: {},
      timestamp: 1000,
    });
    useExecutionHistory.getState().addRecord({
      id: "r2",
      nodeId: "node-1",
      taskType: "txt2img",
      status: "success",
      inputParams: {},
      timestamp: 2000,
    });

    const history = useExecutionHistory.getState().getNodeHistory("node-1");
    expect(history).toHaveLength(2);
    expect(history[0].id).toBe("r2"); // Most recent first
    expect(history[1].id).toBe("r1");
  });

  it("limits records per node to maxPerNode", () => {
    for (let i = 0; i < 25; i++) {
      useExecutionHistory.getState().addRecord({
        id: `r${i}`,
        nodeId: "node-1",
        taskType: "txt2img",
        status: "success",
        inputParams: {},
        timestamp: i,
      });
    }

    const history = useExecutionHistory.getState().getNodeHistory("node-1");
    expect(history).toHaveLength(20); // Default max
    expect(history[0].id).toBe("r24"); // Most recent
  });

  it("isolates records by node", () => {
    useExecutionHistory.getState().addRecord({
      id: "r1",
      nodeId: "node-1",
      taskType: "txt2img",
      status: "success",
      inputParams: {},
      timestamp: 1000,
    });
    useExecutionHistory.getState().addRecord({
      id: "r2",
      nodeId: "node-2",
      taskType: "img2video",
      status: "failed",
      inputParams: {},
      timestamp: 2000,
    });

    expect(useExecutionHistory.getState().getNodeHistory("node-1")).toHaveLength(1);
    expect(useExecutionHistory.getState().getNodeHistory("node-2")).toHaveLength(1);
  });

  it("clearNodeHistory removes only that node's records", () => {
    useExecutionHistory.getState().addRecord({
      id: "r1",
      nodeId: "node-1",
      taskType: "txt2img",
      status: "success",
      inputParams: {},
      timestamp: 1000,
    });
    useExecutionHistory.getState().addRecord({
      id: "r2",
      nodeId: "node-2",
      taskType: "img2video",
      status: "success",
      inputParams: {},
      timestamp: 2000,
    });

    useExecutionHistory.getState().clearNodeHistory("node-1");

    expect(useExecutionHistory.getState().getNodeHistory("node-1")).toHaveLength(0);
    expect(useExecutionHistory.getState().getNodeHistory("node-2")).toHaveLength(1);
  });

  it("clearAll removes all records", () => {
    useExecutionHistory.getState().addRecord({
      id: "r1",
      nodeId: "node-1",
      taskType: "txt2img",
      status: "success",
      inputParams: {},
      timestamp: 1000,
    });

    useExecutionHistory.getState().clearAll();
    expect(useExecutionHistory.getState().getNodeHistory("node-1")).toHaveLength(0);
  });

  it("returns empty array for nodes with no history", () => {
    expect(useExecutionHistory.getState().getNodeHistory("nonexistent")).toEqual([]);
  });
});
