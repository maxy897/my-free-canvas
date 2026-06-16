import type { PromptTemplate } from "@shared/types";
import { API_URL } from "./api";

export type { PromptTemplate };

export interface PromptTemplatesResponse {
  templates: PromptTemplate[];
  categories: string[];
}

let cache: PromptTemplatesResponse | null = null;
let inflight: Promise<PromptTemplatesResponse> | null = null;

/**
 * Fetch the built-in prompt template library. The full list is small and
 * static, so it is fetched once and cached in-memory; filtering by category /
 * keyword is done client-side from the cached list.
 */
export async function fetchPromptTemplates(): Promise<PromptTemplatesResponse> {
  if (cache) return cache;
  if (inflight) return inflight;

  inflight = (async () => {
    const res = await fetch(`${API_URL}/api/prompt-templates`, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
    });
    if (!res.ok) {
      throw new Error(`加载提示词模板失败 (${res.status})`);
    }
    const data = (await res.json()) as PromptTemplatesResponse;
    cache = data;
    return data;
  })();

  try {
    return await inflight;
  } finally {
    inflight = null;
  }
}
