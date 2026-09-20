import { describe, expect, it } from "vitest";

import { pruneWorkflowHistory } from "../src/postgres-store.js";
import { emptyStore } from "../src/types.js";

describe("workflow history retention", () => {
  it("keeps only the newest configured timeline, action, and schedule records", () => {
    const state = emptyStore();
    state.timeline = [1, 3, 2].map((value) => ({ id: `timeline-${value}`, type: "test", title: "test", created_at: `2026-01-0${value}T00:00:00.000Z`, actor_name: "test" }));
    state.action_executions = [1, 3, 2].map((value) => ({ id: `action-${value}`, ticket_id: "ticket", provider_key: "provider", event: "test", status: "success", input: {}, output: {}, created_at: `2026-01-0${value}T00:00:00.000Z` }));
    state.schedule_runs = [1, 3, 2].map((value) => ({ id: `run-${value}`, schedule_id: "schedule", workflow_id: "workflow", planned_at: `2026-01-0${value}T00:00:00.000Z`, executed_at: `2026-01-0${value}T00:00:00.000Z`, status: "succeeded" }));

    pruneWorkflowHistory(state, { timeline: 2, actionExecutions: 2, scheduleRuns: 2 });

    expect(state.timeline.map((item) => item.id)).toEqual(["timeline-3", "timeline-2"]);
    expect(state.action_executions.map((item) => item.id)).toEqual(["action-3", "action-2"]);
    expect(state.schedule_runs.map((item) => item.id)).toEqual(["run-3", "run-2"]);
  });
});
