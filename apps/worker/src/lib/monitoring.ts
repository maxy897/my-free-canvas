import type { Env } from "../types";

/**
 * Metrics collection for monitoring system health
 */
export interface Metrics {
  timestamp: string;
  taskSubmissions: number;
  taskCompletions: number;
  taskFailures: number;
  averageResponseTime: number;
  errorRate: number;
  databaseLatency: number;
  kvLatency: number;
}

class MetricsCollector {
  private metrics: Map<string, number> = new Map();
  private startTime = Date.now();

  increment(key: string, value = 1): void {
    this.metrics.set(key, (this.metrics.get(key) || 0) + value);
  }

  set(key: string, value: number): void {
    this.metrics.set(key, value);
  }

  get(key: string): number {
    return this.metrics.get(key) || 0;
  }

  getAll(): Record<string, number> {
    return Object.fromEntries(this.metrics);
  }

  reset(): void {
    this.metrics.clear();
  }

  uptime(): number {
    return (Date.now() - this.startTime) / 1000; // seconds
  }
}

export const metricsCollector = new MetricsCollector();

/**
 * Health check interface for monitoring services
 */
export interface HealthCheckResult {
  status: "healthy" | "degraded" | "unhealthy";
  timestamp: string;
  components: {
    database: ComponentHealth;
    kv: ComponentHealth;
    relay: ComponentHealth;
    api: ComponentHealth;
  };
  uptime: number;
  metrics: Record<string, number>;
}

export interface ComponentHealth {
  status: "healthy" | "degraded" | "unhealthy";
  lastCheck: string;
  latency?: number;
  error?: string;
}

/**
 * Perform health checks on all components
 */
export async function performHealthCheck(env: Env): Promise<HealthCheckResult> {
  const now = new Date().toISOString();
  const components: HealthCheckResult["components"] = {
    database: { status: "healthy", lastCheck: now },
    kv: { status: "healthy", lastCheck: now },
    relay: { status: "healthy", lastCheck: now },
    api: { status: "healthy", lastCheck: now },
  };

  // Check database connectivity
  try {
    const startDb = Date.now();
    await env.DB.prepare("SELECT 1").first();
    components.database.latency = Date.now() - startDb;
  } catch (error) {
    components.database.status = "unhealthy";
    components.database.error = String(error);
  }

  // Check KV connectivity
  try {
    const startKv = Date.now();
    await env.KV.put("health:check", Date.now().toString(), { expirationTtl: 10 });
    components.kv.latency = Date.now() - startKv;
  } catch (error) {
    components.kv.status = "unhealthy";
    components.kv.error = String(error);
  }

  // Determine overall status
  const unhealthy = Object.values(components).filter(
    (c) => c.status === "unhealthy"
  );
  const degraded = Object.values(components).filter(
    (c) => c.status === "degraded"
  );

  let overallStatus: HealthCheckResult["status"] = "healthy";
  if (unhealthy.length > 0) {
    overallStatus = "unhealthy";
  } else if (degraded.length > 0) {
    overallStatus = "degraded";
  }

  return {
    status: overallStatus,
    timestamp: now,
    components,
    uptime: metricsCollector.uptime(),
    metrics: metricsCollector.getAll(),
  };
}

/**
 * Track request metrics
 */
export function trackRequestMetric(
  method: string,
  path: string,
  statusCode: number,
  duration: number
): void {
  // Track by method
  metricsCollector.increment(`requests:${method}`);

  // Track by status code
  if (statusCode >= 200 && statusCode < 300) {
    metricsCollector.increment("requests:success");
  } else if (statusCode >= 400 && statusCode < 500) {
    metricsCollector.increment("requests:client_error");
  } else if (statusCode >= 500) {
    metricsCollector.increment("requests:server_error");
  }

  // Track response time
  const avgKey = "response_time:average";
  const countKey = "response_time:count";
  const currentAvg = metricsCollector.get(avgKey);
  const currentCount = metricsCollector.get(countKey);
  const newAvg = (currentAvg * currentCount + duration) / (currentCount + 1);
  metricsCollector.set(avgKey, newAvg);
  metricsCollector.increment(countKey);

  // Track by endpoint
  const endpoint = `${method}:${path}`;
  metricsCollector.increment(`endpoint:${endpoint}`);
}

/**
 * Track task execution metrics
 */
export function trackTaskMetric(
  taskType: string,
  status: "submitted" | "completed" | "failed"
): void {
  metricsCollector.increment("tasks:total");
  metricsCollector.increment(`tasks:${status}`);
  metricsCollector.increment(`tasks:${taskType}:${status}`);
}

/**
 * Track credit usage
 */
export function trackCreditUsage(userId: string, amount: number, taskType: string): void {
  metricsCollector.increment("credits:deducted", amount);
  metricsCollector.increment(`credits:${taskType}`, amount);
}

/**
 * Format metrics for display
 */
export function formatMetrics(metrics: Record<string, number>): string {
  const entries = Object.entries(metrics)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `  ${key}: ${value.toFixed(2)}`)
    .join("\n");

  return `Metrics:\n${entries}`;
}
