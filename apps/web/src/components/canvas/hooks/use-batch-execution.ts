import { useCallback } from "react";
import { useFlowStore } from "../stores/use-flow-store";

/**
 * Hook for batch-executing a node multiple times.
 * Reads batchCount from node config and runs executeNode N times concurrently.
 */
export function useBatchExecution(executeNode: (nodeId: string) => Promise<void>) {
  const executeBatch = useCallback(
    async (nodeId: string) => {
      const node = useFlowStore.getState().nodes.find((n) => n.id === nodeId);
      if (!node) return;

      const batchCount = (node.data.batchCount as number) || 1;

      if (batchCount <= 1) {
        // Single execution — delegate directly
        await executeNode(nodeId);
        return;
      }

      // Submit N concurrent tasks
      const promises = Array.from({ length: batchCount }, () => executeNode(nodeId));
      await Promise.allSettled(promises);
    },
    [executeNode]
  );

  return { executeBatch };
}
