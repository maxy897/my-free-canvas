import { useEffect } from "react";
import { useFlowStore } from "../stores/use-flow-store";

interface KeyboardShortcutsOptions {
  enabled?: boolean;
}

/** Check if target is an interactive element where we shouldn't capture keys */
function isInputElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || target.isContentEditable;
}

export function useKeyboardShortcuts(options: KeyboardShortcutsOptions = {}) {
  const { enabled = true } = options;
  const { undo, redo, canUndo, canRedo, deleteSelectedNodes } = useFlowStore();

  useEffect(() => {
    if (!enabled) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Don't intercept when user is typing in an input
      if (isInputElement(event.target)) return;
      const key = event.key.toLowerCase();

      // Cmd+Z (Mac) or Ctrl+Z (Windows/Linux) for undo
      if ((event.metaKey || event.ctrlKey) && key === "z" && !event.shiftKey) {
        event.preventDefault();
        if (canUndo()) {
          undo();
        }
      }

      // Cmd+Shift+Z (Mac) or Ctrl+Shift+Z (Windows/Linux) or Ctrl+Y for redo
      if (
        ((event.metaKey || event.ctrlKey) && event.shiftKey && key === "z") ||
        (event.ctrlKey && key === "y")
      ) {
        event.preventDefault();
        if (canRedo()) {
          redo();
        }
      }

      // Delete/Backspace to delete selected nodes
      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelectedNodes();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [enabled, undo, redo, canUndo, canRedo, deleteSelectedNodes]);
}
