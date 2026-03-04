export type TaskState = "planning" | "execution" | "validation" | "done";

export type TaskExpectedAction =
  | "approve_plan"
  | "complete_step"
  | "approve_validation"
  | "resume"
  | "none";

export type TaskCommand =
  | "pause"
  | "resume"
  | "approve_plan"
  | "complete_step"
  | "approve_validation"
  | "request_replan"
  | "request_rework";

export type TaskArtifactKind = "plan" | "execution" | "validation";

export type TaskArtifact = {
  kind: TaskArtifactKind;
  state: TaskState;
  step: number;
  text: string;
  createdAt: number;
};

export type TaskContext = {
  task: string;
  state: TaskState;
  step: number;
  total: number;
  expectedAction: TaskExpectedAction;
  current: string;
  plan: string[];
  done: string[];
  artifacts: TaskArtifact[];
  paused: boolean;
  pausedAt: number | null;
  pausedReason: string;
  draftArtifactText: string;
  draftArtifactState: TaskState | "";
  draftArtifactStep: number;
  draftArtifactUpdatedAt: number | null;
  draftArtifactSourceMessageId: string;
  updatedAt: number;
};

export type TaskCommandInput = {
  command: TaskCommand;
  artifactText?: string;
  plan?: string[];
  reason?: string;
};

export type TaskCommandResult =
  | { ok: true; task: TaskContext }
  | { ok: false; status: 409 | 422; error: string };

const MAX_TASK_LENGTH = 240;
const MAX_TEXT_LENGTH = 2000;
const MAX_REASON_LENGTH = 320;
const MAX_PLAN_ITEMS = 24;
const MAX_ARTIFACTS = 48;
const MAX_MESSAGE_ID_LENGTH = 128;

export const TASK_COMMANDS: TaskCommand[] = [
  "pause",
  "resume",
  "approve_plan",
  "complete_step",
  "approve_validation",
  "request_replan",
  "request_rework",
];

const compactWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const normalizeText = (value: unknown, maxLength = MAX_TEXT_LENGTH): string => {
  if (typeof value !== "string") {
    return "";
  }
  const normalized = compactWhitespace(value);
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const normalizeList = (values: string[]): string[] => {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const value of values) {
    const next = normalizeText(value, 240);
    if (!next) {
      continue;
    }
    const key = next.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(next);
    if (normalized.length >= MAX_PLAN_ITEMS) {
      break;
    }
  }

  return normalized;
};

export const parsePlanFromArtifact = (artifactText: string): string[] => {
  const multilineSegments = artifactText.replace(/\r/g, "\n").split(/[\n;]+/);
  const numberedSegments =
    multilineSegments.length <= 1 ? artifactText.split(/\s(?=\d+[.)]\s+)/) : multilineSegments;

  const lines = numberedSegments
    .map((line) => line.trim())
    .map((line) => line.replace(/^[-*•·]\s+/, ""))
    .map((line) => line.replace(/^\d+[.)]\s+/, ""));

  return normalizeList(lines);
};

const expectedActionByState = (state: TaskState): TaskExpectedAction => {
  switch (state) {
    case "planning":
      return "approve_plan";
    case "execution":
      return "complete_step";
    case "validation":
      return "approve_validation";
    case "done":
      return "none";
  }
};

const withExpectedAction = (task: TaskContext): TaskContext => {
  const expectedAction: TaskExpectedAction = task.paused ? "resume" : expectedActionByState(task.state);
  return {
    ...task,
    expectedAction,
  };
};

const normalizeDraftState = (value: unknown): TaskState | "" => {
  if (value === "planning" || value === "execution" || value === "validation" || value === "done") {
    return value;
  }
  return "";
};

const clearDraftArtifactFields = (task: TaskContext): TaskContext => ({
  ...task,
  draftArtifactText: "",
  draftArtifactState: "",
  draftArtifactStep: 0,
  draftArtifactUpdatedAt: null,
  draftArtifactSourceMessageId: "",
});

