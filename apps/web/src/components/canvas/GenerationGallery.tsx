import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { Loader2, Pin, RefreshCw, X } from "lucide-react";
import { AssetCard, type AssetGalleryItem, type AssetPreviewPayload } from "./AssetCard";
import { PreviewOverlay } from "./PreviewOverlay";

const API_BASE = import.meta.env.PUBLIC_API_URL || "http://localhost:8787";
const PAGE_SIZE = 48;

interface CanvasProject {
  id: string;
  name: string;
}

interface ProjectCanvas {
  id: string;
  projectId: string;
  name: string;
}

interface GalleryResponse {
  items: AssetGalleryItem[];
  total: number;
  limit: number;
  offset: number;
}

interface GenerationGalleryProps {
  mode?: "page" | "panel";
  projectId?: string | null;
  canvasId?: string | null;
  pinned?: boolean;
  onPinnedChange?: (pinned: boolean) => void;
  onClose?: () => void;
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || (res.status === 401 ? "请先登录后查看素材" : `请求失败：${res.status}`));
  }
  return (await res.json()) as T;
}

function buildTasksUrl(params: {
  projectId?: string | null;
  canvasId?: string | null;
  status?: string;
  offset: number;
}) {
  const query = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(params.offset),
  });
  if (params.projectId) query.set("projectId", params.projectId);
  if (params.canvasId) query.set("canvasId", params.canvasId);
  if (params.status) query.set("status", params.status);
  return `${API_BASE}/api/canvas/tasks?${query.toString()}`;
}

function explodeTaskItems(items: AssetGalleryItem[]): AssetGalleryItem[] {
  return items.flatMap((item) => {
    if (item.outputUrls.length <= 1) return [item];

    return item.outputUrls.map((url, index) => ({
      ...item,
      id: `${item.id}:${index}`,
      outputUrls: [url],
      assets: item.assets[index] ? [item.assets[index]] : [],
    }));
  });
}

