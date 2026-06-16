import type { NodeTypes } from "@xyflow/react";
import { PromptNode } from "./PromptNode";
import { Txt2ImgNode } from "./Txt2ImgNode";
import { Img2VideoNode } from "./Img2VideoNode";
import { ImageInputNode } from "./ImageInputNode";

export const nodeTypes: NodeTypes = {
  prompt: PromptNode,
  "image-input": ImageInputNode,
  txt2img: Txt2ImgNode,
  "img2video": Img2VideoNode,
};