export const setTaskDraftArtifact = (
  task: TaskContext,
  params: {
    artifactText: string;
    artifactState: TaskState;
    artifactStep: number;
    artifactUpdatedAt: number;
    sourceMessageId: string;
  }
): TaskContext => {
  const artifactText = normalizeText(params.artifactText);
  if (!artifactText) {
    return clearDraftArtifactFields(task);
  }
  return {
    ...task,
    draftArtifactText: artifactText,
    draftArtifactState: params.artifactState,
    draftArtifactStep: Math.max(0, Math.trunc(params.artifactStep)),
    draftArtifactUpdatedAt: Math.max(0, Math.trunc(params.artifactUpdatedAt)),
    draftArtifactSourceMessageId: normalizeText(params.sourceMessageId, MAX_MESSAGE_ID_LENGTH),
  };
};

export const clearTaskDraftArtifact = (task: TaskContext): TaskContext => clearDraftArtifactFields(task);

export const isTaskCommand = (value: unknown): value is TaskCommand =>
  typeof value === "string" && TASK_COMMANDS.includes(value as TaskCommand);

export const createDefaultTaskContext = (task: string, now = Date.now()): TaskContext =>
  withExpectedAction({
    task: normalizeText(task, MAX_TASK_LENGTH) || "Task",
    state: "planning",
    step: 0,
    total: 0,
    expectedAction: "approve_plan",
    current: "Собираем требования и утверждаем план",
    plan: [],
    done: [],
    artifacts: [],
    paused: false,
    pausedAt: null,
    pausedReason: "",
    draftArtifactText: "",
    draftArtifactState: "",
    draftArtifactStep: 0,
    draftArtifactUpdatedAt: null,
    draftArtifactSourceMessageId: "",
    updatedAt: now,
  });

export const normalizeTaskContext = (candidate: Partial<TaskContext>): TaskContext => {
  const state: TaskState =
    candidate.state === "planning" ||
    candidate.state === "execution" ||
    candidate.state === "validation" ||
    candidate.state === "done"
      ? candidate.state
      : "planning";

  const plan = normalizeList(Array.isArray(candidate.plan) ? candidate.plan : []);
  const done = normalizeList(Array.isArray(candidate.done) ? candidate.done : []);
  const artifacts = Array.isArray(candidate.artifacts)
    ? candidate.artifacts
        .map((item) => {
          if (!item || typeof item !== "object") {
            return null;
          }
          const next = item as Partial<TaskArtifact>;
          const kind: TaskArtifactKind =
            next.kind === "plan" || next.kind === "execution" || next.kind === "validation"
              ? next.kind
              : "execution";
          const text = normalizeText(next.text);
          if (!text) {
            return null;
          }
          const itemState: TaskState =
            next.state === "planning" ||
            next.state === "execution" ||
            next.state === "validation" ||
            next.state === "done"
              ? next.state
              : state;
          const step = Number.isFinite(next.step) ? Math.max(0, Math.trunc(next.step as number)) : 0;
          const createdAt = Number.isFinite(next.createdAt)
            ? Math.max(0, Math.trunc(next.createdAt as number))
            : Date.now();
          return {
            kind,
            state: itemState,
            step,
            text,
            createdAt,
          } satisfies TaskArtifact;
        })
        .filter((item): item is TaskArtifact => Boolean(item))
        .slice(-MAX_ARTIFACTS)
    : [];

  const total = Number.isFinite(candidate.total) ? Math.max(0, Math.trunc(candidate.total as number)) : plan.length;
  const normalizedTotal = total || plan.length;
  const stepRaw = Number.isFinite(candidate.step) ? Math.max(0, Math.trunc(candidate.step as number)) : 0;
  const step = normalizedTotal > 0 ? Math.min(Math.max(0, stepRaw), normalizedTotal) : 0;

  const currentFromPlan = step > 0 && step <= plan.length ? plan[step - 1] : "";

  return withExpectedAction({
    task: normalizeText(candidate.task, MAX_TASK_LENGTH) || "Task",
    state,
    step,
    total: normalizedTotal,
    expectedAction: "none",
    current:
      normalizeText(candidate.current, 320) ||
      currentFromPlan ||
      (state === "planning"
        ? "Собираем требования и утверждаем план"
        : state === "validation"
        ? "Проверяем результат и подтверждаем завершение"
        : state === "done"
        ? "Задача завершена"
        : "Выполняем текущий шаг"),
    plan,
    done,
    artifacts,
    paused: candidate.paused === true,
    pausedAt:
      candidate.pausedAt !== undefined && Number.isFinite(candidate.pausedAt)
        ? Math.max(0, Math.trunc(candidate.pausedAt as number))
        : null,
    pausedReason: normalizeText(candidate.pausedReason, MAX_REASON_LENGTH),
    draftArtifactText: normalizeText(candidate.draftArtifactText),
    draftArtifactState: normalizeDraftState(candidate.draftArtifactState),
    draftArtifactStep:
      candidate.draftArtifactStep !== undefined && Number.isFinite(candidate.draftArtifactStep)
        ? Math.max(0, Math.trunc(candidate.draftArtifactStep as number))
        : 0,
    draftArtifactUpdatedAt:
      candidate.draftArtifactUpdatedAt !== undefined && Number.isFinite(candidate.draftArtifactUpdatedAt)
        ? Math.max(0, Math.trunc(candidate.draftArtifactUpdatedAt as number))
        : null,
    draftArtifactSourceMessageId: normalizeText(candidate.draftArtifactSourceMessageId, MAX_MESSAGE_ID_LENGTH),
    updatedAt:
      candidate.updatedAt !== undefined && Number.isFinite(candidate.updatedAt)
        ? Math.max(0, Math.trunc(candidate.updatedAt as number))
        : Date.now(),
  });
};

