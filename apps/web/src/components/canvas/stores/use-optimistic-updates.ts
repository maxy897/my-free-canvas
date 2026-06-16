import { create } from "zustand";
import type { Node, Edge } from "@xyflow/react";

export interface OptimisticUpdate {
  id: string;
  type: "node" | "edge" | "nodeData";
  operation: "add" | "update" | "delete";
  target: Node | Edge | string;
  originalState?: Node | Edge;
  timestamp: number;
  confirmed: boolean;
  error?: string;
}

interface OptimisticStore {
  updates: Map<string, OptimisticUpdate>;
  
  // Optimistic operations
  trackUpdate: (update: OptimisticUpdate) => string;
  confirmUpdate: (updateId: string) => void;
  rollbackUpdate: (updateId: string) => OptimisticUpdate | null;
  getUpdate: (updateId: string) => OptimisticUpdate | null;
  getPendingUpdates: () => OptimisticUpdate[];
  getFailedUpdates: () => OptimisticUpdate[];
  clearUpdate: (updateId: string) => void;
  clearOldUpdates: (olderThanMs: number) => void;
}

export const useOptimisticUpdates = create<OptimisticStore>((set, get) => ({
  updates: new Map(),

  trackUpdate: (update) => {
    const id = update.id || `optimistic-${Date.now()}-${Math.random()}`;
    const updateWithId = { ...update, id };
    
    set((s) => {
      const updates = new Map(s.updates);
      updates.set(id, updateWithId);
      return { updates };
    });
    
    return id;
  },

  confirmUpdate: (updateId) => {
    set((s) => {
      const updates = new Map(s.updates);
      const update = updates.get(updateId);
      if (update) {
        update.confirmed = true;
      }
      return { updates };
    });
  },

  rollbackUpdate: (updateId) => {
    const update = get().updates.get(updateId);
    
    set((s) => {
      const updates = new Map(s.updates);
      updates.delete(updateId);
      return { updates };
    });
    
    return update || null;
  },

  getUpdate: (updateId) => {
    return get().updates.get(updateId) || null;
  },

  getPendingUpdates: () => {
    return Array.from(get().updates.values()).filter((u) => !u.confirmed);
  },

  getFailedUpdates: () => {
    return Array.from(get().updates.values()).filter((u) => u.error);
  },

  clearUpdate: (updateId) => {
    set((s) => {
      const updates = new Map(s.updates);
      updates.delete(updateId);
      return { updates };
    });
  },

  clearOldUpdates: (olderThanMs) => {
    const cutoff = Date.now() - olderThanMs;
    set((s) => {
      const updates = new Map(s.updates);
      for (const [id, update] of updates.entries()) {
        if (update.timestamp < cutoff) {
          updates.delete(id);
        }
      }
      return { updates };
    });
  },
}));
