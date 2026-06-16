import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";

export interface PreviewOverlayImage {
  src: string;
  thumbnailSrc?: string;
  title?: string;
  meta?: string;
  downloadUrl?: string;
  actionLabel?: string;
}

export function PreviewOverlay({
  image,
  onClose,
}: {
  image: PreviewOverlayImage;
  onClose: () => void;
}) {
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "failed">("loading");
  const actionUrl = image.downloadUrl || image.src;

  useEffect(() => {
    setLoadState("loading");
  }, [image.src]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const overlay = (
    <div
      className="nodrag nopan fixed inset-0 z-[100] flex items-center justify-center bg-[#030711]/90 p-5 text-[#F5F7FA] backdrop-blur-xl"
      role="dialog"
      aria-modal="true"
      aria-label={image.title || "图片预览"}
      onClick={onClose}
    >
      <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-4 border-b border-white/10 bg-[#030711]/75 px-5 py-3 shadow-[0_18px_60px_rgba(0,0,0,0.35)] backdrop-blur-xl">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-white">{image.title || "图片预览"}</div>
          {image.meta && <div className="mt-0.5 text-xs text-[#9AA6B7]">{image.meta}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actionUrl && (
            <a
              href={actionUrl}
              target="_blank"
              rel="noreferrer"
              className="flex min-h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-[#DDE5F2] transition-colors hover:bg-white/10 hover:text-white"
              onClick={(event) => event.stopPropagation()}
            >
              <Download className="h-4 w-4" /> {image.actionLabel || "打开高清图"}
            </a>
          )}
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-[#DDE5F2] transition-colors hover:bg-white/10 hover:text-white"
            aria-label="关闭预览"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div
        className="relative flex h-full w-full items-center justify-center pt-14"
        onClick={(event) => event.stopPropagation()}
      >
        {image.thumbnailSrc && loadState === "loading" && (
          <img
            src={image.thumbnailSrc}
            alt=""
            aria-hidden="true"
            className="absolute max-h-[calc(100%-3.5rem)] max-w-full rounded-2xl border border-white/10 object-contain opacity-45 blur-sm"
            referrerPolicy="no-referrer"
          />
        )}
        {loadState === "loading" && (
          <div className="absolute flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[#07101A]/80 px-5 py-4 text-xs text-[#DDE5F2] shadow-[0_18px_56px_rgba(0,0,0,0.42)] backdrop-blur-xl">
            <span className="h-7 w-7 animate-spin rounded-full border-2 border-[#28D7F5]/25 border-t-[#28D7F5]" />
            <span>正在加载高清图...</span>
          </div>
        )}
        {loadState === "failed" && (
          <div className="absolute max-w-sm rounded-2xl border border-[#FF5C7A]/25 bg-[#210A12]/90 px-5 py-4 text-center text-xs text-[#FFB3C1] shadow-[0_18px_56px_rgba(0,0,0,0.42)] backdrop-blur-xl">
            高清图加载失败。可以稍后重试，或使用右上角按钮查看原文件。
          </div>
        )}
        <img
          src={image.src}
          alt={image.title || "图片预览"}
          className={`max-h-full max-w-full rounded-2xl border border-white/10 bg-black/40 object-contain shadow-[0_28px_100px_rgba(0,0,0,0.55)] transition-opacity duration-300 ${
            loadState === "loaded" ? "opacity-100" : "opacity-0"
          }`}
          referrerPolicy="no-referrer"
          onLoad={() => setLoadState("loaded")}
          onError={() => setLoadState("failed")}
        />
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
