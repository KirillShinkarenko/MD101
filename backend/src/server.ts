import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  applyTaskCommand,
  clearTaskDraftArtifact,
  createDefaultTaskContext,
  isTaskCommand,
  normalizeTaskContext,
  setTaskDraftArtifact,
  type TaskCommand,
  type TaskContext,
} from "./taskFsm.js";
import { buildTaskStagePrompt, buildTaskStateBlock } from "./taskFsmPrompt.js";
import { extractTaskArtifactEnvelope, type TaskArtifactDraftStatus } from "./taskArtifactParser.js";

dotenv.config({ path: "../.env" });
dotenv.config();

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

type Role = "user" | "assistant";
type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
type LongTermField = "profile" | "preferences" | "decisions" | "knowledge";

type ChatBody = {
  userPrompt?: string;
  model?: string;
  reasoningEffort?: string;
  systemPrompt?: string;
  memoryModel?: string;
};

type TaskCommandBody = {
  command?: TaskCommand;
  artifactText?: string;
  plan?: string[];
  reason?: string;
};

type ApprovePlanStreamBody = {
  artifactText?: string;
  plan?: string[];
  model?: string;
  reasoningEffort?: string;
  systemPrompt?: string;
  memoryModel?: string;
};

type CreateChatBody = {
  title?: string;
  model?: string;
  systemPrompt?: string;
};

type PatchChatBody = {
  title?: string;
  model?: string;
  systemPrompt?: string;
};

type WorkingMemoryPatchBody = {
  goal?: string;
  constraints?: string;
  status?: string;
  nextSteps?: string;
};

type LongTermMemoryPatchBody = {
  profile?: string;
  preferences?: string;
  decisions?: string;
  knowledge?: string;
};

type CreateProfileBody = {
  name?: string;
};

type PatchProfileBody = {
  name?: string;
  style?: string;
  outputFormat?: string;
  constraints?: string;
  notes?: string;
};

type SetActiveProfileBody = {
  profileId?: string | null;
};

type MemorySettingsPatchBody = {
  shortTermEnabled?: boolean;
  workingEnabled?: boolean;
  longTermEnabled?: boolean;
};

type InvariantSettingsPatchBody = {
  enabled?: boolean;
  injectInSystemPrompt?: boolean;
};

type CreateInvariantBody = {
  name?: string;
  ruleText?: string;
};

type PatchInvariantBody = {
  name?: string;
  ruleText?: string;
};

type UsageSummary = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type CostBreakdownUsd = {
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
};

type ChatRowRecord = {
  id: string;
  title: string;
  model: string;
  systemPrompt: string;
  memoryStrategy: string;
  slidingWindowSize: number;
  stickyWindowSize: number;
  branchFromChatId: string | null;
  branchFromChatTitle: string | null;
  branchCheckpointMessageCount: number | null;
};

type ModelApiProfile = {
  reasoningEfforts: ReasoningEffort[];
};

type ShortTermMemoryRow = {
  chatId: string;
  rollingSummary: string;
  lastProcessedMessageCount: number;
  updatedAt: number;
};

type WorkingMemoryRow = {
  chatId: string;
  goal: string;
  constraints: string;
  status: string;
  nextSteps: string;
  manualLockGoal: number;
  manualLockConstraints: number;
  manualLockStatus: number;
  manualLockNextSteps: number;
  updatedBy: "auto" | "manual";
  updatedAt: number;
};

type TaskStateRow = {
  chatId: string;
  task: string;
  state: string;
  step: number;
  total: number;
  expectedAction: string;
  current: string;
  planJson: string;
  doneJson: string;
  artifactsJson: string;
  paused: number;
  pausedAt: number | null;
  pausedReason: string;
  draftArtifactText: string;
  draftArtifactState: string;
  draftArtifactStep: number;
  draftArtifactUpdatedAt: number | null;
  draftArtifactSourceMessageId: string;
  updatedAt: number;
};

type LongTermMemoryRow = {
  scopeId: "global";
  profile: string;
  preferences: string;
  decisions: string;
  knowledge: string;
  manualLockProfile: number;
  manualLockPreferences: number;
  manualLockDecisions: number;
  manualLockKnowledge: number;
  updatedBy: "auto" | "manual";
  updatedAt: number;
};

type LongTermCandidateRow = {
  id: string;
  chatId: string;
  targetField: LongTermField;
  value: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  resolvedAt: number | null;
};

type UserProfileRow = {
  id: string;
  name: string;
  style: string;
  outputFormat: string;
  constraints: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
};

type ProfileSettingsRow = {
  scopeId: "global";
  activeProfileId: string | null;
  updatedAt: number;
};

type MemorySettingsRow = {
  scopeId: "global";
  shortTermEnabled: number;
  workingEnabled: number;
  longTermEnabled: number;
  updatedAt: number;
};

type InvariantSettingsRow = {
  scopeId: "global";
  enabled: number;
  injectInSystemPrompt: number;
  updatedAt: number;
};

type InvariantRow = {
  id: string;
  name: string;
  ruleText: string;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
};

type InvariantViolation = {
  invariantId: string;
  description: string;
};

type ChatMemorySnapshot = {
  shortTerm: {
    rollingSummary: string;
    lastProcessedMessageCount: number;
    updatedAt: number;
  };
  working: {
    goal: string;
    constraints: string;
    status: string;
    nextSteps: string;
    updatedBy: "auto" | "manual";
    updatedAt: number;
  };
  longTerm: {
    profile: string;
    preferences: string;
    decisions: string;
    knowledge: string;
    updatedBy: "auto" | "manual";
    updatedAt: number;
  };
  pendingCandidates: Array<{
    id: string;
    chatId: string;
    targetField: LongTermField;
    value: string;
    reason: string;
    status: "pending" | "approved" | "rejected";
    createdAt: number;
    resolvedAt: number | null;
  }>;
};

type MemoryUpdaterOutput = {
  shortTerm: {
    rollingSummary: string;
  };
  working: {
    goal: string;
    constraints: string;
    status: string;
    nextSteps: string;
  };
  longTermCandidates: Array<{
    targetField: LongTermField;
    value: string;
    reason: string;
  }>;
};

const DEFAULT_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
const DEFAULT_MEMORY_MODEL = "gpt-4.1-nano";
const BRANCH_CHAT_TITLE_PREFIX = "Ветка - ";
const GLOBAL_LONG_TERM_SCOPE_ID = "global" as const;
const GLOBAL_PROFILE_SCOPE_ID = "global" as const;
const GLOBAL_MEMORY_SETTINGS_SCOPE_ID = "global" as const;
const GLOBAL_INVARIANT_SETTINGS_SCOPE_ID = "global" as const;
const SHORT_TERM_MAX_LENGTH = 1800;
const WORKING_FIELD_MAX_LENGTH = 320;
const LONG_TERM_FIELD_MAX_LENGTH = 600;
const CANDIDATE_VALUE_MAX_LENGTH = 320;
const PROFILE_FIELD_MAX_LENGTH = 600;
const PROFILE_NAME_MAX_LENGTH = 64;
const INVARIANT_NAME_MAX_LENGTH = 120;
const INVARIANT_RULE_MAX_LENGTH = 1500;
const INVARIANT_VIOLATION_OPEN_TAG = "[INVARIANT_VIOLATION_JSON]";
const INVARIANT_VIOLATION_CLOSE_TAG = "[/INVARIANT_VIOLATION_JSON]";
const NETWORK_ERROR_HINTS: Record<string, string> = {
  ENOTFOUND: "DNS lookup failed. Check internet connection or DNS settings.",
  ECONNRESET: "Network connection was reset while calling OpenAI.",
  ETIMEDOUT: "Request to OpenAI timed out.",
  ECONNREFUSED: "Connection was refused before reaching OpenAI.",
};

const MODEL_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5.1": { input: 1.25, output: 10 },
  "gpt-5.2": { input: 1.75, output: 14 },
};
const MODEL_PRICING_KEYS = Object.keys(MODEL_PRICING_PER_1M).sort((a, b) => b.length - a.length);

const MODEL_API_PROFILES: Record<string, ModelApiProfile> = {
  "gpt-3.5-turbo": {
    reasoningEfforts: [],
  },
  "gpt-4.1-nano": {
    reasoningEfforts: [],
  },
  "gpt-5-mini": {
    reasoningEfforts: ["minimal", "low", "medium", "high"],
  },
  "gpt-5.1": {
    reasoningEfforts: ["none", "low", "medium", "high"],
  },
  "gpt-5.2": {
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
  },
};

const ALLOWED_MODELS = new Set(Object.keys(MODEL_API_PROFILES));
const EFFECTIVE_DEFAULT_MODEL = ALLOWED_MODELS.has(DEFAULT_MODEL) ? DEFAULT_MODEL : "gpt-5-mini";
const EFFECTIVE_DEFAULT_MEMORY_MODEL = ALLOWED_MODELS.has(DEFAULT_MEMORY_MODEL)
  ? DEFAULT_MEMORY_MODEL
  : EFFECTIVE_DEFAULT_MODEL;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const MODEL_VALIDATION_ERROR = `model must be one of: ${Array.from(ALLOWED_MODELS).join(", ")}`;

if (!OPENAI_API_KEY) {
  app.log.warn("OPENAI_API_KEY is not set. Requests will fail until it is configured.");
}

const createId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const dbPath = resolve(process.cwd(), "data", "md.sqlite");
mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec(`
CREATE TABLE IF NOT EXISTS chats (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  model TEXT NOT NULL,
  system_prompt TEXT NOT NULL,
  memory_strategy TEXT NOT NULL DEFAULT 'none',
  sliding_window_size INTEGER NOT NULL DEFAULT 6,
  sticky_window_size INTEGER NOT NULL DEFAULT 6,
  branch_from_chat_id TEXT,
  branch_from_chat_title TEXT,
  branch_checkpoint_message_count INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  request_json TEXT,
  response_json TEXT,
  latency_ms INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_tokens INTEGER,
  cost_usd REAL,
  input_cost_usd REAL,
  output_cost_usd REAL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_short_memory (
  chat_id TEXT PRIMARY KEY,
  rolling_summary TEXT NOT NULL DEFAULT '',
  last_processed_message_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_working_memory (
  chat_id TEXT PRIMARY KEY,
  goal TEXT NOT NULL DEFAULT '',
  constraints TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  next_steps TEXT NOT NULL DEFAULT '',
  manual_lock_goal INTEGER NOT NULL DEFAULT 0,
  manual_lock_constraints INTEGER NOT NULL DEFAULT 0,
  manual_lock_status INTEGER NOT NULL DEFAULT 0,
  manual_lock_next_steps INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT 'auto',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_task_state (
  chat_id TEXT PRIMARY KEY,
  task TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'planning',
  step INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL DEFAULT 0,
  expected_action TEXT NOT NULL DEFAULT 'approve_plan',
  current TEXT NOT NULL DEFAULT '',
  plan_json TEXT NOT NULL DEFAULT '[]',
  done_json TEXT NOT NULL DEFAULT '[]',
  artifacts_json TEXT NOT NULL DEFAULT '[]',
  paused INTEGER NOT NULL DEFAULT 0,
  paused_at INTEGER,
  paused_reason TEXT NOT NULL DEFAULT '',
  draft_artifact_text TEXT NOT NULL DEFAULT '',
  draft_artifact_state TEXT NOT NULL DEFAULT '',
  draft_artifact_step INTEGER NOT NULL DEFAULT 0,
  draft_artifact_updated_at INTEGER,
  draft_artifact_source_message_id TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS global_long_term_memory (
  scope_id TEXT PRIMARY KEY,
  profile TEXT NOT NULL DEFAULT '',
  preferences TEXT NOT NULL DEFAULT '',
  decisions TEXT NOT NULL DEFAULT '',
  knowledge TEXT NOT NULL DEFAULT '',
  manual_lock_profile INTEGER NOT NULL DEFAULT 0,
  manual_lock_preferences INTEGER NOT NULL DEFAULT 0,
  manual_lock_decisions INTEGER NOT NULL DEFAULT 0,
  manual_lock_knowledge INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT NOT NULL DEFAULT 'auto',
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS long_term_candidates (
  id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL,
  target_field TEXT NOT NULL,
  value TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  style TEXT NOT NULL DEFAULT '',
  output_format TEXT NOT NULL DEFAULT '',
  constraints TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profile_settings (
  scope_id TEXT PRIMARY KEY,
  active_profile_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (active_profile_id) REFERENCES user_profiles (id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS memory_settings (
  scope_id TEXT PRIMARY KEY,
  short_term_enabled INTEGER NOT NULL DEFAULT 1,
  working_enabled INTEGER NOT NULL DEFAULT 1,
  long_term_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invariant_settings (
  scope_id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 1,
  inject_in_system_prompt INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invariants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rule_text TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at ON messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_long_term_candidates_chat_status_created_at
  ON long_term_candidates (chat_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_user_profiles_updated_at ON user_profiles (updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invariants_sort_order_created_at ON invariants (sort_order ASC, created_at ASC);
`);

const chatsColumns = db.prepare("PRAGMA table_info(chats)").all() as Array<{ name: string }>;
const chatColumnNames = new Set(chatsColumns.map((column) => column.name));
if (!chatColumnNames.has("branch_from_chat_id")) {
  db.exec("ALTER TABLE chats ADD COLUMN branch_from_chat_id TEXT");
}
if (!chatColumnNames.has("branch_from_chat_title")) {
  db.exec("ALTER TABLE chats ADD COLUMN branch_from_chat_title TEXT");
}
if (!chatColumnNames.has("branch_checkpoint_message_count")) {
  db.exec("ALTER TABLE chats ADD COLUMN branch_checkpoint_message_count INTEGER");
}

const memorySettingsColumns = db.prepare("PRAGMA table_info(memory_settings)").all() as Array<{ name: string }>;
const memorySettingsColumnNames = new Set(memorySettingsColumns.map((column) => column.name));
if (!memorySettingsColumnNames.has("short_term_enabled")) {
  db.exec("ALTER TABLE memory_settings ADD COLUMN short_term_enabled INTEGER NOT NULL DEFAULT 1");
}
if (!memorySettingsColumnNames.has("working_enabled")) {
  db.exec("ALTER TABLE memory_settings ADD COLUMN working_enabled INTEGER NOT NULL DEFAULT 1");
}

const invariantSettingsColumns = db.prepare("PRAGMA table_info(invariant_settings)").all() as Array<{
  name: string;
}>;
const invariantSettingsColumnNames = new Set(invariantSettingsColumns.map((column) => column.name));
if (!invariantSettingsColumnNames.has("inject_in_system_prompt")) {
  db.exec("ALTER TABLE invariant_settings ADD COLUMN inject_in_system_prompt INTEGER NOT NULL DEFAULT 1");
}

