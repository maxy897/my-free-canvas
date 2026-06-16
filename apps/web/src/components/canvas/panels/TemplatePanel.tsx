import { useState } from "react";
import { nanoid } from "nanoid";
import { useFlowStore } from "../stores/use-flow-store";
import { useTemplateStore, type WorkflowTemplate } from "../stores/use-template-store";

interface TemplatePanelProps {
  onClose: () => void;
}

export function TemplatePanel({ onClose }: TemplatePanelProps) {
  const [saveName, setSaveName] = useState("");
  const templates = useTemplateStore((s) => s.templates);
  const { saveTemplate, deleteTemplate } = useTemplateStore();
  const { nodes, edges, setFlow } = useFlowStore();

  const handleSave = () => {
    if (!saveName.trim()) return;
    saveTemplate({
      id: nanoid(8),
      name: saveName.trim(),
      nodes,
      edges,
      createdAt: Date.now(),
    });
    setSaveName("");
  };

  const handleLoad = (template: WorkflowTemplate) => {
    // Generate new IDs to avoid conflicts
    const idMap = new Map<string, string>();
    const newNodes = template.nodes.map((n) => {
      const newId = nanoid(8);
      idMap.set(n.id, newId);
      return { ...n, id: newId };
    });
    const newEdges = template.edges.map((e) => ({
      ...e,
      id: nanoid(8),
      source: idMap.get(e.source) || e.source,
      target: idMap.get(e.target) || e.target,
    }));

    setFlow({ nodes: newNodes, edges: newEdges });
    onClose();
  };

  return (
    <div className="absolute right-4 top-4 z-10 w-80 overflow-hidden rounded-[22px] border border-[#3C4654]/80 bg-[#181C23]/90 text-[#F5F7FA] shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[#2B313B] px-4 py-3">
        <h3 className="text-sm font-bold text-[#F5F7FA]">工作流模板</h3>
        <button onClick={onClose} className="text-lg text-[#788493] hover:text-[#F5F7FA]">&times;</button>
      </div>

      {/* Save current workflow */}
      <div className="border-b border-[#2B313B] px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="模板名称..."
            className="flex-1 rounded-xl border border-[#2B313B] bg-[#101319] px-3 py-2 text-xs text-[#F5F7FA] outline-none placeholder:text-[#788493] focus:border-[#28D7F5]"
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
          />
          <button
            onClick={handleSave}
            disabled={!saveName.trim() || nodes.length === 0}
            className="rounded-full bg-[#F5F7FA] px-3 py-2 text-xs font-semibold text-[#050608] hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            保存
          </button>
        </div>
        {nodes.length === 0 && (
          <p className="mt-2 text-xs text-[#788493]">画布为空，无法保存</p>
        )}
      </div>

      {/* Template list */}
      <div className="max-h-72 overflow-y-auto p-3 space-y-2">
        {templates.length === 0 ? (
          <p className="py-5 text-center text-xs text-[#788493]">暂无保存的模板</p>
        ) : (
          templates.map((t) => (
            <div
              key={t.id}
              className="rounded-2xl border border-[#2B313B] bg-[#101319] p-3 transition-colors hover:border-[#28D7F5]/55"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-[#F5F7FA]">{t.name}</span>
                <span className="text-xs text-[#788493]">
                  {t.nodes.length} 节点
                </span>
              </div>
              <div className="flex items-center gap-2 mt-2">
                <button
                  onClick={() => handleLoad(t)}
                  className="flex-1 rounded-full border border-[#28D7F5]/30 bg-[#102B33] px-2 py-1.5 text-xs font-semibold text-[#28D7F5] hover:border-[#28D7F5]/70"
                >
                  导入
                </button>
                <button
                  onClick={() => deleteTemplate(t.id)}
                  className="rounded-full border border-[#FF5C7A]/25 bg-[#32131B] px-3 py-1.5 text-xs text-[#FF5C7A] hover:border-[#FF5C7A]/70"
                >
                  删除
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
