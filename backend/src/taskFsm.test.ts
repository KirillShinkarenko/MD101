import test from "node:test";
import assert from "node:assert/strict";
import {
  applyTaskCommand,
  createDefaultTaskContext,
  normalizeTaskContext,
  setTaskDraftArtifact,
  type TaskContext,
} from "./taskFsm.js";

const mustOk = (result: ReturnType<typeof applyTaskCommand>): TaskContext => {
  assert.equal(result.ok, true);
  return (result as { ok: true; task: TaskContext }).task;
};

test("approve_plan moves planning -> execution with step 1", () => {
  const initial = createDefaultTaskContext("Auth service", 1000);
  const result = applyTaskCommand(
    initial,
    {
      command: "approve_plan",
      plan: ["JWT module", "Token validation"],
    },
    1010
  );

  const next = mustOk(result);
  assert.equal(next.state, "execution");
  assert.equal(next.step, 1);
  assert.equal(next.total, 2);
  assert.equal(next.current, "JWT module");
  assert.equal(next.expectedAction, "complete_execution");
});

test("complete_execution completes remaining plan and enters validation", () => {
  const planned = mustOk(
    applyTaskCommand(
      createDefaultTaskContext("FSM"),
      {
        command: "approve_plan",
        plan: ["step A", "step B", "step C"],
      },
      2000
    )
  );

  const afterExecution = mustOk(
    applyTaskCommand(
      planned,
      {
        command: "complete_execution",
        artifactText: "All execution work completed",
      },
      2020
    )
  );
  assert.equal(afterExecution.state, "validation");
  assert.equal(afterExecution.step, 3);
  assert.deepEqual(afterExecution.done, ["step A", "step B", "step C"]);
  assert.equal(afterExecution.expectedAction, "approve_validation");
});

test("complete_execution from mid-progress marks only remaining steps as done", () => {
  const execution = normalizeTaskContext({
    task: "Mid-progress",
    state: "execution",
    step: 2,
    total: 3,
    plan: ["step A", "step B", "step C"],
    done: ["step A"],
    current: "step B",
    paused: false,
    pausedAt: null,
    pausedReason: "",
    artifacts: [],
    updatedAt: 2500,
  });

  const next = mustOk(
    applyTaskCommand(
      execution,
      {
        command: "complete_execution",
        artifactText: "Finished remaining execution steps",
      },
      2510
    )
  );

  assert.equal(next.state, "validation");
  assert.equal(next.step, 3);
  assert.deepEqual(next.done, ["step A", "step B", "step C"]);
  assert.equal(next.expectedAction, "approve_validation");
});

test("legacy complete_step still increments execution step and enters validation", () => {
  const planned = mustOk(
    applyTaskCommand(
      createDefaultTaskContext("Legacy FSM"),
      {
        command: "approve_plan",
        plan: ["step A", "step B"],
      },
      2600
    )
  );

  const afterFirst = mustOk(
    applyTaskCommand(
      planned,
      {
        command: "complete_step",
        artifactText: "A completed",
      },
      2610
    )
  );
  assert.equal(afterFirst.state, "execution");
  assert.equal(afterFirst.step, 2);
  assert.equal(afterFirst.current, "step B");

  const afterSecond = mustOk(
    applyTaskCommand(
      afterFirst,
      {
        command: "complete_step",
        artifactText: "B completed",
      },
      2620
    )
  );
  assert.equal(afterSecond.state, "validation");
  assert.equal(afterSecond.step, 2);
  assert.equal(afterSecond.expectedAction, "approve_validation");
});