const taskStateColumns = db.prepare("PRAGMA table_info(chat_task_state)").all() as Array<{ name: string }>;
const taskStateColumnNames = new Set(taskStateColumns.map((column) => column.name));
if (!taskStateColumnNames.has("draft_artifact_text")) {
  db.exec("ALTER TABLE chat_task_state ADD COLUMN draft_artifact_text TEXT NOT NULL DEFAULT ''");
}
if (!taskStateColumnNames.has("draft_artifact_state")) {
  db.exec("ALTER TABLE chat_task_state ADD COLUMN draft_artifact_state TEXT NOT NULL DEFAULT ''");
}
if (!taskStateColumnNames.has("draft_artifact_step")) {
  db.exec("ALTER TABLE chat_task_state ADD COLUMN draft_artifact_step INTEGER NOT NULL DEFAULT 0");
}
if (!taskStateColumnNames.has("draft_artifact_updated_at")) {
  db.exec("ALTER TABLE chat_task_state ADD COLUMN draft_artifact_updated_at INTEGER");
}
if (!taskStateColumnNames.has("draft_artifact_source_message_id")) {
  db.exec(
    "ALTER TABLE chat_task_state ADD COLUMN draft_artifact_source_message_id TEXT NOT NULL DEFAULT ''"
  );
}

const ensureGlobalLongTermMemoryStmt = db.prepare(`
  INSERT INTO global_long_term_memory (
    scope_id,
    profile,
    preferences,
    decisions,
    knowledge,
    manual_lock_profile,
    manual_lock_preferences,
    manual_lock_decisions,
    manual_lock_knowledge,
    updated_by,
    updated_at
  ) VALUES ('global', '', '', '', '', 0, 0, 0, 0, 'auto', ?)
  ON CONFLICT(scope_id) DO NOTHING
`);
ensureGlobalLongTermMemoryStmt.run(Date.now());

const ensureProfileSettingsStmt = db.prepare(`
  INSERT INTO profile_settings (
    scope_id,
    active_profile_id,
    updated_at
  ) VALUES ('global', NULL, ?)
  ON CONFLICT(scope_id) DO NOTHING
`);
ensureProfileSettingsStmt.run(Date.now());

const ensureMemorySettingsStmt = db.prepare(`
  INSERT INTO memory_settings (
    scope_id,
    short_term_enabled,
    working_enabled,
    long_term_enabled,
    updated_at
  ) VALUES ('global', 1, 1, 1, ?)
  ON CONFLICT(scope_id) DO NOTHING
`);
ensureMemorySettingsStmt.run(Date.now());

const ensureInvariantSettingsStmt = db.prepare(`
  INSERT INTO invariant_settings (
    scope_id,
    enabled,
    inject_in_system_prompt,
    updated_at
  ) VALUES ('global', 1, 1, ?)
  ON CONFLICT(scope_id) DO NOTHING
`);
ensureInvariantSettingsStmt.run(Date.now());

const parseModel = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const parseAllowedModel = (value: unknown): string | undefined => {
  const parsed = parseModel(value);
  if (!parsed) {
    return undefined;
  }
  return ALLOWED_MODELS.has(parsed) ? parsed : undefined;
};

const parseReasoningEffort = (value: unknown): ReasoningEffort | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (
    trimmed === "none" ||
    trimmed === "minimal" ||
    trimmed === "low" ||
    trimmed === "medium" ||
    trimmed === "high" ||
    trimmed === "xhigh"
  ) {
    return trimmed;
  }
  return undefined;
};

const parseJsonSafe = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const normalizeErrorCode = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const code = value.trim().toUpperCase();
  return code || undefined;
};

const formatUpstreamError = (
  error: unknown
): { message: string; code?: string; cause?: string; hint?: string } => {
  const baseMessage =
    error instanceof Error && error.message ? error.message : "Unexpected server error";
  const errorWithCode = error as { code?: unknown; cause?: unknown };
  const code =
    normalizeErrorCode(errorWithCode?.code) ??
    normalizeErrorCode((errorWithCode?.cause as { code?: unknown } | undefined)?.code);
  const cause =
    errorWithCode?.cause instanceof Error
      ? errorWithCode.cause.message
      : typeof errorWithCode?.cause === "string"
      ? errorWithCode.cause
      : undefined;
  const hint = code ? NETWORK_ERROR_HINTS[code] : undefined;

  const details = [code ? `code=${code}` : undefined, cause ? `cause=${cause}` : undefined]
    .filter(Boolean)
    .join(", ");

  return {
    message: details ? `${baseMessage} (${details})` : baseMessage,
    code,
    cause,
    hint,
  };
};

const isContextOverflowError = (params: { code?: string; type?: string; message?: string }): boolean => {
  const code = params.code?.toLowerCase();
  const type = params.type?.toLowerCase();
  const message = params.message?.toLowerCase();
  if (code === "context_length_exceeded") {
    return true;
  }
  return Boolean(
    type?.includes("context_length_exceeded") ||
      message?.includes("context_length_exceeded") ||
      message?.includes("maximum context length") ||
      message?.includes("too many tokens")
  );
};

const buildOpenAiErrorPayload = (
  source: unknown,
  fallbackMessage: string,
  upstreamStatus?: number
): {
  message: string;
  code?: string;
  type?: string;
  param?: string;
  requestId?: string;
  upstreamStatus?: number;
  isContextOverflow?: boolean;
  raw?: unknown;
} => {
  const candidate = source as
    | {
        message?: unknown;
        code?: unknown;
        type?: unknown;
        param?: unknown;
        request_id?: unknown;
        requestId?: unknown;
      }
    | undefined;
  const message = typeof candidate?.message === "string" ? candidate.message : fallbackMessage;
  const code = typeof candidate?.code === "string" ? candidate.code : undefined;
  const type = typeof candidate?.type === "string" ? candidate.type : undefined;
  const param = typeof candidate?.param === "string" ? candidate.param : undefined;
  const requestId =
    typeof candidate?.request_id === "string"
      ? candidate.request_id
      : typeof candidate?.requestId === "string"
      ? candidate.requestId
      : undefined;
  const isContextOverflow = isContextOverflowError({ code, type, message });
  return {
    message,
    code,
    type,
    param,
    requestId,
    upstreamStatus,
    isContextOverflow: isContextOverflow ? true : undefined,
    raw: source,
  };
};

const extractCompletedText = (response: any): string => {
  if (!response || typeof response !== "object") {
    return "";
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part?.text === "string") {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join("");
};

const extractFinalDebug = (response: any): Record<string, unknown> => {
  return {
    id: typeof response?.id === "string" ? response.id : undefined,
    status: typeof response?.status === "string" ? response.status : undefined,
    model: typeof response?.model === "string" ? response.model : undefined,
    output_text: extractCompletedText(response),
    usage: response?.usage,
  };
};

const toFiniteNumber = (value: unknown): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  return 0;
};

const extractUsageSummary = (usage: unknown): UsageSummary => {
  const candidate = usage as
    | {
        input_tokens?: unknown;
        output_tokens?: unknown;
        total_tokens?: unknown;
      }
    | undefined;
  const inputTokens = toFiniteNumber(candidate?.input_tokens);
  const outputTokens = toFiniteNumber(candidate?.output_tokens);
  const totalTokens = toFiniteNumber(candidate?.total_tokens) || inputTokens + outputTokens;
  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
};

const normalizeModelId = (model: string): string => model.trim().toLowerCase();

const matchesModelAlias = (modelId: string, alias: string): boolean => {
  if (!modelId.startsWith(alias)) {
    return false;
  }
  const nextChar = modelId.slice(alias.length, alias.length + 1);
  return !nextChar || !/[a-z0-9]/i.test(nextChar);
};

const resolveModelPricing = (model: string): { input: number; output: number } | undefined => {
  const normalizedModel = normalizeModelId(model);
  const direct = MODEL_PRICING_PER_1M[normalizedModel];
  if (direct) {
    return direct;
  }

  for (const alias of MODEL_PRICING_KEYS) {
    if (matchesModelAlias(normalizedModel, alias)) {
      return MODEL_PRICING_PER_1M[alias];
    }
  }
  return undefined;
};

const estimateCostBreakdownUsd = (model: string, usageSummary: UsageSummary): CostBreakdownUsd | null => {
  const pricing = resolveModelPricing(model);
  if (!pricing) {
    return null;
  }

  const inputCostUsd = Number(((usageSummary.inputTokens / 1_000_000) * pricing.input).toFixed(8));
  const outputCostUsd = Number(((usageSummary.outputTokens / 1_000_000) * pricing.output).toFixed(8));
  const totalCostUsd = Number((inputCostUsd + outputCostUsd).toFixed(8));
  return {
    inputCostUsd,
    outputCostUsd,
    totalCostUsd,
  };
};

const compactWhitespace = (value: string): string => value.replace(/\s+/g, " ").trim();

const splitSegments = (value: string): string[] => {
  const normalized = value
    .replace(/\r/g, "\n")
    .replace(/[•·▪●]/g, ";")
    .replace(/\n+/g, ";")
    .split(";")
    .map((segment) => segment.trim().replace(/^[-*]\s+/, ""))
    .map((segment) => segment.replace(/^\d+[.)]\s+/, ""))
    .map((segment) => compactWhitespace(segment))
    .filter(Boolean);
  return normalized;
};

const compactFactText = (value: string): string => splitSegments(value).join("; ");

const clampWithEllipsis = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }
  if (maxLength <= 1) {
    return value.slice(0, maxLength);
  }
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
};

const normalizeTextField = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    return "";
  }
  const compact = compactFactText(value);
  if (!compact) {
    return "";
  }
  return clampWithEllipsis(compact, maxLength);
};

const normalizeShortSummary = (value: unknown): string => normalizeTextField(value, SHORT_TERM_MAX_LENGTH);
const normalizeWorkingField = (value: unknown): string => normalizeTextField(value, WORKING_FIELD_MAX_LENGTH);
const normalizeLongTermField = (value: unknown): string => normalizeTextField(value, LONG_TERM_FIELD_MAX_LENGTH);
const normalizeCandidateValue = (value: unknown): string => normalizeTextField(value, CANDIDATE_VALUE_MAX_LENGTH);
const normalizeProfileField = (value: unknown): string => normalizeTextField(value, PROFILE_FIELD_MAX_LENGTH);
const normalizeInvariantRule = (value: unknown): string => normalizeTextField(value, INVARIANT_RULE_MAX_LENGTH);

const parseProfileName = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const compact = compactWhitespace(value.trim());
  if (!compact || compact.length > PROFILE_NAME_MAX_LENGTH) {
    return null;
  }
  return compact;
};

const parseInvariantName = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const compact = compactWhitespace(value.trim());
  if (!compact || compact.length > INVARIANT_NAME_MAX_LENGTH) {
    return null;
  }
  return compact;
};

const extractJsonObject = (value: string): string | null => {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (withoutFence.startsWith("{") && withoutFence.endsWith("}")) {
    return withoutFence;
  }

  const first = withoutFence.indexOf("{");
  const last = withoutFence.lastIndexOf("}");
  if (first < 0 || last <= first) {
    return null;
  }
  return withoutFence.slice(first, last + 1);
};

const parseMemoryUpdaterOutput = (value: string): MemoryUpdaterOutput | null => {
  const jsonText = extractJsonObject(value);
  if (!jsonText) {
    return null;
  }
  const parsed = parseJsonSafe(jsonText);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const candidate = parsed as {
    shortTerm?: { rollingSummary?: unknown };
    working?: { goal?: unknown; constraints?: unknown; status?: unknown; nextSteps?: unknown };
    longTermCandidates?: Array<{ targetField?: unknown; value?: unknown; reason?: unknown }>;
  };

  const fields = new Set<LongTermField>(["profile", "preferences", "decisions", "knowledge"]);
  const longTermCandidates = Array.isArray(candidate.longTermCandidates)
    ? candidate.longTermCandidates
        .map((item) => {
          const targetField =
            typeof item?.targetField === "string" && fields.has(item.targetField as LongTermField)
              ? (item.targetField as LongTermField)
              : null;
          const value = normalizeCandidateValue(item?.value);
          const reason = normalizeTextField(item?.reason, 240);
          if (!targetField || !value) {
            return null;
          }
          return {
            targetField,
            value,
            reason,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
    : [];

  return {
    shortTerm: {
      rollingSummary: normalizeShortSummary(candidate.shortTerm?.rollingSummary),
    },
    working: {
      goal: normalizeWorkingField(candidate.working?.goal),
      constraints: normalizeWorkingField(candidate.working?.constraints),
      status: normalizeWorkingField(candidate.working?.status),
      nextSteps: normalizeWorkingField(candidate.working?.nextSteps),
    },
    longTermCandidates,
  };
};

const dedupeSegments = (segments: string[]): string[] => {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const segment of segments) {
    const key = segment.trim().toLowerCase();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(segment.trim());
  }
  return unique;
};

const mergeLongTermFieldValue = (current: string, incoming: string): string => {
  const currentSegments = splitSegments(current);
  const incomingSegments = splitSegments(incoming);
  const merged = dedupeSegments([...currentSegments, ...incomingSegments]).join("; ");
  return clampWithEllipsis(merged, LONG_TERM_FIELD_MAX_LENGTH);
};

const buildBranchChatTitle = (sourceTitle: string): string => {
  const normalizedSource = sourceTitle.trim() || "New chat";
  return `${BRANCH_CHAT_TITLE_PREFIX}${normalizedSource}`;
};

const buildOpenAiRequestBody = (params: {
  model: string;
  systemPrompt: string;
  inputMessages: Array<{ role: Role; content: string }>;
  reasoningEffort?: ReasoningEffort;
}): Record<string, unknown> => {
  const { model, systemPrompt, inputMessages, reasoningEffort } = params;
  const body: Record<string, unknown> = {
    model,
    stream: true,
    truncation: "disabled",
    instructions: systemPrompt || undefined,
    input: inputMessages,
  };

  if (reasoningEffort !== undefined) {
    body.reasoning = { effort: reasoningEffort };
  }

  return body;
};

const buildMemoryUpdateRequestBody = (params: {
  memoryModel: string;
  previousSummary: string;
  working: { goal: string; constraints: string; status: string; nextSteps: string };
  longTerm: { profile: string; preferences: string; decisions: string; knowledge: string };
  newMessages: Array<{ role: Role; content: string }>;
  latestUserPrompt: string;
  shortTermEnabled: boolean;
  workingEnabled: boolean;
  longTermEnabled: boolean;
}): Record<string, unknown> => {
  const {
    memoryModel,
    previousSummary,
    working,
    longTerm,
    newMessages,
    latestUserPrompt,
    shortTermEnabled,
    workingEnabled,
    longTermEnabled,
  } = params;
  const shortTermRule = shortTermEnabled
    ? "1) shortTerm.rollingSummary: обнови накопительное саммари диалога (прошлое саммари + новые сообщения)."
    : "1) shortTerm.rollingSummary: верни пустую строку.";
  const workingRule = workingEnabled
    ? "2) working: только текущее состояние задачи (goal, constraints, status, nextSteps)."
    : "2) working: верни все поля пустыми строками.";
  const longTermRule = longTermEnabled
    ? "3) longTermCandidates: только потенциально долговременные факты. Не переноси ничего напрямую в long-term."
    : "3) longTermCandidates: всегда возвращай пустой массив.";
  return {
    model: memoryModel,
    stream: false,
    truncation: "disabled",
    instructions: [
      "Ты обновляешь слои памяти ассистента.",
      "Верни строго один JSON-объект без markdown и пояснений.",
      "Формат:",
      '{"shortTerm":{"rollingSummary":""},"working":{"goal":"","constraints":"","status":"","nextSteps":""},"longTermCandidates":[{"targetField":"profile|preferences|decisions|knowledge","value":"","reason":""}]}',
      "Правила:",
      shortTermRule,
      workingRule,
      longTermRule,
      "4) Не дублируй одинаковые кандидаты.",
      "5) Пиши компактно, короткими фразами через '; '.",
      "6) Если данных нет, используй пустую строку.",
      "7) Лимиты символов: rollingSummary<=1800, working fields<=320, candidate value<=320, reason<=240.",
    ].join("\n"),
    input: [
      {
        role: "user",
        content: JSON.stringify(
          {
            previousSummary,
            working,
            longTerm,
            latestUserPrompt,
            newMessages,
          },
          null,
          2
        ),
      },
    ],
  };
};

const updateMemoryViaModel = async (params: {
  memoryModel: string;
  previousSummary: string;
  working: { goal: string; constraints: string; status: string; nextSteps: string };
  longTerm: { profile: string; preferences: string; decisions: string; knowledge: string };
  newMessages: Array<{ role: Role; content: string }>;
  latestUserPrompt: string;
  shortTermEnabled: boolean;
  workingEnabled: boolean;
  longTermEnabled: boolean;
  signal: AbortSignal;
}): Promise<MemoryUpdaterOutput> => {
  const requestBody = buildMemoryUpdateRequestBody(params);
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: params.signal,
    body: JSON.stringify(requestBody),
  });

  if (!upstream.ok) {
    const payloadText = await upstream.text();
    throw new Error(`memory updater failed (${upstream.status}): ${payloadText}`);
  }

  const responseText = await upstream.text();
  const payload = parseJsonSafe(responseText) as
    | {
        output_text?: unknown;
      }
    | null;
  if (!payload || typeof payload !== "object") {
    throw new Error("memory updater returned invalid JSON envelope");
  }

  const completedText =
    extractCompletedText(payload) ||
    (typeof payload.output_text === "string" ? payload.output_text : "");
  const parsed = parseMemoryUpdaterOutput(completedText);
  if (!parsed) {
    throw new Error("memory updater returned invalid JSON object");
  }

  return parsed;
};

