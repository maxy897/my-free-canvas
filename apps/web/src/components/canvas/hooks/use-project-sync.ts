import { useCallback } from "react";
import type { Edge, Node, Viewport } from "@xyflow/react";
import { generateThumbnailSvg } from "../lib/thumbnail-generator";
import { useFlowStore } from "../stores/use-flow-store";

const API_BASE = import.meta.env.PUBLIC_API_URL || "http://localhost:8787";
const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

interface CanvasFlowData {
  nodes: Node[];
  edges: Edge[];
  viewport: Viewport;
}

interface CanvasProject {
  id: string;
  name: string;
  thumbnailUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface ProjectCanvas {
  id: string;
  projectId: string;
  name: string;
  flowData: CanvasFlowData;
  thumbnailUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface CanvasIds {
  projectId: string;
  canvasId: string;
}

interface ProjectSyncApi {
  listProjects: () => Promise<CanvasProject[]>;
  createProject: (name?: string) => Promise<CanvasProject | null>;
  loadProject: (projectId: string) => Promise<CanvasProject | null>;
  updateProject: (projectId: string, updates: { name?: string; thumbnailUrl?: string | null }) => Promise<boolean>;
  deleteProject: (projectId: string) => Promise<boolean>;
  listCanvases: (projectId: string) => Promise<ProjectCanvas[]>;
  createCanvas: (projectId: string, name?: string) => Promise<ProjectCanvas | null>;
  loadCanvas: (projectId: string, canvasId: string) => Promise<boolean>;
  saveCanvas: (projectIdArg?: string, canvasIdArg?: string) => Promise<boolean>;
  deleteCanvas: (projectId: string, canvasId: string) => Promise<boolean>;
  ensureEditorCanvas: (ids?: { projectId?: string | null; canvasId?: string | null }) => Promise<CanvasIds | null>;
}

function createOptionalNameBody(name?: string): string {
  const trimmedName = name?.trim();
  return JSON.stringify(trimmedName ? { name: trimmedName } : {});
}

function hydrateCanvas(projectId: string, canvasId: string, flowData?: Partial<CanvasFlowData>): void {
  useFlowStore.setState({ enableHistory: false });
  useFlowStore.setState({
    projectId,
    canvasId,
    nodes: flowData?.nodes || [],
    edges: flowData?.edges || [],
    viewport: flowData?.viewport || DEFAULT_VIEWPORT,
    enableHistory: true,
    isDirty: false,
  });
  useFlowStore.getState().resetHistory();
}

async function readJson<T>(res: Response): Promise<T | null> {
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** Project/canvas sync hook. Projects are containers; canvases own flowData. */
export function useProjectSync(): ProjectSyncApi {
  const listProjects = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/canvas/projects`, { credentials: "include" });
      const data = await readJson<{ projects: CanvasProject[] }>(res);
      return data?.projects || [];
    } catch (error) {
      console.error("[project-sync] List projects error:", error);
      return [];
    }
  }, []);

  const createProject = useCallback(async (name?: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/canvas/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: createOptionalNameBody(name),
      });
      const project = await readJson<CanvasProject>(res);
      if (!project) return null;

      useFlowStore.getState().setProjectId(project.id);
      return project;
    } catch (error) {
      console.error("[project-sync] Create project error:", error);
      return null;
    }
  }, []);

  const loadProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/canvas/projects/${projectId}`, { credentials: "include" });
      return await readJson<CanvasProject>(res);
    } catch (error) {
      console.error("[project-sync] Load project error:", error);
      return null;
    }
  }, []);

  const updateProject = useCallback(async (projectId: string, updates: { name?: string; thumbnailUrl?: string | null }) => {
    try {
      const res = await fetch(`${API_BASE}/api/canvas/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      });
      return res.ok;
    } catch (error) {
      console.error("[project-sync] Update project error:", error);
      return false;
    }
  }, []);

  const deleteProject = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/canvas/projects/${projectId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok && useFlowStore.getState().projectId === projectId) {
        useFlowStore.setState({ projectId: null, canvasId: null });
      }
      return res.ok;
    } catch (error) {
      console.error("[project-sync] Delete project error:", error);
      return false;
    }
  }, []);

  const listCanvases = useCallback(async (projectId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/canvas/projects/${projectId}/canvases`, { credentials: "include" });
      const data = await readJson<{ canvases: ProjectCanvas[] }>(res);
      return data?.canvases || [];
    } catch (error) {
      console.error("[project-sync] List canvases error:", error);
      return [];
    }
  }, []);

  const createCanvas = useCallback(async (projectId: string, name?: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/canvas/projects/${projectId}/canvases`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: createOptionalNameBody(name),
      });
      const canvas = await readJson<ProjectCanvas>(res);
      if (!canvas) return null;

      hydrateCanvas(projectId, canvas.id, canvas.flowData);
      return canvas;
    } catch (error) {
      console.error("[project-sync] Create canvas error:", error);
      return null;
    }
  }, []);

  const loadCanvas = useCallback(async (projectId: string, canvasId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/canvas/projects/${projectId}/canvases/${canvasId}`, {
        credentials: "include",
      });
      const canvas = await readJson<ProjectCanvas>(res);
      if (!canvas) return false;

      hydrateCanvas(projectId, canvasId, canvas.flowData);
      return true;
    } catch (error) {
      console.error("[project-sync] Load canvas error:", error);
      return false;
    }
  }, []);

  const saveCanvas = useCallback(async (projectIdArg?: string, canvasIdArg?: string) => {
    const { projectId, canvasId, nodes, edges, viewport, markClean } = useFlowStore.getState();
    const targetProjectId = projectIdArg || projectId;
    const targetCanvasId = canvasIdArg || canvasId;
    if (!targetProjectId || !targetCanvasId) return false;

    const thumbnailUrl = generateThumbnailSvg(nodes, edges);

    try {
      const res = await fetch(`${API_BASE}/api/canvas/projects/${targetProjectId}/canvases/${targetCanvasId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          flowData: { nodes, edges, viewport },
          thumbnailUrl: thumbnailUrl || undefined,
        }),
      });

      if (res.ok) markClean();
      return res.ok;
    } catch (error) {
      console.error("[project-sync] Save canvas error:", error);
      return false;
    }
  }, []);

  const deleteCanvas = useCallback(async (projectId: string, canvasId: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/canvas/projects/${projectId}/canvases/${canvasId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok && useFlowStore.getState().canvasId === canvasId) {
        useFlowStore.setState({ canvasId: null });
      }
      return res.ok;
    } catch (error) {
      console.error("[project-sync] Delete canvas error:", error);
      return false;
    }
  }, []);

  const ensureEditorCanvas = useCallback(
    async (ids: { projectId?: string | null; canvasId?: string | null } = {}) => {
      if (ids.projectId && ids.canvasId) {
        const loaded = await loadCanvas(ids.projectId, ids.canvasId);
        return loaded ? { projectId: ids.projectId, canvasId: ids.canvasId } : null;
      }

      if (ids.projectId) {
        const canvas = await createCanvas(ids.projectId);
        return canvas ? { projectId: ids.projectId, canvasId: canvas.id } : null;
      }

      const projects = await listProjects();
      const project = projects[0] || (await createProject());
      if (!project) return null;

      const canvas = await createCanvas(project.id);
      return canvas ? { projectId: project.id, canvasId: canvas.id } : null;
    },
    [createCanvas, createProject, listProjects, loadCanvas]
  );

  return {
    listProjects,
    createProject,
    loadProject,
    updateProject,
    deleteProject,
    listCanvases,
    createCanvas,
    loadCanvas,
    saveCanvas,
    deleteCanvas,
    ensureEditorCanvas,
  };
}
