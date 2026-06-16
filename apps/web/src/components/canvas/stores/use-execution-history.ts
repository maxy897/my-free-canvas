import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { localForageStorage } from "../lib/localforage-storage";

export interface ExecutionRecord {
  id: string;
  nodeId: string;
  taskType: string;
  status: "success" | "failed";
  outputUrl?: string;
  inputParams: Record<string, unknown>;
  errorMessage?: string;
  timestamp: number;
}

interface ExecutionHistoryStore {
  /** Map of nodeId → array of execution records (most recent first) */
  records: Record<string, ExecutionRecord[]>;

  /** Add a completed execution to history */
  addRecord: (record: ExecutionRecord) => void;

  /** Get execution history for a node */
  getNodeHistory: (nodeId: string) => ExecutionRecord[];

  /** Clear history for a specific node */
  clearNodeHistory: (nodeId: string) => void;

  /** Clear all history */
  clearAll: () => void;

  /** Max records per node */
  maxPerNode: number;
}

const MAX_RECORDS_PER_NODE = 20;

export const useExecutionHistory = create<ExecutionHistoryStore>()(
  persist(
    (set, get) => ({
      records: {},
      maxPerNode: MAX_RECORDS_PER_NODE,

      addRecord: (record) =>
        set((s) => {
          const nodeRecords = s.records[record.nodeId] || [];
          const updated = [record, ...nodeRecords].slice(0, s.maxPerNode);
          return {
            records: { ...s.records, [record.nodeId]: updated },
          };
        }),

      getNodeHistory: (nodeId) => get().records[nodeId] || [],

      clearNodeHistory: (nodeId) =>
        set((s) => {
          const { [nodeId]: _, ...rest } = s.records;
          return { records: rest };
        }),

      clearAll: () => set({ records: {} }),
    }),
    {
      name: "canvas-execution-history",
      storage: createJSONStorage(() => localForageStorage),
      partialize: (state) => ({ records: state.records }),
    }
  )
);
