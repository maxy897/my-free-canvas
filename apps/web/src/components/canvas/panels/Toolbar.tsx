import { NODE_REGISTRY, type NodeTypeDefinition } from "@shared/types";
import { Download, Images, Image as ImageIcon, MessageSquare, Sparkles } from "lucide-react";

interface ToolbarProps {
  onAddNode: (nodeType: NodeTypeDefinition) => void;
  onExportJson?: () => void;
  onOpenGallery?: () => void;
}

const HIDDEN_NODE_TYPES = new Set(["img2video"]);

export function Toolbar({ onAddNode, onExportJson, onOpenGallery }: ToolbarProps) {
  const nodeTone = (nodeType: NodeTypeDefinition) => {
    if (nodeType.type === "prompt") return "border-[#FFB454]/28 bg-[#22160B]/72 text-[#FFD49A]";
    if (nodeType.type === "image-input") return "border-[#28D7F5]/28 bg-[#071F2A]/72 text-[#91F0FF]";
    return "border-[#28D7F5]/28 bg-[#071F2A]/72 text-[#91F0FF]";
  };

  const nodeGlyph = (nodeType: NodeTypeDefinition) => {
    if (nodeType.type === "prompt") return <MessageSquare className="size-3" />;
    if (nodeType.type === "image-input") return <ImageIcon className="size-3" />;
    return <Sparkles className="size-3" />;
  };

  return (
    <div className="absolute left-5 top-5 z-20 flex items-start gap-2">
      <div className="flex items-center gap-2 rounded-[26px] border border-white/10 bg-[#070C14]/86 p-1.5 shadow-[0_18px_56px_rgba(0,0,0,0.38),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
        <a
          href="/canvas"
          aria-label="返回画布列表"
          title="返回画布列表"
          className="flex size-9 items-center justify-center rounded-full border border-white/10 bg-white/[0.035] font-mono text-base font-semibold text-[#F5F7FA] transition hover:border-[#28D7F5]/45 hover:bg-white/[0.08] hover:text-[#91F0FF] focus-visible:ring-2 focus-visible:ring-[#28D7F5]/70"
        >
          {"<"}
        </a>
        {Object.values(NODE_REGISTRY)
          .filter((nodeType) => !HIDDEN_NODE_TYPES.has(nodeType.type))
          .map((nodeType) => (
            <button
              key={nodeType.type}
              type="button"
              onClick={() => onAddNode(nodeType)}
              title={nodeType.label}
              className={`group flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:border-white/30 hover:bg-white/[0.08] focus-visible:ring-2 focus-visible:ring-[#28D7F5]/70 ${nodeTone(nodeType)}`}
            >
              <span className="flex size-5 items-center justify-center rounded-full bg-black/28 font-mono text-[10px] text-current ring-1 ring-white/10">
                {nodeGlyph(nodeType)}
              </span>
              <span>{nodeType.label}</span>
            </button>
          ))}
        {onExportJson && (
          <>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <button
              type="button"
              onClick={onExportJson}
              className="flex min-h-9 items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.035] px-3.5 py-1.5 text-xs font-semibold text-[#E6E6E6] transition hover:border-[#28D7F5]/45 hover:bg-white/[0.08] hover:text-white focus-visible:ring-2 focus-visible:ring-[#28D7F5]/70"
              title="导出画布 JSON"
            >
              <Download className="size-3.5" />
              导出 JSON
            </button>
          </>
        )}
        {onOpenGallery && (
          <>
            <span className="mx-1 h-5 w-px bg-white/10" />
            <button
              type="button"
              onClick={onOpenGallery}
              className="flex min-h-9 items-center gap-1.5 rounded-full border border-[#28D7F5]/30 bg-[#071F2A]/72 px-3.5 py-1.5 text-xs font-semibold text-[#91F0FF] transition hover:border-[#28D7F5]/60 hover:bg-[#0A2A38] focus-visible:ring-2 focus-visible:ring-[#28D7F5]/70"
              title="查看当前画布素材"
            >
              <Images className="size-3.5" />
              素材
            </button>
          </>
        )}
      </div>
    </div>
  );
}
