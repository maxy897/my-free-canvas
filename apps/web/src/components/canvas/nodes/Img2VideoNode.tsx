import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CSSProperties } from "react";
import { makeHandleId, PORT_COLORS, HANDLE_STYLE } from "../lib/type-system";
import type { TaskStatus } from "@shared/types";
import { Wand2, Upload, RefreshCw, Download, Film } from "lucide-react";

export function Img2VideoNode({ id, data }: NodeProps) {
  const status = (data.taskStatus as TaskStatus) || null;
  const onExecute = data.onExecute as (() => void) | undefined;
  const outputUrl = data.outputUrl as string | undefined;
  const taskError = typeof data.taskError === "string" ? data.taskError : "";
  const isBusy = status === "pending" || status === "running";

  const renderContent = () => {
    if (isBusy) {
      return (
        <div className="px-4 pb-4">
          <div className="relative flex h-[200px] flex-col items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-gradient-to-br from-[#1E1B4B]/80 via-[#172554]/80 to-[#1e3a8a]/80">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ animation: "shimmer 2.5s ease-in-out infinite" }}></div>
            <div className="relative w-20 h-20 mb-3">
              <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
                <circle cx="40" cy="40" r="34" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="4" />
                <circle cx="40" cy="40" r="34" fill="none" stroke="url(#blueGrad)" strokeWidth="4" strokeLinecap="round" strokeDasharray="213.6" strokeDashoffset="85" />
                <defs>
                  <linearGradient id="blueGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#6366F1" />
                    <stop offset="100%" stopColor="#3B82F6" />
                  </linearGradient>
                </defs>
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-sm font-bold text-[#818CF8]">Wait</span>
              </div>
            </div>
            <span className="text-[11px] font-medium text-[#818CF8]">
              {status === "pending" ? "Starting video task..." : "Generating video..."}
            </span>
          </div>
        </div>
      );
    }

    if (status === "success" && outputUrl) {
      return (
        <>
          <div className="px-4 pb-2">
            <div className="relative h-[150px] overflow-hidden rounded-xl border border-white/10 bg-black/40">
              <video src={outputUrl} controls className="w-full h-full object-contain" />
            </div>
          </div>
          <div className="px-4 pb-3 flex items-center gap-1.5">
            <button type="button" onClick={onExecute} className="flex min-h-8 items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[10px] text-[#B8C0CC] transition-colors hover:bg-white/10 hover:text-white">
              <RefreshCw className="w-3 h-3" /> Redo
            </button>
            <button type="button" className="flex min-h-8 items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[10px] text-[#B8C0CC] transition-colors hover:bg-white/10 hover:text-white">
              <Download className="w-3 h-3" /> Download
            </button>
            <button type="button" className="flex min-h-8 items-center gap-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[10px] text-[#B8C0CC] transition-colors hover:bg-white/10 hover:text-white">
              <Film className="w-3 h-3" /> To Node
            </button>
          </div>
        </>
      );
    }

    if (status === "failed") {
      return (
        <div className="px-4 pb-4">
          <div className="rounded-xl border border-[#FF5C7A]/25 bg-[#FF5C7A]/[0.08] px-3 py-2.5 text-[10px] leading-4 text-[#FF9AAD]">
            <div className="mb-1 font-semibold">生成失败</div>
            <p className="whitespace-pre-wrap break-words">
              {taskError || "请调整参数后重新生成"}
            </p>
          </div>
          <button 
            type="button"
            onClick={onExecute}
            className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#6366F1] to-[#3B82F6] text-xs font-bold text-white shadow-[0_8px_22px_rgba(99,102,241,0.28)] transition-opacity hover:opacity-90"
          >
            <Wand2 className="w-3.5 h-3.5" /> Retry
          </button>
        </div>
      );
    }

    // Default / Input state
    return (
      <>
        <div className="px-4 pb-2">
          <div className="canvas-field w-full rounded-xl p-2.5">
            <p className="text-[11px] text-[#9AA6B7] leading-relaxed">
              Generate video clips from prompts and reference images...
            </p>
          </div>
        </div>
        <div className="px-4 pb-2">
          <div className="flex h-[60px] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-white/10 bg-black/10 transition-colors hover:border-[#6366F1]/50">
            <Upload className="w-4 h-4 text-[#788493] mb-1" />
            <span className="text-[9px] text-[#788493]">Drop reference image here or connect input</span>
          </div>
        </div>
        <div className="px-4 pb-3">
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-[#9AA6B7]">Duration:</span>
            <span className="text-[9px] font-medium text-[#788493] bg-white/5 px-2 py-1 rounded-md border border-transparent">5s</span>
            <span className="text-[9px] font-medium bg-[#6366F1]/20 text-[#818CF8] px-2 py-1 rounded-md border border-[#6366F1]/30">10s</span>
            <span className="text-[9px] font-medium text-[#788493] bg-white/5 px-2 py-1 rounded-md border border-transparent">15s</span>
          </div>
        </div>
        <div className="px-4 pb-4">
          <button 
            type="button"
            onClick={onExecute}
            disabled={isBusy}
            className="flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#6366F1] to-[#3B82F6] text-xs font-bold text-white shadow-[0_8px_22px_rgba(99,102,241,0.28)] transition-opacity hover:opacity-90"
          >
            <Wand2 className="w-3.5 h-3.5" /> Generate Video
          </button>
        </div>
      </>
    );
  };

  return (
    <div 
      className="canvas-node w-[280px] rounded-[20px] text-[#F5F7FA]"
      style={{
        "--node-accent": "rgba(99, 102, 241, 0.88)",
        "--node-glow": "rgba(99, 102, 241, 0.28)",
      } as CSSProperties}
    >
      <div className="canvas-node-header px-4 py-3 flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-white bg-gradient-to-r from-[#6366F1] to-[#3B82F6] px-2.5 py-0.5 rounded-full shadow-[0_0_10px_rgba(99,102,241,0.4)]">AI Video</span>
          {isBusy && <span className="text-[10px] text-[#818CF8] font-medium animate-breathe">{status === "pending" ? "Starting..." : "Processing..."}</span>}
          {status === "success" && <span className="text-[10px] text-[#39E58C] font-medium">● Complete</span>}
          {status === "failed" && <span className="text-[10px] text-[#FF5C7A] font-medium">● Failed</span>}
        </div>
        {status === "success" && <span className="text-[10px] text-[#9AA6B7]">10s · 1080p</span>}
      </div>

      {renderContent()}

      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id={makeHandleId("image", "image", "target")}
        style={{ ...HANDLE_STYLE, background: PORT_COLORS.image, borderColor: PORT_COLORS.image, top: "30%" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={makeHandleId("prompt", "text", "target")}
        style={{ ...HANDLE_STYLE, background: PORT_COLORS.text, borderColor: PORT_COLORS.text, top: "60%" }}
      />

      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={makeHandleId("video", "video", "source")}
        style={{ ...HANDLE_STYLE, background: PORT_COLORS.video, borderColor: PORT_COLORS.video }}
      />
    </div>
  );
}
