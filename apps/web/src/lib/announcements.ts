import type { Announcement } from "@shared/types";
import { API_URL } from "./api";

export type { Announcement };

export interface AnnouncementsResponse {
  announcements: Announcement[];
}

/** localStorage key for per-announcement dismissal tokens, shared by banner + center. */
export const DISMISS_STORAGE_KEY = "freecanvas-dismissed-announcements";

/** Per-announcement dismissal token; changes when the announcement is edited. */
export function dismissToken(item: Announcement): string {
  return `${item.id}:${item.updatedAt}`;
}

export function readDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DISMISS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : []
    );
  } catch {
    return new Set();
  }
}

export function persistDismissed(tokens: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify([...tokens]));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

/** Whether an announcement is currently live (active + within its display window). */
export function isLive(item: Announcement, now: number = Date.now()): boolean {
  if (!item.isActive) return false;
  if (item.startsAt && Date.parse(item.startsAt) > now) return false;
  if (item.endsAt && Date.parse(item.endsAt) < now) return false;
  return true;
}

/** Fetch the currently active announcements for the public banner. */
export async function fetchActiveAnnouncements(): Promise<Announcement[]> {
  return fetchAnnouncements(false);
}

/** Fetch recent announcements (incl. dismissed / ended / disabled) for the center. */
export async function fetchAnnouncementHistory(): Promise<Announcement[]> {
  return fetchAnnouncements(true);
}

async function fetchAnnouncements(history: boolean): Promise<Announcement[]> {
  const res = await fetch(`${API_URL}/api/announcements${history ? "?history=1" : ""}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    throw new Error(`加载公告失败 (${res.status})`);
  }
  const data = (await res.json()) as AnnouncementsResponse;
  return data.announcements ?? [];
}
