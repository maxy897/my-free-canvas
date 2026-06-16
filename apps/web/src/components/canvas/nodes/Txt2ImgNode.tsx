import { Handle, Position, type NodeProps } from "@xyflow/react";
import { type CSSProperties } from "react";
import { makeHandleId, PORT_COLORS, HANDLE_STYLE } from "../lib/type-system";
import type { TaskStatus } from "@shared/types";
import { Sparkles, CheckCircle2, AlertCircle, X, Loader2 } from "lucide-react";

const SIZE_OPTIONS = ["auto", "1:1", "3:2", "2:3", "16:9", "21:9", "9:16", "4:3", "3:4"];
const RESOLUTION_OPTIONS = ["1080p", "2k", "4k"];

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<string | { value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[9px] font-medium uppercase tracking-[0.12em] text-[#788493]">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="canvas-field nodrag min-h-8 w-full rounded-lg px-2 py-1 text-[10px] font-medium text-[#F5F7FA] outline-none focus:border-[#8B5CF6]"
      >
        {options.map((option) => {
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;
          return (
            <option key={optionValue} value={optionValue}>
              {optionLabel}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function Txt2ImgNode({ data }: NodeProps) {
  const status = (data.taskStatus as TaskStatus) || null;
  const onExecute = data.onExecute as (() => void) | undefined;
  const onCancel = data.onCancel as (() => void) | undefined;
  const canExecute = Boolean(data.canExecute);
  const batchCount = (data.n as number) || (data.batchCount as number) || 1;
  const onBatchChange = data.onBatchChange as ((n: number) => void) | undefined;
  const onConfigChange = data.onConfigChange as ((config: Record<string, unknown>) => void) | undefined;
  const size = (data.size as string) || "auto";
  const imageResolution = (data.image_resolution as string) || "1080p";
  const referenceImageCount = (data.referenceImageCount as number) || 0;
  const resultCount = (data.resultCount as number) || 0;
  const generatedImageNodeId = data.generatedImageNodeId as string | undefined;
  const taskId = data.taskId as string | undefined;
  const taskError = typeof data.taskError === "string" ? data.taskError : "";
  const updateConfig = (config: Record<string, unknown>) => onConfigChange?.(config);
  const isPending = status === "pending";
  const isRunning = status === "running";
  const isBusy = isPending || isRunning;
  const canCancel = isRunning && Boolean(taskId && onCancel);

  const renderPrimaryAction = () => (
    <div className="px-4 pb-4">
      <button
        type="button"
        onClick={canCancel ? onCancel : onExecute}
        disabled={isPending || (isRunning && !canCancel) || (!isBusy && !canExecute)}
        title={isPending ? "正在提交任务" : isRunning ? "Cancel" : canExecute ? "Generate" : "连接一个非空文本节点后生成"}
        className={
          isBusy
            ? "flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-[#FF9AAD]/30 bg-[#FF5C7A]/[0.12] text-xs font-bold text-[#FFB3C1] transition-colors hover:bg-[#FF5C7A]/[0.18] disabled:cursor-not-allowed disabled:opacity-40"
            : "flex h-10 w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] text-xs font-bold text-white shadow-[0_8px_22px_rgba(99,102,241,0.28)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        }
      >
        {isBusy ? (
          <>
            {canCancel ? <X className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {canCancel ? "Cancel" : "Starting..."}
          </>
        ) : (
          <>
            <Sparkles className="h-3.5 w-3.5" /> Generate
          </>
        )}
      </button>
    </div>
  );

  const renderParamSummary = () => (
    <div className="px-4 pb-3 space-y-2">
      {referenceImageCount > 0 && (
        <div className="rounded-xl border border-[#28D7F5]/20 bg-[#28D7F5]/[0.08] px-3 py-2 text-[10px] font-medium text-[#91F0FF]">
          已连接 {referenceImageCount} 张参考图，将按图生图执行
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <SelectField
          label="Size"
          value={size}
          options={SIZE_OPTIONS}
          onChange={(value) => updateConfig({ size: value })}
        />
        <SelectField
          label="Resolution"
          value={imageResolution}
          options={RESOLUTION_OPTIONS}
          onChange={(value) => updateConfig({ image_resolution: value })}
        />
      </div>
      <div>
        <SelectField
          label="Count"
          value={String(batchCount)}
          options={["1", "2", "3", "4"]}
          onChange={(value) => onBatchChange?.(Number(value))}
        />
      </div>
    </div>
  );

  const renderContent = () => {
    if (isBusy) {
      return (
        <>
          {renderParamSummary()}
          <div className="px-4 pb-3">
            <div className="relative flex h-[180px] flex-col items-center justify-center overflow-hidden rounded-xl border border-white/5 bg-gradient-to-br from-[#1E1B4B]/80 via-[#312E81]/80 to-[#1e1b4b]/80">
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ animation: "shimmer 2s ease-in-out infinite" }}></div>
              <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#8B5CF6]/40 to-[#6366F1]/40 flex items-center justify-center animate-breathe relative">
                <div className="absolute inset-0 rounded-full bg-[#8B5CF6]/20" style={{ animation: "pulse-ring 2s ease-out infinite" }}></div>
                <Sparkles className="w-6 h-6 text-[#A78BFA]" />
              </div>
              <span className="text-sm font-semibold text-[#A78BFA] mt-3">
                {isPending ? "Starting..." : "Generating..."}
              </span>
            </div>
          </div>
          {renderPrimaryAction()}
        </>
      );
    }

    if (status === "success") {
      return (
        <>
          {renderParamSummary()}
          <div className="px-4 pb-3">
            <div className="rounded-xl border border-[#39E58C]/20 bg-[#39E58C]/[0.08] px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-[#9FF6C3]">
                <CheckCircle2 className="h-3.5 w-3.5" />
                <span>{resultCount > 1 ? `${resultCount} images ready` : "Image ready"}</span>
              </div>
              <div className="mt-1 text-[10px] leading-4 text-[#7D8A99]">
                结果已输出到右侧图片节点{generatedImageNodeId ? ` #${generatedImageNodeId}` : ""}
              </div>
            </div>
          </div>
          {renderPrimaryAction()}
        </>
      );
    }

    if (status === "failed") {
      return (
        <>
          {renderParamSummary()}
          <div className="px-4 pb-3">
            <div className="rounded-xl border border-[#FF5C7A]/25 bg-[#FF5C7A]/[0.08] px-3 py-2.5 text-[10px] leading-4 text-[#FF9AAD]">
              <div className="mb-1 flex items-center gap-1.5 font-semibold">
                <AlertCircle className="h-3.5 w-3.5" />
                生成失败
              </div>
              <p className="whitespace-pre-wrap break-words">
                {taskError || "请调整参数后重新生成"}
              </p>
            </div>
          </div>
          {renderPrimaryAction()}
        </>
      );
    }

    // Default / Input state
    return (
      <>
        {renderParamSummary()}
        {renderPrimaryAction()}
      </>
    );
  };

  return (
    <div 
      className="canvas-node w-[280px] rounded-[20px] text-[#F5F7FA]"
      style={{
        "--node-accent": "rgba(139, 92, 246, 0.88)",
        "--node-glow": "rgba(139, 92, 246, 0.28)",
      } as CSSProperties}
    >
      <div className="canvas-node-header px-4 py-3 flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold text-white bg-gradient-to-r from-[#8B5CF6] to-[#6366F1] px-2.5 py-0.5 rounded-full shadow-[0_0_10px_rgba(139,92,246,0.4)]">AI Image</span>
          {isBusy && <span className="text-[10px] text-[#A78BFA] font-medium animate-breathe">{isPending ? "Starting..." : "Generating..."}</span>}
          {status === "success" && <span className="text-[10px] text-[#39E58C] font-medium">● Complete</span>}
          {status === "failed" && <span className="text-[10px] text-[#FF5C7A] font-medium">● Failed</span>}
        </div>
        {status === "success" && resultCount > 1 && (
          <span className="text-[10px] text-[#9AA6B7]">{resultCount} results</span>
        )}
      </div>

      {renderContent()}

      {/* Input handles */}
      <Handle
        type="target"
        position={Position.Left}
        id={makeHandleId("prompt", "text", "target")}
        style={{ ...HANDLE_STYLE, background: PORT_COLORS.text, borderColor: PORT_COLORS.text, top: "30%" }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id={makeHandleId("reference_images", "image", "target")}
        title="参考图"
        style={{ ...HANDLE_STYLE, background: PORT_COLORS.image, borderColor: PORT_COLORS.image, top: "62%" }}
      />
      {/* Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id={makeHandleId("image", "image", "source")}
        style={{ ...HANDLE_STYLE, background: PORT_COLORS.image, borderColor: PORT_COLORS.image }}
      />
    </div>
  );
}
