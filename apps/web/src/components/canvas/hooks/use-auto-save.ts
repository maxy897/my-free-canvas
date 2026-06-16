import { useEffect, useRef } from "react";
import { useFlowStore } from "../stores/use-flow-store";
import { generateThumbnailSvg } from "../lib/thumbnail-generator";

const API_BASE = import.meta.env.PUBLIC_API_URL || "http://localhost:8787";
const SAVE_DEBOUNCE_MS = 3000;

/**
 * Auto-save hook: debounces dirty state and syncs to remote D1 via PUT.
 * Also generates a thumbnail on save.
 * Only activates when projectId and canvasId are set.
 */
export function useAutoSave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unsubscribe = useFlowStore.subscribe((state, prevState) => {
      if (!state.isDirty || !state.projectId || !state.canvasId) return;
      if (state.isDirty === prevState.isDirty && state.nodes === prevState.nodes && state.edges === prevState.edges) return;

      // Clear previous timer
      if (timerRef.current) clearTimeout(timerRef.current);

      // Debounce save
      timerRef.current = setTimeout(async () => {
        const { projectId, canvasId, nodes, edges, viewport, markClean } = useFlowStore.getState();
        if (!projectId || !canvasId) return;

        // Generate thumbnail from current canvas state
        const thumbnailUrl = generateThumbnailSvg(nodes, edges);

        try {
          const res = await fetch(`${API_BASE}/api/canvas/projects/${projectId}/canvases/${canvasId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({
              flowData: { nodes, edges, viewport },
              thumbnailUrl: thumbnailUrl || undefined,
            }),
          });

          const latest = useFlowStore.getState();
          if (
            res.ok &&
            latest.projectId === projectId &&
            latest.canvasId === canvasId &&
            latest.nodes === nodes &&
            latest.edges === edges &&
            latest.viewport === viewport
          ) {
            markClean();
          }
        } catch (error) {
          console.error("[auto-save] Failed to sync:", error);
        }
      }, SAVE_DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);
}
