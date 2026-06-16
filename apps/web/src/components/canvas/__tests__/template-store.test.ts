import { describe, it, expect, beforeEach } from "vitest";
import { useTemplateStore } from "../stores/use-template-store";
import type { Node, Edge } from "@xyflow/react";

describe("Template Store", () => {
  beforeEach(() => {
    useTemplateStore.setState({ templates: [] });
  });

  const sampleNodes: Node[] = [
    { id: "n1", type: "prompt", position: { x: 0, y: 0 }, data: { text: "hello" } },
    { id: "n2", type: "txt2img", position: { x: 200, y: 0 }, data: {} },
  ];
  const sampleEdges: Edge[] = [
    { id: "e1", source: "n1", target: "n2" },
  ];

  it("saves a workflow template", () => {
    useTemplateStore.getState().saveTemplate({
      id: "t1",
      name: "My Template",
      nodes: sampleNodes,
      edges: sampleEdges,
      createdAt: Date.now(),
    });

    const templates = useTemplateStore.getState().getTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe("My Template");
    expect(templates[0].nodes).toHaveLength(2);
    expect(templates[0].edges).toHaveLength(1);
  });

  it("stores most recent template first", () => {
    useTemplateStore.getState().saveTemplate({
      id: "t1",
      name: "First",
      nodes: [],
      edges: [],
      createdAt: 1000,
    });
    useTemplateStore.getState().saveTemplate({
      id: "t2",
      name: "Second",
      nodes: [],
      edges: [],
      createdAt: 2000,
    });

    const templates = useTemplateStore.getState().getTemplates();
    expect(templates[0].name).toBe("Second");
    expect(templates[1].name).toBe("First");
  });

  it("deletes a template by id", () => {
    useTemplateStore.getState().saveTemplate({
      id: "t1",
      name: "To Delete",
      nodes: sampleNodes,
      edges: sampleEdges,
      createdAt: Date.now(),
    });
    useTemplateStore.getState().saveTemplate({
      id: "t2",
      name: "To Keep",
      nodes: [],
      edges: [],
      createdAt: Date.now(),
    });

    useTemplateStore.getState().deleteTemplate("t1");
    const templates = useTemplateStore.getState().getTemplates();
    expect(templates).toHaveLength(1);
    expect(templates[0].name).toBe("To Keep");
  });

  it("renames a template", () => {
    useTemplateStore.getState().saveTemplate({
      id: "t1",
      name: "Old Name",
      nodes: [],
      edges: [],
      createdAt: Date.now(),
    });

    useTemplateStore.getState().renameTemplate("t1", "New Name");
    const templates = useTemplateStore.getState().getTemplates();
    expect(templates[0].name).toBe("New Name");
  });

  it("template preserves node data", () => {
    useTemplateStore.getState().saveTemplate({
      id: "t1",
      name: "With Data",
      nodes: sampleNodes,
      edges: sampleEdges,
      createdAt: Date.now(),
    });

    const templates = useTemplateStore.getState().getTemplates();
    const promptNode = templates[0].nodes.find((n) => n.type === "prompt");
    expect(promptNode?.data.text).toBe("hello");
  });
});
