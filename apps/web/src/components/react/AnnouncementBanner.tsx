import { useEffect, useState } from "react";
import type { Announcement } from "../../lib/announcements";
import {
  dismissToken,
  fetchActiveAnnouncements,
  persistDismissed,
  readDismissed,
} from "../../lib/announcements";

type LevelStyle = {
  container: string;
  badge: string;
  label: string;
  icon: string;
};

const LEVEL_STYLES: Record<Announcement["level"], LevelStyle> = {
  info: {
    container: "border-[#28D7F5]/40 bg-[#0e2630]/95 text-[#cdeef7]",
    badge: "bg-[#28D7F5]/20 text-[#7fe4f7]",
    label: "公告",
    icon: "M12 16v-4m0-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  success: {
    container: "border-[#39e58c]/40 bg-[#0d2419]/95 text-[#c6f4dc]",
    badge: "bg-[#39e58c]/20 text-[#7ff0b6]",
    label: "通知",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  warning: {
    container: "border-[#ffb454]/45 bg-[#2a200d]/95 text-[#f7e6c8]",
    badge: "bg-[#ffb454]/20 text-[#ffcf8a]",
    label: "注意",
    icon: "M12 9v4m0 4h.01M10.29 3.86l-8.18 14.14A1.5 1.5 0 003.4 20.5h17.2a1.5 1.5 0 001.29-2.5L13.71 3.86a1.5 1.5 0 00-2.42 0z",
  },
  critical: {
    container: "border-[#ff5c7a]/50 bg-[#2c0f16]/95 text-[#f8d2da]",
    badge: "bg-[#ff5c7a]/25 text-[#ff96aa]",
    label: "重要",
    icon: "M12 9v4m0 4h.01M10.29 3.86l-8.18 14.14A1.5 1.5 0 003.4 20.5h17.2a1.5 1.5 0 001.29-2.5L13.71 3.86a1.5 1.5 0 00-2.42 0z",
  },
};

export default function AnnouncementBanner() {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());

  useEffect(() => {
    let cancelled = false;
    fetchActiveAnnouncements()
      .then((items) => {
        if (!cancelled) setAnnouncements(items);
      })
      .catch(() => {
        /* banner is non-critical; fail silently */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function dismiss(item: Announcement) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(dismissToken(item));
      persistDismissed(next);
      return next;
    });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("freecanvas-announcements-changed"));
    }
  }

  const visible = announcements.filter((item) => !dismissed.has(dismissToken(item)));
  if (visible.length === 0) return null;

  return (
    <div className="relative z-[60] flex flex-col">
      {visible.map((item) => {
        const style = LEVEL_STYLES[item.level] ?? LEVEL_STYLES.info;
        return (
          <div
            key={item.id}
            role="status"
            className={`flex items-start gap-3 border-b px-4 py-2.5 backdrop-blur-md sm:px-6 ${style.container}`}
          >
            <svg
              className="mt-0.5 h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={style.icon} />
            </svg>
            <div className="min-w-0 flex-1 text-sm leading-relaxed">
              <span
                className={`mr-2 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${style.badge}`}
              >
                {style.label}
              </span>
              <span className="font-semibold">{item.title}</span>
              {item.content && (
                <span className="ml-1.5 opacity-90">— {item.content}</span>
              )}
            </div>
            {item.isDismissible && (
              <button
                type="button"
                onClick={() => dismiss(item)}
                aria-label="关闭公告"
                className="-mr-1 shrink-0 rounded-md p-1 opacity-70 transition hover:bg-white/10 hover:opacity-100"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  aria-hidden="true"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
