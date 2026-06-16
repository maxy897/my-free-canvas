import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";
import type { Announcement } from "../../lib/announcements";
import {
  dismissToken,
  fetchAnnouncementHistory,
  isLive,
  persistDismissed,
  readDismissed,
} from "../../lib/announcements";

const LEVEL_DOT: Record<Announcement["level"], string> = {
  info: "bg-[#28D7F5]",
  success: "bg-[#39e58c]",
  warning: "bg-[#ffb454]",
  critical: "bg-[#ff5c7a]",
};

const LEVEL_LABEL: Record<Announcement["level"], string> = {
  info: "公告",
  success: "通知",
  warning: "注意",
  critical: "重要",
};

function formatDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function AnnouncementBell() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const containerRef = useRef<HTMLDivElement>(null);

  function load() {
    fetchAnnouncementHistory()
      .then(setItems)
      .catch(() => {
        /* non-critical */
      });
  }

  useEffect(() => {
    load();
    const onChange = () => setDismissed(readDismissed());
    window.addEventListener("freecanvas-announcements-changed", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("freecanvas-announcements-changed", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Unread = currently live announcements the user hasn't dismissed yet.
  const unreadCount = items.filter((item) => isLive(item) && !dismissed.has(dismissToken(item))).length;

  function toggle() {
    setOpen((prev) => {
      const next = !prev;
      if (next) load();
      return next;
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="公告中心"
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-[#B8C0CC] transition hover:border-[#28D7F5]/40 hover:text-[#F5F7FA]"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff5c7a] px-1 text-[10px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-[70] mt-2 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-[#2B313B] bg-[#0C0F15]/97 shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <div className="flex items-center justify-between border-b border-[#2B313B] px-4 py-3">
            <span className="text-sm font-semibold text-[#F5F7FA]">公告中心</span>
            <span className="text-xs text-[#788493]">最近 {items.length} 条</span>
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 && (
              <div className="px-4 py-8 text-center text-sm text-[#788493]">暂无公告</div>
            )}
            {items.map((item) => {
              const live = isLive(item);
              return (
                <div
                  key={item.id}
                  className="border-b border-[#2B313B]/60 px-4 py-3 last:border-b-0"
                >
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${LEVEL_DOT[item.level] ?? LEVEL_DOT.info}`} />
                    <span className="text-xs font-medium text-[#9AA6B7]">{LEVEL_LABEL[item.level] ?? "公告"}</span>
                    {live ? (
                      <span className="rounded-full bg-[#39e58c]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#7ff0b6]">
                        进行中
                      </span>
                    ) : (
                      <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-[#788493]">已结束</span>
                    )}
                    <span className="ml-auto text-[11px] text-[#788493]">{formatDate(item.createdAt)}</span>
                  </div>
                  <div className="mt-1.5 text-sm font-semibold text-[#F5F7FA]">{item.title}</div>
                  {item.content && (
                    <div className="mt-1 whitespace-pre-wrap text-xs leading-5 text-[#B8C0CC]">{item.content}</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
