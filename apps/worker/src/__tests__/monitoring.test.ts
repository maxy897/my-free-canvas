import { describe, it, expect, beforeEach } from "vitest";
import {
  metricsCollector,
  trackRequestMetric,
  trackTaskMetric,
  trackCreditUsage,
  formatMetrics,
} from "../lib/monitoring";

describe("Monitoring and Metrics", () => {
  beforeEach(() => {
    metricsCollector.reset();
  });

  describe("Metrics collector", () => {
    it("increments counter", () => {
      metricsCollector.increment("requests");
      metricsCollector.increment("requests");
      expect(metricsCollector.get("requests")).toBe(2);
    });

    it("increments by custom amount", () => {
      metricsCollector.increment("credits", 50);
      metricsCollector.increment("credits", 30);
      expect(metricsCollector.get("credits")).toBe(80);
    });

    it("sets metric value", () => {
      metricsCollector.set("latency", 100);
      expect(metricsCollector.get("latency")).toBe(100);
    });

    it("returns 0 for non-existent metric", () => {
      expect(metricsCollector.get("nonexistent")).toBe(0);
    });

    it("gets all metrics", () => {
      metricsCollector.increment("metric1");
      metricsCollector.increment("metric2", 5);
      const all = metricsCollector.getAll();

      expect(all.metric1).toBe(1);
      expect(all.metric2).toBe(5);
    });

    it("resets all metrics", () => {
      metricsCollector.increment("test", 10);
      metricsCollector.reset();
      expect(metricsCollector.get("test")).toBe(0);
    });
  });

  describe("Request metric tracking", () => {
    it("tracks successful requests", () => {
      trackRequestMetric("GET", "/api/test", 200, 50);
      expect(metricsCollector.get("requests:GET")).toBe(1);
      expect(metricsCollector.get("requests:success")).toBe(1);
    });

    it("tracks client errors", () => {
      trackRequestMetric("POST", "/api/test", 400, 30);
      expect(metricsCollector.get("requests:POST")).toBe(1);
      expect(metricsCollector.get("requests:client_error")).toBe(1);
    });

    it("tracks server errors", () => {
      trackRequestMetric("DELETE", "/api/test", 500, 100);
      expect(metricsCollector.get("requests:DELETE")).toBe(1);
      expect(metricsCollector.get("requests:server_error")).toBe(1);
    });

    it("calculates average response time", () => {
      trackRequestMetric("GET", "/test", 200, 100);
      trackRequestMetric("GET", "/test", 200, 200);

      const avg = metricsCollector.get("response_time:average");
      expect(avg).toBe(150); // (100 + 200) / 2
    });

    it("tracks endpoint usage", () => {
      trackRequestMetric("GET", "/api/users", 200, 50);
      trackRequestMetric("GET", "/api/users", 200, 60);
      trackRequestMetric("POST", "/api/users", 201, 100);

      expect(metricsCollector.get("endpoint:GET:/api/users")).toBe(2);
      expect(metricsCollector.get("endpoint:POST:/api/users")).toBe(1);
    });
  });

  describe("Task metric tracking", () => {
    it("tracks submitted tasks", () => {
      trackTaskMetric("txt2img", "submitted");
      expect(metricsCollector.get("tasks:total")).toBe(1);
      expect(metricsCollector.get("tasks:submitted")).toBe(1);
      expect(metricsCollector.get("tasks:txt2img:submitted")).toBe(1);
    });

    it("tracks completed tasks", () => {
      trackTaskMetric("img2img", "completed");
      expect(metricsCollector.get("tasks:completed")).toBe(1);
      expect(metricsCollector.get("tasks:img2img:completed")).toBe(1);
    });

    it("tracks failed tasks", () => {
      trackTaskMetric("img2video", "failed");
      expect(metricsCollector.get("tasks:failed")).toBe(1);
      expect(metricsCollector.get("tasks:img2video:failed")).toBe(1);
    });

    it("tracks total tasks across types", () => {
      trackTaskMetric("txt2img", "submitted");
      trackTaskMetric("img2img", "submitted");
      trackTaskMetric("img2video", "submitted");
      expect(metricsCollector.get("tasks:total")).toBe(3);
    });
  });

  describe("Credit usage tracking", () => {
    it("tracks credit deductions", () => {
      trackCreditUsage("user-1", 10, "txt2img");
      trackCreditUsage("user-2", 50, "img2video");

      expect(metricsCollector.get("credits:deducted")).toBe(60);
      expect(metricsCollector.get("credits:txt2img")).toBe(10);
      expect(metricsCollector.get("credits:img2video")).toBe(50);
    });

    it("tracks credit usage by task type", () => {
      trackCreditUsage("user-1", 10, "txt2img");
      trackCreditUsage("user-1", 10, "txt2img");
      trackCreditUsage("user-1", 15, "img2img");

      expect(metricsCollector.get("credits:txt2img")).toBe(20);
      expect(metricsCollector.get("credits:img2img")).toBe(15);
      expect(metricsCollector.get("credits:deducted")).toBe(35);
    });
  });

  describe("Metrics formatting", () => {
    it("formats metrics for display", () => {
      const metrics = {
        "requests:total": 100,
        "tasks:submitted": 50,
      };

      const formatted = formatMetrics(metrics);
      expect(formatted).toContain("Metrics:");
      expect(formatted).toContain("requests:total");
      expect(formatted).toContain("100.00");
    });

    it("sorts metrics alphabetically", () => {
      const metrics = {
        zebra: 1,
        apple: 2,
        banana: 3,
      };

      const formatted = formatMetrics(metrics);
      const lines = formatted.split("\n");

      // Find positions of each metric
      const applePos = lines.findIndex((l) => l.includes("apple"));
      const bananaPos = lines.findIndex((l) => l.includes("banana"));
      const zebraPos = lines.findIndex((l) => l.includes("zebra"));

      expect(applePos < bananaPos).toBe(true);
      expect(bananaPos < zebraPos).toBe(true);
    });
  });

  describe("Uptime tracking", () => {
    it("returns uptime in seconds", () => {
      const uptime = metricsCollector.uptime();
      expect(uptime).toBeGreaterThan(0);
      expect(typeof uptime).toBe("number");
    });

    it("increases over time", () => {
      const uptime1 = metricsCollector.uptime();
      // Small delay
      const uptime2 = metricsCollector.uptime();
      expect(uptime2 >= uptime1).toBe(true);
    });
  });
});
