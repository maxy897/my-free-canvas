import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X, Loader2, Sparkles, ImagePlus } from "lucide-react";
import {
  fetchPromptTemplates,
  type PromptTemplate,
} from "../../lib/prompt-templates";

interface PromptTemplatePickerProps {
  open: boolean;
  onClose: () => void;
  onSelect: (content: string, template: PromptTemplate) => void;
}

export function PromptTemplatePicker({ open, onClose, onSelect }: PromptTemplatePickerProps) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchPromptTemplates()
      .then((data) => {
        if (cancelled) return;
        setTemplates(data.templates);
        setCategories(data.categories);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const id = window.setTimeout(() => searchRef.current?.focus(), 60);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
    };
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return templates.filter((t) => {
      if (activeCategory && t.category !== activeCategory) return false;
      if (!q) return true;
      return (
        t.title.toLowerCase().includes(q) ||
        t.content.toLowerCase().includes(q) ||
        t.tags.some((tag) => tag.toLowerCase().includes(q))
      );
    });
  }, [templates, query, activeCategory]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="提示词模板库"
    >
      <div
        className="flex h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#0A0C11] text-[#F5F7FA] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#28D7F5]" />
            <h2 className="text-sm font-bold">提示词模板库</h2>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-[#9AA6B7]">
              {filtered.length} 个模板
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="rounded-lg p-1.5 text-[#9AA6B7] transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search + categories */}
        <div className="space-y-3 border-b border-white/10 px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#788493]" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索标题、内容或标签…"
              className="h-10 w-full rounded-xl border border-white/10 bg-[#050608] pl-9 pr-3 text-sm outline-none transition focus:border-[#28D7F5] focus:ring-2 focus:ring-[#28D7F5]/20"
            />
          </div>
          {categories.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <CategoryChip
                label="全部"
                active={activeCategory === null}
                onClick={() => setActiveCategory(null)}
              />
              {categories.map((cat) => (
                <CategoryChip
                  key={cat}
                  label={cat}
                  active={activeCategory === cat}
                  onClick={() => setActiveCategory(cat)}
                />
              ))}
            </div>
          )}
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-[#9AA6B7]">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> 加载中…
            </div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-sm text-[#FF9AAD]">
              {error}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-[#788493]">
              没有匹配的模板
            </div>
          ) : (
            <div className="grid gap-3">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    onSelect(t.content, t);
                    onClose();
                  }}
                  className="group rounded-2xl border border-white/10 bg-[#050608] p-4 text-left transition hover:border-[#28D7F5]/60 hover:bg-[#0B141A]"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#F5F7FA] group-hover:text-[#91F0FF]">
                      {t.title}
                    </span>
                    {t.needsReference && (
                      <span className="flex shrink-0 items-center gap-1 rounded-full bg-[#28D7F5]/10 px-2 py-0.5 text-[10px] font-medium text-[#91F0FF]">
                        <ImagePlus className="h-2.5 w-2.5" /> 需参考图
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 text-xs leading-5 text-[#9AA6B7]">{t.content}</p>
                  {t.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-[#788493]"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition ${
        active
          ? "bg-[#28D7F5] text-[#04141A]"
          : "bg-white/5 text-[#9AA6B7] hover:bg-white/10 hover:text-white"
      }`}
    >
      {label}
    </button>
  );
}
