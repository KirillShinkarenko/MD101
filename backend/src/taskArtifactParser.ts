import { parsePlanFromArtifact, type TaskState } from "./taskFsm.js";

export type TaskArtifactDraftStatus = "valid" | "invalid" | "missing";

export type TaskArtifactEnvelope = {
  status: TaskArtifactDraftStatus;
  error?: string;
  artifactText: string;
  artifactState: TaskState | "";
  artifactStep: number;
  plan: string[];
};

const compactWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const parseEnvelopeBlock = (text: string): string | null => {
  const regex = /\[TASK_ARTIFACT_JSON\]([\s\S]*?)\[\/TASK_ARTIFACT_JSON\]/g;
  let matched: RegExpExecArray | null = null;
  let current: RegExpExecArray | null;
  while ((current = regex.exec(text)) !== null) {
    matched = current;
  }
  if (!matched) {
    return null;
  }
  const block = matched[1]?.trim();
  return block || null;
};

const normalizeState = (value: unknown): TaskState | null => {
  if (value === "planning" || value === "execution" || value === "validation" || value === "done") {
    return value;
  }
  return null;
};

const normalizeStep = (value: unknown): number | null => {
  if (!Number.isFinite(value)) {
    return null;
  }
  const next = Math.trunc(value as number);
  if (next < 0) {
    return null;
  }
  return next;
};

const normalizeArtifact = (value: unknown): string => {
  if (typeof value !== "string") {
    return "";
  }
  return value.replace(/\r/g, "").trim();
};

const normalizePlan = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const normalized = compactWhitespace(item);
    if (!normalized) {
      continue;
    }
    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    next.push(normalized);
  }
  return next;
};

export const extractTaskArtifactEnvelope = (
  finalText: string,
  currentTask: { state: TaskState; step: number }
): TaskArtifactEnvelope => {
  const envelope = parseEnvelopeBlock(finalText);
  if (!envelope) {
    return {
      status: "missing",
      artifactText: "",
      artifactState: "",
      artifactStep: 0,
      plan: [],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope);
  } catch {
    return {
      status: "invalid",
      error: "TASK_ARTIFACT_JSON is not valid JSON",
      artifactText: "",
      artifactState: "",
      artifactStep: 0,
      plan: [],
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      status: "invalid",
      error: "TASK_ARTIFACT_JSON must be an object",
      artifactText: "",
      artifactState: "",
      artifactStep: 0,
      plan: [],
    };
  }

  const candidate = parsed as {
    state?: unknown;
    step?: unknown;
    artifact?: unknown;
    plan?: unknown;
  };

  const artifactState = normalizeState(candidate.state);
  if (!artifactState || artifactState === "done") {
    return {
      status: "invalid",
      error: "artifact.state must be planning|execution|validation",
      artifactText: "",
      artifactState: "",
      artifactStep: 0,
      plan: [],
    };
  }

  const artifactStep = normalizeStep(candidate.step);
  if (artifactStep === null) {
    return {
      status: "invalid",
      error: "artifact.step must be a non-negative integer",
      artifactText: "",
      artifactState: "",
      artifactStep: 0,
      plan: [],
    };
  }

  if (artifactState !== currentTask.state) {
    return {
      status: "invalid",
      error: `artifact.state '${artifactState}' does not match current state '${currentTask.state}'`,
      artifactText: "",
      artifactState,
      artifactStep,
      plan: [],
    };
  }

  if (artifactStep !== currentTask.step) {
    return {
      status: "invalid",
      error: `artifact.step '${artifactStep}' does not match current step '${currentTask.step}'`,
      artifactText: "",
      artifactState,
      artifactStep,
      plan: [],
    };
  }

  const artifactText = normalizeArtifact(candidate.artifact);
  if (!artifactText) {
    return {
      status: "invalid",
      error: "artifact.artifact must be a non-empty string",
      artifactText: "",
      artifactState,
      artifactStep,
      plan: [],
    };
  }

  const plan = normalizePlan(candidate.plan);
  if (artifactState === "planning" && plan.length === 0) {
    const parsedPlan = parsePlanFromArtifact(artifactText);
    if (parsedPlan.length === 0) {
      return {
        status: "invalid",
        error: "planning artifact requires non-empty plan array",
        artifactText,
        artifactState,
        artifactStep,
        plan: [],
      };
    }
    return {
      status: "valid",
      artifactText,
      artifactState,
      artifactStep,
      plan: parsedPlan,
    };
  }

  return {
    status: "valid",
    artifactText,
    artifactState,
    artifactStep,
    plan,
  };
};