test("pause and resume preserve state and step", () => {
  const execution = mustOk(
    applyTaskCommand(
      createDefaultTaskContext("Pause test"),
      {
        command: "approve_plan",
        plan: ["one"],
      },
      3000
    )
  );

  const paused = mustOk(applyTaskCommand(execution, { command: "pause", reason: "break" }, 3010));
  assert.equal(paused.paused, true);
  assert.equal(paused.state, "execution");
  assert.equal(paused.step, 1);
  assert.equal(paused.expectedAction, "resume");

  const resumed = mustOk(applyTaskCommand(paused, { command: "resume" }, 3020));
  assert.equal(resumed.paused, false);
  assert.equal(resumed.state, "execution");
  assert.equal(resumed.step, 1);
  assert.equal(resumed.expectedAction, "complete_execution");
});

test("approve_validation moves validation -> done", () => {
  const validation = normalizeTaskContext({
    task: "Done test",
    state: "validation",
    step: 2,
    total: 2,
    plan: ["a", "b"],
    done: ["a", "b"],
    current: "validate",
    paused: false,
    pausedAt: null,
    pausedReason: "",
    artifacts: [],
    updatedAt: 1,
  });

  const done = mustOk(
    applyTaskCommand(
      validation,
      {
        command: "approve_validation",
        artifactText: "All checks passed",
      },
      4000
    )
  );

  assert.equal(done.state, "done");
  assert.equal(done.expectedAction, "none");
});

test("invalid transition returns 409", () => {
  const planning = createDefaultTaskContext("Invalid");
  const result = applyTaskCommand(planning, { command: "complete_step", artifactText: "x" }, 5000);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
  }
});

test("approve_plan without parsable plan returns 422", () => {
  const planning = createDefaultTaskContext("No plan");
  const result = applyTaskCommand(
    planning,
    {
      command: "approve_plan",
      artifactText: "   ",
    },
    6000
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 422);
  }
});

test("approve_plan uses persisted draft artifact when artifactText is not provided", () => {
  const planning = setTaskDraftArtifact(createDefaultTaskContext("Draft plan", 7000), {
    artifactText: "1. JWT module\n2. Token validation",
    artifactState: "planning",
    artifactStep: 0,
    artifactUpdatedAt: 7001,
    sourceMessageId: "m-1",
  });
  const result = applyTaskCommand(
    planning,
    {
      command: "approve_plan",
    },
    7010
  );
  const next = mustOk(result);
  assert.equal(next.state, "execution");
  assert.equal(next.step, 1);
  assert.equal(next.total, 2);
  assert.equal(next.draftArtifactText, "");
});

test("approve commands reject stale persisted draft artifact", () => {
  const execution = normalizeTaskContext(
    setTaskDraftArtifact(
      {
        ...createDefaultTaskContext("Stale"),
        state: "execution",
        step: 2,
        total: 2,
        plan: ["A", "B"],
        current: "B",
        expectedAction: "complete_execution",
      },
      {
        artifactText: "Old step draft",
        artifactState: "execution",
        artifactStep: 1,
        artifactUpdatedAt: 7100,
        sourceMessageId: "m-old",
      }
    )
  );

  const result = applyTaskCommand(
    execution,
    {
      command: "complete_step",
    },
    7110
  );
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.status, 409);
    assert.match(result.error, /stale/i);
  }
});

test("draft is cleared after complete_step transition", () => {
  const execution = normalizeTaskContext(
    setTaskDraftArtifact(
      {
        ...createDefaultTaskContext("Clear draft"),
        state: "execution",
        step: 1,
        total: 1,
        plan: ["A"],
        current: "A",
        expectedAction: "complete_execution",
      },
      {
        artifactText: "Step A done",
        artifactState: "execution",
        artifactStep: 1,
        artifactUpdatedAt: 7200,
        sourceMessageId: "m-step",
      }
    )
  );
  const next = mustOk(
    applyTaskCommand(
      execution,
      {
        command: "complete_step",
      },
      7210
    )
  );
  assert.equal(next.state, "validation");
  assert.equal(next.draftArtifactText, "");
  assert.equal(next.draftArtifactState, "");
  assert.equal(next.draftArtifactStep, 0);
  assert.equal(next.draftArtifactSourceMessageId, "");
});
