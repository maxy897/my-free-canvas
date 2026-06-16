import { addEdge, type Edge, type Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import { useFlowStore } from "../stores/use-flow-store";
import { makeHandleId } from "./type-system";

const IMAGE_SOURCE_HANDLE = makeHandleId("image", "image", "source");
const IMAGE_TARGET_HANDLE = makeHandleId("image", "image", "target");

type ImageOutput = {
  url: string;
  asset?: unknown;
};

function isGeneratedImageNode(node: Node | undefined, sourceNodeId: string): boolean {
  return node?.type === "image-input" && node.data?.generatedFrom === sourceNodeId;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getAssetNodeData(asset: unknown): Record<string, unknown> {
  if (!isRecord(asset)) return {};

  const details = isRecord(asset.asset_details) ? asset.asset_details : {};
  const data: Record<string, unknown> = { asset };

  if (typeof asset.id === "string") {
    data.assetId = asset.id;
    data.fileKey = asset.id;
  }
  if (typeof asset.title === "string") data.title = asset.title;
  if (typeof asset.type === "string") data.assetType = asset.type;
  if (typeof details.width === "string") data.width = details.width;
  if (typeof details.height === "string") data.height = details.height;
  if (typeof details.size === "string") data.size = details.size;
  if (typeof details.download_url === "string") data.downloadUrl = details.download_url;
  if (typeof details.thumbnail_url === "string") data.thumbnailUrl = details.thumbnail_url;

  return data;
}

function normalizeImageOutputs(imageUrl?: string | string[], asset?: unknown): ImageOutput[] {
  const urls = (Array.isArray(imageUrl) ? imageUrl : [imageUrl]).filter(
    (url): url is string => typeof url === "string" && url.trim().length > 0
  );
  const assets = Array.isArray(asset) ? asset : asset === undefined ? [] : [asset];

  return urls.map((url, index) => ({
    url,
    asset: assets[index] ?? (urls.length === 1 ? assets[0] : undefined),
  }));
}

function getExistingResultNodes(
  nodes: Node[],
  edges: Edge[],
  sourceNodeId: string,
  savedResultNodeId?: unknown
): Node[] {
  const candidateIds = new Set<string>();
  if (typeof savedResultNodeId === "string") candidateIds.add(savedResultNodeId);
  if (Array.isArray(savedResultNodeId)) {
    for (const id of savedResultNodeId) {
      if (typeof id === "string") candidateIds.add(id);
    }
  }

  for (const edge of edges) {
    if (edge.source === sourceNodeId && edge.sourceHandle === IMAGE_SOURCE_HANDLE) {
      candidateIds.add(edge.target);
    }
  }

  return Array.from(candidateIds)
    .map((id) => nodes.find((node) => node.id === id))
    .filter((node): node is Node => isGeneratedImageNode(node, sourceNodeId));
}

export function materializeImageOutputNode(
  sourceNodeId: string,
  imageUrl?: string | string[],
  asset?: unknown,
  resultCount = 1
) {
  const outputs = normalizeImageOutputs(imageUrl, asset);
  if (outputs.length === 0) return;

  const state = useFlowStore.getState();
  const sourceNode = state.nodes.find((node) => node.id === sourceNodeId);
  if (!sourceNode) return;

  const existingResultNodes = getExistingResultNodes(
    state.nodes,
    state.edges,
    sourceNodeId,
    sourceNode.data?.generatedImageNodeIds ?? sourceNode.data?.generatedImageNodeId
  );

  const nextResultNodes = outputs.map((output, index): Node => {
    const existingNode = existingResultNodes[index];
    const assetNodeData = getAssetNodeData(output.asset);
    if (existingNode) {
      return {
        ...existingNode,
        data: {
          ...existingNode.data,
          url: output.url,
          generatedFrom: sourceNodeId,
          label: "生成结果",
          ...assetNodeData,
        },
      };
    }

    return {
      id: nanoid(8),
      type: "image-input",
      position: {
        x: sourceNode.position.x + 420,
        y: sourceNode.position.y + 40 + index * 300,
      },
      data: {
        url: output.url,
        label: "生成结果",
        generatedFrom: sourceNodeId,
        ...assetNodeData,
      },
    };
  });

  const nextResultNodeIds = nextResultNodes.map((node) => node.id);
  const nextResultNodeIdSet = new Set(nextResultNodeIds);
  const staleResultNodeIds = existingResultNodes
    .map((node) => node.id)
    .filter((id) => !nextResultNodeIdSet.has(id));

  console.info("[canvas:materialize-output] materializing generated image nodes", {
    sourceNodeId,
    resultNodeIds: nextResultNodeIds,
    resultCount: outputs.length,
  });

  useFlowStore.setState((current) => ({
    nodes: [
      ...current.nodes
        .map((node) => {
          if (staleResultNodeIds.includes(node.id)) return null;
          if (node.id === sourceNodeId) {
            const { outputUrl: _outputUrl, assets: _assets, ...sourceData } = node.data;
            return {
              ...node,
              data: {
                ...sourceData,
                generatedImageNodeId: nextResultNodeIds[0],
                generatedImageNodeIds: nextResultNodeIds,
                resultCount: Math.max(resultCount, outputs.length),
              },
            };
          }
          const updatedResultNode = nextResultNodes.find((resultNode) => resultNode.id === node.id);
          if (updatedResultNode) return updatedResultNode;
          return node;
        })
        .filter((node): node is Node => Boolean(node)),
      ...nextResultNodes.filter(
        (resultNode) => !current.nodes.some((node) => node.id === resultNode.id)
      ),
    ],
    edges: nextResultNodes.reduce((edges, resultNode) => {
      if (
        edges.some(
          (edge) =>
            edge.source === sourceNodeId &&
            edge.sourceHandle === IMAGE_SOURCE_HANDLE &&
            edge.target === resultNode.id
        )
      ) {
        return edges;
      }

      const nextEdge: Edge = {
        id: `generated-${sourceNodeId}-${resultNode.id}`,
        source: sourceNodeId,
        sourceHandle: IMAGE_SOURCE_HANDLE,
        target: resultNode.id,
        targetHandle: IMAGE_TARGET_HANDLE,
      };
      return addEdge(nextEdge, edges);
    }, current.edges.filter((edge) => !staleResultNodeIds.includes(edge.source) && !staleResultNodeIds.includes(edge.target))),
    isDirty: true,
  }));
}
