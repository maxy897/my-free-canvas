import { create } from "zustand";
import type { Node, Edge, Viewport } from "@xyflow/react";

export interface HistoryState {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
}

interface HistoryStore {
  past: HistoryState[];
  future: HistoryState[];

  // History operations
  push: (state: HistoryState) => void;
  undo: (currentState: HistoryState) => HistoryState | null;
  redo: (currentState: HistoryState) => HistoryState | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  clear: () => void;

  // Configuration
  maxHistory: number;
}

const DEFAULT_MAX_HISTORY = 50;

function cloneHistoryState(state: HistoryState): HistoryState {
  return {
    nodes: structuredClone(state.nodes),
    edges: structuredClone(state.edges),
    viewport: { ...state.viewport },
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEqualValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((value, index) => isEqualValue(value, b[index]));
  }

  if (isPlainObject(a) || isPlainObject(b)) {
    if (!isPlainObject(a) || !isPlainObject(b)) return false;
    const keysA = Object.keys(a);
    if (keysA.length !== Object.keys(b).length) return false;
    return keysA.every((key) => Object.prototype.hasOwnProperty.call(b, key) && isEqualValue(a[key], b[key]));
  }

  return false;
}

function isSameNode(a: Node, b: Node): boolean {
  return (
    a.id === b.id &&
    a.type === b.type &&
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.selected === b.selected &&
    isEqualValue(a.data, b.data)
  );
}

function isSameEdge(a: Edge, b: Edge): boolean {
  return (
    a.id === b.id &&
    a.source === b.source &&
    a.target === b.target &&
    a.sourceHandle === b.sourceHandle &&
    a.targetHandle === b.targetHandle &&
    a.selected === b.selected &&
    isEqualValue(a.data, b.data)
  );
}

function isSameHistoryState(a: HistoryState, b: HistoryState): boolean {
  return (
    a.viewport.x === b.viewport.x &&
    a.viewport.y === b.viewport.y &&
    a.viewport.zoom === b.viewport.zoom &&
    a.nodes.length === b.nodes.length &&
    a.edges.length === b.edges.length &&
    a.nodes.every((node, index) => isSameNode(node, b.nodes[index])) &&
    a.edges.every((edge, index) => isSameEdge(edge, b.edges[index]))
  );
}

export const useHistory = create<HistoryStore>((set, get) => ({
  past: [],
  future: [],
  maxHistory: DEFAULT_MAX_HISTORY,

  push: (state) =>
    set((s) => {
      const snapshot = cloneHistoryState(state);
      const last = s.past[s.past.length - 1];
      if (last && isSameHistoryState(last, snapshot)) {
        return s;
      }

      const past = [...s.past, snapshot];
      if (past.length > s.maxHistory) {
        past.shift();
      }
      return {
        past,
        future: [], // Clear future when new action is performed
      };
    }),

  undo: (currentState) => {
    const { past } = get();
    if (past.length === 0) return null;

    const restored = past[past.length - 1];

    set((s) => ({
      past: s.past.slice(0, -1),
      future: [cloneHistoryState(currentState), ...s.future],
    }));

    return cloneHistoryState(restored);
  },

  redo: (currentState) => {
    const { future } = get();
    if (future.length === 0) return null;

    const restored = future[0];

    set((s) => ({
      past: [...s.past, cloneHistoryState(currentState)],
      future: s.future.slice(1),
    }));

    return cloneHistoryState(restored);
  },

  canUndo: () => get().past.length > 0,
  canRedo: () => get().future.length > 0,

  clear: () =>
    set({
      past: [],
      future: [],
    }),
}));
