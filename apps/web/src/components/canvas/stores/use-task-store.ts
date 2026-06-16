import { create } from "zustand";
import type { TaskStatus } from "@shared/types";

interface TaskState {
  id: string;
  nodeId: string;
  status: TaskStatus;
  result?: { url: string; fileKey: string };
  error?: string;
}

interface TaskStore {
  tasks: Map<string, TaskState>;
  setTask: (taskId: string, state: TaskState) => void;
  updateTaskStatus: (taskId: string, status: TaskStatus, result?: TaskState["result"], error?: string) => void;
  getTaskByNodeId: (nodeId: string) => TaskState | undefined;
  clearTask: (taskId: string) => void;
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: new Map(),

  setTask: (taskId, state) =>
    set((s) => {
      const tasks = new Map(s.tasks);
      tasks.set(taskId, state);
      return { tasks };
    }),

  updateTaskStatus: (taskId, status, result, error) =>
    set((s) => {
      const tasks = new Map(s.tasks);
      const existing = tasks.get(taskId);
      if (existing) {
        tasks.set(taskId, { ...existing, status, result, error });
      }
      return { tasks };
    }),

  getTaskByNodeId: (nodeId) => {
    for (const task of get().tasks.values()) {
      if (task.nodeId === nodeId) return task;
    }
    return undefined;
  },

  clearTask: (taskId) =>
    set((s) => {
      const tasks = new Map(s.tasks);
      tasks.delete(taskId);
      return { tasks };
    }),
}));
