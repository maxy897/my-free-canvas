import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  AlertCircle,
  CheckCircle,
  CheckCircle2,
  ChevronDown,
  Download,
  Image as ImageIcon,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { getAssetThumbnailUrl, type AssetGalleryItem } from "./AssetCard";
import { PromptTemplatePicker } from "./PromptTemplatePicker";
import {
  cancelCanvasTask,
  getCanvasTaskOutputUrls,
  startCanvasTaskSubscription,
  type CanvasTaskSubscription,
  submitCanvasTask,
  type GenerationOutput,
} from "./lib/canvas-task-client";

const API_BASE = import.meta.env.PUBLIC_API_URL || "http://localhost:8787";
const MAX_REFERENCE_IMAGES = 14;
const LIBRARY_PAGE_SIZE = 48;
const HISTORY_PAGE_SIZE = 10;
const HISTORY_ASSET_DRAG_TYPE = "application/x-free-canvas-history-asset";

const RESOLUTION_OPTIONS = [
  { value: "1080p", label: "1080p" },
  { value: "2k", label: "2k" },
  { value: "4k", label: "4k" },
];

const SIZE_OPTIONS = [
  { value: "auto", label: "auto" },
  { value: "1:1", label: "1:1" },
  { value: "3:2", label: "3:2" },
  { value: "2:3", label: "2:3" },
  { value: "16:9", label: "16:9" },
  { value: "21:9", label: "21:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
];

const COUNT_OPTIONS = ["1", "2", "3", "4"];
const DEFAULT_MODEL = "gpt-image-2";
const TXT2IMG_PREFERENCES_STORAGE_KEY = "free-canvas:txt2img-preferences";
const VALID_RESOLUTIONS = new Set(RESOLUTION_OPTIONS.map((option) => option.value));
const VALID_SIZES = new Set(SIZE_OPTIONS.map((option) => option.value));
const VALID_COUNTS = new Set(COUNT_OPTIONS);

interface UploadResult {
  url: string;
  title?: string;
  width?: string;
  height?: string;
  size?: string;
  downloadUrl?: string;
}

interface ReferenceImage {
  id: string;
  name: string;
  previewUrl: string;
  uploadUrl?: string;
  source: "upload" | "library";
  status: "uploading" | "ready" | "failed";
  error?: string;
}

interface LibraryResponse {
  items: AssetGalleryItem[];
  total: number;
  limit: number;
  offset: number;
}

interface HistoryAssetDragPayload {
  id: string;
  url: string;
  thumbnailUrl?: string;
  prompt?: string;
}

interface SelectControlProps {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function makeLocalId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function explodeLibraryItems(items: AssetGalleryItem[]): AssetGalleryItem[] {
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

function readErrorMessage(errorData: unknown, fallback: string) {
  if (!errorData || typeof errorData !== "object") return fallback;
  const record = errorData as Record<string, unknown>;
  return [record.error, record.detail]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(": ") || fallback;
}

function readGenerationPreferences() {
  if (typeof window === "undefined") {
    return { resolution: "1080p", size: "auto", count: "1" };
  }

  try {
    const stored = window.localStorage.getItem(TXT2IMG_PREFERENCES_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) as Record<string, unknown> : {};
    const resolution = typeof parsed.image_resolution === "string" && VALID_RESOLUTIONS.has(parsed.image_resolution)
      ? parsed.image_resolution
      : "1080p";
    const size = typeof parsed.size === "string" && VALID_SIZES.has(parsed.size)
      ? parsed.size
      : "auto";
    const rawCount = typeof parsed.n === "number" ? String(parsed.n) : typeof parsed.n === "string" ? parsed.n : "1";
    const count = VALID_COUNTS.has(rawCount) ? rawCount : "1";

    return { resolution, size, count };
  } catch {
    return { resolution: "1080p", size: "auto", count: "1" };
  }
}

function persistGenerationPreferences(preferences: { resolution: string; size: string; count: string }) {
  if (typeof window === "undefined") return;

  try {
    const stored = window.localStorage.getItem(TXT2IMG_PREFERENCES_STORAGE_KEY);
    const parsed = stored ? JSON.parse(stored) as Record<string, unknown> : {};
    window.localStorage.setItem(
      TXT2IMG_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        ...parsed,
        image_resolution: preferences.resolution,
        size: preferences.size,
        n: Number(preferences.count),
      })
    );
  } catch {
    // localStorage may be unavailable in private browsing or restricted contexts.
  }
}

async function uploadReferenceImage(file: File): Promise<UploadResult> {
  const formData = new FormData();
  formData.set("file", file);

  const response = await fetch(`${API_BASE}/api/canvas/files/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(readErrorMessage(errorData, response.status === 401 ? "请先登录后上传图片" : "参考图上传失败"));
  }

  return response.json() as Promise<UploadResult>;
}

function SelectControl({ label, value, options, onChange }: SelectControlProps) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-semibold text-[#F5F7FA]">{label}</span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-12 w-full appearance-none rounded-2xl border border-white/10 bg-[#050608] px-4 pr-10 text-base font-semibold text-[#F5F7FA] outline-none transition focus:border-[#28D7F5] focus:ring-2 focus:ring-[#28D7F5]/20"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA6B7]" />
      </span>
    </label>
  );
}

export function FormImageGenerator() {
  const [resolution, setResolution] = useState(() => readGenerationPreferences().resolution);
  const [size, setSize] = useState(() => readGenerationPreferences().size);
  const [count, setCount] = useState(() => readGenerationPreferences().count);
  const [prompt, setPrompt] = useState("");
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<"idle" | "pending" | "running" | "success" | "failed" | "cancelled">("idle");
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<GenerationOutput | null>(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryItems, setLibraryItems] = useState<AssetGalleryItem[]>([]);
  const [libraryTotal, setLibraryTotal] = useState(0);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryLoadingMore, setLibraryLoadingMore] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [historyItems, setHistoryItems] = useState<AssetGalleryItem[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyOffset, setHistoryOffset] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [referenceDragActive, setReferenceDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const taskSubscriptionRef = useRef<CanvasTaskSubscription | null>(null);
  const referencesRef = useRef<ReferenceImage[]>([]);

  const isBusy = taskStatus === "pending" || taskStatus === "running";
  const readyReferences = references.filter((item) => item.status === "ready" && item.uploadUrl);
  const hasUploadingReference = references.some((item) => item.status === "uploading");
  const resultUrls = useMemo(() => getCanvasTaskOutputUrls(output), [output]);
  const selectedReferenceUrls = useMemo(
    () => new Set(references.map((item) => item.uploadUrl).filter((url): url is string => Boolean(url))),
    [references]
  );
  const explodedLibraryItems = useMemo(() => explodeLibraryItems(libraryItems), [libraryItems]);
  const historyAssets = useMemo(() => explodeLibraryItems(historyItems), [historyItems]);
  const canPageHistoryBack = historyOffset > 0;
  const canPageHistoryForward = historyOffset + HISTORY_PAGE_SIZE < historyTotal;
  const canGenerate = prompt.trim().length > 0 && !isBusy && !hasUploadingReference;

  const stopListening = useCallback(() => {
    taskSubscriptionRef.current?.stop();
    taskSubscriptionRef.current = null;
  }, []);

  useEffect(() => {
    referencesRef.current = references;
  }, [references]);

  useEffect(() => {
    persistGenerationPreferences({ resolution, size, count });
  }, [resolution, size, count]);

  useEffect(() => {
    return () => {
      taskSubscriptionRef.current?.stop();
      referencesRef.current.forEach((item) => {
        if (item.source === "upload") URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  const loadLibraryItems = useCallback(async (offset = 0) => {
    if (offset === 0) setLibraryLoading(true);
    else setLibraryLoadingMore(true);
    setLibraryError(null);

    try {
      const query = new URLSearchParams({
        limit: String(LIBRARY_PAGE_SIZE),
        offset: String(offset),
        status: "success",
      });
      const response = await fetch(`${API_BASE}/api/canvas/tasks?${query.toString()}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(readErrorMessage(errorData, response.status === 401 ? "请先登录后查看素材库" : "素材库加载失败"));
      }

      const data = await response.json() as LibraryResponse;
      setLibraryTotal(data.total);
      setLibraryItems((current) => offset === 0 ? data.items : [...current, ...data.items]);
    } catch (err) {
      setLibraryError(err instanceof Error ? err.message : "素材库加载失败");
    } finally {
      setLibraryLoading(false);
      setLibraryLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (libraryOpen && libraryItems.length === 0 && !libraryLoading) {
      void loadLibraryItems(0);
    }
  }, [libraryItems.length, libraryLoading, libraryOpen, loadLibraryItems]);

  const loadHistoryItems = useCallback(async (offset = 0) => {
    setHistoryLoading(true);
    setHistoryError(null);

    try {
      const query = new URLSearchParams({
        limit: String(HISTORY_PAGE_SIZE),
        offset: String(offset),
        status: "success",
        projectId: "local",
      });
      const response = await fetch(`${API_BASE}/api/canvas/tasks?${query.toString()}`, {
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(readErrorMessage(errorData, response.status === 401 ? "请先登录后查看历史素材" : "历史素材加载失败"));
      }

      const data = await response.json() as LibraryResponse;
      setHistoryTotal(data.total);
      setHistoryOffset(offset);
      setHistoryItems(data.items);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : "历史素材加载失败");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadHistoryItems(0);
  }, [loadHistoryItems]);

  const applyTaskUpdate = useCallback((status: string, nextOutput?: GenerationOutput | null, errorMessage?: string) => {
    if (status === "success") {
      setTaskStatus("success");
      setOutput(nextOutput ?? null);
      setError(null);
      stopListening();
      void loadHistoryItems(0);
      return true;
    }
    if (status === "failed" || status === "cancelled") {
      setTaskStatus(status);
      setError(errorMessage || (status === "cancelled" ? "任务已取消" : "生成失败，请稍后重试"));
      stopListening();
      return true;
    }
    if (status === "running" || status === "pending") {
      setTaskStatus(status);
    }
    return false;
  }, [loadHistoryItems, stopListening]);

  const startListening = useCallback((id: string) => {
    stopListening();
    taskSubscriptionRef.current = startCanvasTaskSubscription(id, {
      onUpdate: (update) => {
        applyTaskUpdate(update.status, update.outputData, update.errorMessage);
      },
      onError: (err, source) => {
        if (source === "sse") {
          console.warn("Task SSE connection failed, falling back to polling", err);
          return;
        }
        setError(err instanceof Error ? err.message : "任务状态查询失败");
      },
    });
  }, [applyTaskUpdate, stopListening]);

  const handleFiles = useCallback((files: FileList | File[]) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const availableSlots = Math.max(0, MAX_REFERENCE_IMAGES - references.length);
    const selectedFiles = imageFiles.slice(0, availableSlots);
    if (selectedFiles.length === 0) return;

    const nextReferences = selectedFiles.map<ReferenceImage>((file) => ({
      id: makeLocalId(),
      name: file.name || "reference-image",
      previewUrl: URL.createObjectURL(file),
      source: "upload",
      status: "uploading",
    }));

    setReferences((current) => [...current, ...nextReferences]);

    for (const [index, file] of selectedFiles.entries()) {
      const referenceId = nextReferences[index].id;
      void uploadReferenceImage(file)
        .then((result) => {
          setReferences((current) =>
            current.map((item) =>
              item.id === referenceId
                ? { ...item, uploadUrl: result.url, status: "ready" }
                : item
            )
          );
        })
        .catch((err) => {
          setReferences((current) =>
            current.map((item) =>
              item.id === referenceId
                ? {
                    ...item,
                    status: "failed",
                    error: err instanceof Error ? err.message : "参考图上传失败",
                  }
                : item
            )
          );
        });
    }
  }, [references.length]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files) handleFiles(event.target.files);
    event.target.value = "";
  };

  const removeReference = (id: string) => {
    setReferences((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.source === "upload") URL.revokeObjectURL(target.previewUrl);
      return current.filter((item) => item.id !== id);
    });
  };

  const addLibraryReference = (item: AssetGalleryItem) => {
    const url = item.outputUrls[0];
    if (!url || selectedReferenceUrls.has(url) || references.length >= MAX_REFERENCE_IMAGES) return;

    const thumbnailUrl = getAssetThumbnailUrl(item);
    setReferences((current) => [
      ...current,
      {
        id: `library-${item.id}`,
        name: item.prompt || "素材库图片",
        previewUrl: thumbnailUrl || url,
        uploadUrl: url,
        source: "library",
        status: "ready",
      },
    ]);
  };

  const addReferenceFromHistoryAsset = (asset: HistoryAssetDragPayload) => {
    if (!asset.url || selectedReferenceUrls.has(asset.url) || references.length >= MAX_REFERENCE_IMAGES) return;

    setReferences((current) => [
      ...current,
      {
        id: `history-${asset.id}`,
        name: asset.prompt || "历史素材",
        previewUrl: asset.thumbnailUrl || asset.url,
        uploadUrl: asset.url,
        source: "library",
        status: "ready",
      },
    ]);
  };

  const isReferenceDrag = (event: DragEvent<HTMLElement>) =>
    Array.from(event.dataTransfer.types).includes(HISTORY_ASSET_DRAG_TYPE) ||
    Array.from(event.dataTransfer.types).includes("Files");

  const handleReferenceDrop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setReferenceDragActive(false);
    const historyPayload = event.dataTransfer.getData(HISTORY_ASSET_DRAG_TYPE);
    if (historyPayload) {
      try {
        addReferenceFromHistoryAsset(JSON.parse(historyPayload) as HistoryAssetDragPayload);
        return;
      } catch {
        // Fall back to normal file handling below.
      }
    }

    if (event.dataTransfer.files.length > 0) {
      handleFiles(event.dataTransfer.files);
    }
  };

  const submitTask = async () => {
    if (!canGenerate) return;

    stopListening();
    setTaskStatus("pending");
    setTaskId(null);
    setOutput(null);
    setError(null);

    const referenceUrls = readyReferences
      .map((item) => item.uploadUrl)
      .filter((url): url is string => Boolean(url));
    const taskType = referenceUrls.length > 0 ? "img2img" : "txt2img";

    try {
      const data = await submitCanvasTask({
        projectId: "local",
        canvasId: null,
        nodeId: `form-${makeLocalId()}`,
        taskType,
        inputParams: {
          prompt: prompt.trim(),
          model: DEFAULT_MODEL,
          image_resolution: resolution,
          size,
          n: Number(count),
          output_format: "png",
          ...(referenceUrls.length > 0
            ? {
                image_url: referenceUrls[0],
                referenceImages: referenceUrls,
              }
            : {}),
        },
      });
      setTaskId(data.taskId);
      setTaskStatus("running");
      startListening(data.taskId);
    } catch (err) {
      setTaskStatus("failed");
      setError(err instanceof Error ? err.message : "任务提交失败");
    }
  };

  const cancelTask = async () => {
    if (!taskId) return;
    try {
      await cancelCanvasTask(taskId);
      setTaskStatus("cancelled");
      setError("任务已取消");
      stopListening();
    } catch {
      setError("取消任务失败，请稍后重试");
    }
  };

  return (
    <section className="mx-auto flex min-h-[calc(100vh-7rem)] w-full max-w-6xl flex-col gap-6 pb-28 text-[#F5F7FA] lg:grid lg:grid-cols-[minmax(0,1fr)_420px] lg:pb-8">
      <div className="space-y-6">
        <div className="rounded-[28px] border border-white/10 bg-[#0A0C11]/82 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl sm:p-6">
          <div className="mb-6">
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[#28D7F5]">Image Studio</p>
            <h2 className="mt-2 text-2xl font-black tracking-[-0.04em] sm:text-4xl">图片生成工作台</h2>
            <p className="mt-2 text-sm leading-6 text-[#B8C0CC]">
              不需要拖动画布，手机上也可以直接上传参考图、填写提示词并生成图片。
            </p>
          </div>

          <div className="space-y-5">
            <div
              onDragEnter={(event) => {
                if (!isReferenceDrag(event)) return;
                event.preventDefault();
                setReferenceDragActive(true);
              }}
              onDragOver={(event) => {
                if (!isReferenceDrag(event)) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "copy";
                setReferenceDragActive(true);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  setReferenceDragActive(false);
                }
              }}
              onDrop={handleReferenceDrop}
              className={`rounded-3xl border p-2 transition ${
                referenceDragActive
                  ? "border-[#28D7F5]/80 bg-[#071F2A]/72 shadow-[0_0_32px_rgba(40,215,245,0.18)]"
                  : "border-transparent"
              }`}
            >
              <div className="mb-2 flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">参考图</h3>
                  <p className="mt-1 text-xs text-[#788493]">
                    最多支持 {MAX_REFERENCE_IMAGES} 张。可本地上传，也可将右侧历史素材拖入这里。
                  </p>
                </div>
                {references.length > 0 && (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setLibraryOpen(true)}
                      disabled={references.length >= MAX_REFERENCE_IMAGES}
                      className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-[#DDE5F2] transition hover:border-[#28D7F5]/45 hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <ImageIcon className="h-3.5 w-3.5" />
                      素材库
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={references.length >= MAX_REFERENCE_IMAGES}
                      className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-[#28D7F5]/35 bg-[#071F2A]/72 px-3 text-xs font-semibold text-[#91F0FF] transition hover:border-[#28D7F5]/70 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      上传
                    </button>
                  </div>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp,image/*"
                multiple
                className="hidden"
                onChange={handleFileChange}
              />

              {references.length === 0 ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex min-h-40 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.04] px-4 text-center transition hover:border-[#28D7F5]/50 hover:bg-[#071F2A]/50"
                  >
                    <Upload className="mb-3 h-8 w-8 text-[#F5F7FA]" />
                    <span className="text-base font-bold">本地上传</span>
                    <span className="mt-2 text-sm text-[#788493]">点击/拖拽 JPEG、PNG 图片</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setLibraryOpen(true)}
                    className="flex min-h-40 w-full cursor-pointer flex-col items-center justify-center rounded-2xl border border-white/10 bg-white/[0.04] px-4 text-center transition hover:border-[#28D7F5]/50 hover:bg-[#071F2A]/50"
                  >
                    <ImageIcon className="mb-3 h-8 w-8 text-[#F5F7FA]" />
                    <span className="text-base font-bold">从素材库选择</span>
                    <span className="mt-2 text-sm text-[#788493]">使用已生成图片作为参考</span>
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {references.map((item) => (
                    <div key={item.id} className="group relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
                      <img src={item.previewUrl} alt={item.name} className="h-full w-full object-contain" />
                      <button
                        type="button"
                        onClick={() => removeReference(item.id)}
                        className="absolute right-1.5 top-1.5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/70 text-white opacity-100 backdrop-blur transition hover:bg-[#FF5C7A] sm:opacity-0 sm:group-hover:opacity-100"
                        aria-label="移除参考图"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      {item.status !== "ready" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/72 p-2 text-center text-xs">
                          {item.status === "uploading" ? (
                            <>
                              <Loader2 className="mb-2 h-5 w-5 animate-spin text-[#28D7F5]" />
                              上传中
                            </>
                          ) : (
                            <>
                              <AlertCircle className="mb-2 h-5 w-5 text-[#FF9AAD]" />
                              <span className="line-clamp-2 text-[#FFB6C4]">{item.error || "上传失败"}</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {referenceDragActive && (
                <div className="mt-3 rounded-2xl border border-[#28D7F5]/45 bg-[#071F2A]/80 px-4 py-3 text-center text-sm font-semibold text-[#91F0FF]">
                  松手即可添加为参考图
                </div>
              )}
            </div>

            <label className="block">
              <span className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">提示词</span>
                <button
                  type="button"
                  onClick={() => setTemplatePickerOpen(true)}
                  className="flex items-center gap-1 rounded-full border border-[#28D7F5]/40 bg-[#28D7F5]/10 px-3 py-1 text-xs font-semibold text-[#91F0FF] transition hover:bg-[#28D7F5]/20"
                >
                  <Sparkles className="h-3 w-3" /> 提示词模板
                </button>
              </span>
              <textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="描述你想生成的图片"
                rows={8}
                className="min-h-60 w-full resize-y rounded-2xl border border-white/10 bg-[#050608] px-4 py-4 text-base leading-7 text-[#F5F7FA] outline-none transition placeholder:text-[#4E5664] focus:border-[#28D7F5] focus:ring-2 focus:ring-[#28D7F5]/20"
              />
            </label>
            <PromptTemplatePicker
              open={templatePickerOpen}
              onClose={() => setTemplatePickerOpen(false)}
              onSelect={(content) => setPrompt(content)}
            />
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 rounded-[28px] border border-white/10 bg-[#0A0C11]/82 p-3 backdrop-blur-xl">
          <SelectControl label="Resolution" value={resolution} options={RESOLUTION_OPTIONS} onChange={setResolution} />
          <SelectControl label="Size" value={size} options={SIZE_OPTIONS} onChange={setSize} />
          <label className="block">
            <span className="mb-2 block text-sm font-semibold text-[#F5F7FA]">Count</span>
            <span className="relative block">
              <select
                value={count}
                onChange={(event) => setCount(event.target.value)}
                className="h-12 w-full appearance-none rounded-2xl border border-white/10 bg-[#050608] px-4 pr-10 text-base font-semibold text-[#F5F7FA] outline-none transition focus:border-[#28D7F5] focus:ring-2 focus:ring-[#28D7F5]/20"
              >
                {COUNT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    x{option}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9AA6B7]" />
            </span>
          </label>
        </div>
      </div>

      <aside className="rounded-[28px] border border-white/10 bg-[#0A0C11]/82 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.35)] backdrop-blur-xl lg:sticky lg:top-24 lg:h-fit">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#28D7F5]">Result</p>
            <h3 className="mt-1 text-xl font-bold">生成结果</h3>
          </div>
          {taskStatus === "success" && (
            <span className="inline-flex items-center gap-1 rounded-full border border-[#39E58C]/25 bg-[#39E58C]/10 px-3 py-1 text-xs font-semibold text-[#9FF6C3]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              完成
            </span>
          )}
        </div>

        <div className="mt-4">
          {isBusy ? (
            <div className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-[#8B5CF6]/20 bg-gradient-to-br from-[#1E1B4B]/80 via-[#312E81]/72 to-[#071F2A]/72 p-6 text-center">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[#8B5CF6]/25">
                <span className="absolute inset-0 animate-ping rounded-full bg-[#8B5CF6]/20" />
                <Sparkles className="relative h-7 w-7 text-[#C4B5FD]" />
              </div>
              <p className="mt-4 text-base font-bold">{taskStatus === "pending" ? "正在提交任务..." : "正在生成图片..."}</p>
              <p className="mt-2 text-sm leading-6 text-[#B8C0CC]">可以保持页面打开，生成完成后会自动展示。</p>
            </div>
          ) : resultUrls.length > 0 ? (
            <div className="grid gap-3">
              {resultUrls.map((url, index) => (
                <figure key={`${url}-${index}`} className="overflow-hidden rounded-3xl border border-white/10 bg-black/40">
                  <img src={url} alt={`生成结果 ${index + 1}`} className="aspect-square w-full object-contain" referrerPolicy="no-referrer" />
                  <figcaption className="flex items-center justify-between gap-3 px-3 py-3">
                    <span className="text-xs text-[#9AA6B7]">Result {index + 1}</span>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-full bg-white px-3 text-xs font-bold text-[#050608] transition hover:bg-[#DDE5F2]"
                    >
                      <Download className="h-3.5 w-3.5" />
                      打开
                    </a>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : (
            <div className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.025] p-6 text-center">
              <ImageIcon className="mb-3 h-10 w-10 text-[#4E5664]" />
              <p className="text-base font-bold">结果会显示在这里</p>
              <p className="mt-2 text-sm leading-6 text-[#788493]">填写提示词后点击“立即生成”。</p>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-4 rounded-2xl border border-[#FF5C7A]/30 bg-[#2A0B13]/72 p-3 text-sm leading-6 text-[#FFB6C4]">
            {error}
          </div>
        )}

        {taskId && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-white/[0.035] px-3 py-2 text-xs text-[#788493]">
            Task ID: {taskId}
          </div>
        )}

        <div className="mt-6 border-t border-white/10 pt-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#28D7F5]">History</p>
              <h4 className="mt-1 text-base font-bold">工作台历史素材</h4>
              {historyTotal > 0 && (
                <p className="mt-1 text-xs text-[#788493]">
                  {historyOffset + 1}-{Math.min(historyOffset + HISTORY_PAGE_SIZE, historyTotal)} / {historyTotal}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => loadHistoryItems(historyOffset)}
              disabled={historyLoading}
              className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.035] text-[#DDE5F2] transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="刷新历史素材"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${historyLoading ? "animate-spin" : ""}`} />
            </button>
          </div>

          {historyError ? (
            <div className="rounded-2xl border border-[#FF5C7A]/30 bg-[#2A0B13]/72 p-3 text-sm leading-6 text-[#FFB6C4]">
              {historyError}
            </div>
          ) : historyLoading && historyAssets.length === 0 ? (
            <div className="flex min-h-32 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.025] text-sm text-[#B8C0CC]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              正在加载历史素材...
            </div>
          ) : historyAssets.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.025] p-4 text-center text-sm leading-6 text-[#788493]">
              当前工作台还没有历史素材。
            </div>
          ) : (
            <>
              <div className="grid grid-cols-3 gap-2">
                {historyAssets.slice(0, HISTORY_PAGE_SIZE).map((item) => {
                  const url = item.outputUrls[0];
                  const thumbnailUrl = getAssetThumbnailUrl(item) || url;

                  return (
                    <a
                      key={item.id}
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      draggable={Boolean(url)}
                      onDragStart={(event) => {
                        if (!url) return;
                        event.dataTransfer.effectAllowed = "copy";
                        event.dataTransfer.setData(
                          HISTORY_ASSET_DRAG_TYPE,
                          JSON.stringify({
                            id: item.id,
                            url,
                            thumbnailUrl: thumbnailUrl || undefined,
                            prompt: item.prompt || undefined,
                          } satisfies HistoryAssetDragPayload)
                        );
                        event.dataTransfer.setData("text/uri-list", url);
                      }}
                      className="group relative aspect-square overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition hover:border-[#28D7F5]/55"
                      title="拖入参考图，或点击打开原图"
                    >
                      {thumbnailUrl ? (
                        <img
                          src={thumbnailUrl}
                          alt={item.prompt || "历史生成素材"}
                          className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.035]"
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[#788493]">
                          <ImageIcon className="h-6 w-6" />
                        </div>
                      )}
                      <span className="pointer-events-none absolute inset-x-1.5 bottom-1.5 rounded-full bg-black/60 px-2 py-1 text-center text-[10px] font-semibold text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
                        拖入参考图
                      </span>
                    </a>
                  );
                })}
              </div>
              {(canPageHistoryBack || canPageHistoryForward) && (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => loadHistoryItems(Math.max(0, historyOffset - HISTORY_PAGE_SIZE))}
                    disabled={!canPageHistoryBack || historyLoading}
                    className="min-h-9 cursor-pointer rounded-full border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-[#DDE5F2] transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    上一页
                  </button>
                  <button
                    type="button"
                    onClick={() => loadHistoryItems(historyOffset + HISTORY_PAGE_SIZE)}
                    disabled={!canPageHistoryForward || historyLoading}
                    className="min-h-9 cursor-pointer rounded-full border border-white/10 bg-white/[0.035] px-3 text-xs font-semibold text-[#DDE5F2] transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    下一页
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </aside>

      {libraryOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-6">
          <div className="flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-[28px] border border-white/10 bg-[#0A0C11] shadow-[0_24px_90px_rgba(0,0,0,0.52)] sm:mx-auto sm:max-w-5xl sm:rounded-[28px]">
            <div className="flex items-start justify-between gap-4 border-b border-white/10 p-4 sm:p-5">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#28D7F5]">Asset Library</p>
                <h3 className="mt-1 text-xl font-bold">选择参考图</h3>
                <p className="mt-1 text-sm text-[#788493]">
                  已选择 {references.length}/{MAX_REFERENCE_IMAGES} 张，点击素材可加入参考图。
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => loadLibraryItems(0)}
                  disabled={libraryLoading}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.035] text-[#DDE5F2] transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="刷新素材库"
                >
                  <RefreshCw className={`h-4 w-4 ${libraryLoading ? "animate-spin" : ""}`} />
                </button>
                <button
                  type="button"
                  onClick={() => setLibraryOpen(false)}
                  className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-white/10 bg-white/[0.035] text-[#DDE5F2] transition hover:bg-white/[0.08]"
                  aria-label="关闭素材库"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {libraryError ? (
                <div className="rounded-2xl border border-[#FF5C7A]/30 bg-[#2A0B13]/72 p-4 text-sm leading-6 text-[#FFB6C4]">
                  {libraryError}
                </div>
              ) : libraryLoading && libraryItems.length === 0 ? (
                <div className="flex min-h-64 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.025] text-sm text-[#B8C0CC]">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  正在加载素材库...
                </div>
              ) : explodedLibraryItems.length === 0 ? (
                <div className="flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-white/10 bg-white/[0.025] p-6 text-center">
                  <ImageIcon className="mb-3 h-10 w-10 text-[#4E5664]" />
                  <p className="text-base font-bold">素材库暂无可用图片</p>
                  <p className="mt-2 text-sm text-[#788493]">完成一次图片生成后，可在这里选择生成结果作为参考图。</p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                    {explodedLibraryItems.map((item) => {
                      const url = item.outputUrls[0];
                      const thumbnailUrl = getAssetThumbnailUrl(item) || url;
                      const selected = Boolean(url && selectedReferenceUrls.has(url));
                      const disabled = !url || selected || references.length >= MAX_REFERENCE_IMAGES;

                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => addLibraryReference(item)}
                          disabled={disabled}
                          className="group relative aspect-square cursor-pointer overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] text-left transition hover:border-[#28D7F5]/55 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {thumbnailUrl ? (
                            <img
                              src={thumbnailUrl}
                              alt={item.prompt || "素材库图片"}
                              className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.035]"
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[#788493]">
                              <ImageIcon className="h-8 w-8" />
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-3">
                            <p className="line-clamp-2 text-xs font-semibold leading-4 text-white">
                              {item.prompt || "未记录提示词"}
                            </p>
                          </div>
                          {selected && (
                            <div className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-[#39E58C] text-[#052A16] shadow-lg">
                              <CheckCircle className="h-4 w-4" />
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                  {libraryItems.length < libraryTotal && (
                    <div className="mt-5 flex justify-center">
                      <button
                        type="button"
                        onClick={() => loadLibraryItems(libraryItems.length)}
                        disabled={libraryLoadingMore}
                        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-[#28D7F5]/35 bg-[#071F2A]/72 px-5 text-sm font-semibold text-[#91F0FF] transition hover:border-[#28D7F5]/70 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {libraryLoadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                        加载更多 {libraryItems.length}/{libraryTotal}
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-[#050608]/92 p-4 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-6xl gap-3">
          {isBusy && taskId && (
            <button
              type="button"
              onClick={cancelTask}
              className="flex h-12 w-14 cursor-pointer items-center justify-center rounded-2xl border border-[#FF5C7A]/35 bg-[#2A0B13] text-[#FFB6C4]"
              aria-label="取消任务"
            >
              <X className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={isBusy ? cancelTask : submitTask}
            disabled={!isBusy && !canGenerate}
            className="flex h-12 flex-1 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white text-base font-black text-[#050608] shadow-[0_14px_40px_rgba(245,247,250,0.18)] transition hover:bg-[#DDE5F2] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isBusy ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                取消生成
              </>
            ) : taskStatus === "success" ? (
              <>
                <RefreshCw className="h-5 w-5" />
                再生成
              </>
            ) : (
              <>
                <Sparkles className="h-5 w-5" />
                立即生成
              </>
            )}
          </button>
        </div>
      </div>

      <div className="hidden lg:fixed lg:bottom-8 lg:left-1/2 lg:z-40 lg:flex lg:w-full lg:max-w-6xl lg:-translate-x-1/2 lg:justify-end lg:px-6">
        <button
          type="button"
          onClick={isBusy ? cancelTask : submitTask}
          disabled={!isBusy && !canGenerate}
          className="flex h-12 min-w-40 cursor-pointer items-center justify-center gap-2 rounded-2xl bg-white px-6 text-base font-black text-[#050608] shadow-[0_14px_40px_rgba(245,247,250,0.18)] transition hover:bg-[#DDE5F2] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
          {isBusy ? "取消生成" : taskStatus === "success" ? "再生成" : "立即生成"}
        </button>
      </div>
    </section>
  );
}
