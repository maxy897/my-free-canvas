import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useEffect, useRef, useState, type CSSProperties, type ChangeEvent } from "react";
import { makeHandleId, PORT_COLORS, HANDLE_STYLE } from "../lib/type-system";
import { Download, Eye, Image as ImageIcon } from "lucide-react";

const MAX_IMAGE_RETRIES = 5;
const preloadedPreviewUrls = new Set<string>();

function getAssetThumbnailUrl(asset: unknown): string {
  if (typeof asset !== "object" || asset === null || Array.isArray(asset)) return "";
  const details = (asset as Record<string, unknown>).asset_details;
  if (typeof details !== "object" || details === null || Array.isArray(details)) return "";
  const thumbnailUrl = (details as Record<string, unknown>).thumbnail_url;
  return typeof thumbnailUrl === "string" ? thumbnailUrl : "";
}

function formatBytes(value: unknown): string {
  const bytes = typeof value === "string" ? Number(value) : typeof value === "number" ? value : 0;
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function preloadPreviewImage(url: string) {
  if (!url || typeof window === "undefined" || preloadedPreviewUrls.has(url)) return;
  preloadedPreviewUrls.add(url);
  const image = new window.Image();
  image.referrerPolicy = "no-referrer";
  image.src = url;
}

export function ImageInputNode({ data }: NodeProps) {
  const nodeData = data as Record<string, unknown>;
  const url = (typeof nodeData.url === "string" ? nodeData.url : "").trim();
  const thumbnailUrl = (
    typeof nodeData.thumbnailUrl === "string" ? nodeData.thumbnailUrl : getAssetThumbnailUrl(nodeData.asset)
  ).trim();
  const displayUrl = thumbnailUrl || url;
  const uploadStatus = nodeData.uploadStatus as string | undefined;
  const uploadError = nodeData.uploadError as string | undefined;
  const generatedFrom = nodeData.generatedFrom as string | undefined;
  const width = nodeData.width as string | number | undefined;
  const height = nodeData.height as string | number | undefined;
  const size = formatBytes(nodeData.size);
  const downloadUrl = nodeData.downloadUrl as string | undefined;
  const onFileUpload = nodeData.onFileUpload as ((file: File) => void) | undefined;
  const onPreviewImage = nodeData.onPreviewImage as
    | ((image: { src: string; thumbnailSrc?: string; title?: string; meta?: string; downloadUrl?: string }) => void)
    | undefined;
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isUploading = uploadStatus === "uploading";
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const imageMeta = [width && height ? `${width} × ${height}` : "", size].filter(Boolean).join(" · ");
  const previewThumbnailUrl = thumbnailUrl && thumbnailUrl !== url ? thumbnailUrl : undefined;

  useEffect(() => {
    setFailedUrl(null);
    setRetryAttempt(0);
  }, [displayUrl]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) onFileUpload?.(file);
    event.target.value = "";
  };

  return (
    <div
      className="canvas-node w-[280px] rounded-[20px] text-[#F5F7FA]"
      style={{
        "--node-accent": "rgba(40, 215, 245, 0.88)",
        "--node-glow": "rgba(40, 215, 245, 0.28)",
      } as CSSProperties}
    >
      <div className="canvas-node-header px-4 py-3 flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[#082F36] bg-gradient-to-r from-[#28D7F5] to-[#06B6D4] px-2.5 py-0.5 rounded-full shadow-[0_0_10px_rgba(40,215,245,0.4)] flex items-center gap-1">
            <ImageIcon className="w-2.5 h-2.5" /> Image
          </span>
        </div>
        <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[9px] font-medium text-[#9AA6B7]">
          {generatedFrom ? "Result" : "Source"}
        </span>
      </div>

      <div className="px-4 pb-4 space-y-3">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />
        {isUploading ? (
          <div className="group flex h-[140px] cursor-progress flex-col items-center justify-center rounded-xl border border-[#28D7F5]/25 bg-[#28D7F5]/[0.06]">
            <ImageIcon className="mb-2 h-5 w-5 animate-pulse text-[#28D7F5]" />
            <span className="text-[10px] text-[#91F0FF]">正在上传图片...</span>
          </div>
        ) : displayUrl && failedUrl !== displayUrl ? (
          <div className="h-[140px] overflow-hidden rounded-xl border border-white/10 bg-black/40">
            <img
              key={`${displayUrl}-${retryAttempt}`}
              src={displayUrl}
              alt="Input"
              className="w-full h-full object-contain"
              referrerPolicy="no-referrer"
              onLoad={(event) => {
                console.info("[canvas:image-input] image loaded", {
                  url: displayUrl,
                  retryAttempt,
                  naturalWidth: event.currentTarget.naturalWidth,
                  naturalHeight: event.currentTarget.naturalHeight,
                });
                setFailedUrl(null);
              }}
              onError={(event) => {
                console.warn("[canvas:image-input] image failed to load", {
                  url: displayUrl,
                  currentSrc: event.currentTarget.currentSrc,
                  retryAttempt,
                });
                if (retryAttempt < MAX_IMAGE_RETRIES) {
                  window.setTimeout(() => setRetryAttempt((attempt) => attempt + 1), 800 * (retryAttempt + 1));
                } else {
                  setFailedUrl(displayUrl);
                }
              }}
            />
          </div>
        ) : url ? (
          <div className="flex h-[140px] flex-col items-center justify-center gap-2 rounded-xl border border-[#FF5C7A]/25 bg-[#FF5C7A]/[0.08] px-3 text-center">
            <ImageIcon className="h-5 w-5 text-[#FF9AAD]" />
            <span className="text-[10px] leading-4 text-[#FF9AAD]">图片加载失败，请查看 Console 日志</span>
          </div>
        ) : (
          <button
            type="button"
            className="nodrag group flex h-[140px] w-full cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/10 bg-black/10 transition-colors hover:border-[#28D7F5]/40"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImageIcon className="w-5 h-5 text-[#788493] mb-2 group-hover:text-[#28D7F5] transition-colors" />
            <span className="text-[10px] text-[#9AA6B7] group-hover:text-[#91F0FF] transition-colors">
              点击上传图片
            </span>
          </button>
        )}
        {uploadError && (
          <div className="rounded-lg border border-[#FF5C7A]/25 bg-[#FF5C7A]/[0.08] px-2.5 py-2 text-[10px] text-[#FF9AAD]">
            {uploadError}
          </div>
        )}
        {url && (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 text-[10px] text-[#7D8A99]">
              {imageMeta || "Image asset"}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                className="nodrag flex min-h-7 items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] text-[#B8C0CC] transition-colors hover:bg-white/10 hover:text-white"
                onPointerEnter={() => preloadPreviewImage(url)}
                onFocus={() => preloadPreviewImage(url)}
                onClick={() =>
                  onPreviewImage?.({
                    src: url,
                    thumbnailSrc: previewThumbnailUrl,
                    title: (data.title as string | undefined) || (generatedFrom ? "生成结果" : "图片预览"),
                    meta: imageMeta,
                    downloadUrl,
                  })
                }
              >
                <Eye className="h-3 w-3" /> Preview
              </button>
              {downloadUrl && (
                <a
                  href={downloadUrl}
                  className="nodrag flex min-h-7 items-center gap-1 rounded-lg bg-white/5 px-2 py-1 text-[10px] text-[#B8C0CC] transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Download className="h-3 w-3" /> Download
                </a>
              )}
            </div>
          </div>
        )}
      </div>

      {generatedFrom && (
        <Handle
          type="target"
          position={Position.Left}
          id={makeHandleId("image", "image", "target")}
          style={{ ...HANDLE_STYLE, background: PORT_COLORS.image, borderColor: PORT_COLORS.image }}
        />
      )}
      <Handle
        type="source"
        position={Position.Right}
        id={makeHandleId("image", "image", "source")}
        style={{ ...HANDLE_STYLE, background: PORT_COLORS.image, borderColor: PORT_COLORS.image }}
      />
    </div>
  );
}