export function GenerationGallery({
  mode = "page",
  projectId,
  canvasId,
  pinned = false,
  onPinnedChange,
  onClose,
}: GenerationGalleryProps): ReactElement {
  const isPanel = mode === "panel";
  const [projects, setProjects] = useState<CanvasProject[]>([]);
  const [canvases, setCanvases] = useState<ProjectCanvas[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState(projectId || "");
  const [selectedCanvasId, setSelectedCanvasId] = useState(canvasId || "");
  const [status, setStatus] = useState("success");
  const [items, setItems] = useState<AssetGalleryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<AssetPreviewPayload | null>(null);

  const projectNameById = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects]
  );
  const canvasNameById = useMemo(
    () => new Map(canvases.map((canvas) => [canvas.id, canvas.name])),
    [canvases]
  );
  const visibleCanvases = selectedProjectId
    ? canvases.filter((canvas) => canvas.projectId === selectedProjectId)
    : canvases;
  const effectiveProjectId = isPanel ? projectId || "" : selectedProjectId;
  const effectiveCanvasId = isPanel ? canvasId || "" : selectedCanvasId;
  const canQuery = !isPanel || Boolean(effectiveCanvasId);

  const loadProjectIndex = useCallback(async () => {
    if (isPanel) return;
    const projectData = await fetchJson<{ projects: CanvasProject[] }>(`${API_BASE}/api/canvas/projects`);
    setProjects(projectData.projects);
    const canvasGroups = await Promise.all(
      projectData.projects.map((project) =>
        fetchJson<{ canvases: ProjectCanvas[] }>(`${API_BASE}/api/canvas/projects/${project.id}/canvases`)
          .then((data) => data.canvases)
          .catch(() => [])
      )
    );
    setCanvases(canvasGroups.flat());
  }, [isPanel]);

  const loadItems = useCallback(
    async (offset = 0) => {
      if (!canQuery) return;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const data = await fetchJson<GalleryResponse>(
          buildTasksUrl({
            projectId: effectiveProjectId,
            canvasId: effectiveCanvasId,
            status,
            offset,
          })
        );
        setTotal(data.total);
        setItems((current) => (offset === 0 ? data.items : [...current, ...data.items]));
      } catch (err) {
        setError(err instanceof Error ? err.message : "素材加载失败");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [canQuery, effectiveCanvasId, effectiveProjectId, status]
  );

  useEffect(() => {
    void loadProjectIndex().catch((err) => {
      setError(err instanceof Error ? err.message : "项目索引加载失败");
    });
  }, [loadProjectIndex]);

  useEffect(() => {
    setSelectedProjectId(projectId || "");
  }, [projectId]);

  useEffect(() => {
    setSelectedCanvasId(canvasId || "");
  }, [canvasId]);

  useEffect(() => {
    void loadItems(0);
  }, [loadItems]);

  useEffect(() => {
    if (!selectedProjectId) return;
    if (selectedCanvasId && !visibleCanvases.some((canvas) => canvas.id === selectedCanvasId)) {
      setSelectedCanvasId("");
    }
  }, [selectedCanvasId, selectedProjectId, visibleCanvases]);

  const hasMore = items.length < total;
  const assetItems = useMemo(() => explodeTaskItems(items), [items]);

  return (
    <section className={isPanel ? "flex h-full flex-col text-[#F5F7FA]" : "text-[#F5F7FA]"}>
      <div className={isPanel ? "border-b border-white/10 p-4" : "mb-6"}>
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            {isPanel && onPinnedChange && (
              <button
                type="button"
                onClick={() => onPinnedChange(!pinned)}
                aria-pressed={pinned}
                title={pinned ? "已固定：点击画布不会关闭" : "固定素材面板"}
                className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition ${
                  pinned
                    ? "border-[#28D7F5]/55 bg-[#071F2A] text-[#91F0FF] shadow-[0_0_22px_rgba(40,215,245,0.18)]"
                    : "border-white/10 bg-white/[0.035] text-[#9AA6B7] hover:border-[#28D7F5]/45 hover:text-[#91F0FF]"
                }`}
              >
                <Pin className="h-4 w-4" />
              </button>
            )}
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#28D7F5]">Generation Gallery</p>
              <h2 className={isPanel ? "mt-1 text-xl font-bold" : "mt-2 text-4xl font-bold tracking-[-0.05em]"}>
                {isPanel ? "当前画布素材" : "所有生成素材"}
              </h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-[#B8C0CC]">
                {isPanel ? "只展示当前画布保存过的生成结果。" : "跨项目、跨画布查看结果图、提示词和生成参数。"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => loadItems(0)}
              disabled={loading || !canQuery}
              className="flex min-h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-[#DDE5F2] transition hover:border-[#28D7F5]/45 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
              刷新
            </button>
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.035] text-[#DDE5F2] transition hover:bg-white/[0.08]"
                aria-label="关闭素材面板"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {!isPanel && (
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            <select
              value={selectedProjectId}
              onChange={(event) => {
                setSelectedProjectId(event.target.value);
                setSelectedCanvasId("");
              }}
              className="min-h-11 rounded-2xl border border-white/10 bg-[#0A0C11]/82 px-3 text-sm text-[#F5F7FA] outline-none focus:border-[#28D7F5]"
            >
              <option value="">全部项目</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </select>
            <select
              value={selectedCanvasId}
              onChange={(event) => setSelectedCanvasId(event.target.value)}
              className="min-h-11 rounded-2xl border border-white/10 bg-[#0A0C11]/82 px-3 text-sm text-[#F5F7FA] outline-none focus:border-[#28D7F5]"
            >
              <option value="">全部画布</option>
              {visibleCanvases.map((canvas) => (
                <option key={canvas.id} value={canvas.id}>{canvas.name}</option>
              ))}
            </select>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="min-h-11 rounded-2xl border border-white/10 bg-[#0A0C11]/82 px-3 text-sm text-[#F5F7FA] outline-none focus:border-[#28D7F5]"
            >
              <option value="success">仅成功</option>
              <option value="">全部状态</option>
              <option value="failed">失败</option>
              <option value="cancelled">已取消</option>
            </select>
          </div>
        )}
      </div>

      {!canQuery ? (
        <div className="rounded-[24px] border border-dashed border-white/15 bg-white/[0.025] p-8 text-center text-sm leading-6 text-[#B8C0CC]">
          当前画布还没有服务端 ID。保存或打开一个已创建画布后，会在这里展示该画布的生成结果。
        </div>
      ) : error ? (
        <div className="rounded-[24px] border border-[#FF5C7A]/30 bg-[#2A0B13]/72 p-4 text-sm text-[#FFB6C4]">{error}</div>
      ) : (
        <div className={isPanel ? "min-h-0 flex-1 overflow-y-auto p-4" : ""}>
          {loading && items.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center rounded-[28px] border border-white/10 bg-[#0A0C11]/72 text-sm text-[#B8C0CC]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载素材...
            </div>
          ) : assetItems.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-white/15 bg-white/[0.025] p-10 text-center text-sm leading-6 text-[#B8C0CC]">
              暂无生成素材。完成一次图片生成后，这里会自动出现结果图和提示词。
            </div>
          ) : (
            <>
              <div className={isPanel ? "grid grid-cols-4 gap-3" : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}>
                {assetItems.map((item) => (
                  <AssetCard
                    key={item.id}
                    item={item}
                    compact={isPanel}
                    onPreview={setPreview}
                    projectName={!isPanel ? projectNameById.get(item.projectId) : undefined}
                    canvasName={!isPanel && item.canvasId ? canvasNameById.get(item.canvasId) : undefined}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="mt-6 flex justify-center">
                  <button
                    type="button"
                    onClick={() => loadItems(items.length)}
                    disabled={loadingMore}
                    className="flex min-h-10 items-center gap-2 rounded-full border border-[#28D7F5]/35 bg-[#071F2A]/72 px-5 text-sm font-semibold text-[#91F0FF] transition hover:border-[#28D7F5]/70 hover:bg-[#0A2A38] disabled:opacity-50"
                  >
                    {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                    加载更多 {items.length}/{total}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {preview && <PreviewOverlay image={preview} onClose={() => setPreview(null)} />}
    </section>
  );
}
