import type { GenerationOutput } from "./task-output";

// Canvas DAG Node Type System

/** Port data types — determines which nodes can connect */
export type PortDataType = "text" | "image" | "video";

/** Port direction */
export type PortDirection = "input" | "output";

/** Port definition for a node */
export interface PortDefinition {
  id: string;
  label: string;
  dataType: PortDataType;
  direction: PortDirection;
  required?: boolean;
  multiple?: boolean;
}

/** Node type registration */
export interface NodeTypeDefinition {
  type: string;
  label: string;
  category: "input" | "generate" | "process" | "output";
  inputs: PortDefinition[];
  outputs: PortDefinition[];
  defaultConfig: Record<string, unknown>;
}

// --- Node Type Registry ---

export const PROMPT_NODE: NodeTypeDefinition = {
  type: "prompt",
  label: "文本",
  category: "input",
  inputs: [],
  outputs: [
    { id: "text", label: "Text", dataType: "text", direction: "output" },
  ],
  defaultConfig: { text: "" },
};

export const TXT2IMG_NODE: NodeTypeDefinition = {
  type: "txt2img",
  label: "图片生成",
  category: "generate",
  inputs: [
    { id: "prompt", label: "文本", dataType: "text", direction: "input", required: true },
    { id: "reference_images", label: "参考图", dataType: "image", direction: "input", multiple: true },
  ],
  outputs: [
    { id: "image", label: "图片", dataType: "image", direction: "output" },
  ],
  defaultConfig: {
    model: "gpt-image-2",
    n: 1,
    size: "auto",
    image_resolution: "1080p",
    quality: "",
    output_format: "png",
    output_compression: "",
    background: "",
    moderation: "",
    style: "",
    partial_images: "",
    visibility: "private",
  },
};

export const IMAGE_INPUT_NODE: NodeTypeDefinition = {
  type: "image-input",
  label: "图片",
  category: "input",
  inputs: [],
  outputs: [
    { id: "image", label: "Image", dataType: "image", direction: "output" },
  ],
  defaultConfig: { url: "", fileKey: "", assetId: "", source: "remote" },
};

export const IMG2VIDEO_NODE: NodeTypeDefinition = {
  type: "img2video",
  label: "视频生成",
  category: "generate",
  inputs: [
    { id: "image", label: "图片", dataType: "image", direction: "input", required: true },
    { id: "prompt", label: "文本", dataType: "text", direction: "input" },
  ],
  outputs: [
    { id: "video", label: "视频", dataType: "video", direction: "output" },
  ],
  defaultConfig: { model: "kling-v1", duration: 5, fps: 24 },
};

/** All registered node types */
export const NODE_REGISTRY: Record<string, NodeTypeDefinition> = {
  prompt: PROMPT_NODE,
  "image-input": IMAGE_INPUT_NODE,
  txt2img: TXT2IMG_NODE,
  "img2video": IMG2VIDEO_NODE,
};

// --- Task Types ---

export type TaskStatus = "pending" | "running" | "success" | "failed" | "cancelled";
export type TaskType = "txt2img" | "img2img" | "img2video";

export interface CanvasTask {
  id: string;
  projectId: string;
  nodeId: string;
  userId: string;
  taskType: TaskType;
  status: TaskStatus;
  inputParams: Record<string, unknown>;
  outputData?: GenerationOutput;
  errorMessage?: string;
  createdAt: string;
  completedAt?: string;
}

// --- Project & Canvas Types ---

export interface CanvasFlowData {
  nodes: unknown[];
  edges: unknown[];
  viewport: { x: number; y: number; zoom: number };
}

export interface CanvasProject {
  id: string;
  userId: string;
  name: string;
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCanvas {
  id: string;
  projectId: string;
  userId: string;
  name: string;
  flowData: CanvasFlowData;
  thumbnailUrl?: string;
  createdAt: string;
  updatedAt: string;
}
