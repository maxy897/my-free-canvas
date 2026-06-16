import { describe, it, expect, beforeEach } from "vitest";
import type { Node } from "@xyflow/react";
import { useFlowStore } from "../stores/use-flow-store";
import { useHistory } from "../stores/use-history";
import { materializeImageOutputNode } from "../lib/materialize-output-node";
import { makeHandleId } from "../lib/type-system";

describe("materializeImageOutputNode", () => {
  beforeEach(() => {
    useHistory.getState().clear();
    useFlowStore.setState({
      nodes: [],
      edges: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      isDirty: false,
      enableHistory: true,
      projectId: null,
      canvasId: null,
    });
  });

  it("stores generated asset data on the image node, not the generator node", () => {
    const generator: Node = {
      id: "gen-1",
      type: "txt2img",
      position: { x: 100, y: 100 },
      data: { taskStatus: "success" },
    };

    useFlowStore.setState({ nodes: [generator], edges: [] });

    materializeImageOutputNode(
      "gen-1",
      "https://example.com/result.png",
      {
        id: "asset-1",
        type: "image",
        title: "result.png",
        asset_details: {
          width: "1024",
          height: "1024",
          download_url: "https://example.com/result.png?download=1",
          thumbnail_url: "https://example.com/thumb.jpg",
        },
      },
      3
    );

    const { nodes, edges } = useFlowStore.getState();
    const sourceNode = nodes.find((node) => node.id === "gen-1");
    const imageNode = nodes.find((node) => node.type === "image-input");

    expect(sourceNode?.data).toMatchObject({
      generatedImageNodeId: imageNode?.id,
      resultCount: 3,
    });
    expect(sourceNode?.data).not.toHaveProperty("outputUrl");
    expect(sourceNode?.data).not.toHaveProperty("assets");

    expect(imageNode?.data).toMatchObject({
      url: "https://example.com/result.png",
      generatedFrom: "gen-1",
      assetId: "asset-1",
      thumbnailUrl: "https://example.com/thumb.jpg",
      width: "1024",
      height: "1024",
    });
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ source: "gen-1", target: imageNode?.id });
  });

  it("creates one generated image node per output URL", () => {
    const generator: Node = {
      id: "gen-1",
      type: "txt2img",
      position: { x: 100, y: 100 },
      data: { taskStatus: "success" },
    };

    useFlowStore.setState({ nodes: [generator], edges: [] });

    materializeImageOutputNode(
      "gen-1",
      [
        "https://example.com/result-1.png",
        "https://example.com/result-2.png",
        "https://example.com/result-3.png",
        "https://example.com/result-4.png",
      ],
      [
        { id: "asset-1", type: "image", title: "result-1.png" },
        { id: "asset-2", type: "image", title: "result-2.png" },
        { id: "asset-3", type: "image", title: "result-3.png" },
        { id: "asset-4", type: "image", title: "result-4.png" },
      ],
      4
    );

    const { nodes, edges } = useFlowStore.getState();
    const sourceNode = nodes.find((node) => node.id === "gen-1");
    const imageNodes = nodes.filter((node) => node.type === "image-input");

    expect(imageNodes).toHaveLength(4);
    expect(sourceNode?.data.resultCount).toBe(4);
    expect(sourceNode?.data.generatedImageNodeIds).toEqual(imageNodes.map((node) => node.id));
    expect(imageNodes.map((node) => node.data.url)).toEqual([
      "https://example.com/result-1.png",
      "https://example.com/result-2.png",
      "https://example.com/result-3.png",
      "https://example.com/result-4.png",
    ]);
    expect(imageNodes.map((node) => node.data.assetId)).toEqual([
      "asset-1",
      "asset-2",
      "asset-3",
      "asset-4",
    ]);
    expect(edges).toHaveLength(4);
    expect(edges.map((edge) => edge.target)).toEqual(imageNodes.map((node) => node.id));
  });

  it("updates existing generated image nodes before creating additional ones", () => {
    const sourceHandle = makeHandleId("image", "image", "source");
    const targetHandle = makeHandleId("image", "image", "target");
    const generator: Node = {
      id: "gen-1",
      type: "txt2img",
      position: { x: 100, y: 100 },
      data: {
        taskStatus: "success",
        generatedImageNodeId: "img-1",
        generatedImageNodeIds: ["img-1", "img-2"],
      },
    };
    const existingImageNodes: Node[] = [
      {
        id: "img-1",
        type: "image-input",
        position: { x: 520, y: 140 },
        data: { url: "https://example.com/old-1.png", generatedFrom: "gen-1" },
      },
      {
        id: "img-2",
        type: "image-input",
        position: { x: 520, y: 440 },
        data: { url: "https://example.com/old-2.png", generatedFrom: "gen-1" },
      },
    ];

    useFlowStore.setState({
      nodes: [generator, ...existingImageNodes],
      edges: existingImageNodes.map((node) => ({
        id: `generated-gen-1-${node.id}`,
        source: "gen-1",
        sourceHandle,
        target: node.id,
        targetHandle,
      })),
    });

    materializeImageOutputNode(
      "gen-1",
      [
        "https://example.com/new-1.png",
        "https://example.com/new-2.png",
        "https://example.com/new-3.png",
      ],
      undefined,
      3
    );

    const { nodes, edges } = useFlowStore.getState();
    const imageNodes = nodes.filter((node) => node.type === "image-input");

    expect(imageNodes).toHaveLength(3);
    expect(nodes.find((node) => node.id === "img-1")?.data.url).toBe("https://example.com/new-1.png");
    expect(nodes.find((node) => node.id === "img-2")?.data.url).toBe("https://example.com/new-2.png");
    expect(imageNodes.map((node) => node.data.url)).toContain("https://example.com/new-3.png");
    expect(edges).toHaveLength(3);
  });
});
