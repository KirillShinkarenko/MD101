import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

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
const SHORT_TERM_MAX_LENGTH = 1800;
const WORKING_FIELD_MAX_LENGTH = 320;
const LONG_TERM_FIELD_MAX_LENGTH = 600;
const CANDIDATE_VALUE_MAX_LENGTH = 320;
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

CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at ON messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_long_term_candidates_chat_status_created_at
  ON long_term_candidates (chat_id, status, created_at);
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
}): Record<string, unknown> => {
  const { memoryModel, previousSummary, working, longTerm, newMessages, latestUserPrompt } = params;
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
      "1) shortTerm.rollingSummary: обнови накопительное саммари диалога (прошлое саммари + новые сообщения).",
      "2) working: только текущее состояние задачи (goal, constraints, status, nextSteps).",
      "3) longTermCandidates: только потенциально долговременные факты. Не переноси ничего напрямую в long-term.",
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
}): string => {
  const { shortTerm, working, longTerm } = params;
  return [
    "MEMORY_LAYERS",
    "SHORT_TERM:",
    `- rolling_summary: ${shortTerm.rollingSummary || "(empty)"}`,
    "WORKING_MEMORY:",
    `- goal: ${working.goal || "(empty)"}`,
    `- constraints: ${working.constraints || "(empty)"}`,
    `- status: ${working.status || "(empty)"}`,
    `- next_steps: ${working.nextSteps || "(empty)"}`,
    "LONG_TERM_MEMORY:",
    `- profile: ${longTerm.profile || "(empty)"}`,
    `- preferences: ${longTerm.preferences || "(empty)"}`,
    `- decisions: ${longTerm.decisions || "(empty)"}`,
    `- knowledge: ${longTerm.knowledge || "(empty)"}`,
  ].join("\n");
};