const isCommandAllowed = (task: TaskContext, command: TaskCommand): boolean => {
  if (task.paused) {
    return command === "resume";
  }

  switch (command) {
    case "pause":
      return task.state !== "done";
    case "resume":
      return false;
    case "approve_plan":
      return task.state === "planning";
    case "complete_step":
      return task.state === "execution" && task.total > 0;
    case "approve_validation":
      return task.state === "validation";
    case "request_replan":
      return task.state === "execution";
    case "request_rework":
      return task.state === "validation";
  }
};

const pushArtifact = (
  task: TaskContext,
  item: Omit<TaskArtifact, "createdAt">,
  now: number
): TaskArtifact[] => {
  const next: TaskArtifact[] = [
    ...task.artifacts,
    {
      ...item,
      createdAt: now,
    },
  ];
  if (next.length <= MAX_ARTIFACTS) {
    return next;
  }
  return next.slice(next.length - MAX_ARTIFACTS);
};

const resolveArtifactTextForApprove = (
  task: TaskContext,
  inputArtifactText: unknown
): { ok: true; artifactText: string } | { ok: false; status: 409 | 422; error: string } => {
  const explicitArtifactText = normalizeText(inputArtifactText);
  if (explicitArtifactText) {
    return { ok: true, artifactText: explicitArtifactText };
  }

  if (!task.draftArtifactText) {
    return {
      ok: false,
      status: 422,
      error: "artifactText is required because task draft artifact is missing",
    };
  }

  if (task.draftArtifactState !== task.state || task.draftArtifactStep !== task.step) {
    return {
      ok: false,
      status: 409,
      error: "draft artifact is stale for current stage",
    };
  }

  return { ok: true, artifactText: task.draftArtifactText };
};

