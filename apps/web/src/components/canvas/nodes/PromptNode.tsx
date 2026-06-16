import { Handle, Position, type NodeProps } from "@xyflow/react";
import { useState, type CSSProperties } from "react";
import { makeHandleId, PORT_COLORS, HANDLE_STYLE } from "../lib/type-system";
import { MessageSquare, Sparkles } from "lucide-react";
import { PromptTemplatePicker } from "../PromptTemplatePicker";

export function PromptNode({ id, data }: NodeProps) {
  const text = (data.text as string) || "";
  const onChange = data.onChange as ((value: string) => void) | undefined;
  const onCommit = data.onCommit as (() => void) | undefined;
  const [pickerOpen, setPickerOpen] = useState(false);

  return (
    <div
      className="canvas-node w-[280px] rounded-[20px] text-[#F5F7FA]"
      style={{
        "--node-accent": "rgba(255, 180, 84, 0.88)",
        "--node-glow": "rgba(255, 180, 84, 0.28)",
      } as CSSProperties}
    >
      <div className="canvas-node-header px-4 py-3 flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-[#432305] bg-gradient-to-r from-[#FFB454] to-[#F59E0B] px-2.5 py-0.5 rounded-full shadow-[0_0_10px_rgba(255,180,84,0.4)] flex items-center gap-1">
            <MessageSquare className="w-2.5 h-2.5" /> Prompt
          </span>
        </div>
        <button
          type="button"
          className="nodrag flex items-center gap-1 rounded-full border border-[#FFB454]/40 bg-[#FFB454]/10 px-2 py-0.5 text-[9px] font-medium text-[#FFD9A6] transition-colors hover:bg-[#FFB454]/20"
          onClick={() => setPickerOpen(true)}
        >
          <Sparkles className="h-2.5 w-2.5" /> 模板
        </button>
      </div>
      
      <div className="px-4 pb-4">
        <textarea
          aria-label="Prompt text"
          className="canvas-field h-28 w-full resize-none rounded-xl p-3 text-xs leading-5 text-[#F5F7FA] outline-none placeholder:text-[#788493] transition-colors focus:border-[#FFB454] focus:ring-1 focus:ring-[#FFB454]/40"
          placeholder="描述你想生成的内容..."
          value={text}
          onChange={(e) => onChange?.(e.target.value)}
          onBlur={() => onCommit?.()}
        />
      </div>

      <PromptTemplatePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={(content) => {
          onChange?.(content);
          onCommit?.();
        }}
      />

      <Handle
        type="source"
        position={Position.Right}
        id={makeHandleId("text", "text", "source")}
        style={{ ...HANDLE_STYLE, background: PORT_COLORS.text, borderColor: PORT_COLORS.text }}
      />
    </div>
  );
}
