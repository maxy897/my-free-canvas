import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import {
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Viewport,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import { localForageStorage } from "../lib/localforage-storage";
import { useHistory, type HistoryState } from "./use-history";
import { useOptimisticUpdates } from "./use-optimistic-updates";

interface UpdateNodeDataOptions {
  recordHistory?: boolean;
}

interface FlowState {
  // Core data
  projectId: string | null;
  canvasId: string | null;
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;

  // History and undo/redo
  enableHistory: boolean;
  
  // Operations
  setProjectId: (id: string | null) => void;
  setCanvasId: (id: string | null) => void;
  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  setFlow: (state: Partial<HistoryState>) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  addNode: (node: Node) => void;
  addNodeWithEdges: (node: Node, edges: Edge[]) => void;
  deleteNode: (nodeId: string) => void;
  deleteSelectedNodes: () => void;
  updateNodeData: (nodeId: string, data: Record<string, unknown>, options?: UpdateNodeDataOptions) => void;
  commitNodeDataHistory: () => void;
  setViewport: (viewport: Viewport) => void;
  
  // Undo/Redo
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
  resetHistory: () => void;

  // Sync tracking
  isDirty: boolean;
  markClean: () => void;
}

let activeNodeDragSnapshot: HistoryState | null = null;
let pendingNodeDataHistorySnapshot: HistoryState | null = null;

function getSnapshot(state: FlowState): HistoryState {
  return {
    nodes: state.nodes,
    edges: state.edges,
    viewport: state.viewport,
  };
}

function pushHistory(state: FlowState) {
  if (!state.enableHistory) return;
  flushPendingNodeDataHistory();
  useHistory.getState().push(getSnapshot(state));
}

function queueNodeDataHistory(state: FlowState) {
  if (!state.enableHistory || pendingNodeDataHistorySnapshot) return;
  pendingNodeDataHistorySnapshot = getSnapshot(state);
}

function flushPendingNodeDataHistory() {
  if (!pendingNodeDataHistorySnapshot) return;
  useHistory.getState().push(pendingNodeDataHistorySnapshot);
  pendingNodeDataHistorySnapshot = null;
}

function getUrlCanvasId(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("canvasId");
}

function shouldHydratePersistedState(persistedState: unknown): persistedState is Partial<FlowState> {
  if (!persistedState || typeof persistedState !== "object") return false;

  const persistedCanvasId = (persistedState as Partial<FlowState>).canvasId;
  const urlCanvasId = getUrlCanvasId();
  return Boolean(urlCanvasId && persistedCanvasId && persistedCanvasId === urlCanvasId);
}

function shouldRecordEdgeChanges(changes: EdgeChange[]): boolean {
  return changes.some((change) => change.type === "remove");
}

function shouldRecordNodeChanges(changes: NodeChange[]): boolean {
  return changes.some((change) => change.type === "remove");
}

export const useFlowStore = create<FlowState>()(
  persist(
    (set, get) => ({
      projectId: null,
      canvasId: null,
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      isDirty: false,
      enableHistory: true,

      setProjectId: (projectId) => set({ projectId }),
      setCanvasId: (canvasId) => set({ canvasId }),

      setNodes: (nodes) => {
        pushHistory(get());
        set({ nodes, isDirty: true });
      },

      setEdges: (edges) => {
        pushHistory(get());
        set({ edges, isDirty: true });
      },

      setFlow: (state) => {
        const current = get();
        pushHistory(current);
        set({
          nodes: state.nodes ?? current.nodes,
          edges: state.edges ?? current.edges,
          viewport: state.viewport ?? current.viewport,
          isDirty: true,
        });
      },

      onNodesChange: (changes) => {
        const current = get();

        const hasPositionChange = changes.some((change) => change.type === "position");
        if (current.enableHistory && hasPositionChange && !activeNodeDragSnapshot) {
          flushPendingNodeDataHistory();
          activeNodeDragSnapshot = getSnapshot(current);
          useHistory.getState().push(activeNodeDragSnapshot);
        } else if (current.enableHistory && shouldRecordNodeChanges(changes)) {
          flushPendingNodeDataHistory();
          useHistory.getState().push(getSnapshot(current));
        }

        set((s) => ({ nodes: applyNodeChanges(changes, s.nodes), isDirty: true }));

        if (
          hasPositionChange &&
          !changes.some((change) => change.type === "position" && change.dragging === true)
        ) {
          activeNodeDragSnapshot = null;
        }
      },

      onEdgesChange: (changes) => {
        const current = get();
        if (current.enableHistory && shouldRecordEdgeChanges(changes)) {
          flushPendingNodeDataHistory();
          useHistory.getState().push(getSnapshot(current));
        }
        set((s) => ({ edges: applyEdgeChanges(changes, s.edges), isDirty: true }));
      },

      addNode: (node) => {
        const current = get();
        pushHistory(current);
        set((s) => ({ nodes: [...s.nodes, node], isDirty: true }));
      },

      addNodeWithEdges: (node, edges) => {
        const current = get();
        pushHistory(current);
        set((s) => ({ nodes: [...s.nodes, node], edges, isDirty: true }));
      },

      deleteNode: (nodeId) => {
        const current = get();
        pushHistory(current);
        set((s) => ({
          nodes: s.nodes.filter((n) => n.id !== nodeId),
          edges: s.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
          isDirty: true,
        }));
      },

      deleteSelectedNodes: () => {
        const current = get();
        const selected = current.nodes.filter((n) => n.selected);
        if (selected.length === 0) return;

        pushHistory(current);
        const selectedIds = new Set(selected.map((n) => n.id));
        set((s) => ({
          nodes: s.nodes.filter((n) => !selectedIds.has(n.id)),
          edges: s.edges.filter((e) => !selectedIds.has(e.source) && !selectedIds.has(e.target)),
          isDirty: true,
        }));
      },

      updateNodeData: (nodeId, data, options) => {
        const current = get();
        if (options?.recordHistory === false) {
          queueNodeDataHistory(current);
        } else {
          pushHistory(current);
        }
        set((s) => ({
          nodes: s.nodes.map((n) =>
            n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n
          ),
          isDirty: true,
        }));
      },

      commitNodeDataHistory: () => {
        if (!get().enableHistory) return;
        flushPendingNodeDataHistory();
      },

      setViewport: (viewport) => set({ viewport }),

      undo: () => {
        const current = get();
        const history = useHistory.getState();
        const prevState = history.undo({
          nodes: current.nodes,
          edges: current.edges,
          viewport: current.viewport,
        });
        if (prevState) {
          set({
            ...prevState,
            isDirty: true,
            enableHistory: true,
          });
        }
      },

      redo: () => {
        const current = get();
        const history = useHistory.getState();
        const nextState = history.redo({
          nodes: current.nodes,
          edges: current.edges,
          viewport: current.viewport,
        });
        if (nextState) {
          set({
            ...nextState,
            isDirty: true,
            enableHistory: true,
          });
        }
      },

      canUndo: () => useHistory.getState().canUndo(),
      canRedo: () => useHistory.getState().canRedo(),
      
      resetHistory: () => {
        useHistory.getState().clear();
        useOptimisticUpdates.getState().clearUpdate("");
        pendingNodeDataHistorySnapshot = null;
      },

      markClean: () => set({ isDirty: false }),
    }),
    {
      name: "canvas-flow",
      storage: createJSONStorage(() => localForageStorage),
      partialize: (state) => ({
        projectId: state.projectId,
        canvasId: state.canvasId,
        nodes: state.nodes,
        edges: state.edges,
        viewport: state.viewport,
      }),
      merge: (persistedState, currentState) => {
        if (!shouldHydratePersistedState(persistedState)) return currentState;

        return {
          ...currentState,
          ...persistedState,
          isDirty: false,
          enableHistory: true,
        };
      },
    }
  )
);