export const applyTaskCommand = (
  currentTask: TaskContext,
  input: TaskCommandInput,
  now = Date.now()
): TaskCommandResult => {
  const task = normalizeTaskContext(currentTask);

  if (!isCommandAllowed(task, input.command)) {
    return {
      ok: false,
      status: 409,
      error: `Command '${input.command}' is not allowed in state '${task.state}'`,
    };
  }

  switch (input.command) {
    case "pause": {
      const pausedReason = normalizeText(input.reason, MAX_REASON_LENGTH);
      return {
        ok: true,
        task: withExpectedAction({
          ...task,
          paused: true,
          pausedAt: now,
          pausedReason,
          updatedAt: now,
        }),
      };
    }

    case "resume": {
      return {
        ok: true,
        task: withExpectedAction({
          ...task,
          paused: false,
          pausedAt: null,
          pausedReason: "",
          updatedAt: now,
        }),
      };
    }

    case "approve_plan": {
      const planFromBody = Array.isArray(input.plan) ? normalizeList(input.plan) : [];
      let artifactText = normalizeText(input.artifactText);
      if (!artifactText && planFromBody.length === 0) {
        const artifactResolved = resolveArtifactTextForApprove(task, input.artifactText);
        if (!artifactResolved.ok) {
          return artifactResolved;
        }
        artifactText = artifactResolved.artifactText;
      }
      const plan = planFromBody.length > 0 ? planFromBody : parsePlanFromArtifact(artifactText);

      if (plan.length === 0) {
        return {
          ok: false,
          status: 422,
          error: "Plan is required: pass 'plan' array or parsable 'artifactText'",
        };
      }

      const artifactTextFromPlan = artifactText || plan.map((item, index) => `${index + 1}. ${item}`).join("\n");
      return {
        ok: true,
        task: withExpectedAction({
          ...clearDraftArtifactFields(task),
          state: "execution",
          step: 1,
          total: plan.length,
          current: plan[0],
          plan,
          done: [],
          artifacts: pushArtifact(
            task,
            {
              kind: "plan",
              state: "planning",
              step: 0,
              text: artifactTextFromPlan,
            },
            now
          ),
          updatedAt: now,
        }),
      };
    }

    case "complete_step": {
      const artifactResolved = resolveArtifactTextForApprove(task, input.artifactText);
      if (!artifactResolved.ok) {
        return artifactResolved;
      }
      const artifactText = artifactResolved.artifactText;

      const currentIndex = Math.max(0, Math.min(task.step - 1, Math.max(0, task.plan.length - 1)));
      const completed = task.plan[currentIndex] || `Step ${Math.max(1, task.step)}`;
      const done = normalizeList([...task.done, completed]);
      const hasMoreSteps = task.step < task.total;

      if (hasMoreSteps) {
        const nextStep = task.step + 1;
        return {
          ok: true,
          task: withExpectedAction({
            ...clearDraftArtifactFields(task),
            state: "execution",
            step: nextStep,
            total: task.total,
            current: task.plan[nextStep - 1] || `Step ${nextStep}`,
            done,
            artifacts: pushArtifact(
              task,
              {
                kind: "execution",
                state: "execution",
                step: task.step,
                text: artifactText,
              },
              now
            ),
            updatedAt: now,
          }),
        };
      }

      return {
        ok: true,
        task: withExpectedAction({
          ...clearDraftArtifactFields(task),
          state: "validation",
          step: task.total,
          total: task.total,
          current: "Проверяем результат и подтверждаем завершение",
          done,
          artifacts: pushArtifact(
            task,
            {
              kind: "execution",
              state: "execution",
              step: task.step,
              text: artifactText,
            },
            now
          ),
          updatedAt: now,
        }),
      };
    }

    case "approve_validation": {
      const artifactResolved = resolveArtifactTextForApprove(task, input.artifactText);
      if (!artifactResolved.ok) {
        return artifactResolved;
      }
      const artifactText = artifactResolved.artifactText;

      return {
        ok: true,
        task: withExpectedAction({
          ...clearDraftArtifactFields(task),
          state: "done",
          step: task.total,
          current: "Задача завершена",
          artifacts: pushArtifact(
            task,
            {
              kind: "validation",
              state: "validation",
              step: task.step,
              text: artifactText,
            },
            now
          ),
          updatedAt: now,
        }),
      };
    }

    case "request_replan": {
      const reason = normalizeText(input.reason, MAX_REASON_LENGTH);
      return {
        ok: true,
        task: withExpectedAction({
          ...clearDraftArtifactFields(task),
          state: "planning",
          step: 0,
          total: 0,
          current: reason || "Перепланирование задачи",
          plan: [],
          done: [],
          updatedAt: now,
        }),
      };
    }

    case "request_rework": {
      const reason = normalizeText(input.reason, MAX_REASON_LENGTH) || "Устранить замечания валидации";
      const plan = normalizeList([...task.plan, reason]);
      const nextStep = plan.length;
      return {
        ok: true,
        task: withExpectedAction({
          ...clearDraftArtifactFields(task),
          state: "execution",
          step: nextStep,
          total: plan.length,
          plan,
          current: plan[nextStep - 1] || reason,
          updatedAt: now,
        }),
      };
    }
  }
};
