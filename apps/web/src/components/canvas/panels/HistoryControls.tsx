import { useFlowStore } from "../stores/use-flow-store";
import { useHistory } from "../stores/use-history";

export function HistoryControls() {
  const { undo, redo } = useFlowStore();
  const canUndo = useHistory((state) => state.past.length > 0);
  const canRedo = useHistory((state) => state.future.length > 0);

  return (
    <div className="absolute left-4 top-[66px] z-10 flex gap-1 rounded-full border border-[#3C4654]/70 bg-[#181C23]/80 p-1.5 shadow-[0_18px_55px_rgba(0,0,0,0.32)] backdrop-blur-xl">
      <button
        type="button"
        onClick={() => undo()}
        disabled={!canUndo}
        title="撤销 (Cmd+Z)"
        aria-label="撤销"
        className="rounded-full p-2 text-[#B8C0CC] transition-colors hover:bg-[#1D2129] hover:text-[#F5F7FA] disabled:cursor-not-allowed disabled:opacity-35"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l-4-4m0 0l4-4m-4 4h12"
          />
        </svg>
      </button>

      <button
        type="button"
        onClick={() => redo()}
        disabled={!canRedo}
        title="重做 (Cmd+Shift+Z)"
        aria-label="重做"
        className="rounded-full p-2 text-[#B8C0CC] transition-colors hover:bg-[#1D2129] hover:text-[#F5F7FA] disabled:cursor-not-allowed disabled:opacity-35"
      >
        <svg
          className="w-4 h-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M17 8l4 4m0 0l-4 4m4-4H9a5 5 0 010-10h.88A5 5 0 0117 8z"
          />
        </svg>
      </button>
    </div>
  );
}
