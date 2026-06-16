/**
 * Kling API Provider (skeleton + mock fallback)
 * Real implementation: Kling AI video generation API
 * Supports: img2video (primary), txt2img (secondary)
 */

import type { AIProvider, GenerationResult, Txt2ImgParams, Img2ImgParams, Img2VideoParams } from "./types.ts";

const KLING_API_KEY = Deno.env.get("KLING_API_KEY") || "";

export class KlingProvider implements AIProvider {
  name = "kling";

  async txt2img(params: Txt2ImgParams): Promise<GenerationResult> {
    if (!KLING_API_KEY) {
      return this.mockImageGenerate(params.prompt, params.width || 1024, params.height || 1024);
    }

    // TODO: Real Kling txt2img API
    throw new Error("Kling txt2img: real API not yet implemented.");
  }

  async img2img(params: Img2ImgParams): Promise<GenerationResult> {
    if (!KLING_API_KEY) {
      return this.mockImageGenerate(params.prompt, params.width || 1024, params.height || 1024);
    }

    // TODO: Real Kling img2img API
    throw new Error("Kling img2img: real API not yet implemented.");
  }

  async img2video(params: Img2VideoParams): Promise<GenerationResult> {
    if (!KLING_API_KEY) {
      return this.mockVideoGenerate(params.duration || 5);
    }

    // TODO: Real Kling video generation API call
    // POST https://api.klingai.com/v1/videos/image2video
    throw new Error("Kling img2video: real API not yet implemented. Set KLING_API_KEY='' to use mock.");
  }

  private async mockImageGenerate(prompt: string, width: number, height: number): Promise<GenerationResult> {
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));

    const text = encodeURIComponent((prompt || "Generated").slice(0, 30));
    const url = `https://placehold.co/${width}x${height}/png?text=${text}`;
    const res = await fetch(url);
    const data = new Uint8Array(await res.arrayBuffer());

    return { data, mimeType: "image/png", metadata: { width, height, model: "kling-mock", provider: "kling" } };
  }

  private async mockVideoGenerate(duration: number): Promise<GenerationResult> {
    await new Promise((r) => setTimeout(r, 3000 + Math.random() * 3000));

    // Mock: return placeholder bytes
    const placeholder = new TextEncoder().encode(`[mock kling video: ${duration}s, 24fps]`);
    return {
      data: placeholder,
      mimeType: "video/mp4",
      metadata: { duration, fps: 24, model: "kling-v1-mock", provider: "kling" },
    };
  }
}
