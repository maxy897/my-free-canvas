import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { createCanvasEditorUrl, createEditorCanvas } from "./lib/create-editor-canvas";

interface QuickCreateCanvasButtonProps {
  className: string;
  children: ReactNode;
  loadingLabel?: string;
}

export function QuickCreateCanvasButton({
  className,
  children,
  loadingLabel = "正在创建...",
}: QuickCreateCanvasButtonProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick(): Promise<void> {
    if (loading) return;

    setLoading(true);
    setError(null);
    try {
      const ids = await createEditorCanvas();
      window.location.href = createCanvasEditorUrl(ids);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建画布失败");
      setLoading(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-2">
      <button type="button" onClick={handleClick} disabled={loading} className={className}>
        {loading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {loadingLabel}
          </>
        ) : (
          children
        )}
      </button>
      {error && <span className="text-xs text-[#FFB6C4]">{error}</span>}
    </span>
  );
}