const mergeSystemPromptWithMemory = (systemPrompt: string, memoryBlock: string): string => {
  const normalizedPrompt = systemPrompt.trim();
  if (!normalizedPrompt) {
    return memoryBlock;
  }
  return `${normalizedPrompt}\n\n${memoryBlock}`;
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

app.get("/health", async () => ({ ok: true }));

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

app.post<{ Params: { id: string }; Body: ChatBody }>("/api/chats/:id/stream", async (request, reply) => {
  if (!OPENAI_API_KEY) {
    reply.code(500);
    return { error: "OPENAI_API_KEY is not configured" };
  }

  const chatId = request.params.id;
  const existingChat = getChatStmt.get(chatId) as
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

  if (!existingChat) {
    reply.code(404);
    return { error: "chat not found" };
  }

  const userPrompt = request.body?.userPrompt?.trim() ?? "";
  const requestedModelRaw = request.body?.model;
  const requestedModel = parseAllowedModel(requestedModelRaw);
  if (requestedModelRaw !== undefined && requestedModel === undefined) {
    reply.code(400);
    return { error: MODEL_VALIDATION_ERROR };
  }

  const model = requestedModel ?? existingChat.model;
  if (!ALLOWED_MODELS.has(model)) {
    reply.code(400);
    return { error: MODEL_VALIDATION_ERROR };
  }

  const requestedReasoningEffortRaw = request.body?.reasoningEffort;
  const reasoningEffort = parseReasoningEffort(requestedReasoningEffortRaw);
  if (requestedReasoningEffortRaw !== undefined && reasoningEffort === undefined) {
    reply.code(400);
    return { error: "reasoningEffort must be one of: none, minimal, low, medium, high, xhigh" };
  }

  const modelProfile = MODEL_API_PROFILES[model];
  if (reasoningEffort !== undefined && !modelProfile.reasoningEfforts.includes(reasoningEffort)) {
    reply.code(400);
    return {
      error: `reasoningEffort for ${model} must be one of: ${modelProfile.reasoningEfforts.join(", ")}`,
    };
  }

  const memoryModelRaw = request.body?.memoryModel;
  const memoryModel = parseAllowedModel(memoryModelRaw) ?? EFFECTIVE_DEFAULT_MEMORY_MODEL;
  if (memoryModelRaw !== undefined && parseAllowedModel(memoryModelRaw) === undefined) {
    reply.code(400);
    return { error: MODEL_VALIDATION_ERROR };
  }

  const systemPrompt =
    typeof request.body?.systemPrompt === "string" ? request.body.systemPrompt : existingChat.systemPrompt;

  if (!userPrompt) {
    reply.code(400);
    return { error: "userPrompt is required" };
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
    model,
    systemPrompt,
    existingChat.memoryStrategy,
    existingChat.slidingWindowSize,
    existingChat.stickyWindowSize,
    existingChat.branchFromChatId ?? null,
    existingChat.branchFromChatTitle ?? null,
    existingChat.branchCheckpointMessageCount ?? null,
    now,
    chatId
  );

  const effectiveTitle = existingChat.title === "New chat" ? userPrompt.slice(0, 42).trim() || "New chat" : existingChat.title;
  if (effectiveTitle !== existingChat.title) {
    updateChatStmt.run(
      effectiveTitle,
      model,
      systemPrompt,
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

  const persistedMessagesRaw = listMessagesForMemoryStmt.all(chatId) as Array<{ role: Role; content: string }>;

  let shortTerm = getOrCreateShortMemory(chatId);
  let working = getOrCreateWorkingMemory(chatId);
  let longTerm = getOrCreateLongTermMemory();

  const fromIndex = Math.min(
    Math.max(shortTerm.lastProcessedMessageCount, 0),
    persistedMessagesRaw.length
  );
  const newMessagesForUpdater = persistedMessagesRaw.slice(fromIndex);

  let memoryUpdaterDiagnostics: { status: "ok" | "error"; message?: string } = { status: "ok" };

  try {
    const updaterOutput = await updateMemoryViaModel({
      memoryModel,
      previousSummary: shortTerm.rollingSummary,
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
      newMessages: newMessagesForUpdater,
      latestUserPrompt: userPrompt,
      signal: abortController.signal,
    });

    const memoryUpdatedAt = Date.now();
    shortTerm = persistShortMemory({
      ...shortTerm,
      rollingSummary: updaterOutput.shortTerm.rollingSummary,
      lastProcessedMessageCount: persistedMessagesRaw.length,
      updatedAt: memoryUpdatedAt,
    });

    working = persistWorkingMemory(
      applyAutoWorkingUpdate(working, updaterOutput.working, memoryUpdatedAt)
    );

    insertPendingCandidates(chatId, updaterOutput.longTermCandidates, memoryUpdatedAt);
  } catch (error) {
    const formatted = formatUpstreamError(error);
    memoryUpdaterDiagnostics = {
      status: "error",
      message: formatted.message,
    };
    app.log.warn({ err: error, chatId, memoryModel }, "failed to update memory layers, using previous snapshot");
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
  });

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
    updater: memoryUpdaterDiagnostics,
  });

  try {
    const openaiRequestBody = buildOpenAiRequestBody({
      model,
      systemPrompt: mergeSystemPromptWithMemory(systemPrompt, memoryBlock),
      inputMessages: persistedMessagesRaw,
      reasoningEffort,
    });

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
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hasSentDelta = false;
    let assistantText = "";
    let finalDebugResponse: Record<string, unknown> | null = null;
    let finalUsage: UsageSummary | null = null;
    let finalModel = model;
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
          hasSentDelta = true;
          assistantText += payload.delta;
          sendSse("delta", { text: payload.delta });
          continue;
        }

        if (eventType === "response.error") {
          sendSse(
            "error",
            buildOpenAiErrorPayload(payload.error, payload.error?.message ?? "Unknown response error")
          );
          reply.raw.end();
          return;
        }

        if (eventType === "response.completed") {
          const finalText = extractCompletedText(payload.response);
          finalModel = typeof payload.response?.model === "string" ? payload.response.model : model;
          finalUsage = extractUsageSummary(payload.response?.usage);
          finalCost =
            estimateCostBreakdownUsd(finalModel, finalUsage) ??
            estimateCostBreakdownUsd(model, finalUsage);

          if (!hasSentDelta && finalText) {
            assistantText = finalText;
            sendSse("delta", { text: finalText });
          }

          finalDebugResponse = extractFinalDebug(payload.response);
          sendSse("debug_response_final", {
            body: finalDebugResponse,
          });

          const assistantMessageId = createId();
          const finishedAt = Date.now();
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

          sendSse("done", {
            reason: payload.response?.status ?? "completed",
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
          return;
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

    if (assistantText) {
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
        model,
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
          model,
          latencyMs: Date.now() - startedAt,
          usage: null,
          costUsd: null,
          inputCostUsd: null,
          outputCostUsd: null,
        },
      });
      reply.raw.end();
      return;
    }

    const formattedError = formatUpstreamError(error);
    app.log.error({ err: error, ...formattedError }, "OpenAI upstream request failed");
    sendSse("error", formattedError);
    reply.raw.end();
  }
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
