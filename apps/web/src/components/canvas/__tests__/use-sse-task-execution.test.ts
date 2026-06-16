import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Node } from "@xyflow/react";
import { useFlowStore } from "../stores/use-flow-store";
import { useTaskStore } from "../stores/use-task-store";
import { useHistory } from "../stores/use-history";
import { useSSETaskExecution } from "../hooks/use-sse-task-execution";
import {
  startCanvasTaskSubscription,
  type CanvasTaskSubscriptionOptions,
} from "../lib/canvas-task-client";
import { materializeImageOutputNode } from "../lib/materialize-output-node";

vi.mock("react", () => ({
  useCallback: <T extends (...args: unknown[]) => unknown>(callback: T) => callback,
  useEffect: vi.fn(),
  useRef: <T,>(initialValue: T) => ({ current: initialValue }),
}));

vi.mock("../lib/materialize-output-node", () => ({
  materializeImageOutputNode: vi.fn(),
}));

vi.mock("../lib/canvas-task-client", async () => {
  const actual = await vi.importActual<typeof import("../lib/canvas-task-client")>(
    "../lib/canvas-task-client"
  );
  return {
    ...actual,
    cancelCanvasTask: vi.fn(),
    startCanvasTaskSubscription: vi.fn(() => ({
      stop: vi.fn(),
      startPolling: vi.fn(),
    })),
    submitCanvasTask: vi.fn(),
  };
});

describe("useSSETaskExecution", () => {
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
    useTaskStore.setState({ tasks: new Map() });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resumes running node tasks and applies terminal updates", () => {
    const runningNode: Node = {
      id: "node-running",
      type: "txt2img",
      position: { x: 0, y: 0 },
      data: {
        taskId: "task-running",
        taskStatus: "running",
      },
    };
    const completedNode: Node = {
      id: "node-complete",
      type: "txt2img",
      position: { x: 100, y: 0 },
      data: {
        taskId: "task-complete",
        taskStatus: "success",
      },
    };

    useFlowStore.setState({ nodes: [runningNode, completedNode], edges: [] });

    const { resumeRunningTasks } = useSSETaskExecution();
    resumeRunningTasks();

    expect(startCanvasTaskSubscription).toHaveBeenCalledTimes(1);
    expect(startCanvasTaskSubscription).toHaveBeenCalledWith(
      "task-running",
      expect.objectContaining({
        useSse: true,
        pollIntervalMs: 2000,
      })
    );
    expect(useTaskStore.getState().tasks.get("task-running")).toMatchObject({
      id: "task-running",
      nodeId: "node-running",
      status: "running",
    });

    const subscriptionOptions = vi.mocked(startCanvasTaskSubscription).mock
      .calls[0][1] as CanvasTaskSubscriptionOptions;
    subscriptionOptions.onUpdate(
      {
        id: "task-running",
        status: "success",
        outputData: { url: "https://example.com/result.png" },
      },
      "sse"
    );

    const updatedNode = useFlowStore
      .getState()
      .nodes.find((node) => node.id === "node-running");
    expect(updatedNode?.data).toMatchObject({
      taskId: "task-running",
      taskStatus: "success",
      taskError: undefined,
      resultCount: 1,
    });
    expect(useTaskStore.getState().tasks.get("task-running")).toMatchObject({
      status: "success",
      result: { url: "https://example.com/result.png" },
    });
    expect(materializeImageOutputNode).toHaveBeenCalledWith(
      "node-running",
      "https://example.com/result.png",
      undefined,
      1
    );
  });
});