const buildMemoryBlock = (params: {
  shortTerm: { rollingSummary: string };
  working: { goal: string; constraints: string; status: string; nextSteps: string };
  longTerm: { profile: string; preferences: string; decisions: string; knowledge: string };
  shortTermEnabled: boolean;
  workingEnabled: boolean;
  longTermEnabled: boolean;
}): string => {
  const { shortTerm, working, longTerm, shortTermEnabled, workingEnabled, longTermEnabled } = params;
  const block = ["MEMORY_LAYERS"];
  if (shortTermEnabled) {
    block.push("SHORT_TERM:", `- rolling_summary: ${shortTerm.rollingSummary || "(empty)"}`);
  }
  if (workingEnabled) {
    block.push(
      "WORKING_MEMORY:",
      `- goal: ${working.goal || "(empty)"}`,
      `- constraints: ${working.constraints || "(empty)"}`,
      `- status: ${working.status || "(empty)"}`,
      `- next_steps: ${working.nextSteps || "(empty)"}`
    );
  }
  if (longTermEnabled) {
    block.push(
      "LONG_TERM_MEMORY:",
      `- profile: ${longTerm.profile || "(empty)"}`,
      `- preferences: ${longTerm.preferences || "(empty)"}`,
      `- decisions: ${longTerm.decisions || "(empty)"}`,
      `- knowledge: ${longTerm.knowledge || "(empty)"}`
    );
  }
  return block.join("\n");
};

const buildProfileBlock = (profile: UserProfileRow | null): string => {
  if (!profile) {
    return "";
  }
  return [
    "USER_PROFILE",
    `- name: ${profile.name || "(empty)"}`,
    `- style: ${profile.style || "(empty)"}`,
    `- output_format: ${profile.outputFormat || "(empty)"}`,
    `- constraints: ${profile.constraints || "(empty)"}`,
    `- notes: ${profile.notes || "(empty)"}`,
  ].join("\n");
};

const buildInvariantBlock = (invariants: InvariantRow[]): string => {
  if (invariants.length === 0) {
    return "";
  }
  const lines = ["INVARIANTS"];
  for (let index = 0; index < invariants.length; index += 1) {
    const invariant = invariants[index];
    lines.push(`${index + 1}. [${invariant.id}] ${invariant.name}: ${invariant.ruleText}`);
  }
  return lines.join("\n");
};

const buildInvariantCheckRequestBody = (params: {
  model: string;
  invariants: InvariantRow[];
  assistantResponse: string;
}): Record<string, unknown> => {
  const { model, invariants, assistantResponse } = params;
  return {
    model,
    stream: false,
    truncation: "disabled",
    instructions: [
      "Проверь ответ ассистента на нарушение инвариантов.",
      "Верни строго один JSON-объект без markdown и пояснений.",
      'Формат: {"violations":[{"invariantId":"","description":""}]}',
      "Если нарушений нет, верни пустой массив violations.",
      "В invariantId используй id из переданного списка инвариантов.",
    ].join("\n"),
    input: [
      {
        role: "user",
        content: JSON.stringify(
          {
            invariants: invariants.map((invariant) => ({
              id: invariant.id,
              name: invariant.name,
              ruleText: invariant.ruleText,
            })),
            answer: assistantResponse,
          },
          null,
          2
        ),
      },
    ],
  };
};

