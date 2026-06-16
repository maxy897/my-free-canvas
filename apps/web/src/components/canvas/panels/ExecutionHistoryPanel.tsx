import { useExecutionHistory, type ExecutionRecord } from "../stores/use-execution-history";

interface ExecutionHistoryPanelProps {
  nodeId: string;
  onSelectResult?: (record: ExecutionRecord) => void;
  onClose: () => void;
}

export function ExecutionHistoryPanel({ nodeId, onSelectResult, onClose }: ExecutionHistoryPanelProps) {
  const records = useExecutionHistory((s) => s.records[nodeId] || []);
  const clearNodeHistory = useExecutionHistory((s) => s.clearNodeHistory);

  if (records.length === 0) {
    return (
      <div className="absolute right-4 top-4 z-10 w-72 overflow-hidden rounded-[22px] border border-[#3C4654]/80 bg-[#181C23]/90 text-[#F5F7FA] shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div className="flex items-center justify-between border-b border-[#2B313B] px-4 py-3">
          <h3 className="text-sm font-bold text-[#F5F7FA]">执行历史</h3>
          <button onClick={onClose} className="text-lg text-[#788493] hover:text-[#F5F7FA]">&times;</button>
        </div>
        <div className="p-5 text-center text-xs text-[#788493]">暂无执行记录</div>
      </div>
    );
  }

  return (
    <div className="absolute right-4 top-4 z-10 w-72 overflow-hidden rounded-[22px] border border-[#3C4654]/80 bg-[#181C23]/90 text-[#F5F7FA] shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop-blur-xl">
      <div className="flex items-center justify-between border-b border-[#2B313B] px-4 py-3">
        <h3 className="text-sm font-bold text-[#F5F7FA]">执行历史 ({records.length})</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={() => clearNodeHistory(nodeId)}
            className="text-xs text-[#FF5C7A] hover:text-[#ff8aa0]"
            title="清空历史"
          >
            清空
          </button>
          <button onClick={onClose} className="text-lg text-[#788493] hover:text-[#F5F7FA]">&times;</button>
        </div>
      </div>

      <div className="max-h-80 overflow-y-auto p-2 space-y-2">
        {records.map((record) => (
          <div
            key={record.id}
            onClick={() => onSelectResult?.(record)}
            className={`cursor-pointer rounded-2xl border p-2.5 transition-all hover:-translate-y-0.5 ${
              record.status === "success"
                ? "border-[#39E58C]/30 bg-[#113325]/70"
                : "border-[#FF5C7A]/30 bg-[#32131B]/70"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className={`text-xs font-medium ${
                record.status === "success" ? "text-[#39E58C]" : "text-[#FF5C7A]"
              }`}>
                {record.status === "success" ? "成功" : "失败"}
              </span>
              <span className="text-xs text-[#788493]">
                {formatTime(record.timestamp)}
              </span>
            </div>
            {record.outputUrl && (
              <div className="mt-1.5">
                <img
                  src={record.outputUrl}
                  alt="Result"
                  className="h-20 w-full rounded-xl border border-[#2B313B] object-contain"
                />
              </div>
            )}
            {record.errorMessage && (
              <p className="mt-1 truncate text-xs text-[#FF5C7A]">{record.errorMessage}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
