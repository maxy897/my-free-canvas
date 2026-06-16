/**
 * Unified AI Provider interface for all generation tasks.
 * Each provider implements this interface with real API calls or mock fallback.
 */

export interface GenerationResult {
  data: Uint8Array;
  mimeType: string;
  metadata: Record<string, unknown>;
}

export interface Txt2ImgParams {
  prompt: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  model?: string;
  seed?: number;
  guidance_scale?: number;
}

export interface Img2ImgParams {
  prompt: string;
  image_url: string;
  negative_prompt?: string;
  width?: number;
  height?: number;
  steps?: number;
  strength?: number;
  model?: string;
  seed?: number;
}

export interface Img2VideoParams {
  image_url: string;
  prompt?: string;
  duration?: number;
  fps?: number;
  model?: string;
}

export interface AIProvider {
  name: string;
  txt2img(params: Txt2ImgParams): Promise<GenerationResult>;
  img2img(params: Img2ImgParams): Promise<GenerationResult>;
  img2video(params: Img2VideoParams): Promise<GenerationResult>;
}
