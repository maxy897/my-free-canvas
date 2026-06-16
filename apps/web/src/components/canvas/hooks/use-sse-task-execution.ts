/**
 * Enhanced task execution with Server-Sent Events (SSE) for real-time updates
 * Falls back to polling if SSE is not available or fails
 */

import { useCallback, useEffect, useRef } from "react";
import { useFlowStore } from "../stores/use-flow-store";
import { useTaskStore } from "../stores/use-task-store";
import { useExecutionHistory } from "../stores/use-execution-history";
import { nanoid } from "nanoid";
import { materializeImageOutputNode } from "../lib/materialize-output-node";
import { parseHandleId } from "../lib/type-system";
import {
  cancelCanvasTask,
  getCanvasTaskOutputValue,
  startCanvasTaskSubscription,
  type CanvasTaskSubscription,
  type CanvasTaskSubscriptionUpdate,
  type CanvasTaskUpdateSource,
  submitCanvasTask,
} from "../lib/canvas-task-client";

const POLL_INTERVAL_FALLBACK = 2000;
const MAX_CONCURRENT_STREAMS = 20;
const NODE_RUNTIME_DATA_KEYS = new Set([
  "onExecute",
  "onCancel",
  "onBatchChange",
  "onConfigChange",
  "taskStatus",
  "taskId",
  "taskError",
  "generatedImageNodeId",
  "resultCount",
]);
const TXT2IMG_PARAM_KEYS = [
  "model",
  "n",
  "size",
  "image_resolution",
  "quality",
  "output_format",
  "output_compression",
  "background",
  "moderation",
  "style",
  "partial_images",
  "visibility",
];
const MAX_REFERENCE_IMAGES = 14;

function appendImageUrls(target: string[], value: unknown) {
  const values = Array.isArray(value) ? value : [value];
  for (const item of values) {
    if (target.length >= MAX_REFERENCE_IMAGES) return;
    const url = typeof item === "string" ? item.trim() : "";
    if (url && !target.includes(url)) target.push(url);
  }
}

function getExecutableNodeParams(nodeType: string | undefined, data: Record<string, unknown>): Record<string, unknown> {
  const config = data.config as Record<string, unknown> | undefined;
  const params: Record<string, unknown> = config ? { ...config } : {};

  if (nodeType === "txt2img") {
    for (const key of TXT2IMG_PARAM_KEYS) {
      const value = data[key];
      if (value !== undefined && value !== "") params[key] = value;
    }
    if (!params.n && data.batchCount) params.n = data.batchCount;
    return params;
  }

  for (const [key, value] of Object.entries(data)) {
    if (NODE_RUNTIME_DATA_KEYS.has(key) || key === "config") continue;
    if (typeof value === "function" || value === undefined || value === "") continue;
    params[key] = value;
  }

  return params;
}

