import type { TaskContext, TaskState } from "./taskFsm.js";

const stageRules: Record<TaskState, string[]> = {
  planning: [
    "Stage: planning.",
    "Collect requirements and produce a concrete plan artifact.",
    "Do not execute implementation work in this stage.",
    "If the plan is complete, explicitly ask for approve_plan.",
    "At the end of the answer emit TASK_ARTIFACT_JSON block with state='planning', current step and non-empty plan array.",
  ],
  execution: [
    "Stage: execution.",
    "Work only on the current step.",
    "Do not skip steps or jump to validation.",
    "When step output is ready, return a step artifact and ask for complete_step.",
    "At the end of the answer emit TASK_ARTIFACT_JSON block with state='execution', current step and artifact text.",
  ],
  validation: [
    "Stage: validation.",
    "Validate implementation against the approved plan and acceptance criteria.",
    "List findings clearly. If complete, provide validation artifact and ask for approve_validation.",
    "At the end of the answer emit TASK_ARTIFACT_JSON block with state='validation', current step and artifact text.",
  ],
  done: [
    "Stage: done.",
    "Task is completed. Summarize final result and important artifacts.",
    "Do not re-open execution unless a new explicit command is provided.",
  ],
};

const formatList = (items: string[]): string => {
  if (items.length === 0) {
    return "(empty)";
  }
  return items.map((item, index) => `${index + 1}. ${item}`).join("\n");
};

export const buildTaskStagePrompt = (state: TaskState): string => {
  const rules = stageRules[state] ?? stageRules.planning;
  return [
    "TASK_STAGE_RULES",
    ...rules,
    "Artifact format (strict, no markdown around it):",
    "[TASK_ARTIFACT_JSON]",
    '{"state":"planning|execution|validation","step":0,"artifact":"...","plan":["..."]}',
    "[/TASK_ARTIFACT_JSON]",
    "For planning: plan is required. For execution/validation: plan is optional.",
    "Emit this block exactly once at the end of the answer.",
  ].join("\n");
};

export const buildTaskStateBlock = (task: TaskContext): string => {
  return [
    "TASK_STATE",
    `[TASK] ${task.task || "(empty)"}`,
    `[STATE] ${task.state}`,
    `[STEP] ${task.step}/${task.total}`,
    `[EXPECTED_ACTION] ${task.expectedAction}`,
    `[PAUSED] ${task.paused ? "yes" : "no"}`,
    `[CURRENT] ${task.current || "(empty)"}`,
    "[PLAN]",
    formatList(task.plan),
    "[DONE]",
    formatList(task.done),
  ].join("\n");
};
