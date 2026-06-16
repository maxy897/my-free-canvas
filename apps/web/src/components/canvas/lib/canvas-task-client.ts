import type { GenerationOutput, TaskStatus } from "@shared/types";
import { API_URL } from "../../../lib/api";

export {
  getCanvasTaskOutputUrls,
  getCanvasTaskOutputValue,
  type GenerationOutput,
} from "@shared/types";

export interface CanvasTaskUpdate {
  type: "task_update";
  data: {
    id?: string;
    status: TaskStatus | string;
    outputData?: GenerationOutput | null;
    errorMessage?: string;
  };
}

export interface CanvasTaskSnapshot {
  status: TaskStatus | string;
  outputData?: GenerationOutput | null;
  errorMessage?: string;
}

export type CanvasTaskUpdateSource = "sse" | "polling";

export interface CanvasTaskSubscriptionUpdate extends CanvasTaskSnapshot {
  id?: string;
}

export interface CanvasTaskSubscriptionOptions {
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
  useSse?: boolean;
  pausePollingWhen?: () => boolean;
  onUpdate: (update: CanvasTaskSubscriptionUpdate, source: CanvasTaskUpdateSource) => void;
  onError?: (error: unknown, source: CanvasTaskUpdateSource) => boolean | void;
  onSseClosed?: () => void;
}

export interface CanvasTaskSubscription {
  stop: () => void;
  startPolling: () => void;
}

export interface CreateCanvasTaskRequest {
  projectId: string;
  canvasId: string | null;
  nodeId: string;
  taskType: string;
  inputParams: Record<string, unknown>;
}

export interface CreateCanvasTaskResponse {
  taskId: string;
  status?: TaskStatus | string;
}

function readTaskError(errorData: unknown, fallback: string) {
  if (!errorData || typeof errorData !== "object") return fallback;
  const record = errorData as Record<string, unknown>;
  return [record.error, record.detail]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(": ") || fallback;
}

async function readJsonError(response: Response, fallback: string) {
  const errorData = await response.json().catch(() => null);
  return readTaskError(errorData, fallback);
}

export function isTerminalCanvasTaskStatus(status: TaskStatus | string): status is "success" | "failed" | "cancelled" {
  return status === "success" || status === "failed" || status === "cancelled";
}

export function createCanvasTaskEventSource(taskId: string): EventSource {
  return new EventSource(`${API_URL}/api/canvas/tasks/${taskId}/stream`, {
    withCredentials: true,
  });
}

export function parseCanvasTaskUpdate(eventData: string): CanvasTaskUpdate | null {
  const update = JSON.parse(eventData) as CanvasTaskUpdate;
  return update.type === "task_update" ? update : null;
}

export async function submitCanvasTask(payload: CreateCanvasTaskRequest): Promise<CreateCanvasTaskResponse> {
  const response = await fetch(`${API_URL}/api/canvas/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await readJsonError(response, response.status === 401 ? "请先登录后提交任务" : `HTTP ${response.status}`);
    throw new Error(`任务提交失败：${detail}`);
  }

  return response.json() as Promise<CreateCanvasTaskResponse>;
}

export async function fetchCanvasTaskStatus(taskId: string, init?: RequestInit): Promise<CanvasTaskSnapshot> {
  const response = await fetch(`${API_URL}/api/canvas/tasks/${taskId}`, {
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    const detail = await readJsonError(response, `HTTP ${response.status}`);
    throw new Error(response.status === 404 ? "Task not found" : `任务状态查询失败：${detail}`);
  }

  return response.json() as Promise<CanvasTaskSnapshot>;
}

export async function cancelCanvasTask(taskId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/canvas/tasks/${taskId}/cancel`, {
    method: "POST",
    credentials: "include",
  });

  if (!response.ok) {
    const detail = await readJsonError(response, `HTTP ${response.status}`);
    throw new Error(`任务取消失败：${detail}`);
  }
}

function makePollSignal(timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

export function startCanvasTaskSubscription(
  taskId: string,
  {
    pollIntervalMs = 2000,
    pollTimeoutMs = 5000,
    useSse = true,
    pausePollingWhen,
    onUpdate,
    onError,
    onSseClosed,
  }: CanvasTaskSubscriptionOptions
): CanvasTaskSubscription {
  let stopped = false;
  let eventSource: EventSource | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let pollInFlight = false;
  let sseClosed = false;

  const markSseClosed = () => {
    if (sseClosed) return;
    sseClosed = true;
    onSseClosed?.();
  };

  const closeSse = () => {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }
    markSseClosed();
  };

  const stop = () => {
    stopped = true;
    closeSse();
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  };

  const handleUpdate = (update: CanvasTaskSubscriptionUpdate, source: CanvasTaskUpdateSource) => {
    if (stopped) return;
    onUpdate(update, source);
    if (isTerminalCanvasTaskStatus(update.status)) {
      stop();
    }
  };

  const schedulePoll = () => {
    if (stopped || pollTimer) return;
    pollTimer = setTimeout(() => {
      pollTimer = null;
      void poll();
    }, pollIntervalMs);
  };

  const poll = async () => {
    if (stopped || pollInFlight) return;
    if (pausePollingWhen?.()) {
      schedulePoll();
      return;
    }

    pollInFlight = true;
    try {
      const snapshot = await fetchCanvasTaskStatus(taskId, {
        signal: makePollSignal(pollTimeoutMs),
      });
      handleUpdate(snapshot, "polling");
      if (!stopped) schedulePoll();
    } catch (error) {
      const shouldStop = onError?.(error, "polling");
      if (shouldStop) {
        stop();
      } else {
        schedulePoll();
      }
    } finally {
      pollInFlight = false;
    }
  };

  const startPolling = () => {
    closeSse();
    void poll();
  };

  if (useSse) {
    try {
      eventSource = createCanvasTaskEventSource(taskId);
      eventSource.addEventListener("message", (event: MessageEvent) => {
        try {
          const update = parseCanvasTaskUpdate(event.data);
          if (update) {
            handleUpdate(update.data, "sse");
          }
        } catch (error) {
          onError?.(error, "sse");
        }
      });
      eventSource.addEventListener("error", (error) => {
        onError?.(error, "sse");
        startPolling();
      });
    } catch (error) {
      markSseClosed();
      onError?.(error, "sse");
      startPolling();
    }
  } else {
    startPolling();
  }

  return { stop, startPolling };
}
