import { useCallback, useEffect, useState, type ReactElement } from "react";

const API_BASE = import.meta.env.PUBLIC_API_URL || "http://localhost:8787";
const JSON_HEADERS = { "Content-Type": "application/json" };

interface CanvasProject {
  id: string;
  name: string;
  thumbnailUrl?: string | null;
  updatedAt?: string;
}

interface ProjectCanvas {
  id: string;
  projectId: string;
  name: string;
  thumbnailUrl?: string | null;
  updatedAt?: string;
}

function formatDate(value?: string): string {
  if (!value) return "未同步";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) throw new Error(res.status === 401 ? "请先登录后查看项目" : `请求失败：${res.status}`);
  return (await res.json()) as T;
}

function redirectToCanvas(projectId: string, canvasId: string): void {
  const params = new URLSearchParams({
    projectId,
    canvasId,
  });
  window.location.href = `/canvas/editor?${params.toString()}`;
}

export function ProjectCanvasList(): ReactElement {
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [canvases, setCanvases] = useState<ProjectCanvas[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProject = projects.find((project) => project.id === selectedProjectId) || null;

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJson<{ projects: CanvasProject[] }>(`${API_BASE}/api/canvas/projects`);
      setProjects(data.projects);
      setSelectedProjectId((current) => current || data.projects[0]?.id || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "项目加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCanvases = useCallback(async (projectId: string) => {
    setError(null);
    try {
      const data = await fetchJson<{ canvases: ProjectCanvas[] }>(`${API_BASE}/api/canvas/projects/${projectId}/canvases`);
      setCanvases(data.canvases);
    } catch (err) {
      setError(err instanceof Error ? err.message : "画布加载失败");
      setCanvases([]);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    if (selectedProjectId) void loadCanvases(selectedProjectId);
    else setCanvases([]);
  }, [loadCanvases, selectedProjectId]);

  async function createProjectWithCanvas(): Promise<void> {
    setCreating(true);
    setError(null);
    try {
      const project = await fetchJson<CanvasProject>(`${API_BASE}/api/canvas/projects`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      });
      const canvas = await fetchJson<ProjectCanvas>(`${API_BASE}/api/canvas/projects/${project.id}/canvases`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      });
      redirectToCanvas(project.id, canvas.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建项目失败");
      setCreating(false);
    }
  }

  async function createCanvas(): Promise<void> {
    if (!selectedProjectId) return;

    setCreating(true);
    setError(null);
    try {
      const canvas = await fetchJson<ProjectCanvas>(`${API_BASE}/api/canvas/projects/${selectedProjectId}/canvases`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({}),
      });
      redirectToCanvas(selectedProjectId, canvas.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建画布失败");
      setCreating(false);
    }
  }

  let projectListContent: ReactElement;
  if (loading) {
    projectListContent = (
      <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4 text-sm text-[#B8C0CC]">加载项目中...</div>
    );
  } else if (projects.length === 0) {
    projectListContent = (
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.025] p-4 text-sm leading-6 text-[#B8C0CC]">
        还没有项目。创建项目后会自动创建默认画布。
      </div>
    );
  } else {
    projectListContent = (
      <div className="space-y-2">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            onClick={() => setSelectedProjectId(project.id)}
            className={`w-full rounded-2xl border p-3 text-left transition ${
              project.id === selectedProjectId
                ? "border-[#28D7F5]/55 bg-[#071F2A]/72 text-white"
                : "border-white/10 bg-white/[0.035] text-[#B8C0CC] hover:border-white/20 hover:bg-white/[0.06]"
            }`}
          >
            <div className="font-semibold text-[#F5F7FA]">{project.name}</div>
            <div className="mt-1 text-[11px] text-[#788493]">更新于 {formatDate(project.updatedAt)}</div>
          </button>
        ))}
      </div>
    );
  }

  let canvasListContent: ReactElement;
  if (!selectedProjectId) {
    canvasListContent = (
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.025] p-8 text-center text-sm text-[#B8C0CC]">
        先选择一个项目，或新建项目并进入默认画布。
      </div>
    );
  } else if (canvases.length === 0) {
    canvasListContent = (
      <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.025] p-8 text-center text-sm text-[#B8C0CC]">
        该项目还没有画布。
      </div>
    );
  } else {
    canvasListContent = (
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {canvases.map((canvas) => (
          <a
            key={canvas.id}
            href={`/canvas/editor?projectId=${encodeURIComponent(canvas.projectId)}&canvasId=${encodeURIComponent(canvas.id)}`}
            className="group rounded-[22px] border border-white/10 bg-[#0A0C11]/72 p-4 transition hover:border-[#28D7F5]/45 hover:bg-[#101A27]"
          >
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#050608]">
              {canvas.thumbnailUrl ? (
                <img src={canvas.thumbnailUrl} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="text-xs uppercase tracking-[0.18em] text-[#3C4654]">Canvas</span>
              )}
            </div>
            <div className="mt-3 font-semibold text-[#F5F7FA] group-hover:text-white">{canvas.name}</div>
            <div className="mt-1 text-[11px] text-[#788493]">更新于 {formatDate(canvas.updatedAt)}</div>
          </a>
        ))}
      </div>
    );
  }

  return (
    <section className="mt-6 grid max-w-6xl gap-4 lg:grid-cols-[320px_1fr]">
      <div className="rounded-[28px] border border-[#2B313B] bg-[#0A0C11]/78 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#28D7F5]">Projects</p>
            <h3 className="mt-1 text-lg font-bold">项目</h3>
          </div>
          <button
            type="button"
            onClick={createProjectWithCanvas}
            disabled={creating}
            className="rounded-full bg-[#F5F7FA] px-3 py-1.5 text-xs font-semibold text-[#050608] transition hover:bg-white disabled:opacity-50"
          >
            {creating ? "新建中..." : "新建"}
          </button>
        </div>

        {projectListContent}
      </div>

      <div className="rounded-[28px] border border-[#2B313B] bg-[#14171D]/86 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#FFB454]">Canvases</p>
            <h3 className="mt-1 text-xl font-bold">{selectedProject ? selectedProject.name : "选择项目"}</h3>
          </div>
          <button
            type="button"
            onClick={createCanvas}
            disabled={!selectedProjectId || creating}
            className="rounded-full border border-[#28D7F5]/40 bg-[#071F2A]/72 px-4 py-2 text-xs font-bold text-[#91F0FF] transition hover:border-[#28D7F5]/70 hover:bg-[#0A2A38] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? "新建中..." : "新建画布"}
          </button>
        </div>

        {error && <div className="mb-4 rounded-2xl border border-[#FF5C7A]/30 bg-[#2A0B13]/70 p-3 text-sm text-[#FFB6C4]">{error}</div>}

        {canvasListContent}
      </div>
    </section>
  );
}
