/**
 * Performance monitoring utilities for Canvas
 * Tracks rendering, state updates, API calls, and memory usage
 */

export interface PerformanceMetric {
  name: string;
  duration: number;
  timestamp: number;
  category: "render" | "api" | "state" | "memory" | "dag";
}

interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

export interface PerformanceThresholds {
  renderTime: number; // ms
  stateUpdateTime: number; // ms
  apiResponseTime: number; // ms
  dagSolveTime: number; // ms
  memoryIncrease: number; // MB
}

const DEFAULT_THRESHOLDS: PerformanceThresholds = {
  renderTime: 16, // 60fps = 16ms per frame
  stateUpdateTime: 5,
  apiResponseTime: 1000,
  dagSolveTime: 25,
  memoryIncrease: 10, // MB
};

class PerformanceMonitor {
  private metrics: PerformanceMetric[] = [];
  private thresholds: PerformanceThresholds;
  private maxMetrics = 1000; // Keep last 1000 metrics
  private warnings: string[] = [];

  constructor(thresholds: Partial<PerformanceThresholds> = {}) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
  }

  /**
   * Measure execution time of a function
   */
  async measure<T>(
    name: string,
    category: PerformanceMetric["category"],
    fn: () => Promise<T> | T
  ): Promise<T> {
    const start = performance.now();
    try {
      const result = await Promise.resolve(fn());
      const duration = performance.now() - start;
      this.recordMetric(name, category, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.recordMetric(name, category, duration);
      throw error;
    }
  }

  /**
   * Measure render time using requestAnimationFrame
   */
  measureRender(name: string): Promise<number> {
    return new Promise((resolve) => {
      const start = performance.now();
      requestAnimationFrame(() => {
        const duration = performance.now() - start;
        this.recordMetric(name, "render", duration);
        resolve(duration);
      });
    });
  }

  /**
   * Record a metric with threshold checking
   */
  private recordMetric(name: string, category: PerformanceMetric["category"], duration: number) {
    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
      category,
    };

    this.metrics.push(metric);

    // Keep only recent metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Check thresholds
    this.checkThreshold(metric);
  }

  /**
   * Check if metric exceeds thresholds
   */
  private checkThreshold(metric: PerformanceMetric) {
    let threshold = 0;

    switch (metric.category) {
      case "render":
        threshold = this.thresholds.renderTime;
        break;
      case "state":
        threshold = this.thresholds.stateUpdateTime;
        break;
      case "api":
        threshold = this.thresholds.apiResponseTime;
        break;
      case "dag":
        threshold = this.thresholds.dagSolveTime;
        break;
    }

    if (metric.duration > threshold) {
      const warning = `⚠️ Slow ${metric.category}: ${metric.name} took ${metric.duration.toFixed(2)}ms (threshold: ${threshold}ms)`;
      this.warnings.push(warning);
      if (import.meta.env.DEV) {
        console.warn(warning);
      }
    }
  }

  /**
   * Get metrics for a specific category
   */
  getMetrics(category?: PerformanceMetric["category"]): PerformanceMetric[] {
    if (!category) return this.metrics;
    return this.metrics.filter((m) => m.category === category);
  }

  /**
   * Get average duration for a metric name
   */
  getAverageDuration(name: string): number {
    const matching = this.metrics.filter((m) => m.name === name);
    if (matching.length === 0) return 0;
    const sum = matching.reduce((acc, m) => acc + m.duration, 0);
    return sum / matching.length;
  }

  /**
   * Get performance statistics
   */
  getStats(name?: string) {
    const metrics = name
      ? this.metrics.filter((m) => m.name === name)
      : this.metrics;

    if (metrics.length === 0) {
      return null;
    }

    const durations = metrics.map((m) => m.duration);
    const sorted = [...durations].sort((a, b) => a - b);

    return {
      count: durations.length,
      min: Math.min(...durations),
      max: Math.max(...durations),
      mean: durations.reduce((a, b) => a + b, 0) / durations.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }

  /**
   * Get memory usage stats
   */
  getMemoryStats() {
    const memory = (performance as PerformanceWithMemory).memory;

    if (!memory) {
      return null;
    }

    return {
      used: memory.usedJSHeapSize,
      limit: memory.jsHeapSizeLimit,
      percentage: (memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100,
    };
  }

  /**
   * Clear all metrics
   */
  clear() {
    this.metrics = [];
    this.warnings = [];
  }

  /**
   * Get all warnings
   */
  getWarnings(): string[] {
    return [...this.warnings];
  }

  /**
   * Export metrics as JSON for analysis
   */
  export() {
    return {
      metrics: this.metrics,
      warnings: this.warnings,
      timestamp: new Date().toISOString(),
      memory: this.getMemoryStats(),
    };
  }
}

// Global instance
export const globalMonitor = new PerformanceMonitor();

// Hook for React components
export function usePerformanceMonitor() {
  return globalMonitor;
}
