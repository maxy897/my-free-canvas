import { ImageOff } from "lucide-react";
import type { PreviewOverlayImage } from "./PreviewOverlay";

export interface AssetGalleryItem {
  id: string;
  projectId: string;
  canvasId: string | null;
  nodeId: string;
  taskType: string;
  status: string;
  prompt: string;
  inputParams: Record<string, unknown>;
  outputUrls: string[];
  assets: unknown[];
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
}

export type AssetPreviewPayload = PreviewOverlayImage;
export const ASSET_DRAG_TYPE = "application/x-free-canvas-asset";

export interface AssetDragPayload {
  id: string;
  url: string;
  thumbnailUrl?: string;
  title?: string;
  prompt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function getAssetDetails(asset: unknown): Record<string, unknown> {
  if (!isRecord(asset)) return {};
  return isRecord(asset.asset_details) ? asset.asset_details : {};
}

export function getAssetThumbnailUrl(item: AssetGalleryItem): string {
  for (const asset of item.assets) {
    const details = getAssetDetails(asset);
    const thumbnailUrl = readString(details.thumbnail_url);
    if (thumbnailUrl) return thumbnailUrl;
  }

  const inputThumbnailUrl = readString((item.inputParams as Record<string, unknown>).thumbnailUrl);
  if (inputThumbnailUrl) return inputThumbnailUrl;

  return item.outputUrls[0] || "";
}

function getAssetMeta(item: AssetGalleryItem): string {
  const asset = item.assets.find(isRecord);
  const details = getAssetDetails(asset);
  const width = readString(details.width);
  const height = readString(details.height);
  const size = readString(details.size);
  return [width && height ? `${width} × ${height}` : "", size].filter(Boolean).join(" · ");
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "未完成";
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function paramSummary(params: Record<string, unknown>): string[] {
  const keys = ["model", "size", "image_resolution", "n", "quality", "output_format"];
  return keys
    .map((key) => {
      const value = params[key];
      if (value === undefined || value === null || value === "") return null;
      return `${key}: ${String(value)}`;
    })
    .filter((value): value is string => Boolean(value));
}

export function AssetCard({
  item,
  projectName,
  canvasName,
  compact,
  onPreview,
}: {
  item: AssetGalleryItem;
  projectName?: string;
  canvasName?: string;
  compact?: boolean;
  onPreview?: (payload: AssetPreviewPayload) => void;
}) {
  const primaryUrl = item.outputUrls[0];
  const thumbnailUrl = getAssetThumbnailUrl(item);
  const chips = paramSummary(item.inputParams);
  const canPreview = Boolean(primaryUrl);
  const dragPayload: AssetDragPayload | null = primaryUrl
    ? {
        id: item.id,
        url: primaryUrl,
        thumbnailUrl: thumbnailUrl || undefined,
        title: item.prompt || "生成素材",
        prompt: item.prompt || undefined,
      }
    : null;

  return (
    <article
      role={canPreview ? "button" : undefined}
      tabIndex={canPreview ? 0 : undefined}
      draggable={Boolean(dragPayload)}
      onDragStart={(event) => {
        if (!dragPayload) return;
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData(ASSET_DRAG_TYPE, JSON.stringify(dragPayload));
        event.dataTransfer.setData("text/uri-list", dragPayload.url);
      }}
      onClick={() => {
        if (!primaryUrl) return;
        onPreview?.({
          src: primaryUrl,
          thumbnailSrc: thumbnailUrl || undefined,
          title: item.prompt || "生成结果",
          meta: getAssetMeta(item),
        });
      }}
      onKeyDown={(event) => {
        if (!canPreview || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onPreview?.({
          src: primaryUrl,
          thumbnailSrc: thumbnailUrl || undefined,
          title: item.prompt || "生成结果",
          meta: getAssetMeta(item),
        });
      }}
      className={`group overflow-hidden border border-white/10 bg-[#0A0C11]/78 shadow-[0_18px_52px_rgba(0,0,0,0.28)] transition hover:-translate-y-0.5 hover:border-[#28D7F5]/42 hover:bg-[#101A27] ${
        compact ? "rounded-[18px]" : "rounded-[24px]"
      } ${
        canPreview ? "cursor-grab active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#28D7F5]/70" : ""
      }`}
    >
      <div className={`relative overflow-hidden bg-[#050608] ${compact ? "aspect-[4/3]" : "aspect-square"}`}>
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={item.prompt || "生成结果缩略图"}
            className="h-full w-full object-contain transition duration-500 group-hover:scale-[1.035]"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-[#788493]">
            <ImageOff className="h-7 w-7" />
            <span className="text-xs">暂无缩略图</span>
          </div>
        )}
        <div className="absolute left-3 top-3 rounded-full border border-black/30 bg-black/55 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.14em] text-white backdrop-blur-xl">
          {item.taskType}
        </div>
        {primaryUrl && (
          <div className="absolute right-3 top-3 rounded-full border border-white/10 bg-black/45 px-2.5 py-1 text-[10px] font-semibold text-white opacity-0 backdrop-blur-xl transition group-hover:opacity-100">
            拖入画布
          </div>
        )}
      </div>

      <div className={compact ? "p-2.5" : "p-4"}>
        <div className="mb-2 flex items-center justify-between gap-3 text-[11px] text-[#788493]">
          <span>{formatDate(item.completedAt || item.createdAt)}</span>
          <span className={item.status === "success" ? "text-[#39E58C]" : "text-[#FF9AAD]"}>{item.status}</span>
        </div>
        <p className={`${compact ? "line-clamp-2 min-h-9 text-xs leading-[18px]" : "line-clamp-3 min-h-[3.75rem] text-sm leading-5"} text-[#F5F7FA]`}>
          {item.prompt || "未记录提示词"}
        </p>
        <div className={`${compact ? "mt-2" : "mt-3"} flex flex-wrap gap-1.5`}>
          {(chips.length > 0 ? chips : ["参数未记录"]).slice(0, compact ? 2 : 4).map((chip) => (
            <span key={chip} className="rounded-full border border-white/10 bg-white/[0.035] px-2 py-0.5 text-[10px] text-[#B8C0CC]">
              {chip}
            </span>
          ))}
        </div>
        {(projectName || canvasName) && (
          <div className="mt-3 border-t border-white/10 pt-3 text-[11px] leading-5 text-[#788493]">
            {projectName && <div className="truncate">项目：{projectName}</div>}
            {canvasName && <div className="truncate">画布：{canvasName}</div>}
          </div>
        )}
      </div>
    </article>
  );
}