export function useSSETaskExecution() {
  const subscriptions = useRef<Map<string, CanvasTaskSubscription>>(new Map());
  const activeStreamCount = useRef(0);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const subscription of subscriptions.current.values()) {
        subscription.stop();
      }
      subscriptions.current.clear();
    };
  }, []);

  const executeNode = useCallback(async (nodeId: string) => {
    const { nodes, edges } = useFlowStore.getState();
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    if (node.data.taskStatus === "pending" || node.data.taskStatus === "running") return;

    const inputParams: Record<string, unknown> = {};
    const referenceImages: string[] = [];

    // Find connected input values
    for (const edge of edges) {
      if (edge.target === nodeId) {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetPort = edge.targetHandle ? parseHandleId(edge.targetHandle) : null;

        if (
          sourceNode?.type === "prompt" &&
          (!targetPort || targetPort.portId === "prompt")
        ) {
          inputParams.prompt = sourceNode.data.text || "";
        } else if (sourceNode?.type === "image-input") {
          const imageValue = sourceNode.data.url;
          if (node.type === "txt2img" && targetPort?.portId === "reference_images") {
            appendImageUrls(referenceImages, imageValue);
          } else if (!inputParams.image_url) {
            const imageUrls: string[] = [];
            appendImageUrls(imageUrls, imageValue);
            if (imageUrls[0]) inputParams.image_url = imageUrls[0];
          }
        }
      }
    }

    if (node.type === "txt2img" && referenceImages.length > 0) {
      inputParams.referenceImages = referenceImages;
      inputParams.image_url = referenceImages[0];
    }

    // Add node's own generation parameters.
    Object.assign(inputParams, getExecutableNodeParams(node.type, node.data));

    // Determine task type from node type
    const taskTypeMap: Record<string, string> = {
      txt2img: "txt2img",
      img2video: "img2video",
    };
    const taskType =
      node.type === "txt2img" && referenceImages.length > 0
        ? "img2img"
        : taskTypeMap[node.type || ""];
    if (!taskType) return;

    useFlowStore.getState().updateNodeData(nodeId, {
      taskStatus: "pending",
      taskId: undefined,
      taskError: undefined,
    });

    try {
      const { projectId, canvasId } = useFlowStore.getState();
      // Submit task
      const { taskId } = await submitCanvasTask({
        projectId: projectId || "local",
        canvasId,
        nodeId,
        taskType,
        inputParams,
      });

      // Set task state
      useTaskStore.getState().setTask(taskId, {
        id: taskId,
        nodeId,
        status: "running",
      });

      // Update node status
      useFlowStore.getState().updateNodeData(nodeId, {
        taskStatus: "running",
        taskId,
        taskError: undefined,
      });

      // Start listening for updates (SSE with fallback)
      startListening(taskId, nodeId);
    } catch (error) {
      console.error("Task execution failed:", error);
      useFlowStore.getState().updateNodeData(nodeId, {
        taskStatus: "failed",
        taskId: undefined,
        taskError: error instanceof Error ? error.message : "Task execution failed",
      });
    }
  }, []);

  const startListening = useCallback(
    (taskId: string, nodeId: string) => {
      if (subscriptions.current.has(taskId)) return;

      const useSse = activeStreamCount.current < MAX_CONCURRENT_STREAMS;
      if (!useSse) {
        console.warn(
          `Max concurrent streams (${MAX_CONCURRENT_STREAMS}) reached, using polling fallback`
        );
      } else {
        activeStreamCount.current++;
      }

      const subscription = startCanvasTaskSubscription(taskId, {
        useSse,
        pollIntervalMs: POLL_INTERVAL_FALLBACK,
        pausePollingWhen: () => document.visibilityState !== "visible",
        onSseClosed: () => {
          if (useSse) {
            activeStreamCount.current = Math.max(0, activeStreamCount.current - 1);
          }
        },
        onUpdate: (data, source) => {
          applyTaskUpdate(taskId, nodeId, data, source);
        },
        onError: (error, source) => {
          if (source === "sse") {
            console.warn(`SSE connection failed for task ${taskId}, falling back to polling`);
            return;
          }
          if (error instanceof Error && error.message === "Task not found") {
            subscriptions.current.delete(taskId);
            useTaskStore.getState().updateTaskStatus(taskId, "failed", undefined, "Task not found");
            useFlowStore.getState().updateNodeData(nodeId, {
              taskStatus: "failed",
              taskError: "Task not found",
            });
            return true;
          }
          if (error instanceof Error && error.name === "AbortError") {
            console.warn(`Poll timeout for task ${taskId}, retrying...`);
          } else {
            console.error(`Poll error for task ${taskId}:`, error);
          }
        },
      });
      subscriptions.current.set(taskId, subscription);
    },
    []
  );

  const stopListening = (taskId: string) => {
    subscriptions.current.get(taskId)?.stop();
    subscriptions.current.delete(taskId);
  };

  const cancelNode = useCallback(async (nodeId: string) => {
    const node = useFlowStore.getState().nodes.find((candidate) => candidate.id === nodeId);
    const taskId = node?.data?.taskId;
    if (typeof taskId !== "string" || !taskId) return;

    try {
      await cancelCanvasTask(taskId);

      stopListening(taskId);
      useTaskStore.getState().updateTaskStatus(taskId, "cancelled");
      useFlowStore.getState().updateNodeData(nodeId, {
        taskStatus: "cancelled",
        taskError: undefined,
      });
    } catch (error) {
      console.error("Task cancellation failed:", error);
    }
  }, []);

  /** Record completed execution to history */
  const recordExecution = (
    nodeId: string,
    taskType: string,
    status: "success" | "failed",
    inputParams: Record<string, unknown>,
    outputUrl?: string,
    errorMessage?: string
  ) => {
    useExecutionHistory.getState().addRecord({
      id: nanoid(8),
      nodeId,
      taskType,
      status,
      outputUrl,
      inputParams,
      errorMessage,
      timestamp: Date.now(),
    });
  };

  const resumeRunningTasks = useCallback(() => {
    for (const node of useFlowStore.getState().nodes) {
      const taskId = node.data?.taskId;
      if (node.data?.taskStatus !== "running" || typeof taskId !== "string" || !taskId) continue;

      useTaskStore.getState().setTask(taskId, {
        id: taskId,
        nodeId: node.id,
        status: "running",
      });
      startListening(taskId, node.id);
    }
  }, [startListening]);

  return { executeNode, cancelNode, resumeRunningTasks };

  function applyTaskUpdate(
    taskId: string,
    nodeId: string,
    data: CanvasTaskSubscriptionUpdate,
    source: CanvasTaskUpdateSource
  ) {
    const { status, outputData, errorMessage } = data;

    if (status === "success") {
      subscriptions.current.delete(taskId);
      useTaskStore.getState().updateTaskStatus(taskId, "success", outputData as any);
      const outputUrl = getCanvasTaskOutputValue(outputData);
      const assets = Array.isArray(outputData?.assets) ? outputData.assets : undefined;
      console.info(`[canvas:task] ${source} task succeeded`, {
        taskId,
        nodeId,
        outputData,
        outputUrl,
        outputUrlType: Array.isArray(outputUrl) ? "array" : typeof outputUrl,
      });
      useFlowStore.getState().updateNodeData(nodeId, {
        taskStatus: "success",
        taskError: undefined,
        resultCount: Array.isArray(outputUrl) ? outputUrl.length : 1,
      });
      const firstUrl = Array.isArray(outputUrl) ? outputUrl[0] : outputUrl;
      materializeImageOutputNode(
        nodeId,
        outputUrl as string | string[] | undefined,
        assets,
        Array.isArray(outputUrl) ? outputUrl.length : 1
      );
      recordExecution(nodeId, "unknown", "success", {}, firstUrl as string);
    } else if (status === "failed") {
      subscriptions.current.delete(taskId);
      useTaskStore.getState().updateTaskStatus(taskId, "failed", undefined, errorMessage);
      useFlowStore.getState().updateNodeData(nodeId, {
        taskStatus: "failed",
        taskError: errorMessage || "Task failed",
      });
      recordExecution(nodeId, "unknown", "failed", {}, undefined, errorMessage);
    } else if (status === "cancelled") {
      subscriptions.current.delete(taskId);
      useTaskStore.getState().updateTaskStatus(taskId, "cancelled");
      useFlowStore.getState().updateNodeData(nodeId, {
        taskStatus: "cancelled",
        taskError: undefined,
      });
    }
  }
}
