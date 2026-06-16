/**
 * React performance optimization utilities
 * Memoization helpers, selector patterns, and batching utilities
 */

import { useMemo, useCallback, useRef, useEffect, useState } from "react";

/**
 * Create a shallow equality check for objects
 */
export function shallowEqual<T extends Record<string, unknown>>(a: T, b: T): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);

  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (a[key] !== b[key]) return false;
  }

  return true;
}

/**
 * Memoized selector hook with shallow equality check
 */
export function useShallowSelector<T extends Record<string, unknown>>(
  selector: () => T
): T {
  const previousRef = useRef<T | undefined>(undefined);
  const current = selector();

  return useMemo(() => {
    if (!previousRef.current || !shallowEqual(current, previousRef.current)) {
      previousRef.current = current;
      return current;
    }
    return previousRef.current;
  }, [current]);
}

/**
 * Debounce hook for expensive operations
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Throttle hook for frequent events (resize, scroll, etc.)
 */
export function useThrottle<T>(value: T, interval: number): T {
  const [throttledValue, setThrottledValue] = useState(value);
  const lastUpdatedRef = useRef(Date.now());

  useEffect(() => {
    const now = Date.now();
    if (now >= lastUpdatedRef.current + interval) {
      lastUpdatedRef.current = now;
      setThrottledValue(value);
    } else {
      const timer = setTimeout(
        () => {
          lastUpdatedRef.current = Date.now();
          setThrottledValue(value);
        },
        interval - (now - lastUpdatedRef.current)
      );

      return () => clearTimeout(timer);
    }
  }, [value, interval]);

  return throttledValue;
}

/**
 * Async effect hook that handles cleanup properly
 */
export function useAsyncEffect(
  effect: (isMounted: () => boolean) => Promise<void>,
  deps?: React.DependencyList
) {
  useEffect(() => {
    let isMounted = true;

    effect(() => isMounted);

    return () => {
      isMounted = false;
    };
  }, deps);
}

/**
 * Previous value hook for tracking prop changes
 */
export function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T | undefined>(undefined);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref.current;
}

/**
 * Interval hook with cleanup
 */
export function useInterval(callback: () => void, delay: number | null) {
  const savedCallback = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    savedCallback.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) return;

    const id = setInterval(() => {
      savedCallback.current?.();
    }, delay);

    return () => clearInterval(id);
  }, [delay]);
}

/**
 * Track whether component is in viewport for lazy rendering
 */
export function useInViewport(ref: React.RefObject<HTMLElement>, options?: IntersectionObserverInit) {
  const [isInViewport, setIsInViewport] = useState(false);

  useEffect(() => {
    if (!ref.current) return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsInViewport(entry.isIntersecting);
    }, options);

    observer.observe(ref.current);

    return () => {
      observer.disconnect();
    };
  }, [ref, options]);

  return isInViewport;
}

/**
 * Request ID frame hook for animation
 */
export function useAnimationFrame(callback: (elapsed: number) => void, enabled = true) {
  const frameRef = useRef<number | undefined>(undefined);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (!enabled) return;

    const animate = () => {
      const elapsed = Date.now() - startRef.current;
      callback(elapsed);
      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);

    return () => {
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, [callback, enabled]);
}

/**
 * Memory-efficient list rendering with virtualization hints
 */
export interface VirtualizedListProps<T> {
  items: T[];
  itemHeight: number;
  containerHeight: number;
  renderItem: (item: T, index: number) => React.ReactNode;
  overscan?: number;
}

export function getVisibleRange<T>(
  items: T[],
  itemHeight: number,
  containerHeight: number,
  scrollOffset: number,
  overscan = 3
): { start: number; end: number } {
  const visibleStart = Math.floor(scrollOffset / itemHeight);
  const visibleEnd = Math.ceil((scrollOffset + containerHeight) / itemHeight);

  return {
    start: Math.max(0, visibleStart - overscan),
    end: Math.min(items.length, visibleEnd + overscan),
  };
}
