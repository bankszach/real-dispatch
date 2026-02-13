import { describe, expect, it } from "vitest";
import {
  DispatchMutationActions,
  isActionAllowedForRole,
  isAllowedStateTransition,
  isTransitionAllowedForRole,
} from "./v1.js";

describe("contracts v1 state transitions", () => {
  it("accepts only allowed lifecycle transitions", () => {
    expect(isAllowedStateTransition("new", "triaged")).toBe(true);
    expect(isAllowedStateTransition("triaged", "schedulable")).toBe(true);
    expect(isAllowedStateTransition("schedulable", "scheduled")).toBe(true);
    expect(isAllowedStateTransition("dispatched", "onsite")).toBe(true);
    expect(isAllowedStateTransition("onsite", "closeout_pending")).toBe(true);
    expect(isAllowedStateTransition("closeout_pending", "closed")).toBe(true);

    expect(isAllowedStateTransition("new", "dispatched")).toBe(false);
    expect(isAllowedStateTransition("scheduled", "onsite")).toBe(false);
    expect(isAllowedStateTransition("closed", "scheduled")).toBe(false);
  });

  it("enforces role-specific transition permissions", () => {
    expect(
      isTransitionAllowedForRole(
        "system_intake_agent",
        "new",
        "triaged",
      ),
    ).toBe(true);
    expect(
      isTransitionAllowedForRole(
        "system_scheduling_agent",
        "scheduled",
        "dispatched",
      ),
    ).toBe(true);
    expect(
      isTransitionAllowedForRole(
        "system_technician_liaison_agent",
        "onsite",
        "closeout_pending",
      ),
    ).toBe(true);
    expect(
      isTransitionAllowedForRole(
        "system_closeout_agent",
        "closeout_pending",
        "closed",
      ),
    ).toBe(true);

    expect(
      isTransitionAllowedForRole("customer", "scheduled", "dispatched"),
    ).toBe(false);
    expect(
      isTransitionAllowedForRole("system_intake_agent", "scheduled", "dispatched"),
    ).toBe(false);
  });
});

describe("contracts v1 role action permissions", () => {
  it("allows actions that match role policy", () => {
    expect(isActionAllowedForRole("system_intake_agent", "ticket.create")).toBe(true);
    expect(
      isActionAllowedForRole("system_scheduling_agent", "dispatch.assign_tech"),
    ).toBe(true);
    expect(
      isActionAllowedForRole(
        "system_technician_liaison_agent",
        "closeout.add_evidence",
      ),
    ).toBe(true);
    expect(
      isActionAllowedForRole("system_closeout_agent", "ticket.close"),
    ).toBe(true);
  });

  it("blocks actions outside role policy", () => {
    expect(
      isActionAllowedForRole("system_intake_agent", "dispatch.assign_tech"),
    ).toBe(false);
    expect(
      isActionAllowedForRole("system_closeout_agent", "dispatch.mark_onsite"),
    ).toBe(false);
    expect(
      isActionAllowedForRole("customer", "ticket.close"),
    ).toBe(false);
  });

  it("grants operator_admin all closed mutation actions", () => {
    for (const action of DispatchMutationActions) {
      expect(isActionAllowedForRole("operator_admin", action)).toBe(true);
    }
  });
});
