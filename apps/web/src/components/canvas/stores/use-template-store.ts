import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Node, Edge } from "@xyflow/react";
import { localForageStorage } from "../lib/localforage-storage";

export interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  nodes: Node[];
  edges: Edge[];
  createdAt: number;
}

interface TemplateStore {
  templates: WorkflowTemplate[];

  /** Save current workflow as a template */
  saveTemplate: (template: WorkflowTemplate) => void;

  /** Delete a template by id */
  deleteTemplate: (id: string) => void;

  /** Rename a template */
  renameTemplate: (id: string, name: string) => void;

  /** Get all templates */
  getTemplates: () => WorkflowTemplate[];
}

export const useTemplateStore = create<TemplateStore>()(
  persist(
    (set, get) => ({
      templates: [],

      saveTemplate: (template) =>
        set((s) => ({
          templates: [template, ...s.templates],
        })),

      deleteTemplate: (id) =>
        set((s) => ({
          templates: s.templates.filter((t) => t.id !== id),
        })),

      renameTemplate: (id, name) =>
        set((s) => ({
          templates: s.templates.map((t) =>
            t.id === id ? { ...t, name } : t
          ),
        })),

      getTemplates: () => get().templates,
    }),
    {
      name: "canvas-templates",
      storage: createJSONStorage(() => localForageStorage),
      partialize: (state) => ({ templates: state.templates }),
    }
  )
);
