import type { TaskType } from "@shared/types";

/**
 * Define credit costs for each task type.
 * These costs can be adjusted based on pricing strategy.
 */
export const TASK_COSTS: Record<TaskType, number> = {
  txt2img: 10,      // Text to image: 10 credits per generation
  img2img: 15,      // Image to image: 15 credits (more complex)
  img2video: 50,    // Image to video: 50 credits (most expensive)
} as const;

/**
 * Get the credit cost for a specific task type.
 */
export function getTaskCost(taskType: string): number {
  const cost = TASK_COSTS[taskType as TaskType];
  if (cost === undefined) {
    throw new Error(`Unknown task type: ${taskType}`);
  }
  return cost;
}

/**
 * Verify that a user has enough credits for a task.
 * Returns true if sufficient, false otherwise.
 */
export function hasEnoughCredits(availableCredits: number, taskType: string): boolean {
  const cost = getTaskCost(taskType);
  return availableCredits >= cost;
}
