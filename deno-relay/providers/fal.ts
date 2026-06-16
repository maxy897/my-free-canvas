/**
 * FAL.ai Image Generation Provider
 * Uses the Flux Dev model for text-to-image generation
 * API Reference: https://fal.ai/docs/model-api-reference/image-generation-api/flux-dev
 */

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

export interface Txt2ImgResult {
  data: Uint8Array;
  mimeType: string;
  metadata: { width: number; height: number; model: string };
}

const FAL_API_KEY = Deno.env.get("FAL_API_KEY") || "";
const FAL_API_URL = "https://fal.run/fal-ai/flux/dev";

/**
 * Generate an image from a text prompt using FAL.ai Flux Dev model
 */
export async function txt2img(params: Txt2ImgParams): Promise<Txt2ImgResult> {
  if (!FAL_API_KEY) {
    throw new Error("FAL_API_KEY environment variable is not set. Set it to use real AI generation.");
  }

  try {
    // Map our params to FAL API parameters
    const falParams = {
      prompt: params.prompt,
      negative_prompt: params.negative_prompt || "",
      num_inference_steps: params.steps || 28,
      guidance_scale: params.guidance_scale || 3.5,
      sync_mode: true, // Return image data directly instead of async
      num_images: 1,
      output_format: "jpeg",
      seed: params.seed || undefined,
    };

    // Remove undefined fields
    const cleanParams = Object.fromEntries(
      Object.entries(falParams).filter(([_, v]) => v !== undefined)
    );

    console.log(`[fal] Generating image with prompt: "${params.prompt}"`);

    const response = await fetch(FAL_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(cleanParams),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `FAL API error (${response.status}): ${errorText.substring(0, 200)}`
      );
    }

    const result = await response.json() as {
      images: Array<{ url: string; content_type: string }>;
      seed?: number;
    };

    if (!result.images || result.images.length === 0) {
      throw new Error("FAL API returned no images");
    }

    // Download the generated image
    const imageUrl = result.images[0].url;
    const imageResponse = await fetch(imageUrl);
    if (!imageResponse.ok) {
      throw new Error(`Failed to download image from FAL: ${imageResponse.statusText}`);
    }

    const imageData = await imageResponse.arrayBuffer();

    console.log(`[fal] Successfully generated image (${imageData.byteLength} bytes)`);

    return {
      data: new Uint8Array(imageData),
      mimeType: result.images[0].content_type || "image/jpeg",
      metadata: {
        width: params.width || 1024,
        height: params.height || 1024,
        model: params.model || "flux-dev",
      },
    };
  } catch (error) {
    console.error("[fal] Image generation failed:", error);
    throw error;
  }
}

/**
 * Generate an image from another image (img2img task)
 * Note: FAL has different models for image-to-image tasks
 * For now, we'll use txt2img as a fallback if only text prompt is available
 */
export async function img2img(
  inputImage: Uint8Array,
  params: Txt2ImgParams
): Promise<Txt2ImgResult> {
  // For MVP, we'll just use txt2img
  // In production, you'd use a dedicated img2img model endpoint
  return txt2img(params);
}

/**
 * Check if the FAL API is available and the key is valid
 */
export async function healthCheck(): Promise<boolean> {
  if (!FAL_API_KEY) {
    console.warn("[fal] FAL_API_KEY not configured, using mock mode");
    return false;
  }

  try {
    // Try a minimal API call to verify credentials
    const response = await fetch("https://api.fal.ai/v1/health", {
      headers: {
        "Authorization": `Key ${FAL_API_KEY}`,
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}
