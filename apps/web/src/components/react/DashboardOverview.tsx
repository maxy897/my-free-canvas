import { useCallback, useEffect, useState, type ReactElement } from "react";
import { AlertCircle, ArrowRight, ImageIcon, Layers3, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { API_URL, api } from "../../lib/api";
import { QuickCreateCanvasButton } from "../canvas/QuickCreateCanvasButton";

interface Quota {
  totalAvailable: number;
}

interface CanvasProject {
  id: string;
  name: string;
  thumbnailUrl?: string | null;
  updatedAt?: string;
}

interface ProjectCanvas {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  thumbnailUrl?: string | null;
  updatedAt?: string;
}

interface TaskItem {
  id: string;
  projectId: string;
  canvasId?: string | null;
  taskType: string;
  status: string;
  inputParams?: Record<string, unknown>;
  outputUrls?: string[];
  createdAt: string;
  completedAt?: string | null;
}

interface TaskResponse {
  items: TaskItem[];
  total: number;
}

interface DashboardState {
  quota: Quota | null;
  projects: CanvasProject[];
  canvases: ProjectCanvas[];
  recentTasks: TaskItem[];
  totalTasks: number;
  activeTasks: number;
}

const statusLabels: Record<string, string> = {
  pending: "排队中",
  running: "生成中",
  success: "已完成",
  failed: "失败",
  cancelled: "已取消",
};

const taskTypeLabels: Record<string, string> = {
  "txt2img": "文生图",
  "img2img": "图生图",
  "img2video": "图生视频",
};

function formatNumber(value?: number | null): string {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString("zh-CN");
}

function formatDate(value?: string | null): string {
  if (!value) return "暂无记录";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getTaskTitle(task: TaskItem): string {
  const params = task.inputParams || {};
  const prompt = params.prompt || params.text || params.description;
  if (typeof prompt === "string" && prompt.trim()) return prompt.trim();
  return taskTypeLabels[task.taskType] || task.taskType || "生成任务";
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, { credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || (res.status === 401 ? "请先登录后查看工作台" : `请求失败：${res.status}`));
  }
  return (await res.json()) as T;
}

async function loadProjectsAndCanvases(): Promise<{ projects: CanvasProject[]; canvases: ProjectCanvas[] }> {
  const projectData = await fetchJson<{ projects: CanvasProject[] }>("/api/canvas/projects");
  const canvasGroups = await Promise.all(
    projectData.projects.map((project) =>
      fetchJson<{ canvases: Omit<ProjectCanvas, "projectName">[] }>(`/api/canvas/projects/${project.id}/canvases`)
        .then((data) => data.canvases.map((canvas) => ({ ...canvas, projectName: project.name })))
        .catch(() => [])
    )
  );

  return {
    projects: projectData.projects,
    canvases: canvasGroups.flat().sort((a, b) => Date.parse(b.updatedAt || "") - Date.parse(a.updatedAt || "")),
  };
}

async function loadDashboard(): Promise<DashboardState> {
  const [quota, projectIndex, tasks, pendingTasks, runningTasks] = await Promise.all([
    api.getQuota(),
    loadProjectsAndCanvases(),
    fetchJson<TaskResponse>("/api/canvas/tasks?limit=5&offset=0"),
    fetchJson<TaskResponse>("/api/canvas/tasks?limit=1&offset=0&status=pending"),
    fetchJson<TaskResponse>("/api/canvas/tasks?limit=1&offset=0&status=running"),
  ]);

  return {
    quota,
    projects: projectIndex.projects,
    canvases: projectIndex.canvases,
    recentTasks: tasks.items,
    totalTasks: tasks.total,
    activeTasks: pendingTasks.total + runningTasks.total,
  };
}

function StatCard({
  label,
  value,
  detail,
  tone = "cyan",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "cyan" | "amber" | "green";
}): ReactElement {
  const toneClass = {
    cyan: "text-[#91F0FF]",
    amber: "text-[#FFCF7A]",
    green: "text-[#7DFFB2]",
  }[tone];

  return (
    <div className="rounded-[24px] border border-white/10 bg-[#10141C]/82 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
      <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#788493]">{label}</div>
      <div className={`mt-3 text-3xl font-black tracking-[-0.04em] ${toneClass}`}>{value}</div>
      <div className="mt-2 text-xs leading-5 text-[#9AA6B7]">{detail}</div>
    </div>
  );
}

export default function DashboardOverview(): ReactElement {
  const [data, setData] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : "工作台加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const latestCanvas = data?.canvases[0] || null;
  const latestTask = data?.recentTasks[0] || null;

  if (loading && !data) {
    return (
      <div className="flex min-h-[420px] items-center justify-center rounded-[32px] border border-[#2B313B] bg-[#0A0C11]/76 text-sm text-[#B8C0CC]">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        正在汇总你的工作台...
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="rounded-[28px] border border-[#FF5C7A]/30 bg-[#2A0B13]/72 p-6 text-[#FFB6C4]">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-5 w-5" />
          Dashboard 暂时无法加载
        </div>
        <p className="mt-2 text-sm leading-6">{error}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-5 rounded-full bg-[#F5F7FA] px-4 py-2 text-sm font-semibold text-[#050608]"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-7xl">
      <section className="relative overflow-hidden rounded-[34px] border border-[#2B313B] bg-[#111722]/90 p-7 shadow-[0_24px_90px_rgba(0,0,0,0.42)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-12 -top-20 h-72 w-72 rounded-full bg-[#28D7F5]/18 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-48 h-32 w-32 rounded-full bg-[#FFB454]/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-[#28D7F5]">Workspace Overview</p>
            <h2 className="mt-3 max-w-3xl text-4xl font-black tracking-[-0.055em] text-white">
              可以继续什么、可用额度多少、任务跑到哪，一眼看清。
            </h2>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-[#B8C0CC]">
              Dashboard 会同步公益额度、项目画布和最近生成记录，作为进入创作流程前的真实控制台。
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <a href="/generate" className="inline-flex items-center gap-2 rounded-full bg-[#F5F7FA] px-5 py-2.5 text-sm font-bold text-[#050608] shadow-[0_0_28px_rgba(245,247,250,0.16)] transition hover:bg-white">
              立即生成
              <Sparkles className="h-4 w-4" />
            </a>
            <QuickCreateCanvasButton className="inline-flex items-center gap-2 rounded-full border border-[#28D7F5]/40 bg-[#071F2A]/72 px-5 py-2.5 text-sm font-bold text-[#91F0FF] transition hover:border-[#28D7F5]/70 disabled:opacity-70">
              新建画布
              <ArrowRight className="h-4 w-4" />
            </QuickCreateCanvasButton>
            <a href="/gallery" className="inline-flex items-center gap-2 rounded-full border border-[#28D7F5]/40 bg-[#071F2A]/72 px-5 py-2.5 text-sm font-bold text-[#91F0FF] transition hover:border-[#28D7F5]/70">
              查看素材
              <ImageIcon className="h-4 w-4" />
            </a>
            <button
              type="button"
              onClick={refresh}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-4 py-2.5 text-sm font-semibold text-[#DDE5F2] transition hover:bg-white/[0.07] disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="mt-4 rounded-2xl border border-[#FFB454]/25 bg-[#2A1A08]/72 p-3 text-sm text-[#FFD9A0]">
          部分数据刷新失败：{error}
        </div>
      )}

      <section className="mt-5 grid gap-4 md:grid-cols-3">
        <StatCard
          label="可用额度"
          value={formatNumber(data?.quota?.totalAvailable)}
          detail="用于执行图片和视频生成任务"
        />
        <StatCard
          label="项目 / 画布"
          value={`${formatNumber(data?.projects.length)} / ${formatNumber(data?.canvases.length)}`}
          detail={latestCanvas ? `最近更新：${latestCanvas.projectName} / ${latestCanvas.name}` : "还没有服务端画布"}
        />
        <StatCard
          label="生成任务"
          value={formatNumber(data?.totalTasks)}
          detail={data?.activeTasks ? `${data.activeTasks} 个任务正在等待或生成` : "当前没有正在执行的任务"}
          tone="green"
        />
      </section>

      <section className="mt-5 grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="min-w-0 rounded-[30px] border border-[#2B313B] bg-[#0A0C11]/78 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#28D7F5]">Continue Work</p>
              <h3 className="mt-1 text-xl font-bold">最近画布</h3>
            </div>
            <a href="/canvas" className="shrink-0 text-sm font-semibold text-[#91F0FF] hover:text-white">全部画布</a>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {data?.canvases.slice(0, 4).map((canvas) => (
              <a
                key={canvas.id}
                href={`/canvas/editor?projectId=${encodeURIComponent(canvas.projectId)}&canvasId=${encodeURIComponent(canvas.id)}`}
                className="group min-w-0 rounded-[24px] border border-white/10 bg-white/[0.035] p-3 transition hover:border-[#28D7F5]/45 hover:bg-[#101A27]"
              >
                <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-[#050608]">
                  {canvas.thumbnailUrl ? (
                    <img src={canvas.thumbnailUrl} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <Layers3 className="h-7 w-7 text-[#3C4654]" />
                  )}
                </div>
                <div className="mt-3 truncate font-semibold text-[#F5F7FA] group-hover:text-white">{canvas.name}</div>
                <div className="mt-1 truncate text-xs text-[#788493]">{canvas.projectName} · 更新于 {formatDate(canvas.updatedAt)}</div>
              </a>
            ))}

            {data?.canvases.length === 0 && (
              <div className="rounded-[24px] border border-dashed border-white/15 bg-white/[0.025] p-8 text-center sm:col-span-2">
                <Sparkles className="mx-auto h-8 w-8 text-[#28D7F5]" />
                <h4 className="mt-3 font-semibold text-white">还没有保存的画布</h4>
                <p className="mt-2 text-sm leading-6 text-[#B8C0CC]">创建第一个项目画布后，这里会变成你的继续创作入口。</p>
                <a href="/canvas" className="mt-4 inline-flex rounded-full bg-[#F5F7FA] px-4 py-2 text-sm font-semibold text-[#050608]">去创建</a>
              </div>
            )}
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <div className="rounded-[30px] border border-[#2B313B] bg-[#14171D]/86 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#FFB454]">Shortcuts</p>
                <h3 className="mt-1 text-xl font-bold">常用入口</h3>
              </div>
              <Sparkles className="h-5 w-5 text-[#FFCF7A]" />
            </div>
            <div className="mt-5 grid gap-2">
              <a href="/generate" className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm font-semibold text-[#F5F7FA] transition hover:border-[#28D7F5]/45 hover:bg-white/[0.07]">
                图片生成工作台
              </a>
              <QuickCreateCanvasButton className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-left text-sm font-semibold text-[#F5F7FA] transition hover:border-[#28D7F5]/45 hover:bg-white/[0.07] disabled:opacity-70">
                打开空白画布
              </QuickCreateCanvasButton>
              <a href="/canvas" className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm font-semibold text-[#F5F7FA] transition hover:border-[#28D7F5]/45 hover:bg-white/[0.07]">
                管理项目和画布
              </a>
              <a href="/gallery" className="rounded-2xl border border-white/10 bg-white/[0.035] p-3 text-sm font-semibold text-[#F5F7FA] transition hover:border-[#28D7F5]/45 hover:bg-white/[0.07]">
                查看生成素材
              </a>
            </div>
          </div>

          <div className="rounded-[30px] border border-[#2B313B] bg-[#0A0C11]/78 p-5 shadow-[0_24px_80px_rgba(0,0,0,0.28)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#28D7F5]">Recent Generations</p>
                <h3 className="mt-1 text-xl font-bold">最近任务</h3>
              </div>
              <a href="/gallery" className="text-sm font-semibold text-[#91F0FF] hover:text-white">素材库</a>
            </div>

            <div className="mt-5 space-y-2">
              {data?.recentTasks.map((task) => (
                <div key={task.id} className="rounded-2xl border border-white/10 bg-white/[0.035] p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-semibold text-[#F5F7FA]">{getTaskTitle(task)}</div>
                    <span className={task.status === "success" ? "shrink-0 text-xs text-[#7DFFB2]" : "shrink-0 text-xs text-[#FFCF7A]"}>
                      {statusLabels[task.status] || task.status}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-[#788493]">
                    {taskTypeLabels[task.taskType] || task.taskType} · {formatDate(task.completedAt || task.createdAt)}
                  </div>
                </div>
              ))}

              {data?.recentTasks.length === 0 && (
                <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.025] p-6 text-sm leading-6 text-[#B8C0CC]">
                  暂无生成记录。完成一次文生图或图生视频任务后，这里会展示最近结果。
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {latestTask && latestTask.status !== "success" && (
        <section className="mt-5 rounded-[24px] border border-[#FFB454]/25 bg-[#211707]/72 p-4 text-sm text-[#FFD9A0]">
          最近任务「{getTaskTitle(latestTask)}」当前状态为 {statusLabels[latestTask.status] || latestTask.status}，可到素材库查看详情或回到对应画布继续处理。
        </section>
      )}
    </div>
  );
}