const parseInvariantCheckOutput = (
  value: string,
  invariants: InvariantRow[]
): InvariantViolation[] | null => {
  const jsonText = extractJsonObject(value);
  if (!jsonText) {
    return null;
  }

  const parsed = parseJsonSafe(jsonText) as
    | {
        violations?: unknown;
      }
    | null;
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  if (!Array.isArray(parsed.violations)) {
    return [];
  }

  const violations: InvariantViolation[] = [];
  for (const item of parsed.violations) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const candidate = item as { invariantId?: unknown; invariant_id?: unknown; description?: unknown };
    const rawId =
      typeof candidate.invariantId === "string"
        ? candidate.invariantId
        : typeof candidate.invariant_id === "string"
        ? candidate.invariant_id
        : "";
    const invariantId = rawId.trim();
    if (!invariantId) {
      continue;
    }
    const description = normalizeTextField(candidate.description, 320) || "Invariant violation detected.";
    violations.push({
      invariantId,
      description,
    });
  }

  const deduped: InvariantViolation[] = [];
  const seen = new Set<string>();
  for (const violation of violations) {
    const key = `${violation.invariantId.toLowerCase()}::${violation.description.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(violation);
  }
  return deduped;
};

const checkInvariantViolationsViaModel = async (params: {
  model: string;
  invariants: InvariantRow[];
  assistantResponse: string;
  signal: AbortSignal;
}): Promise<InvariantViolation[]> => {
  if (params.invariants.length === 0) {
    return [];
  }

  const requestBody = buildInvariantCheckRequestBody(params);
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: params.signal,
    body: JSON.stringify(requestBody),
  });

  if (!upstream.ok) {
    const payloadText = await upstream.text();
    throw new Error(`invariant checker failed (${upstream.status}): ${payloadText}`);
  }

  const responseText = await upstream.text();
  const payload = parseJsonSafe(responseText) as
    | {
        output_text?: unknown;
      }
    | null;
  if (!payload || typeof payload !== "object") {
    throw new Error("invariant checker returned invalid JSON envelope");
  }

  const completedText =
    extractCompletedText(payload) ||
    (typeof payload.output_text === "string" ? payload.output_text : "");
  const parsed = parseInvariantCheckOutput(completedText, params.invariants);
  if (!parsed) {
    throw new Error("invariant checker returned invalid JSON object");
  }
  return parsed;
};

const buildInvariantViolationMessage = (params: {
  violations: InvariantViolation[];
  rejectedResponse: string;
  sourceModel: string;
  createdAt: number;
}): string => {
  const payload = {
    violations: params.violations,
    rejectedResponse: params.rejectedResponse,
    sourceModel: params.sourceModel,
    createdAt: params.createdAt,
  };
  return [
    "Ответ отклонен: обнаружены нарушения инвариантов.",
    INVARIANT_VIOLATION_OPEN_TAG,
    JSON.stringify(payload, null, 2),
    INVARIANT_VIOLATION_CLOSE_TAG,
  ].join("\n");
};

const mergeSystemPromptWithContext = (params: {
  stagePrompt: string;
  systemPrompt: string;
  profileBlock: string;
  taskBlock: string;
  memoryBlock: string;
  invariantBlock?: string;
}): string => {
  const { stagePrompt, systemPrompt, profileBlock, taskBlock, memoryBlock, invariantBlock } = params;
  const chunks = [
    systemPrompt.trim(),
    profileBlock.trim(),
    taskBlock.trim(),
    memoryBlock.trim(),
    invariantBlock?.trim() ?? "",
    stagePrompt.trim(),
  ].filter(Boolean);
  return chunks.join("\n\n");
};

const getChatStmt = db.prepare(`
  SELECT
    id,
    title,
    model,
    system_prompt AS systemPrompt,
    memory_strategy AS memoryStrategy,
    sliding_window_size AS slidingWindowSize,
    sticky_window_size AS stickyWindowSize,
    branch_from_chat_id AS branchFromChatId,
    branch_from_chat_title AS branchFromChatTitle,
    branch_checkpoint_message_count AS branchCheckpointMessageCount,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM chats
  WHERE id = ?
`);

const listChatsStmt = db.prepare(`
  SELECT
    c.id,
    c.title,
    c.model,
    c.system_prompt AS systemPrompt,
    c.memory_strategy AS memoryStrategy,
    c.sliding_window_size AS slidingWindowSize,
    c.sticky_window_size AS stickyWindowSize,
    c.branch_from_chat_id AS branchFromChatId,
    c.branch_from_chat_title AS branchFromChatTitle,
    c.branch_checkpoint_message_count AS branchCheckpointMessageCount,
    c.created_at AS createdAt,
    c.updated_at AS updatedAt,
    (
      SELECT m.content
      FROM messages m
      WHERE m.chat_id = c.id
      ORDER BY m.created_at DESC
      LIMIT 1
    ) AS lastMessagePreview
  FROM chats c
  ORDER BY c.updated_at DESC
`);

const listMessagesStmt = db.prepare(`
  SELECT
    id,
    chat_id AS chatId,
    role,
    content,
    request_json AS requestJson,
    response_json AS responseJson,
    latency_ms AS latencyMs,
    input_tokens AS inputTokens,
    output_tokens AS outputTokens,
    total_tokens AS totalTokens,
    cost_usd AS costUsd,
    input_cost_usd AS inputCostUsd,
    output_cost_usd AS outputCostUsd,
    created_at AS createdAt
  FROM messages
  WHERE chat_id = ?
  ORDER BY created_at ASC
`);

const listMessagesForMemoryStmt = db.prepare(`
  SELECT
    role,
    content
  FROM messages
  WHERE chat_id = ?
    AND content NOT LIKE '%[INVARIANT_VIOLATION_JSON]%'
  ORDER BY created_at ASC
`);

const listMessagesForBranchStmt = db.prepare(`
  SELECT
    role,
    content,
    request_json AS requestJson,
    response_json AS responseJson,
    latency_ms AS latencyMs,
    input_tokens AS inputTokens,
    output_tokens AS outputTokens,
    total_tokens AS totalTokens,
    cost_usd AS costUsd,
    input_cost_usd AS inputCostUsd,
    output_cost_usd AS outputCostUsd
  FROM messages
  WHERE chat_id = ?
  ORDER BY created_at ASC
`);

const getMessageByIdForChatStmt = db.prepare(`
  SELECT
    id,
    chat_id AS chatId,
    content
  FROM messages
  WHERE id = ? AND chat_id = ?
  LIMIT 1
`);

const insertChatStmt = db.prepare(`
  INSERT INTO chats (
    id, title, model, system_prompt, memory_strategy, sliding_window_size, sticky_window_size,
    branch_from_chat_id, branch_from_chat_title, branch_checkpoint_message_count, created_at, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateChatStmt = db.prepare(`
  UPDATE chats
  SET title = ?, model = ?, system_prompt = ?, memory_strategy = ?, sliding_window_size = ?, sticky_window_size = ?,
      branch_from_chat_id = ?, branch_from_chat_title = ?, branch_checkpoint_message_count = ?, updated_at = ?
  WHERE id = ?
`);

const deleteChatStmt = db.prepare(`DELETE FROM chats WHERE id = ?`);

const insertMessageStmt = db.prepare(`
  INSERT INTO messages (
    id, chat_id, role, content, request_json, response_json,
    latency_ms, input_tokens, output_tokens, total_tokens,
    cost_usd, input_cost_usd, output_cost_usd, created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateChatUpdatedAtStmt = db.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`);

const getShortMemoryStmt = db.prepare(`
  SELECT
    chat_id AS chatId,
    rolling_summary AS rollingSummary,
    last_processed_message_count AS lastProcessedMessageCount,
    updated_at AS updatedAt
  FROM chat_short_memory
  WHERE chat_id = ?
`);

const upsertShortMemoryStmt = db.prepare(`
  INSERT INTO chat_short_memory (chat_id, rolling_summary, last_processed_message_count, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(chat_id) DO UPDATE SET
    rolling_summary = excluded.rolling_summary,
    last_processed_message_count = excluded.last_processed_message_count,
    updated_at = excluded.updated_at
`);

const getWorkingMemoryStmt = db.prepare(`
  SELECT
    chat_id AS chatId,
    goal,
    constraints,
    status,
    next_steps AS nextSteps,
    manual_lock_goal AS manualLockGoal,
    manual_lock_constraints AS manualLockConstraints,
    manual_lock_status AS manualLockStatus,
    manual_lock_next_steps AS manualLockNextSteps,
    updated_by AS updatedBy,
    updated_at AS updatedAt
  FROM chat_working_memory
  WHERE chat_id = ?
`);

const upsertWorkingMemoryStmt = db.prepare(`
  INSERT INTO chat_working_memory (
    chat_id,
    goal,
    constraints,
    status,
    next_steps,
    manual_lock_goal,
    manual_lock_constraints,
    manual_lock_status,
    manual_lock_next_steps,
    updated_by,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(chat_id) DO UPDATE SET
    goal = excluded.goal,
    constraints = excluded.constraints,
    status = excluded.status,
    next_steps = excluded.next_steps,
    manual_lock_goal = excluded.manual_lock_goal,
    manual_lock_constraints = excluded.manual_lock_constraints,
    manual_lock_status = excluded.manual_lock_status,
    manual_lock_next_steps = excluded.manual_lock_next_steps,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
`);

const getTaskStateStmt = db.prepare(`
  SELECT
    chat_id AS chatId,
    task,
    state,
    step,
    total,
    expected_action AS expectedAction,
    current,
    plan_json AS planJson,
    done_json AS doneJson,
    artifacts_json AS artifactsJson,
    paused,
    paused_at AS pausedAt,
    paused_reason AS pausedReason,
    draft_artifact_text AS draftArtifactText,
    draft_artifact_state AS draftArtifactState,
    draft_artifact_step AS draftArtifactStep,
    draft_artifact_updated_at AS draftArtifactUpdatedAt,
    draft_artifact_source_message_id AS draftArtifactSourceMessageId,
    updated_at AS updatedAt
  FROM chat_task_state
  WHERE chat_id = ?
`);

const upsertTaskStateStmt = db.prepare(`
  INSERT INTO chat_task_state (
    chat_id,
    task,
    state,
    step,
    total,
    expected_action,
    current,
    plan_json,
    done_json,
    artifacts_json,
    paused,
    paused_at,
    paused_reason,
    draft_artifact_text,
    draft_artifact_state,
    draft_artifact_step,
    draft_artifact_updated_at,
    draft_artifact_source_message_id,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(chat_id) DO UPDATE SET
    task = excluded.task,
    state = excluded.state,
    step = excluded.step,
    total = excluded.total,
    expected_action = excluded.expected_action,
    current = excluded.current,
    plan_json = excluded.plan_json,
    done_json = excluded.done_json,
    artifacts_json = excluded.artifacts_json,
    paused = excluded.paused,
    paused_at = excluded.paused_at,
    paused_reason = excluded.paused_reason,
    draft_artifact_text = excluded.draft_artifact_text,
    draft_artifact_state = excluded.draft_artifact_state,
    draft_artifact_step = excluded.draft_artifact_step,
    draft_artifact_updated_at = excluded.draft_artifact_updated_at,
    draft_artifact_source_message_id = excluded.draft_artifact_source_message_id,
    updated_at = excluded.updated_at
`);

const getLongTermMemoryStmt = db.prepare(`
  SELECT
    scope_id AS scopeId,
    profile,
    preferences,
    decisions,
    knowledge,
    manual_lock_profile AS manualLockProfile,
    manual_lock_preferences AS manualLockPreferences,
    manual_lock_decisions AS manualLockDecisions,
    manual_lock_knowledge AS manualLockKnowledge,
    updated_by AS updatedBy,
    updated_at AS updatedAt
  FROM global_long_term_memory
  WHERE scope_id = ?
`);

const upsertLongTermMemoryStmt = db.prepare(`
  INSERT INTO global_long_term_memory (
    scope_id,
    profile,
    preferences,
    decisions,
    knowledge,
    manual_lock_profile,
    manual_lock_preferences,
    manual_lock_decisions,
    manual_lock_knowledge,
    updated_by,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(scope_id) DO UPDATE SET
    profile = excluded.profile,
    preferences = excluded.preferences,
    decisions = excluded.decisions,
    knowledge = excluded.knowledge,
    manual_lock_profile = excluded.manual_lock_profile,
    manual_lock_preferences = excluded.manual_lock_preferences,
    manual_lock_decisions = excluded.manual_lock_decisions,
    manual_lock_knowledge = excluded.manual_lock_knowledge,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at
`);

const listProfilesStmt = db.prepare(`
  SELECT
    id,
    name,
    style,
    output_format AS outputFormat,
    constraints,
    notes,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM user_profiles
  ORDER BY updated_at DESC, created_at DESC
`);

const getProfileByIdStmt = db.prepare(`
  SELECT
    id,
    name,
    style,
    output_format AS outputFormat,
    constraints,
    notes,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM user_profiles
  WHERE id = ?
`);

const insertProfileStmt = db.prepare(`
  INSERT INTO user_profiles (
    id,
    name,
    style,
    output_format,
    constraints,
    notes,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateProfileStmt = db.prepare(`
  UPDATE user_profiles
  SET name = ?, style = ?, output_format = ?, constraints = ?, notes = ?, updated_at = ?
  WHERE id = ?
`);

const deleteProfileStmt = db.prepare(`
  DELETE FROM user_profiles
  WHERE id = ?
`);

const getProfileSettingsStmt = db.prepare(`
  SELECT
    scope_id AS scopeId,
    active_profile_id AS activeProfileId,
    updated_at AS updatedAt
  FROM profile_settings
  WHERE scope_id = ?
`);

const upsertProfileSettingsStmt = db.prepare(`
  INSERT INTO profile_settings (
    scope_id,
    active_profile_id,
    updated_at
  )
  VALUES (?, ?, ?)
  ON CONFLICT(scope_id) DO UPDATE SET
    active_profile_id = excluded.active_profile_id,
    updated_at = excluded.updated_at
`);

const getMemorySettingsStmt = db.prepare(`
  SELECT
    scope_id AS scopeId,
    short_term_enabled AS shortTermEnabled,
    working_enabled AS workingEnabled,
    long_term_enabled AS longTermEnabled,
    updated_at AS updatedAt
  FROM memory_settings
  WHERE scope_id = ?
`);

const upsertMemorySettingsStmt = db.prepare(`
  INSERT INTO memory_settings (
    scope_id,
    short_term_enabled,
    working_enabled,
    long_term_enabled,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(scope_id) DO UPDATE SET
    short_term_enabled = excluded.short_term_enabled,
    working_enabled = excluded.working_enabled,
    long_term_enabled = excluded.long_term_enabled,
    updated_at = excluded.updated_at
`);

const getInvariantSettingsStmt = db.prepare(`
  SELECT
    scope_id AS scopeId,
    enabled,
    inject_in_system_prompt AS injectInSystemPrompt,
    updated_at AS updatedAt
  FROM invariant_settings
  WHERE scope_id = ?
`);

const upsertInvariantSettingsStmt = db.prepare(`
  INSERT INTO invariant_settings (
    scope_id,
    enabled,
    inject_in_system_prompt,
    updated_at
  )
  VALUES (?, ?, ?, ?)
  ON CONFLICT(scope_id) DO UPDATE SET
    enabled = excluded.enabled,
    inject_in_system_prompt = excluded.inject_in_system_prompt,
    updated_at = excluded.updated_at
`);

const listInvariantsStmt = db.prepare(`
  SELECT
    id,
    name,
    rule_text AS ruleText,
    sort_order AS sortOrder,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM invariants
  ORDER BY sort_order ASC, created_at ASC
`);

const getInvariantByIdStmt = db.prepare(`
  SELECT
    id,
    name,
    rule_text AS ruleText,
    sort_order AS sortOrder,
    created_at AS createdAt,
    updated_at AS updatedAt
  FROM invariants
  WHERE id = ?
`);

const getMaxInvariantSortOrderStmt = db.prepare(`
  SELECT COALESCE(MAX(sort_order), 0) AS maxSortOrder
  FROM invariants
`);

const insertInvariantStmt = db.prepare(`
  INSERT INTO invariants (
    id,
    name,
    rule_text,
    sort_order,
    created_at,
    updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?)
`);

const updateInvariantStmt = db.prepare(`
  UPDATE invariants
  SET name = ?, rule_text = ?, updated_at = ?
  WHERE id = ?
`);

const deleteInvariantStmt = db.prepare(`
  DELETE FROM invariants
  WHERE id = ?
`);

const listPendingCandidatesByChatStmt = db.prepare(`
  SELECT
    id,
    chat_id AS chatId,
    target_field AS targetField,
    value,
    reason,
    status,
    created_at AS createdAt,
    resolved_at AS resolvedAt
  FROM long_term_candidates
  WHERE chat_id = ? AND status = 'pending'
  ORDER BY created_at ASC
`);

const getCandidateByIdStmt = db.prepare(`
  SELECT
    id,
    chat_id AS chatId,
    target_field AS targetField,
    value,
    reason,
    status,
    created_at AS createdAt,
    resolved_at AS resolvedAt
  FROM long_term_candidates
  WHERE id = ?
`);

const findPendingDuplicateCandidateStmt = db.prepare(`
  SELECT id
  FROM long_term_candidates
  WHERE chat_id = ? AND target_field = ? AND lower(value) = lower(?) AND status = 'pending'
  LIMIT 1
`);

const insertLongTermCandidateStmt = db.prepare(`
  INSERT INTO long_term_candidates (
    id,
    chat_id,
    target_field,
    value,
    reason,
    status,
    created_at,
    resolved_at
  )
  VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL)
`);

const resolveCandidateStmt = db.prepare(`
  UPDATE long_term_candidates
  SET status = ?, resolved_at = ?
  WHERE id = ?
`);

const createDefaultShortMemory = (chatId: string, now = Date.now()): ShortTermMemoryRow => ({
  chatId,
  rollingSummary: "",
  lastProcessedMessageCount: 0,
  updatedAt: now,
});

const createDefaultWorkingMemory = (chatId: string, now = Date.now()): WorkingMemoryRow => ({
  chatId,
  goal: "",
  constraints: "",
  status: "",
  nextSteps: "",
  manualLockGoal: 0,
  manualLockConstraints: 0,
  manualLockStatus: 0,
  manualLockNextSteps: 0,
  updatedBy: "auto",
  updatedAt: now,
});

const parseJsonArray = (value: string): unknown[] => {
  const parsed = parseJsonSafe(value);
  return Array.isArray(parsed) ? parsed : [];
};

const createDefaultTaskState = (taskName: string, now = Date.now()): TaskContext =>
  createDefaultTaskContext(taskName, now);

const toTaskContext = (row: TaskStateRow): TaskContext => {
  const planRaw = parseJsonArray(row.planJson);
  const doneRaw = parseJsonArray(row.doneJson);
  const artifactsRaw = parseJsonArray(row.artifactsJson);

  return normalizeTaskContext({
    task: row.task,
    state: row.state as TaskContext["state"],
    step: row.step,
    total: row.total,
    expectedAction: row.expectedAction as TaskContext["expectedAction"],
    current: row.current,
    plan: planRaw.filter((item): item is string => typeof item === "string"),
    done: doneRaw.filter((item): item is string => typeof item === "string"),
    artifacts: artifactsRaw as TaskContext["artifacts"],
    paused: row.paused === 1,
    pausedAt: row.pausedAt,
    pausedReason: row.pausedReason,
    draftArtifactText: row.draftArtifactText,
    draftArtifactState: row.draftArtifactState as TaskContext["draftArtifactState"],
    draftArtifactStep: row.draftArtifactStep,
    draftArtifactUpdatedAt: row.draftArtifactUpdatedAt,
    draftArtifactSourceMessageId: row.draftArtifactSourceMessageId,
    updatedAt: row.updatedAt,
  });
};

const createDefaultLongTermMemory = (now = Date.now()): LongTermMemoryRow => ({
  scopeId: GLOBAL_LONG_TERM_SCOPE_ID,
  profile: "",
  preferences: "",
  decisions: "",
  knowledge: "",
  manualLockProfile: 0,
  manualLockPreferences: 0,
  manualLockDecisions: 0,
  manualLockKnowledge: 0,
  updatedBy: "auto",
  updatedAt: now,
});

const getOrCreateShortMemory = (chatId: string): ShortTermMemoryRow => {
  const existing = getShortMemoryStmt.get(chatId) as ShortTermMemoryRow | undefined;
  if (existing) {
    return existing;
  }
  const created = createDefaultShortMemory(chatId);
  upsertShortMemoryStmt.run(
    created.chatId,
    created.rollingSummary,
    created.lastProcessedMessageCount,
    created.updatedAt
  );
  return created;
};

const getOrCreateWorkingMemory = (chatId: string): WorkingMemoryRow => {
  const existing = getWorkingMemoryStmt.get(chatId) as WorkingMemoryRow | undefined;
  if (existing) {
    return existing;
  }
  const created = createDefaultWorkingMemory(chatId);
  upsertWorkingMemoryStmt.run(
    created.chatId,
    created.goal,
    created.constraints,
    created.status,
    created.nextSteps,
    created.manualLockGoal,
    created.manualLockConstraints,
    created.manualLockStatus,
    created.manualLockNextSteps,
    created.updatedBy,
    created.updatedAt
  );
  return created;
};

const getOrCreateTaskState = (chatId: string, fallbackTaskName: string): TaskContext => {
  const existing = getTaskStateStmt.get(chatId) as TaskStateRow | undefined;
  if (existing) {
    return toTaskContext(existing);
  }

  const created = createDefaultTaskState(fallbackTaskName);
  upsertTaskStateStmt.run(
    chatId,
    created.task,
    created.state,
    created.step,
    created.total,
    created.expectedAction,
    created.current,
    JSON.stringify(created.plan),
    JSON.stringify(created.done),
    JSON.stringify(created.artifacts),
    created.paused ? 1 : 0,
    created.pausedAt,
    created.pausedReason,
    created.draftArtifactText,
    created.draftArtifactState,
    created.draftArtifactStep,
    created.draftArtifactUpdatedAt,
    created.draftArtifactSourceMessageId,
    created.updatedAt
  );
  return created;
};

const getOrCreateLongTermMemory = (): LongTermMemoryRow => {
  const existing = getLongTermMemoryStmt.get(GLOBAL_LONG_TERM_SCOPE_ID) as LongTermMemoryRow | undefined;
  if (existing) {
    return existing;
  }
  const created = createDefaultLongTermMemory();
  upsertLongTermMemoryStmt.run(
    created.scopeId,
    created.profile,
    created.preferences,
    created.decisions,
    created.knowledge,
    created.manualLockProfile,
    created.manualLockPreferences,
    created.manualLockDecisions,
    created.manualLockKnowledge,
    created.updatedBy,
    created.updatedAt
  );
  return created;
};

const getOrCreateProfileSettings = (): ProfileSettingsRow => {
  const existing = getProfileSettingsStmt.get(GLOBAL_PROFILE_SCOPE_ID) as ProfileSettingsRow | undefined;
  if (existing) {
    return existing;
  }
  const created: ProfileSettingsRow = {
    scopeId: GLOBAL_PROFILE_SCOPE_ID,
    activeProfileId: null,
    updatedAt: Date.now(),
  };
  upsertProfileSettingsStmt.run(created.scopeId, created.activeProfileId, created.updatedAt);
  return created;
};

const getOrCreateMemorySettings = (): MemorySettingsRow => {
  const existing = getMemorySettingsStmt.get(GLOBAL_MEMORY_SETTINGS_SCOPE_ID) as MemorySettingsRow | undefined;
  if (existing) {
    return existing;
  }
  const created: MemorySettingsRow = {
    scopeId: GLOBAL_MEMORY_SETTINGS_SCOPE_ID,
    shortTermEnabled: 1,
    workingEnabled: 1,
    longTermEnabled: 1,
    updatedAt: Date.now(),
  };
  upsertMemorySettingsStmt.run(
    created.scopeId,
    created.shortTermEnabled,
    created.workingEnabled,
    created.longTermEnabled,
    created.updatedAt
  );
  return created;
};

const getOrCreateInvariantSettings = (): InvariantSettingsRow => {
  const existing = getInvariantSettingsStmt.get(
    GLOBAL_INVARIANT_SETTINGS_SCOPE_ID
  ) as InvariantSettingsRow | undefined;
  if (existing) {
    return existing;
  }
  const created: InvariantSettingsRow = {
    scopeId: GLOBAL_INVARIANT_SETTINGS_SCOPE_ID,
    enabled: 1,
    injectInSystemPrompt: 1,
    updatedAt: Date.now(),
  };
  upsertInvariantSettingsStmt.run(
    created.scopeId,
    created.enabled,
    created.injectInSystemPrompt,
    created.updatedAt
  );
  return created;
};

const persistShortMemory = (memory: ShortTermMemoryRow): ShortTermMemoryRow => {
  upsertShortMemoryStmt.run(
    memory.chatId,
    memory.rollingSummary,
    memory.lastProcessedMessageCount,
    memory.updatedAt
  );
  return memory;
};

const persistWorkingMemory = (memory: WorkingMemoryRow): WorkingMemoryRow => {
  upsertWorkingMemoryStmt.run(
    memory.chatId,
    memory.goal,
    memory.constraints,
    memory.status,
    memory.nextSteps,
    memory.manualLockGoal,
    memory.manualLockConstraints,
    memory.manualLockStatus,
    memory.manualLockNextSteps,
    memory.updatedBy,
    memory.updatedAt
  );
  return memory;
};

const persistTaskState = (chatId: string, taskState: TaskContext): TaskContext => {
  const normalized = normalizeTaskContext(taskState);
  upsertTaskStateStmt.run(
    chatId,
    normalized.task,
    normalized.state,
    normalized.step,
    normalized.total,
    normalized.expectedAction,
    normalized.current,
    JSON.stringify(normalized.plan),
    JSON.stringify(normalized.done),
    JSON.stringify(normalized.artifacts),
    normalized.paused ? 1 : 0,
    normalized.pausedAt,
    normalized.pausedReason,
    normalized.draftArtifactText,
    normalized.draftArtifactState,
    normalized.draftArtifactStep,
    normalized.draftArtifactUpdatedAt,
    normalized.draftArtifactSourceMessageId,
    normalized.updatedAt
  );
  return normalized;
};

const deriveDraftDiagnosticsFromTask = (
  task: TaskContext
): { taskDraftStatus: TaskArtifactDraftStatus; taskDraftError?: string } => {
  if (!task.draftArtifactText) {
    return { taskDraftStatus: "missing" };
  }
  if (task.draftArtifactState !== task.state || task.draftArtifactStep !== task.step) {
    return {
      taskDraftStatus: "invalid",
      taskDraftError: "Stored draft artifact does not match current state/step",
    };
  }
  return { taskDraftStatus: "valid" };
};

const persistLongTermMemory = (memory: LongTermMemoryRow): LongTermMemoryRow => {
  upsertLongTermMemoryStmt.run(
    memory.scopeId,
    memory.profile,
    memory.preferences,
    memory.decisions,
    memory.knowledge,
    memory.manualLockProfile,
    memory.manualLockPreferences,
    memory.manualLockDecisions,
    memory.manualLockKnowledge,
    memory.updatedBy,
    memory.updatedAt
  );
  return memory;
};

const persistProfileSettings = (activeProfileId: string | null, now = Date.now()): ProfileSettingsRow => {
  upsertProfileSettingsStmt.run(GLOBAL_PROFILE_SCOPE_ID, activeProfileId, now);
  return {
    scopeId: GLOBAL_PROFILE_SCOPE_ID,
    activeProfileId,
    updatedAt: now,
  };
};

const persistMemorySettings = (
  settings: { shortTermEnabled: boolean; workingEnabled: boolean; longTermEnabled: boolean },
  now = Date.now()
): MemorySettingsRow => {
  const encodedShort = settings.shortTermEnabled ? 1 : 0;
  const encodedWorking = settings.workingEnabled ? 1 : 0;
  const encodedLong = settings.longTermEnabled ? 1 : 0;
  upsertMemorySettingsStmt.run(
    GLOBAL_MEMORY_SETTINGS_SCOPE_ID,
    encodedShort,
    encodedWorking,
    encodedLong,
    now
  );
  return {
    scopeId: GLOBAL_MEMORY_SETTINGS_SCOPE_ID,
    shortTermEnabled: encodedShort,
    workingEnabled: encodedWorking,
    longTermEnabled: encodedLong,
    updatedAt: now,
  };
};

const persistInvariantSettings = (
  settings: { enabled: boolean; injectInSystemPrompt: boolean },
  now = Date.now()
): InvariantSettingsRow => {
  const encodedEnabled = settings.enabled ? 1 : 0;
  const encodedInject = settings.injectInSystemPrompt ? 1 : 0;
  upsertInvariantSettingsStmt.run(
    GLOBAL_INVARIANT_SETTINGS_SCOPE_ID,
    encodedEnabled,
    encodedInject,
    now
  );
  return {
    scopeId: GLOBAL_INVARIANT_SETTINGS_SCOPE_ID,
    enabled: encodedEnabled,
    injectInSystemPrompt: encodedInject,
    updatedAt: now,
  };
};

const toSnapshot = (
  shortTerm: ShortTermMemoryRow,
  working: WorkingMemoryRow,
  longTerm: LongTermMemoryRow,
  pendingCandidates: LongTermCandidateRow[]
): ChatMemorySnapshot => ({
  shortTerm: {
    rollingSummary: shortTerm.rollingSummary,
    lastProcessedMessageCount: shortTerm.lastProcessedMessageCount,
    updatedAt: shortTerm.updatedAt,
  },
  working: {
    goal: working.goal,
    constraints: working.constraints,
    status: working.status,
    nextSteps: working.nextSteps,
    updatedBy: working.updatedBy,
    updatedAt: working.updatedAt,
  },
  longTerm: {
    profile: longTerm.profile,
    preferences: longTerm.preferences,
    decisions: longTerm.decisions,
    knowledge: longTerm.knowledge,
    updatedBy: longTerm.updatedBy,
    updatedAt: longTerm.updatedAt,
  },
  pendingCandidates: pendingCandidates.map((candidate) => ({
    id: candidate.id,
    chatId: candidate.chatId,
    targetField: candidate.targetField,
    value: candidate.value,
    reason: candidate.reason,
    status: candidate.status,
    createdAt: candidate.createdAt,
    resolvedAt: candidate.resolvedAt,
  })),
});

const getMemorySnapshotForChat = (chatId: string): ChatMemorySnapshot => {
  const shortTerm = getOrCreateShortMemory(chatId);
  const working = getOrCreateWorkingMemory(chatId);
  const longTerm = getOrCreateLongTermMemory();
  const pending = listPendingCandidatesByChatStmt.all(chatId) as LongTermCandidateRow[];
  return toSnapshot(shortTerm, working, longTerm, pending);
};

const applyAutoWorkingUpdate = (
  current: WorkingMemoryRow,
  incoming: MemoryUpdaterOutput["working"],
  now = Date.now()
): WorkingMemoryRow => {
  const next: WorkingMemoryRow = {
    ...current,
    goal: current.manualLockGoal ? current.goal : incoming.goal,
    constraints: current.manualLockConstraints ? current.constraints : incoming.constraints,
    status: current.manualLockStatus ? current.status : incoming.status,
    nextSteps: current.manualLockNextSteps ? current.nextSteps : incoming.nextSteps,
    updatedBy: "auto",
    updatedAt: now,
  };
  return next;
};

const insertPendingCandidates = (chatId: string, candidates: MemoryUpdaterOutput["longTermCandidates"], now: number) => {
  for (const candidate of candidates) {
    const duplicate = findPendingDuplicateCandidateStmt.get(
      chatId,
      candidate.targetField,
      candidate.value
    ) as { id: string } | undefined;
    if (duplicate) {
      continue;
    }
    insertLongTermCandidateStmt.run(
      createId(),
      chatId,
      candidate.targetField,
      candidate.value,
      candidate.reason,
      now
    );
  }
};

const createChat = (params?: {
  title?: string;
  model?: string;
  systemPrompt?: string;
  branchFromChatId?: string | null;
  branchFromChatTitle?: string | null;
  branchCheckpointMessageCount?: number | null;
}) => {
  const now = Date.now();
  const id = createId();
  const title = params?.title?.trim() || "New chat";
  const model = parseAllowedModel(params?.model) ?? EFFECTIVE_DEFAULT_MODEL;
  const systemPrompt = params?.systemPrompt?.trim() ?? "";
  const branchFromChatId =
    typeof params?.branchFromChatId === "string" && params.branchFromChatId.trim()
      ? params.branchFromChatId.trim()
      : null;
  const branchFromChatTitle =
    typeof params?.branchFromChatTitle === "string" && params.branchFromChatTitle.trim()
      ? params.branchFromChatTitle.trim()
      : null;
  const branchCheckpointMessageCount =
    typeof params?.branchCheckpointMessageCount === "number" &&
    Number.isInteger(params.branchCheckpointMessageCount) &&
    params.branchCheckpointMessageCount >= 0
      ? params.branchCheckpointMessageCount
      : null;

  insertChatStmt.run(
    id,
    title,
    model,
    systemPrompt,
    "none",
    6,
    6,
    branchFromChatId,
    branchFromChatTitle,
    branchCheckpointMessageCount,
    now,
    now
  );

  persistShortMemory(createDefaultShortMemory(id, now));
  persistWorkingMemory(createDefaultWorkingMemory(id, now));
  getOrCreateLongTermMemory();

  return getChatStmt.get(id);
};

const buildTaskExecutionAutoPrompt = (task: TaskContext): string =>
  `Продолжай задачу на этапе ${task.state} (шаг ${task.step}/${task.total}). Выполни следующее ожидаемое действие и верни обновлённый артефакт этого шага.`;

const resolveApprovePlanPayload = (params: {
  chatId: string;
  currentTask: TaskContext;
  plan?: string[];
  artifactText?: string;
}): { plan?: string[]; artifactText?: string } => {
  let resolvedPlan = params.plan;
  let resolvedArtifactText = params.artifactText;
  if (
    (resolvedPlan === undefined || resolvedPlan.length === 0) &&
    (!params.artifactText || !params.artifactText.trim()) &&
    params.currentTask.draftArtifactSourceMessageId &&
    params.currentTask.draftArtifactState === params.currentTask.state &&
    params.currentTask.draftArtifactStep === params.currentTask.step
  ) {
    const sourceMessage = getMessageByIdForChatStmt.get(
      params.currentTask.draftArtifactSourceMessageId,
      params.chatId
    ) as { content?: string } | undefined;
    if (typeof sourceMessage?.content === "string") {
      const parsedDraft = extractTaskArtifactEnvelope(sourceMessage.content, params.currentTask);
      if (parsedDraft.status === "valid" && parsedDraft.plan.length > 0) {
        resolvedPlan = parsedDraft.plan;
        resolvedArtifactText = params.currentTask.draftArtifactText || parsedDraft.artifactText;
      }
    }
  }
  return {
    plan: resolvedPlan,
    artifactText: resolvedArtifactText,
  };
};

type ResolvedStreamParams = {
  model: string;
  systemPrompt: string;
  reasoningEffort: ReasoningEffort | undefined;
  memoryModel: string;
};

const resolveStreamParams = (params: {
  model?: string;
  reasoningEffort?: string;
  memoryModel?: string;
  systemPrompt?: string;
  existingChat: ChatRowRecord;
}):
  | { ok: true; value: ResolvedStreamParams }
  | { ok: false; status: 400; error: string } => {
  const requestedModelRaw = params.model;
  const requestedModel = parseAllowedModel(requestedModelRaw);
  if (requestedModelRaw !== undefined && requestedModel === undefined) {
    return { ok: false, status: 400, error: MODEL_VALIDATION_ERROR };
  }

  const model = requestedModel ?? params.existingChat.model;
  if (!ALLOWED_MODELS.has(model)) {
    return { ok: false, status: 400, error: MODEL_VALIDATION_ERROR };
  }

  const requestedReasoningEffortRaw = params.reasoningEffort;
  const reasoningEffort = parseReasoningEffort(requestedReasoningEffortRaw);
  if (requestedReasoningEffortRaw !== undefined && reasoningEffort === undefined) {
    return {
      ok: false,
      status: 400,
      error: "reasoningEffort must be one of: none, minimal, low, medium, high, xhigh",
    };
  }

  const modelProfile = MODEL_API_PROFILES[model];
  if (reasoningEffort !== undefined && !modelProfile.reasoningEfforts.includes(reasoningEffort)) {
    return {
      ok: false,
      status: 400,
      error: `reasoningEffort for ${model} must be one of: ${modelProfile.reasoningEfforts.join(", ")}`,
    };
  }

  const memoryModelRaw = params.memoryModel;
  const parsedMemoryModel = parseAllowedModel(memoryModelRaw);
  if (memoryModelRaw !== undefined && parsedMemoryModel === undefined) {
    return { ok: false, status: 400, error: MODEL_VALIDATION_ERROR };
  }

  return {
    ok: true,
    value: {
      model,
      systemPrompt:
        typeof params.systemPrompt === "string" ? params.systemPrompt : params.existingChat.systemPrompt,
      reasoningEffort,
      memoryModel: parsedMemoryModel ?? EFFECTIVE_DEFAULT_MEMORY_MODEL,
    },
  };
};

type StreamExecutionMode =
  | {
      kind: "chat";
      userPrompt: string;
    }
  | {
      kind: "task_auto";
      userPrompt: string;
    };

type StreamPipelineParams = {
  chatId: string;
  existingChat: ChatRowRecord;
  request: Pick<FastifyRequest, "raw">;
  reply: FastifyReply;
  streamParams: ResolvedStreamParams;
  mode: StreamExecutionMode;
};

type StreamPipelineEarlyResult = {
  status: number;
  payload: Record<string, unknown>;
};

const runChatStreamPipeline = async (
  params: StreamPipelineParams
): Promise<StreamPipelineEarlyResult | null> => {
  const { chatId, existingChat, request, reply, streamParams, mode } = params;
  let taskState = getOrCreateTaskState(chatId, existingChat.title);
  if (taskState.paused) {
    return {
      status: 409,
      payload: {
        error: "task is paused",
        task: taskState,
      },
    };
  }

  if (!OPENAI_API_KEY) {
    return {
      status: 500,
      payload: { error: "OPENAI_API_KEY is not configured" },
    };
  }

  const userPrompt = mode.userPrompt.trim();
  if (!userPrompt) {
    return {
      status: 400,
      payload: { error: "userPrompt is required" },
    };
  }

  const abortController = new AbortController();
  request.raw.on("aborted", () => {
    abortController.abort();
  });
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  });
  reply.raw.on("error", () => {
    abortController.abort();
  });

  const startedAt = Date.now();
  const now = Date.now();

  updateChatStmt.run(
    existingChat.title,
    streamParams.model,
    streamParams.systemPrompt,
    existingChat.memoryStrategy,
    existingChat.slidingWindowSize,
    existingChat.stickyWindowSize,
    existingChat.branchFromChatId ?? null,
    existingChat.branchFromChatTitle ?? null,
    existingChat.branchCheckpointMessageCount ?? null,
    now,
    chatId
  );

  if (mode.kind === "chat") {
    const effectiveTitle =
      existingChat.title === "New chat" ? userPrompt.slice(0, 42).trim() || "New chat" : existingChat.title;
    if (effectiveTitle !== existingChat.title) {
      updateChatStmt.run(
        effectiveTitle,
        streamParams.model,
        streamParams.systemPrompt,
        existingChat.memoryStrategy,
        existingChat.slidingWindowSize,
        existingChat.stickyWindowSize,
        existingChat.branchFromChatId ?? null,
        existingChat.branchFromChatTitle ?? null,
        existingChat.branchCheckpointMessageCount ?? null,
        now,
        chatId
      );
    }

    const userMessageId = createId();
    insertMessageStmt.run(
      userMessageId,
      chatId,
      "user",
      userPrompt,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      null,
      now
    );
    updateChatUpdatedAtStmt.run(now, chatId);
  }

  const persistedMessagesRaw = listMessagesForMemoryStmt.all(chatId) as Array<{ role: Role; content: string }>;

  let shortTerm = getOrCreateShortMemory(chatId);
  let working = getOrCreateWorkingMemory(chatId);
  let longTerm = getOrCreateLongTermMemory();
  const memorySettings = getOrCreateMemorySettings();
  const shortTermEnabled = memorySettings.shortTermEnabled === 1;
  const workingEnabled = memorySettings.workingEnabled === 1;
  const longTermEnabled = memorySettings.longTermEnabled === 1;

  const shouldRunMemoryUpdater = mode.kind === "chat" && (shortTermEnabled || workingEnabled || longTermEnabled);
  let memoryUpdaterDiagnostics: { status: "ok" | "error"; message?: string } = { status: "ok" };

  if (shouldRunMemoryUpdater) {
    const fromIndex = Math.min(
      Math.max(shortTerm.lastProcessedMessageCount, 0),
      persistedMessagesRaw.length
    );
    const newMessagesForUpdater = persistedMessagesRaw.slice(fromIndex);
    try {
      const updaterOutput = await updateMemoryViaModel({
        memoryModel: streamParams.memoryModel,
        previousSummary: shortTermEnabled ? shortTerm.rollingSummary : "",
        working: {
          goal: workingEnabled ? working.goal : "",
          constraints: workingEnabled ? working.constraints : "",
          status: workingEnabled ? working.status : "",
          nextSteps: workingEnabled ? working.nextSteps : "",
        },
        longTerm: {
          profile: longTermEnabled ? longTerm.profile : "",
          preferences: longTermEnabled ? longTerm.preferences : "",
          decisions: longTermEnabled ? longTerm.decisions : "",
          knowledge: longTermEnabled ? longTerm.knowledge : "",
        },
        newMessages: newMessagesForUpdater,
        latestUserPrompt: userPrompt,
        shortTermEnabled,
        workingEnabled,
        longTermEnabled,
        signal: abortController.signal,
      });

      const memoryUpdatedAt = Date.now();
      if (shortTermEnabled) {
        shortTerm = persistShortMemory({
          ...shortTerm,
          rollingSummary: updaterOutput.shortTerm.rollingSummary,
          lastProcessedMessageCount: persistedMessagesRaw.length,
          updatedAt: memoryUpdatedAt,
        });
      }

      if (workingEnabled) {
        working = persistWorkingMemory(
          applyAutoWorkingUpdate(working, updaterOutput.working, memoryUpdatedAt)
        );
      }

      if (longTermEnabled) {
        insertPendingCandidates(chatId, updaterOutput.longTermCandidates, memoryUpdatedAt);
      }
    } catch (error) {
      const formatted = formatUpstreamError(error);
      memoryUpdaterDiagnostics = {
        status: "error",
        message: formatted.message,
      };
      app.log.warn(
        { err: error, chatId, memoryModel: streamParams.memoryModel },
        "failed to update memory layers, using previous snapshot"
      );
    }
  }

  if (!shortTermEnabled && shortTerm.lastProcessedMessageCount !== persistedMessagesRaw.length) {
    shortTerm = persistShortMemory({
      ...shortTerm,
      lastProcessedMessageCount: persistedMessagesRaw.length,
      updatedAt: Date.now(),
    });
  }

  const pendingCandidates = listPendingCandidatesByChatStmt.all(chatId) as LongTermCandidateRow[];
  const memorySnapshot = toSnapshot(shortTerm, working, longTerm, pendingCandidates);
  const memoryBlock = buildMemoryBlock({
    shortTerm: { rollingSummary: shortTerm.rollingSummary },
    working: {
      goal: working.goal,
      constraints: working.constraints,
      status: working.status,
      nextSteps: working.nextSteps,
    },
    longTerm: {
      profile: longTerm.profile,
      preferences: longTerm.preferences,
      decisions: longTerm.decisions,
      knowledge: longTerm.knowledge,
    },
    shortTermEnabled,
    workingEnabled,
    longTermEnabled,
  });
  const profileSettings = getOrCreateProfileSettings();
  const activeProfile = profileSettings.activeProfileId
    ? ((getProfileByIdStmt.get(profileSettings.activeProfileId) as UserProfileRow | undefined) ?? null)
    : null;
  const activeProfileId = activeProfile?.id ?? null;
  const profileBlock = buildProfileBlock(activeProfile);
  const taskBlock = buildTaskStateBlock(taskState);
  const stagePrompt = buildTaskStagePrompt(taskState.state);
  const draftDiagnostics = deriveDraftDiagnosticsFromTask(taskState);
  const invariantSettings = getOrCreateInvariantSettings();
  const invariants = listInvariantsStmt.all() as InvariantRow[];
  const invariantsEnabled = invariantSettings.enabled === 1;
  const injectInSystemPrompt = invariantSettings.injectInSystemPrompt === 1;
  const activeInvariants = invariantsEnabled ? invariants : [];
  const shouldCheckInvariants = activeInvariants.length > 0;
  const invariantBlock =
    injectInSystemPrompt && shouldCheckInvariants ? buildInvariantBlock(activeInvariants) : "";

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const sendSse = (event: string, data: unknown): void => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  sendSse("debug_memory", {
    snapshot: memorySnapshot,
    memoryBlock,
    profileBlock,
    task: taskState,
    taskBlock,
    stagePrompt,
    taskDraftStatus: draftDiagnostics.taskDraftStatus,
    taskDraftError: draftDiagnostics.taskDraftError,
    activeProfileId,
    shortTermEnabled,
    workingEnabled,
    longTermEnabled,
    invariantsEnabled,
    injectInSystemPrompt,
    invariantCount: activeInvariants.length,
    updater: memoryUpdaterDiagnostics,
  });

  try {
    const inputMessagesForModel: Array<{ role: Role; content: string }> =
      mode.kind === "chat"
        ? persistedMessagesRaw
        : [...persistedMessagesRaw, { role: "user", content: userPrompt }];
    const openaiRequestBody = buildOpenAiRequestBody({
      model: streamParams.model,
      systemPrompt: mergeSystemPromptWithContext({
        stagePrompt,
        systemPrompt: streamParams.systemPrompt,
        profileBlock,
        taskBlock,
        memoryBlock,
        invariantBlock,
      }),
      inputMessages: inputMessagesForModel,
      reasoningEffort: streamParams.reasoningEffort,
    });
    const modelProfile = MODEL_API_PROFILES[streamParams.model];

    sendSse("debug_request", {
      target: "openai.responses.create",
      modelProfile,
      body: openaiRequestBody,
    });

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: abortController.signal,
      body: JSON.stringify(openaiRequestBody),
    });

    if (!upstream.ok || !upstream.body) {
      const payloadText = await upstream.text();
      const payload = parseJsonSafe(payloadText) as { error?: unknown } | null;
      const fallbackMessage = `OpenAI error (${upstream.status}): ${payloadText}`;
      sendSse("error", buildOpenAiErrorPayload(payload?.error ?? payload, fallbackMessage, upstream.status));
      reply.raw.end();
      return null;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hasReceivedDelta = false;
    let assistantText = "";
    let finalDebugResponse: Record<string, unknown> | null = null;
    let finalUsage: UsageSummary | null = null;
    let finalModel = streamParams.model;
    let finalCost: CostBreakdownUsd | null = null;
    let lastUpstreamEventType: string | null = null;
    let lastUpstreamPayload: Record<string, unknown> | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const block of parts) {
        const lines = block.split("\n").map((line) => line.trim());
        let upstreamEvent = "";
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) {
            upstreamEvent = line.slice(6).trim();
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        if (dataLines.length === 0) {
          continue;
        }

        const data = dataLines.join("\n");
        if (data === "[DONE]") {
          continue;
        }

        let payload: any;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }

        const eventType = upstreamEvent || payload.type;
        lastUpstreamEventType = typeof eventType === "string" ? eventType : null;
        if (eventType !== "response.output_text.delta" && payload && typeof payload === "object") {
          lastUpstreamPayload = payload as Record<string, unknown>;
        }

        if (eventType === "response.output_text.delta" && typeof payload.delta === "string") {
          hasReceivedDelta = true;
          assistantText += payload.delta;
          if (!shouldCheckInvariants) {
            sendSse("delta", { text: payload.delta });
          }
          continue;
        }

        if (eventType === "response.error") {
          sendSse(
            "error",
            buildOpenAiErrorPayload(payload.error, payload.error?.message ?? "Unknown response error")
          );
          reply.raw.end();
          return null;
        }

        if (eventType === "response.completed") {
          const finalText = extractCompletedText(payload.response);
          finalModel = typeof payload.response?.model === "string" ? payload.response.model : streamParams.model;
          finalUsage = extractUsageSummary(payload.response?.usage);
          finalCost =
            estimateCostBreakdownUsd(finalModel, finalUsage) ??
            estimateCostBreakdownUsd(streamParams.model, finalUsage);

          if (!hasReceivedDelta && finalText) {
            assistantText = finalText;
            if (!shouldCheckInvariants) {
              sendSse("delta", { text: finalText });
            }
          }

          finalDebugResponse = extractFinalDebug(payload.response);
          sendSse("debug_response_final", {
            body: finalDebugResponse,
          });

          const finishedAt = Date.now();
          let invariantViolations: InvariantViolation[] = [];
          if (shouldCheckInvariants) {
            try {
              invariantViolations = await checkInvariantViolationsViaModel({
                model: finalModel,
                invariants: activeInvariants,
                assistantResponse: assistantText,
                signal: abortController.signal,
              });
            } catch (error) {
              const formatted = formatUpstreamError(error);
              app.log.warn(
                { err: error, chatId, model: finalModel },
                "failed to run invariant checker, response is blocked"
              );
              invariantViolations = [
                {
                  invariantId: "invariant_check_failed",
                  description: `Invariant checker failed: ${formatted.message}`,
                },
              ];
            }
          }

          if (shouldCheckInvariants && invariantViolations.length > 0) {
            const assistantMessageId = createId();
            const violationMessage = buildInvariantViolationMessage({
              violations: invariantViolations,
              rejectedResponse: assistantText,
              sourceModel: finalModel,
              createdAt: finishedAt,
            });
            insertMessageStmt.run(
              assistantMessageId,
              chatId,
              "assistant",
              violationMessage,
              JSON.stringify(openaiRequestBody),
              JSON.stringify({
                final: finalDebugResponse,
                invariantViolations,
              }),
              finishedAt - startedAt,
              finalUsage?.inputTokens ?? null,
              finalUsage?.outputTokens ?? null,
              finalUsage?.totalTokens ?? null,
              finalCost?.totalCostUsd ?? null,
              finalCost?.inputCostUsd ?? null,
              finalCost?.outputCostUsd ?? null,
              finishedAt
            );
            updateChatUpdatedAtStmt.run(finishedAt, chatId);

            taskState = persistTaskState(
              chatId,
              clearTaskDraftArtifact({
                ...taskState,
                updatedAt: finishedAt,
              })
            );

            sendSse("done", {
              reason: "invariant_violation",
              violations: invariantViolations,
              task: taskState,
              taskDraftStatus: "missing" as TaskArtifactDraftStatus,
              taskDraftError: "Assistant response violated invariants.",
              metrics: {
                model: finalModel,
                latencyMs: finishedAt - startedAt,
                usage: finalUsage,
                costUsd: finalCost?.totalCostUsd ?? null,
                inputCostUsd: finalCost?.inputCostUsd ?? null,
                outputCostUsd: finalCost?.outputCostUsd ?? null,
              },
            });
            reply.raw.end();
            return null;
          }

          if (shouldCheckInvariants && assistantText) {
            sendSse("delta", { text: assistantText });
          }

          const assistantMessageId = createId();
          insertMessageStmt.run(
            assistantMessageId,
            chatId,
            "assistant",
            assistantText,
            JSON.stringify(openaiRequestBody),
            JSON.stringify(finalDebugResponse),
            finishedAt - startedAt,
            finalUsage?.inputTokens ?? null,
            finalUsage?.outputTokens ?? null,
            finalUsage?.totalTokens ?? null,
            finalCost?.totalCostUsd ?? null,
            finalCost?.inputCostUsd ?? null,
            finalCost?.outputCostUsd ?? null,
            finishedAt
          );
          updateChatUpdatedAtStmt.run(finishedAt, chatId);
          const parsedDraft = extractTaskArtifactEnvelope(assistantText, taskState);
          let doneTaskDraftStatus: TaskArtifactDraftStatus = parsedDraft.status;
          let doneTaskDraftError: string | undefined = parsedDraft.error;

          if (parsedDraft.status === "valid") {
            taskState = persistTaskState(
              chatId,
              setTaskDraftArtifact(
                {
                  ...taskState,
                  updatedAt: finishedAt,
                },
                {
                  artifactText: parsedDraft.artifactText,
                  artifactState: parsedDraft.artifactState as TaskContext["state"],
                  artifactStep: parsedDraft.artifactStep,
                  artifactUpdatedAt: finishedAt,
                  sourceMessageId: assistantMessageId,
                }
              )
            );
            doneTaskDraftStatus = "valid";
            doneTaskDraftError = undefined;
          } else {
            taskState = persistTaskState(
              chatId,
              clearTaskDraftArtifact({
                ...taskState,
                updatedAt: finishedAt,
              })
            );
          }

          sendSse("done", {
            reason: payload.response?.status ?? "completed",
            task: taskState,
            taskDraftStatus: doneTaskDraftStatus,
            taskDraftError: doneTaskDraftError,
            metrics: {
              model: finalModel,
              latencyMs: finishedAt - startedAt,
              usage: finalUsage,
              costUsd: finalCost?.totalCostUsd ?? null,
              inputCostUsd: finalCost?.inputCostUsd ?? null,
              outputCostUsd: finalCost?.outputCostUsd ?? null,
            },
          });
          reply.raw.end();
          return null;
        }
      }
    }

    const fallbackInputTokens = null;
    const fallbackOutputTokens = null;
    const fallbackTotalTokens = null;
    const fallbackTotalCostUsd = null;
    const fallbackInputCostUsd = null;
    const fallbackOutputCostUsd = null;

    sendSse("error", {
      message: "OpenAI stream closed before response.completed",
      code: "upstream_stream_closed",
      type: "upstream_stream_closed",
      upstreamLastEventType: lastUpstreamEventType,
      upstreamLastPayload: lastUpstreamPayload,
      isContextOverflow: false,
    });

    if (assistantText && !shouldCheckInvariants) {
      const finishedAt = Date.now();
      insertMessageStmt.run(
        createId(),
        chatId,
        "assistant",
        assistantText,
        null,
        finalDebugResponse ? JSON.stringify(finalDebugResponse) : null,
        finishedAt - startedAt,
        fallbackInputTokens,
        fallbackOutputTokens,
        fallbackTotalTokens,
        fallbackTotalCostUsd,
        fallbackInputCostUsd,
        fallbackOutputCostUsd,
        finishedAt
      );
      updateChatUpdatedAtStmt.run(finishedAt, chatId);
    }

    sendSse("done", {
      reason: "stream_closed",
      diagnostics: {
        upstreamLastEventType: lastUpstreamEventType,
        upstreamLastPayload: lastUpstreamPayload,
      },
      metrics: {
        model: streamParams.model,
        latencyMs: Date.now() - startedAt,
        usage: finalUsage,
        costUsd: fallbackTotalCostUsd,
        inputCostUsd: fallbackInputCostUsd,
        outputCostUsd: fallbackOutputCostUsd,
      },
    });
    reply.raw.end();
  } catch (error) {
    if (abortController.signal.aborted) {
      sendSse("done", {
        reason: "aborted",
        metrics: {
          model: streamParams.model,
          latencyMs: Date.now() - startedAt,
          usage: null,
          costUsd: null,
          inputCostUsd: null,
          outputCostUsd: null,
        },
      });
      reply.raw.end();
      return null;
    }

    const formattedError = formatUpstreamError(error);
    app.log.error({ err: error, ...formattedError }, "OpenAI upstream request failed");
    sendSse("error", formattedError);
    reply.raw.end();
  }

  return null;
};

app.get("/health", async () => ({ ok: true }));

app.get("/api/profiles", async () => {
  const profiles = listProfilesStmt.all() as UserProfileRow[];
  const settings = getOrCreateProfileSettings();
  return {
    profiles,
    activeProfileId: settings.activeProfileId,
  };
});

app.post<{ Body: CreateProfileBody }>("/api/profiles", async (request, reply) => {
  const name = parseProfileName(request.body?.name);
  if (!name) {
    reply.code(400);
    return { error: `name is required and must be 1-${PROFILE_NAME_MAX_LENGTH} characters` };
  }

  const now = Date.now();
  const profileId = createId();
  insertProfileStmt.run(profileId, name, "", "", "", "", now, now);

  const profile = getProfileByIdStmt.get(profileId) as UserProfileRow | undefined;
  if (!profile) {
    reply.code(500);
    return { error: "failed to create profile" };
  }

  const settings = getOrCreateProfileSettings();
  const activeProfileId = settings.activeProfileId ?? profileId;
  if (activeProfileId !== settings.activeProfileId) {
    persistProfileSettings(activeProfileId, now);
  }

  return {
    profile,
    activeProfileId,
  };
});

app.patch<{ Params: { id: string }; Body: PatchProfileBody }>(
  "/api/profiles/:id",
  async (request, reply) => {
    const profileId = request.params.id;
    const existing = getProfileByIdStmt.get(profileId) as UserProfileRow | undefined;
    if (!existing) {
      reply.code(404);
      return { error: "profile not found" };
    }

    const next: UserProfileRow = {
      ...existing,
      updatedAt: Date.now(),
    };
    let hasChanges = false;

    if (request.body?.name !== undefined) {
      const name = parseProfileName(request.body.name);
      if (!name) {
        reply.code(400);
        return { error: `name must be 1-${PROFILE_NAME_MAX_LENGTH} characters` };
      }
      next.name = name;
      hasChanges = true;
    }
    if (request.body?.style !== undefined) {
      next.style = normalizeProfileField(request.body.style);
      hasChanges = true;
    }
    if (request.body?.outputFormat !== undefined) {
      next.outputFormat = normalizeProfileField(request.body.outputFormat);
      hasChanges = true;
    }
    if (request.body?.constraints !== undefined) {
      next.constraints = normalizeProfileField(request.body.constraints);
      hasChanges = true;
    }
    if (request.body?.notes !== undefined) {
      next.notes = normalizeProfileField(request.body.notes);
      hasChanges = true;
    }

    if (!hasChanges) {
      reply.code(400);
      return { error: "At least one profile field is required" };
    }

    updateProfileStmt.run(
      next.name,
      next.style,
      next.outputFormat,
      next.constraints,
      next.notes,
      next.updatedAt,
      profileId
    );

    const updated = getProfileByIdStmt.get(profileId) as UserProfileRow | undefined;
    if (!updated) {
      reply.code(500);
      return { error: "failed to update profile" };
    }
    return { profile: updated };
  }
);

app.delete<{ Params: { id: string } }>("/api/profiles/:id", async (request, reply) => {
  const profileId = request.params.id;
  const existing = getProfileByIdStmt.get(profileId) as UserProfileRow | undefined;
  if (!existing) {
    reply.code(404);
    return { error: "profile not found" };
  }

  deleteProfileStmt.run(profileId);

  const settings = getOrCreateProfileSettings();
  let activeProfileId = settings.activeProfileId;
  if (settings.activeProfileId === profileId) {
    activeProfileId = null;
    persistProfileSettings(null, Date.now());
  }

  return {
    ok: true,
    activeProfileId,
  };
});

app.put<{ Body: SetActiveProfileBody }>("/api/profiles/active", async (request, reply) => {
  const profileId = request.body?.profileId;
  if (profileId === undefined) {
    reply.code(400);
    return { error: "profileId is required" };
  }

  let nextActiveProfileId: string | null = null;
  if (profileId === null) {
    nextActiveProfileId = null;
  } else if (typeof profileId === "string" && profileId.trim()) {
    const normalizedId = profileId.trim();
    const profile = getProfileByIdStmt.get(normalizedId) as UserProfileRow | undefined;
    if (!profile) {
      reply.code(404);
      return { error: "profile not found" };
    }
    nextActiveProfileId = normalizedId;
  } else {
    reply.code(400);
    return { error: "profileId must be a string or null" };
  }

  persistProfileSettings(nextActiveProfileId, Date.now());
  return {
    activeProfileId: nextActiveProfileId,
  };
});

app.get("/api/memory/settings", async () => {
  const settings = getOrCreateMemorySettings();
  return {
    shortTermEnabled: settings.shortTermEnabled === 1,
    workingEnabled: settings.workingEnabled === 1,
    longTermEnabled: settings.longTermEnabled === 1,
    updatedAt: settings.updatedAt,
  };
});

app.patch<{ Body: MemorySettingsPatchBody }>("/api/memory/settings", async (request, reply) => {
  const body = request.body ?? {};
  const hasShortTerm = body.shortTermEnabled !== undefined;
  const hasWorking = body.workingEnabled !== undefined;
  const hasLongTerm = body.longTermEnabled !== undefined;
  if (!hasShortTerm && !hasWorking && !hasLongTerm) {
    reply.code(400);
    return { error: "At least one memory setting field is required" };
  }
  if (hasShortTerm && typeof body.shortTermEnabled !== "boolean") {
    reply.code(400);
    return { error: "shortTermEnabled must be boolean" };
  }
  if (hasWorking && typeof body.workingEnabled !== "boolean") {
    reply.code(400);
    return { error: "workingEnabled must be boolean" };
  }
  if (hasLongTerm && typeof body.longTermEnabled !== "boolean") {
    reply.code(400);
    return { error: "longTermEnabled must be boolean" };
  }

  const current = getOrCreateMemorySettings();
  const next = persistMemorySettings(
    {
      shortTermEnabled: hasShortTerm ? (body.shortTermEnabled as boolean) : current.shortTermEnabled === 1,
      workingEnabled: hasWorking ? (body.workingEnabled as boolean) : current.workingEnabled === 1,
      longTermEnabled: hasLongTerm ? (body.longTermEnabled as boolean) : current.longTermEnabled === 1,
    },
    Date.now()
  );
  return {
    shortTermEnabled: next.shortTermEnabled === 1,
    workingEnabled: next.workingEnabled === 1,
    longTermEnabled: next.longTermEnabled === 1,
    updatedAt: next.updatedAt,
  };
});

app.get("/api/invariants", async () => {
  const settings = getOrCreateInvariantSettings();
  const invariants = listInvariantsStmt.all() as InvariantRow[];
  return {
    enabled: settings.enabled === 1,
    injectInSystemPrompt: settings.injectInSystemPrompt === 1,
    updatedAt: settings.updatedAt,
    invariants,
  };
});

app.patch<{ Body: InvariantSettingsPatchBody }>("/api/invariants/settings", async (request, reply) => {
  const body = request.body ?? {};
  const hasEnabled = body.enabled !== undefined;
  const hasInjectInSystemPrompt = body.injectInSystemPrompt !== undefined;
  if (!hasEnabled && !hasInjectInSystemPrompt) {
    reply.code(400);
    return { error: "At least one invariant setting field is required" };
  }
  if (hasEnabled && typeof body.enabled !== "boolean") {
    reply.code(400);
    return { error: "enabled must be boolean" };
  }
  if (hasInjectInSystemPrompt && typeof body.injectInSystemPrompt !== "boolean") {
    reply.code(400);
    return { error: "injectInSystemPrompt must be boolean" };
  }

  const current = getOrCreateInvariantSettings();
  const next = persistInvariantSettings(
    {
      enabled: hasEnabled ? (body.enabled as boolean) : current.enabled === 1,
      injectInSystemPrompt: hasInjectInSystemPrompt
        ? (body.injectInSystemPrompt as boolean)
        : current.injectInSystemPrompt === 1,
    },
    Date.now()
  );

  return {
    enabled: next.enabled === 1,
    injectInSystemPrompt: next.injectInSystemPrompt === 1,
    updatedAt: next.updatedAt,
  };
});

app.post<{ Body: CreateInvariantBody }>("/api/invariants", async (request, reply) => {
  const name = parseInvariantName(request.body?.name);
  const ruleText = normalizeInvariantRule(request.body?.ruleText);
  if (!name) {
    reply.code(400);
    return { error: `name is required and must be 1-${INVARIANT_NAME_MAX_LENGTH} characters` };
  }
  if (!ruleText) {
    reply.code(400);
    return { error: `ruleText is required and must be 1-${INVARIANT_RULE_MAX_LENGTH} characters` };
  }

  const now = Date.now();
  const invariantId = createId();
  const row = getMaxInvariantSortOrderStmt.get() as { maxSortOrder?: number } | undefined;
  const nextSortOrder = Number.isFinite(row?.maxSortOrder) ? Number(row?.maxSortOrder) + 1 : 1;
  insertInvariantStmt.run(invariantId, name, ruleText, nextSortOrder, now, now);

  const invariant = getInvariantByIdStmt.get(invariantId) as InvariantRow | undefined;
  if (!invariant) {
    reply.code(500);
    return { error: "failed to create invariant" };
  }
  return { invariant };
});

app.patch<{ Params: { id: string }; Body: PatchInvariantBody }>(
  "/api/invariants/:id",
  async (request, reply) => {
    const invariantId = request.params.id;
    const existing = getInvariantByIdStmt.get(invariantId) as InvariantRow | undefined;
    if (!existing) {
      reply.code(404);
      return { error: "invariant not found" };
    }

    const next: InvariantRow = {
      ...existing,
      updatedAt: Date.now(),
    };
    let hasChanges = false;

    if (request.body?.name !== undefined) {
      const name = parseInvariantName(request.body.name);
      if (!name) {
        reply.code(400);
        return { error: `name must be 1-${INVARIANT_NAME_MAX_LENGTH} characters` };
      }
      next.name = name;
      hasChanges = true;
    }

    if (request.body?.ruleText !== undefined) {
      const ruleText = normalizeInvariantRule(request.body.ruleText);
      if (!ruleText) {
        reply.code(400);
        return { error: `ruleText must be 1-${INVARIANT_RULE_MAX_LENGTH} characters` };
      }
      next.ruleText = ruleText;
      hasChanges = true;
    }

    if (!hasChanges) {
      reply.code(400);
      return { error: "At least one invariant field is required" };
    }

    updateInvariantStmt.run(next.name, next.ruleText, next.updatedAt, invariantId);
    const updated = getInvariantByIdStmt.get(invariantId) as InvariantRow | undefined;
    if (!updated) {
      reply.code(500);
      return { error: "failed to update invariant" };
    }
    return { invariant: updated };
  }
);

app.delete<{ Params: { id: string } }>("/api/invariants/:id", async (request, reply) => {
  const invariantId = request.params.id;
  const existing = getInvariantByIdStmt.get(invariantId) as InvariantRow | undefined;
  if (!existing) {
    reply.code(404);
    return { error: "invariant not found" };
  }

  deleteInvariantStmt.run(invariantId);
  return { ok: true };
});

app.get("/api/chats", async () => {
  const chats = listChatsStmt.all();
  return { chats };
});

app.post<{ Body: CreateChatBody }>("/api/chats", async (request, reply) => {
  const requestedModelRaw = request.body?.model;
  const requestedModel = parseAllowedModel(requestedModelRaw);
  if (requestedModelRaw !== undefined && requestedModel === undefined) {
    reply.code(400);
    return { error: MODEL_VALIDATION_ERROR };
  }

  const chat = createChat({
    ...request.body,
    model: requestedModel,
  });
  return { chat };
});

app.get<{ Params: { id: string } }>("/api/chats/:id/messages", async (request, reply) => {
  const chatId = request.params.id;
  const chat = getChatStmt.get(chatId);
  if (!chat) {
    reply.code(404);
    return { error: "chat not found" };
  }
  const messages = listMessagesStmt.all(chatId);
  return { messages };
});

app.get<{ Params: { id: string } }>("/api/chats/:id/memory", async (request, reply) => {
  const chatId = request.params.id;
  const chat = getChatStmt.get(chatId);
  if (!chat) {
    reply.code(404);
    return { error: "chat not found" };
  }

  const snapshot = getMemorySnapshotForChat(chatId);
  return snapshot;
});

app.get<{ Params: { id: string } }>("/api/chats/:id/task-state", async (request, reply) => {
  const chatId = request.params.id;
  const chat = getChatStmt.get(chatId) as { title: string } | undefined;
  if (!chat) {
    reply.code(404);
    return { error: "chat not found" };
  }

  const task = getOrCreateTaskState(chatId, chat.title);
  return { task };
});

app.post<{ Params: { id: string }; Body: TaskCommandBody }>(
  "/api/chats/:id/task-state/command",
  async (request, reply) => {
    const chatId = request.params.id;
    const chat = getChatStmt.get(chatId) as { title: string } | undefined;
    if (!chat) {
      reply.code(404);
      return { error: "chat not found" };
    }

    const body = request.body ?? {};
    if (!isTaskCommand(body.command)) {
      reply.code(400);
      return { error: "command is required and must be a valid task command" };
    }
    if (body.artifactText !== undefined && typeof body.artifactText !== "string") {
      reply.code(400);
      return { error: "artifactText must be a string" };
    }
    if (
      body.plan !== undefined &&
      (!Array.isArray(body.plan) || body.plan.some((item) => typeof item !== "string"))
    ) {
      reply.code(400);
      return { error: "plan must be an array of strings" };
    }
    if (body.reason !== undefined && typeof body.reason !== "string") {
      reply.code(400);
      return { error: "reason must be a string" };
    }

    const currentTask = getOrCreateTaskState(chatId, chat.title);
    let resolvedPlan = body.plan;
    let resolvedArtifactText = body.artifactText;
    if (body.command === "approve_plan") {
      const resolved = resolveApprovePlanPayload({
        chatId,
        currentTask,
        plan: body.plan,
        artifactText: body.artifactText,
      });
      resolvedPlan = resolved.plan;
      resolvedArtifactText = resolved.artifactText;
    }

    const result = applyTaskCommand(
      currentTask,
      {
        command: body.command,
        artifactText: resolvedArtifactText,
        plan: resolvedPlan,
        reason: body.reason,
      },
      Date.now()
    );

    if (!result.ok) {
      reply.code(result.status);
      return { error: result.error, task: currentTask };
    }

    const task = persistTaskState(chatId, result.task);
    return { task };
  }
);

app.patch<{ Params: { id: string }; Body: PatchChatBody }>("/api/chats/:id", async (request, reply) => {
  const chatId = request.params.id;
  const chat = getChatStmt.get(chatId) as
    | {
        id: string;
        title: string;
        model: string;
        systemPrompt: string;
        memoryStrategy: string;
        slidingWindowSize: number;
        stickyWindowSize: number;
        branchFromChatId: string | null;
        branchFromChatTitle: string | null;
        branchCheckpointMessageCount: number | null;
      }
    | undefined;

  if (!chat) {
    reply.code(404);
    return { error: "chat not found" };
  }

  const title = typeof request.body?.title === "string" ? request.body.title.trim() : chat.title;
  const requestedModelRaw = request.body?.model;
  const requestedModel = parseAllowedModel(requestedModelRaw);
  if (requestedModelRaw !== undefined && requestedModel === undefined) {
    reply.code(400);
    return { error: MODEL_VALIDATION_ERROR };
  }

  const model = requestedModel ?? chat.model;
  const systemPrompt =
    typeof request.body?.systemPrompt === "string" ? request.body.systemPrompt : chat.systemPrompt;

  updateChatStmt.run(
    title || "New chat",
    model,
    systemPrompt,
    chat.memoryStrategy,
    chat.slidingWindowSize,
    chat.stickyWindowSize,
    chat.branchFromChatId ?? null,
    chat.branchFromChatTitle ?? null,
    chat.branchCheckpointMessageCount ?? null,
    Date.now(),
    chatId
  );

  return { chat: getChatStmt.get(chatId) };
});

app.patch<{ Params: { id: string }; Body: WorkingMemoryPatchBody }>(
  "/api/chats/:id/memory/working",
  async (request, reply) => {
    const chatId = request.params.id;
    const chat = getChatStmt.get(chatId);
    if (!chat) {
      reply.code(404);
      return { error: "chat not found" };
    }
    const memorySettings = getOrCreateMemorySettings();
    if (memorySettings.workingEnabled !== 1) {
      reply.code(409);
      return { error: "working memory is disabled" };
    }

    const existing = getOrCreateWorkingMemory(chatId);
    const now = Date.now();
    let hasChanges = false;

    const next: WorkingMemoryRow = {
      ...existing,
      updatedBy: "manual",
      updatedAt: now,
    };

    if (request.body?.goal !== undefined) {
      next.goal = normalizeWorkingField(request.body.goal);
      next.manualLockGoal = 1;
      hasChanges = true;
    }
    if (request.body?.constraints !== undefined) {
      next.constraints = normalizeWorkingField(request.body.constraints);
      next.manualLockConstraints = 1;
      hasChanges = true;
    }
    if (request.body?.status !== undefined) {
      next.status = normalizeWorkingField(request.body.status);
      next.manualLockStatus = 1;
      hasChanges = true;
    }
    if (request.body?.nextSteps !== undefined) {
      next.nextSteps = normalizeWorkingField(request.body.nextSteps);
      next.manualLockNextSteps = 1;
      hasChanges = true;
    }

    if (!hasChanges) {
      reply.code(400);
      return { error: "At least one working memory field is required" };
    }

    persistWorkingMemory(next);
    const snapshot = getMemorySnapshotForChat(chatId);
    return { working: snapshot.working };
  }
);

app.patch<{ Body: LongTermMemoryPatchBody }>("/api/memory/long-term", async (request, reply) => {
  const existing = getOrCreateLongTermMemory();
  const now = Date.now();
  let hasChanges = false;

  const next: LongTermMemoryRow = {
    ...existing,
    updatedBy: "manual",
    updatedAt: now,
  };

  if (request.body?.profile !== undefined) {
    next.profile = normalizeLongTermField(request.body.profile);
    next.manualLockProfile = 1;
    hasChanges = true;
  }
  if (request.body?.preferences !== undefined) {
    next.preferences = normalizeLongTermField(request.body.preferences);
    next.manualLockPreferences = 1;
    hasChanges = true;
  }
  if (request.body?.decisions !== undefined) {
    next.decisions = normalizeLongTermField(request.body.decisions);
    next.manualLockDecisions = 1;
    hasChanges = true;
  }
  if (request.body?.knowledge !== undefined) {
    next.knowledge = normalizeLongTermField(request.body.knowledge);
    next.manualLockKnowledge = 1;
    hasChanges = true;
  }

  if (!hasChanges) {
    reply.code(400);
    return { error: "At least one long-term field is required" };
  }

  persistLongTermMemory(next);
  return {
    longTerm: {
      profile: next.profile,
      preferences: next.preferences,
      decisions: next.decisions,
      knowledge: next.knowledge,
      updatedBy: next.updatedBy,
      updatedAt: next.updatedAt,
    },
  };
});

app.post<{ Params: { id: string } }>("/api/memory/candidates/:id/approve", async (request, reply) => {
  const candidateId = request.params.id;
  const candidate = getCandidateByIdStmt.get(candidateId) as LongTermCandidateRow | undefined;
  if (!candidate) {
    reply.code(404);
    return { error: "candidate not found" };
  }
  if (candidate.status !== "pending") {
    reply.code(400);
    return { error: "candidate is already resolved" };
  }

  const longTerm = getOrCreateLongTermMemory();
  const now = Date.now();
  const next: LongTermMemoryRow = {
    ...longTerm,
    updatedBy: "manual",
    updatedAt: now,
  };

  if (candidate.targetField === "profile") {
    next.profile = mergeLongTermFieldValue(longTerm.profile, candidate.value);
  }
  if (candidate.targetField === "preferences") {
    next.preferences = mergeLongTermFieldValue(longTerm.preferences, candidate.value);
  }
  if (candidate.targetField === "decisions") {
    next.decisions = mergeLongTermFieldValue(longTerm.decisions, candidate.value);
  }
  if (candidate.targetField === "knowledge") {
    next.knowledge = mergeLongTermFieldValue(longTerm.knowledge, candidate.value);
  }

  persistLongTermMemory(next);
  resolveCandidateStmt.run("approved", now, candidateId);

  const snapshot = getMemorySnapshotForChat(candidate.chatId);
  return {
    ok: true,
    longTerm: snapshot.longTerm,
    pendingCandidates: snapshot.pendingCandidates,
  };
});

app.post<{ Params: { id: string } }>("/api/memory/candidates/:id/reject", async (request, reply) => {
  const candidateId = request.params.id;
  const candidate = getCandidateByIdStmt.get(candidateId) as LongTermCandidateRow | undefined;
  if (!candidate) {
    reply.code(404);
    return { error: "candidate not found" };
  }
  if (candidate.status !== "pending") {
    reply.code(400);
    return { error: "candidate is already resolved" };
  }

  const now = Date.now();
  resolveCandidateStmt.run("rejected", now, candidateId);
  const snapshot = getMemorySnapshotForChat(candidate.chatId);
  return {
    ok: true,
    pendingCandidates: snapshot.pendingCandidates,
  };
});

app.delete<{ Params: { id: string } }>("/api/chats/:id", async (request, reply) => {
  const chatId = request.params.id;
  const chat = getChatStmt.get(chatId);
  if (!chat) {
    reply.code(404);
    return { error: "chat not found" };
  }
  deleteChatStmt.run(chatId);
  return { ok: true };
});

app.post<{ Params: { id: string } }>("/api/chats/:id/branch", async (request, reply) => {
  const sourceChatId = request.params.id;
  const sourceChat = getChatStmt.get(sourceChatId) as
    | {
        id: string;
        title: string;
        model: string;
        systemPrompt: string;
      }
    | undefined;

  if (!sourceChat) {
    reply.code(404);
    return { error: "chat not found" };
  }

  const sourceMessages = listMessagesForBranchStmt.all(sourceChatId) as Array<{
    role: Role;
    content: string;
    requestJson: string | null;
    responseJson: string | null;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
    costUsd: number | null;
    inputCostUsd: number | null;
    outputCostUsd: number | null;
  }>;

  const sourceShort = getOrCreateShortMemory(sourceChatId);
  const sourceWorking = getOrCreateWorkingMemory(sourceChatId);
  const sourceTask = getOrCreateTaskState(sourceChatId, sourceChat.title);
  const baseTimestamp = Date.now();
  let createdChatId = "";

  try {
    db.exec("BEGIN");

    const created = createChat({
      title: buildBranchChatTitle(sourceChat.title),
      model: sourceChat.model,
      systemPrompt: sourceChat.systemPrompt,
      branchFromChatId: sourceChat.id,
      branchFromChatTitle: sourceChat.title,
      branchCheckpointMessageCount: sourceMessages.length,
    }) as { id: string } | undefined;

    if (!created?.id) {
      throw new Error("failed to create branch chat");
    }

    createdChatId = created.id;

    sourceMessages.forEach((message, index) => {
      insertMessageStmt.run(
        createId(),
        createdChatId,
        message.role,
        message.content,
        message.requestJson,
        message.responseJson,
        message.latencyMs,
        message.inputTokens,
        message.outputTokens,
        message.totalTokens,
        message.costUsd,
        message.inputCostUsd,
        message.outputCostUsd,
        baseTimestamp + index
      );
    });

    persistShortMemory({
      ...sourceShort,
      chatId: createdChatId,
      updatedAt: baseTimestamp + sourceMessages.length,
    });
    persistWorkingMemory({
      ...sourceWorking,
      chatId: createdChatId,
      updatedAt: baseTimestamp + sourceMessages.length,
    });
    persistTaskState(createdChatId, {
      ...sourceTask,
      updatedAt: baseTimestamp + sourceMessages.length,
    });

    updateChatUpdatedAtStmt.run(baseTimestamp + sourceMessages.length, createdChatId);
    db.exec("COMMIT");
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch (rollbackError) {
      app.log.error({ err: rollbackError, sourceChatId }, "failed to rollback branch chat transaction");
    }
    app.log.error({ err: error, sourceChatId }, "failed to create branch chat");
    reply.code(500);
    return { error: "failed to create branch chat" };
  }

  return { chat: getChatStmt.get(createdChatId) };
});

app.post<{ Params: { id: string }; Body: ApprovePlanStreamBody }>(
  "/api/chats/:id/task-state/approve-plan/stream",
  async (request, reply) => {
    const chatId = request.params.id;
    const existingChat = getChatStmt.get(chatId) as ChatRowRecord | undefined;
    if (!existingChat) {
      reply.code(404);
      return { error: "chat not found" };
    }

    const body = request.body ?? {};
    if (body.artifactText !== undefined && typeof body.artifactText !== "string") {
      reply.code(400);
      return { error: "artifactText must be a string" };
    }
    if (
      body.plan !== undefined &&
      (!Array.isArray(body.plan) || body.plan.some((item) => typeof item !== "string"))
    ) {
      reply.code(400);
      return { error: "plan must be an array of strings" };
    }

    const streamParamsResult = resolveStreamParams({
      model: body.model,
      reasoningEffort: body.reasoningEffort,
      memoryModel: body.memoryModel,
      systemPrompt: body.systemPrompt,
      existingChat,
    });
    if (!streamParamsResult.ok) {
      reply.code(streamParamsResult.status);
      return { error: streamParamsResult.error };
    }
    if (!OPENAI_API_KEY) {
      reply.code(500);
      return { error: "OPENAI_API_KEY is not configured" };
    }

    const currentTask = getOrCreateTaskState(chatId, existingChat.title);
    const approveInputs = resolveApprovePlanPayload({
      chatId,
      currentTask,
      plan: body.plan,
      artifactText: body.artifactText,
    });
    const approveResult = applyTaskCommand(
      currentTask,
      {
        command: "approve_plan",
        artifactText: approveInputs.artifactText,
        plan: approveInputs.plan,
      },
      Date.now()
    );

    if (!approveResult.ok) {
      reply.code(approveResult.status);
      return { error: approveResult.error, task: currentTask };
    }

    const approvedTask = persistTaskState(chatId, approveResult.task);
    const autoPrompt = buildTaskExecutionAutoPrompt(approvedTask);
    const streamStart = await runChatStreamPipeline({
      chatId,
      existingChat,
      request,
      reply,
      streamParams: streamParamsResult.value,
      mode: {
        kind: "task_auto",
        userPrompt: autoPrompt,
      },
    });
    if (streamStart) {
      reply.code(streamStart.status);
      return streamStart.payload;
    }
    return;
  }
);

app.post<{ Params: { id: string }; Body: ChatBody }>("/api/chats/:id/stream", async (request, reply) => {
  const chatId = request.params.id;
  const existingChat = getChatStmt.get(chatId) as ChatRowRecord | undefined;
  if (!existingChat) {
    reply.code(404);
    return { error: "chat not found" };
  }

  const userPrompt = typeof request.body?.userPrompt === "string" ? request.body.userPrompt.trim() : "";
  if (!userPrompt) {
    reply.code(400);
    return { error: "userPrompt is required" };
  }

  const streamParamsResult = resolveStreamParams({
    model: request.body?.model,
    reasoningEffort: request.body?.reasoningEffort,
    memoryModel: request.body?.memoryModel,
    systemPrompt: request.body?.systemPrompt,
    existingChat,
  });
  if (!streamParamsResult.ok) {
    reply.code(streamParamsResult.status);
    return { error: streamParamsResult.error };
  }

  const streamStart = await runChatStreamPipeline({
    chatId,
    existingChat,
    request,
    reply,
    streamParams: streamParamsResult.value,
    mode: {
      kind: "chat",
      userPrompt,
    },
  });
  if (streamStart) {
    reply.code(streamStart.status);
    return streamStart.payload;
  }
  return;
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
