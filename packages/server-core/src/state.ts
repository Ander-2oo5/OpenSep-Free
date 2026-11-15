import type { JobState } from "@opensep/contracts";

const transitions: Readonly<Record<JobState, readonly JobState[]>> = {
  queued: ["preparing", "cancelled"],
  preparing: ["processing", "cancelling", "failed"],
  processing: ["encoding", "cancelling", "failed"],
  encoding: ["completed", "cancelling", "failed"],
  cancelling: ["cancelled", "failed"],
  completed: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return transitions[from].includes(to);
}

export function isTerminal(state: JobState): boolean {
  return state === "completed" || state === "failed" || state === "cancelled";
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid job transition: ${from} -> ${to}`);
  }
}
