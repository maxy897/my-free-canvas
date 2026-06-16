/**
 * HuggingFace Spaces FFmpeg Video Processing (skeleton + mock)
 * Real implementation: calls HF Spaces endpoint with FFmpeg for video post-processing.
 * Use cases: frame stitching, format conversion, watermarking, resolution scaling.
 */

import type { GenerationResult } from "./types.ts";

const HF_SPACES_URL = Deno.env.get("HF_SPACES_URL") || "";

export interface VideoProcessParams {
  /** Raw video data from AI provider */
  inputData: Uint8Array;
  inputMimeType: string;
  /** Target format */
  outputFormat?: "mp4" | "webm" | "gif";
  /** Target resolution */
  width?: number;
  height?: number;
  /** Target FPS */
  fps?: number;
  /** Quality (1-100) */
  quality?: number;
}

/**
 * Post-process video through HF Spaces FFmpeg endpoint.
 * In mock mode, returns input data unchanged.
 */
export async function processVideo(params: VideoProcessParams): Promise<GenerationResult> {
  if (!HF_SPACES_URL) {
    // Mock mode: pass through input unchanged
    console.log("[hf-video] No HF_SPACES_URL configured, passing through input data");
    return {
      data: params.inputData,
      mimeType: params.inputMimeType,
      metadata: {
        processed: false,
        reason: "HF_SPACES_URL not configured",
        format: params.outputFormat || "mp4",
      },
    };
  }

  // Real implementation: POST video to HF Spaces for FFmpeg processing
  try {
    const formData = new FormData();
    const inputBuffer = params.inputData.buffer.slice(
      params.inputData.byteOffset,
      params.inputData.byteOffset + params.inputData.byteLength
    ) as ArrayBuffer;
    formData.append("file", new Blob([inputBuffer], { type: params.inputMimeType }), "input.mp4");
    if (params.outputFormat) formData.append("format", params.outputFormat);
    if (params.width) formData.append("width", String(params.width));
    if (params.height) formData.append("height", String(params.height));
    if (params.fps) formData.append("fps", String(params.fps));
    if (params.quality) formData.append("quality", String(params.quality));

    const res = await fetch(`${HF_SPACES_URL}/process`, {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`HF Spaces FFmpeg processing failed: ${res.status}`);
    }

    const data = new Uint8Array(await res.arrayBuffer());
    const outputMime = params.outputFormat === "webm" ? "video/webm"
      : params.outputFormat === "gif" ? "image/gif"
      : "video/mp4";

    return {
      data,
      mimeType: outputMime,
      metadata: {
        processed: true,
        format: params.outputFormat || "mp4",
        width: params.width,
        height: params.height,
        fps: params.fps,
      },
    };
  } catch (error) {
    console.error("[hf-video] Processing failed, returning raw input:", error);
    // Fallback: return unprocessed input
    return {
      data: params.inputData,
      mimeType: params.inputMimeType,
      metadata: { processed: false, error: (error as Error).message },
    };
  }
}
