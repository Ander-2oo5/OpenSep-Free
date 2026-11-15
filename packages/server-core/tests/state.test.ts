import { describe, expect, it } from "vitest";
import { canTransition, isTerminal } from "../src/state.js";

describe("job state machine", () => {
  it("allows the processing happy path", () => {
    expect(canTransition("queued", "preparing")).toBe(true);
    expect(canTransition("preparing", "processing")).toBe(true);
    expect(canTransition("processing", "encoding")).toBe(true);
    expect(canTransition("encoding", "completed")).toBe(true);
  });

  it("never leaves a terminal state", () => {
    for (const state of ["completed", "failed", "cancelled"] as const) {
      expect(isTerminal(state)).toBe(true);
      expect(canTransition(state, "queued")).toBe(false);
    }
  });
});
