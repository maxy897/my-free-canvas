import { NODE_REGISTRY } from "@shared/types";
import type { NodeTypeDefinition } from "@shared/types";
import type { DragEvent } from "react";

interface NodePaletteProps {
  onNodeSelect: (nodeType: NodeTypeDefinition) => void;
}

/** MIME type used for drag-and-drop node type transfer */
export const DND_NODE_TYPE = "application/x-canvas-node-type";

const HIDDEN_NODE_TYPES = new Set(["img2video"]);
const availableNodeTypes = Object.values(NODE_REGISTRY).filter((n) => !HIDDEN_NODE_TYPES.has(n.type));

const nodesByCategory = {
  input: availableNodeTypes.filter((n) => n.category === "input"),
  generate: availableNodeTypes.filter((n) => n.category === "generate"),
};

const CATEGORY_LABELS: Record<string, string> = {
  input: "输入节点",
  generate: "生成节点",
};

const CATEGORY_COLORS: Record<string, string> = {
  input: "border-[#FFB454]/25 bg-[#332311]/55 text-[#FFB454]",
  generate: "border-[#28D7F5]/25 bg-[#102B33]/55 text-[#28D7F5]",
};

const NODE_ICONS: Record<string, string> = {
  prompt: "T",
  "image-input": "I",
  txt2img: "IG",
  "img2video": "VG",
};

export function NodePalette({ onNodeSelect }: NodePaletteProps) {
  const onDragStart = (event: DragEvent, nodeType: string) => {
    event.dataTransfer.setData(DND_NODE_TYPE, nodeType);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="max-w-sm overflow-hidden rounded-[22px] border border-[#3C4654]/80 bg-[#181C23]/90 text-[#F5F7FA] shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="border-b border-[#2B313B] px-4 py-3">
        <h3 className="text-sm font-bold text-[#F5F7FA]">添加节点</h3>
        <p className="mt-0.5 text-xs text-[#788493]">拖拽到画布或点击添加</p>
      </div>

      <div className="max-h-96 overflow-y-auto p-3 space-y-3">
        {Object.entries(nodesByCategory).map(([category, nodes]) => (
          nodes.length > 0 && (
            <div key={category}>
              <div className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#788493]">
                {CATEGORY_LABELS[category] || category}
              </div>
              <div className="space-y-1.5">
                {nodes.map((node) => (
                  <button
                    key={node.type}
                    draggable
                    onDragStart={(e) => onDragStart(e, node.type)}
                    onClick={() => onNodeSelect(node)}
                    className={`w-full cursor-grab rounded-2xl border px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:border-white/20 active:cursor-grabbing ${
                      CATEGORY_COLORS[category] || "border-[#3C4654] bg-[#1D2129] text-[#B8C0CC]"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="rounded-lg border border-current/25 px-1.5 py-1 font-mono text-[10px] font-semibold">
                        {NODE_ICONS[node.type] || "N"}
                      </span>
                      <div className="flex-1">
                        <div className="text-xs font-semibold text-[#F5F7FA]">{node.label}</div>
                        <div className="text-xs text-[#788493]">
                          {node.inputs.length} 输入 · {node.outputs.length} 输出
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )
        ))}
      </div>
    </div>
  );
}
