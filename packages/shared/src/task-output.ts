export interface GenerationOutput {
  url?: string;
  urls?: string[];
  assets?: unknown[];
  fileKey?: string;
  revisedPrompt?: string;
  metadata?: Record<string, unknown>;
}

export type GenerationOutputLike = {
  url?: unknown;
  urls?: unknown;
};

export function getCanvasTaskOutputUrls(output?: GenerationOutputLike | null): string[] {
  if (!output) return [];
  if (Array.isArray(output.urls)) {
    return output.urls.filter((url): url is string => typeof url === "string" && url.length > 0);
  }
  return typeof output.url === "string" && output.url.length > 0 ? [output.url] : [];
}

export function getCanvasTaskOutputValue(output?: GenerationOutputLike | null): string | string[] | undefined {
  const urls = getCanvasTaskOutputUrls(output);
  if (urls.length === 0) return undefined;
  return urls.length > 1 ? urls : urls[0];
}
