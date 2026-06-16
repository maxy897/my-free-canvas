/**
 * Replicate API Provider (skeleton + mock fallback)
 * Real implementation: https://replicate.com/docs/reference/http
 * Supports: SDXL img2img, Flux txt2img
 */

import type { AIProvider, GenerationResult, Txt2ImgParams, Img2ImgParams, Img2VideoParams } from "./types.ts";

const REPLICATE_API_TOKEN = Deno.env.get("REPLICATE_API_TOKEN") || "";

export class ReplicateProvider implements AIProvider {
  name = "replicate";

  async txt2img(params: Txt2ImgParams): Promise<GenerationResult> {
    if (!REPLICATE_API_TOKEN) {
      return this.mockGenerate(params.prompt, "image/png", params.width || 1024, params.height || 1024);
    }

    // TODO: Real Replicate API call
    // POST https://api.replicate.com/v1/predictions
    // Model: stability-ai/sdxl or black-forest-labs/flux-schnell
    throw new Error("Replicate txt2img: real API not yet implemented. Set REPLICATE_API_TOKEN='' to use mock.");
  }

  async img2img(params: Img2ImgParams): Promise<GenerationResult> {
    if (!REPLICATE_API_TOKEN) {
      return this.mockGenerate(params.prompt, "image/png", params.width || 1024, params.height || 1024);
    }

    // TODO: Real Replicate img2img API call
    throw new Error("Replicate img2img: real API not yet implemented.");
  }

  async img2video(params: Img2VideoParams): Promise<GenerationResult> {
    if (!REPLICATE_API_TOKEN) {
      return this.mockVideoGenerate(params.duration || 5);
    }

    // TODO: Real Replicate video API call (e.g. stable-video-diffusion)
    throw new Error("Replicate img2video: real API not yet implemented.");
  }

  private async mockGenerate(prompt: string, mimeType: string, width: number, height: number): Promise<GenerationResult> {
    await new Promise((r) => setTimeout(r, 1000 + Math.random() * 1500));

    const text = encodeURIComponent((prompt || "Generated").slice(0, 30));
    const url = `https://placehold.co/${width}x${height}/png?text=${text}`;
    const res = await fetch(url);
    const data = new Uint8Array(await res.arrayBuffer());

    return { data, mimeType, metadata: { width, height, model: "replicate-mock", provider: "replicate" } };
  }

  private async mockVideoGenerate(duration: number): Promise<GenerationResult> {
    await new Promise((r) => setTimeout(r, 2000 + Math.random() * 2000));

    // Return placeholder — in real impl this would be actual video bytes
    const placeholder = new TextEncoder().encode(`[mock video: ${duration}s]`);
    return {
      data: placeholder,
      mimeType: "video/mp4",
      metadata: { duration, fps: 24, model: "replicate-mock-video", provider: "replicate" },
    };
  }
}
