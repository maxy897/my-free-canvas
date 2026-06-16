import { API_URL } from "../../../lib/api";

const JSON_HEADERS = { "Content-Type": "application/json" };

export interface CanvasIds {
  projectId: string;
  canvasId: string;
}

interface CanvasProject {
  id: string;
}

interface ProjectCanvas {
  id: string;
  projectId: string;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include", ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || (res.status === 401 ? "请先登录后创建画布" : `请求失败：${res.status}`));
  }
  return (await res.json()) as T;
}

export function createCanvasEditorUrl({ projectId, canvasId }: CanvasIds): string {
  const params = new URLSearchParams({ projectId, canvasId });
  return `/canvas/editor?${params.toString()}`;
}

export async function createEditorCanvas(): Promise<CanvasIds> {
  const data = await fetchJson<{ projects: CanvasProject[] }>("/api/canvas/projects");
  const project =
    data.projects[0] ||
    (await fetchJson<CanvasProject>("/api/canvas/projects", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    }));

  const canvas = await fetchJson<ProjectCanvas>(`/api/canvas/projects/${project.id}/canvases`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({}),
  });

  return { projectId: canvas.projectId || project.id, canvasId: canvas.id };
}
