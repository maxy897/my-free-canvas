import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getCanvasTaskOutputUrls,
  getCanvasTaskOutputValue,
  parseCanvasTaskUpdate,
  startCanvasTaskSubscription,
} from "../lib/canvas-task-client";

type EventHandler = (event: MessageEvent | Event) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  readonly url: string;
  readonly handlers = new Map<string, EventHandler[]>();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: EventHandler) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }

  emitMessage(data: unknown) {
    for (const handler of this.handlers.get("message") ?? []) {
      handler({ data: typeof data === "string" ? data : JSON.stringify(data) } as MessageEvent);
    }
  }

  emitError() {
    for (const handler of this.handlers.get("error") ?? []) {
      handler(new Event("error"));
    }
  }
}

describe("canvas-task-client", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("normalizes single and batch output URLs", () => {
    expect(getCanvasTaskOutputUrls({ url: "https://example.com/one.png" })).toEqual([
      "https://example.com/one.png",
    ]);
    expect(getCanvasTaskOutputUrls({ urls: ["https://example.com/a.png", "", "https://example.com/b.png"] })).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
  });

  it("keeps batch output shape for materialization callers", () => {
    expect(getCanvasTaskOutputValue({ url: "https://example.com/one.png" })).toBe("https://example.com/one.png");
    expect(getCanvasTaskOutputValue({ urls: ["https://example.com/a.png", "https://example.com/b.png"] })).toEqual([
      "https://example.com/a.png",
      "https://example.com/b.png",
    ]);
  });

  it("parses task update SSE payloads", () => {
    expect(
      parseCanvasTaskUpdate(JSON.stringify({
        type: "task_update",
        data: {
          id: "task-1",
          status: "success",
          outputData: { url: "https://example.com/one.png" },
        },
      }))
    ).toMatchObject({
      data: {
        id: "task-1",
        status: "success",
      },
    });
  });

  it("emits terminal SSE success updates and closes the stream", () => {
    const onUpdate = vi.fn();
    const subscription = startCanvasTaskSubscription("task-1", { onUpdate });
    const eventSource = MockEventSource.instances[0];

    eventSource.emitMessage({
      type: "task_update",
      data: {
        id: "task-1",
        status: "success",
        outputData: { url: "https://example.com/one.png" },
      },
    });

    expect(onUpdate).toHaveBeenCalledWith(
      {
        id: "task-1",
        status: "success",
        outputData: { url: "https://example.com/one.png" },
      },
      "sse"
    );
    expect(eventSource.close).toHaveBeenCalledTimes(1);
    subscription.stop();
  });

  it("emits terminal failed and cancelled SSE updates", () => {
    const onUpdate = vi.fn();
    startCanvasTaskSubscription("task-2", { onUpdate });
    MockEventSource.instances[0].emitMessage({
      type: "task_update",
      data: {
        id: "task-2",
        status: "failed",
        errorMessage: "provider failed",
      },
    });

    startCanvasTaskSubscription("task-3", { onUpdate });
    MockEventSource.instances[1].emitMessage({
      type: "task_update",
      data: {
        id: "task-3",
        status: "cancelled",
      },
    });

    expect(onUpdate).toHaveBeenNthCalledWith(
      1,
      { id: "task-2", status: "failed", errorMessage: "provider failed" },
      "sse"
    );
    expect(onUpdate).toHaveBeenNthCalledWith(
      2,
      { id: "task-3", status: "cancelled" },
      "sse"
    );
    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1);
    expect(MockEventSource.instances[1].close).toHaveBeenCalledTimes(1);
  });

  it("falls back to polling when the SSE stream errors", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({
        status: "success",
        outputData: { url: "https://example.com/fallback.png" },
      }))
    );
    const onUpdate = vi.fn();
    const onError = vi.fn();

    startCanvasTaskSubscription("task-4", { onUpdate, onError });
    MockEventSource.instances[0].emitError();
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/canvas/tasks/task-4"),
      expect.objectContaining({ credentials: "include" })
    );
    expect(onError).toHaveBeenCalledWith(expect.any(Event), "sse");
    expect(onUpdate).toHaveBeenCalledWith(
      {
        status: "success",
        outputData: { url: "https://example.com/fallback.png" },
      },
      "polling"
    );
    expect(MockEventSource.instances[0].close).toHaveBeenCalledTimes(1);
  });
});
