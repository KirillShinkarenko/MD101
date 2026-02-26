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
type HistoryMode = "summary" | "full";
type PersistedMessage = {
  role: Role;
  content: string;
  createdAt: number;
};

type ChatBody = {
  userPrompt?: string;
  temperature?: number | string;
  model?: string;
  reasoningEffort?: string;
  systemPrompt?: string;
  historyMode?: string;
  summaryChunkSize?: number | string;
  summaryTailMessages?: number | string;
};

type CreateChatBody = {
  title?: string;
  model?: string;
  systemPrompt?: string;
  historyMode?: string;
  summaryChunkSize?: number | string;
  summaryTailMessages?: number | string;
};

type PatchChatBody = {
  title?: string;
  model?: string;
  systemPrompt?: string;
  historyMode?: string;
  summaryChunkSize?: number | string;
  summaryTailMessages?: number | string;
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
  temperaturePolicy: "never" | "always" | "reasoning_none_only";
  reasoningEfforts: Array<"none" | "minimal" | "low" | "medium" | "high" | "xhigh">;
};

type TokenSavings = {
  actualInputTokens: number | null;
  fullInputTokens: number | null;
  savedInputTokens: number;
  savedInputPercent: number;
  cumulativeSavedInputTokens: number;
};

const DEFAULT_MODEL = process.env.OPENAI_MODEL?.trim() || "gpt-5-mini";
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
    temperaturePolicy: "always",
    reasoningEfforts: [],
  },
  "gpt-4.1-nano": {
    temperaturePolicy: "always",
    reasoningEfforts: [],
  },
  "gpt-5-mini": {
    temperaturePolicy: "never",
    reasoningEfforts: ["minimal", "low", "medium", "high"],
  },
  "gpt-5.1": {
    temperaturePolicy: "reasoning_none_only",
    reasoningEfforts: ["none", "low", "medium", "high"],
  },
  "gpt-5.2": {
    temperaturePolicy: "reasoning_none_only",
    reasoningEfforts: ["none", "low", "medium", "high", "xhigh"],
  },
};

const ALLOWED_MODELS = new Set(Object.keys(MODEL_API_PROFILES));
const EFFECTIVE_DEFAULT_MODEL = ALLOWED_MODELS.has(DEFAULT_MODEL) ? DEFAULT_MODEL : "gpt-5-mini";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_SUMMARY_TAIL_MESSAGES = 10;
const DEFAULT_SUMMARY_CHUNK_SIZE = 10;

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
  history_mode TEXT NOT NULL DEFAULT 'summary',
  summary_chunk_size INTEGER NOT NULL DEFAULT 10,
  summary_tail_messages INTEGER NOT NULL DEFAULT 10,
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
  actual_input_tokens INTEGER,
  full_input_tokens INTEGER,
  saved_input_tokens INTEGER,
  saved_input_percent REAL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_context_summary (
  chat_id TEXT PRIMARY KEY,
  summary_text TEXT NOT NULL,
  summarized_through_created_at INTEGER,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS chat_context_summary_chunks (
  chat_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  summary_text TEXT NOT NULL,
  summarized_through_created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (chat_id, chunk_index),
  FOREIGN KEY (chat_id) REFERENCES chats (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_id_created_at ON messages (chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_summary_chunks_chat_id_chunk_index
  ON chat_context_summary_chunks (chat_id, chunk_index);
`);

const ensureColumn = (table: string, column: string, ddl: string): void => {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
};

ensureColumn("chats", "history_mode", "TEXT NOT NULL DEFAULT 'summary'");
ensureColumn("chats", "summary_chunk_size", "INTEGER NOT NULL DEFAULT 10");
ensureColumn("chats", "summary_tail_messages", "INTEGER NOT NULL DEFAULT 10");
ensureColumn("messages", "actual_input_tokens", "INTEGER");
ensureColumn("messages", "full_input_tokens", "INTEGER");
ensureColumn("messages", "saved_input_tokens", "INTEGER");
ensureColumn("messages", "saved_input_percent", "REAL");

const parseTemperature = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const parseModel = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

const parsePositiveInteger = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
      ? Number(value.trim())
      : Number.NaN;
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 100) {
    return undefined;
  }
  return numeric;
};

const parseHistoryMode = (value: unknown): HistoryMode | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "summary" || trimmed === "full") {
    return trimmed;
  }
  return undefined;
};

const parseReasoningEffort = (
  value: unknown
): "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | undefined => {
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

const parseJsonSafe = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
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

const buildOpenAiRequestBody = (params: {
  model: string;
  instructions: string;
  inputMessages: Array<{ role: Role; content: string }>;
  profile: ModelApiProfile;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  temperature?: number;
  stream?: boolean;
}): Record<string, unknown> => {
  const { model, instructions, inputMessages, temperature, profile, reasoningEffort, stream = true } = params;
  const body: Record<string, unknown> = {
    model,
    stream,
    truncation: "disabled",
    instructions: instructions || undefined,
    input: inputMessages,
  };

  const canUseTemperature =
    profile.temperaturePolicy === "always" ||
    (profile.temperaturePolicy === "reasoning_none_only" && reasoningEffort === "none");

  if (canUseTemperature && temperature !== undefined) {
    body.temperature = temperature;
  }

  if (reasoningEffort !== undefined) {
    body.reasoning = { effort: reasoningEffort };
  }

  return body;
};

const buildSummaryInstructions = (systemPrompt: string, summaryChunks: string[]): string => {
  const normalizedChunks = summaryChunks.map((item) => item.trim()).filter(Boolean);
  if (normalizedChunks.length === 0) {
    return systemPrompt;
  }
  const prefix = systemPrompt.trim();
  const summaryBlock = [
    "Conversation summaries (older messages by chunk):",
    ...normalizedChunks.map((item, index) => `Chunk ${index + 1}:\n${item}`),
  ].join("\n\n");
  return [prefix, summaryBlock].filter(Boolean).join("\n\n");
};

const extractOutputTextFromResponsePayload = (payload: unknown): string => {
  const candidate =
    payload && typeof payload === "object" ? (payload as { output?: unknown }) : undefined;
  return extractCompletedText({ output: candidate?.output });
};

const callOpenAiResponse = async (params: {
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): Promise<{ payload: any; outputText: string; usage: UsageSummary | null }> => {
  const upstream = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    signal: params.signal,
    body: JSON.stringify(params.body),
  });

  const payloadText = await upstream.text();
  const payload = parseJsonSafe(payloadText);
  if (!upstream.ok) {
    throw new Error(`OpenAI error (${upstream.status}): ${payloadText}`);
  }

  const outputText = extractOutputTextFromResponsePayload(payload);
  const usageRaw =
    payload && typeof payload === "object" ? (payload as { usage?: unknown }).usage : undefined;
  const usage = usageRaw ? extractUsageSummary(usageRaw) : null;
  return {
    payload,
    outputText,
    usage,
  };
};

const summarizeChunkWithOpenAi = async (params: {
  model: string;
  chunk: PersistedMessage[];
  signal: AbortSignal;
}): Promise<string> => {
  const chunkText = params.chunk
    .map((item, index) => `${index + 1}. ${item.role.toUpperCase()}: ${item.content}`)
    .join("\n\n");

  const prompt = [
    "Summarize this conversation chunk.",
    "Keep key user goals, constraints, facts, decisions, and unresolved questions from this chunk.",
    "Be concise and factual. Do not invent details.",
    "",
    "Messages in this chunk:",
    chunkText,
    "",
    "Return only the chunk summary as plain text.",
  ].join("\n");

  const summaryBody: Record<string, unknown> = {
    model: params.model,
    stream: false,
    max_output_tokens: 500,
    input: [
      { role: "system", content: "You maintain concise, high-fidelity conversation summaries." },
      { role: "user", content: prompt },
    ],
  };

  const response = await callOpenAiResponse({ body: summaryBody, signal: params.signal });
  const summaryText = response.outputText.trim();
  if (!summaryText) {
    throw new Error("Summary generation returned an empty response");
  }
  return summaryText;
};

const estimateFullInputTokens = async (params: {
  model: string;
  profile: ModelApiProfile;
  systemPrompt: string;
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  temperature?: number;
  inputMessages: Array<{ role: Role; content: string }>;
  signal: AbortSignal;
}): Promise<number | null> => {
  try {
    const body = buildOpenAiRequestBody({
      model: params.model,
      instructions: params.systemPrompt,
      inputMessages: params.inputMessages,
      profile: params.profile,
      reasoningEffort: params.reasoningEffort,
      temperature: params.temperature,
      stream: false,
    });
    body.max_output_tokens = 16;
    const response = await callOpenAiResponse({
      body,
      signal: params.signal,
    });
    return response.usage?.inputTokens ?? null;
  } catch (error) {
    app.log.warn({ err: error }, "Failed to estimate full input tokens");
    return null;
  }
};

const getChatStmt = db.prepare(`
  SELECT
    id,
    title,
    model,
    system_prompt AS systemPrompt,
    history_mode AS historyMode,
    summary_chunk_size AS summaryChunkSize,
    summary_tail_messages AS summaryTailMessages,
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
    c.history_mode AS historyMode,
    c.summary_chunk_size AS summaryChunkSize,
    c.summary_tail_messages AS summaryTailMessages,
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
    actual_input_tokens AS actualInputTokens,
    full_input_tokens AS fullInputTokens,
    saved_input_tokens AS savedInputTokens,
    saved_input_percent AS savedInputPercent,
    created_at AS createdAt
  FROM messages
  WHERE chat_id = ?
  ORDER BY created_at ASC
`);

const getContextSummaryStmt = db.prepare(`
  SELECT
    chat_id AS chatId,
    summary_text AS summaryText,
    summarized_through_created_at AS summarizedThroughCreatedAt,
    updated_at AS updatedAt
  FROM chat_context_summary
  WHERE chat_id = ?
`);

const listContextSummaryChunksStmt = db.prepare(`
  SELECT
    chat_id AS chatId,
    chunk_index AS chunkIndex,
    summary_text AS summaryText,
    summarized_through_created_at AS summarizedThroughCreatedAt
  FROM chat_context_summary_chunks
  WHERE chat_id = ?
  ORDER BY chunk_index ASC
`);

const upsertContextSummaryStmt = db.prepare(`
  INSERT INTO chat_context_summary (chat_id, summary_text, summarized_through_created_at, updated_at)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(chat_id) DO UPDATE SET
    summary_text = excluded.summary_text,
    summarized_through_created_at = excluded.summarized_through_created_at,
    updated_at = excluded.updated_at
`);

const upsertContextSummaryChunkStmt = db.prepare(`
  INSERT INTO chat_context_summary_chunks (
    chat_id, chunk_index, summary_text, summarized_through_created_at, updated_at
  )
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(chat_id, chunk_index) DO UPDATE SET
    summary_text = excluded.summary_text,
    summarized_through_created_at = excluded.summarized_through_created_at,
    updated_at = excluded.updated_at
`);

const deleteContextSummaryChunksFromIndexStmt = db.prepare(`
  DELETE FROM chat_context_summary_chunks
  WHERE chat_id = ? AND chunk_index >= ?
`);

const insertChatStmt = db.prepare(`
  INSERT INTO chats (
    id, title, model, system_prompt, history_mode, summary_chunk_size, summary_tail_messages, created_at, updated_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateChatStmt = db.prepare(`
  UPDATE chats
  SET title = ?, model = ?, system_prompt = ?, history_mode = ?, summary_chunk_size = ?, summary_tail_messages = ?, updated_at = ?
  WHERE id = ?
`);

const deleteChatStmt = db.prepare(`DELETE FROM chats WHERE id = ?`);

const insertMessageStmt = db.prepare(`
  INSERT INTO messages (
    id, chat_id, role, content, request_json, response_json,
    latency_ms, input_tokens, output_tokens, total_tokens,
    cost_usd, input_cost_usd, output_cost_usd,
    actual_input_tokens, full_input_tokens, saved_input_tokens, saved_input_percent,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const updateChatUpdatedAtStmt = db.prepare(`UPDATE chats SET updated_at = ? WHERE id = ?`);

const createChat = (params?: {
  title?: string;
  model?: string;
  systemPrompt?: string;
  historyMode?: string;
  summaryChunkSize?: number | string;
  summaryTailMessages?: number | string;
}) => {
  const now = Date.now();
  const id = createId();
  const title = params?.title?.trim() || "New chat";
  const model = parseModel(params?.model) ?? EFFECTIVE_DEFAULT_MODEL;
  const systemPrompt = params?.systemPrompt?.trim() ?? "";
  const historyMode = parseHistoryMode(params?.historyMode) ?? "summary";
  const summaryChunkSize = parsePositiveInteger(params?.summaryChunkSize) ?? DEFAULT_SUMMARY_CHUNK_SIZE;
  const summaryTailMessages = parsePositiveInteger(params?.summaryTailMessages) ?? DEFAULT_SUMMARY_TAIL_MESSAGES;
  insertChatStmt.run(
    id,
    title,
    model,
    systemPrompt,
    historyMode,
    summaryChunkSize,
    summaryTailMessages,
    now,
    now
  );
  return getChatStmt.get(id);
};

const refreshChatSummary = async (params: {
  chatId: string;
  model: string;
  headMessages: PersistedMessage[];
  chunkSize: number;
  signal: AbortSignal;
}): Promise<{ summaryChunks: string[] }> => {
  const completedChunkCount = Math.floor(params.headMessages.length / params.chunkSize);
  if (completedChunkCount <= 0) {
    deleteContextSummaryChunksFromIndexStmt.run(params.chatId, 0);
    return { summaryChunks: [] };
  }

  const existingChunks = listContextSummaryChunksStmt.all(params.chatId) as Array<{
    chunkIndex: number;
    summaryText: string;
    summarizedThroughCreatedAt: number;
  }>;
  const existingByChunkIndex = new Map(existingChunks.map((item) => [item.chunkIndex, item]));

  const summaryChunks: string[] = [];
  const now = Date.now();

  for (let chunkIndex = 0; chunkIndex < completedChunkCount; chunkIndex += 1) {
    const start = chunkIndex * params.chunkSize;
    const chunk = params.headMessages.slice(start, start + params.chunkSize);
    const summarizedThroughCreatedAt = chunk[chunk.length - 1]?.createdAt;
    if (!summarizedThroughCreatedAt) {
      continue;
    }

    const existingChunk = existingByChunkIndex.get(chunkIndex);
    if (
      existingChunk &&
      existingChunk.summarizedThroughCreatedAt === summarizedThroughCreatedAt &&
      existingChunk.summaryText.trim()
    ) {
      summaryChunks.push(existingChunk.summaryText.trim());
      continue;
    }

    const summaryText = await summarizeChunkWithOpenAi({
      model: params.model,
      chunk,
      signal: params.signal,
    });
    upsertContextSummaryChunkStmt.run(
      params.chatId,
      chunkIndex,
      summaryText,
      summarizedThroughCreatedAt,
      now
    );
    summaryChunks.push(summaryText);
  }

  deleteContextSummaryChunksFromIndexStmt.run(params.chatId, completedChunkCount);
  return { summaryChunks };
};

app.get("/health", async () => ({ ok: true }));

app.get("/api/chats", async () => {
  const chats = listChatsStmt.all();
  return { chats };
});

app.post<{ Body: CreateChatBody }>("/api/chats", async (request) => {
  const chat = createChat(request.body);
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

app.patch<{ Params: { id: string }; Body: PatchChatBody }>("/api/chats/:id", async (request, reply) => {
  const chatId = request.params.id;
  const chat = getChatStmt.get(chatId) as
    | {
        id: string;
        title: string;
        model: string;
        systemPrompt: string;
        historyMode: HistoryMode;
        summaryChunkSize: number;
        summaryTailMessages: number;
      }
    | undefined;

  if (!chat) {
    reply.code(404);
    return { error: "chat not found" };
  }

  const title = typeof request.body?.title === "string" ? request.body.title.trim() : chat.title;
  const model = parseModel(request.body?.model) ?? chat.model;
  const systemPrompt =
    typeof request.body?.systemPrompt === "string" ? request.body.systemPrompt : chat.systemPrompt;
  const historyMode = parseHistoryMode(request.body?.historyMode) ?? chat.historyMode;
  const summaryChunkSize = parsePositiveInteger(request.body?.summaryChunkSize) ?? chat.summaryChunkSize;
  const summaryTailMessages =
    parsePositiveInteger(request.body?.summaryTailMessages) ?? chat.summaryTailMessages;

  if (!ALLOWED_MODELS.has(model)) {
    reply.code(400);
    return { error: `model must be one of: ${Array.from(ALLOWED_MODELS).join(", ")}` };
  }

  if (request.body?.historyMode !== undefined && parseHistoryMode(request.body?.historyMode) === undefined) {
    reply.code(400);
    return { error: "historyMode must be one of: summary, full" };
  }
  if (
    request.body?.summaryChunkSize !== undefined &&
    parsePositiveInteger(request.body?.summaryChunkSize) === undefined
  ) {
    reply.code(400);
    return { error: "summaryChunkSize must be an integer between 1 and 100" };
  }
  if (
    request.body?.summaryTailMessages !== undefined &&
    parsePositiveInteger(request.body?.summaryTailMessages) === undefined
  ) {
    reply.code(400);
    return { error: "summaryTailMessages must be an integer between 1 and 100" };
  }

  const nextTitle = title || "New chat";
  updateChatStmt.run(
    nextTitle,
    model,
    systemPrompt,
    historyMode,
    summaryChunkSize,
    summaryTailMessages,
    Date.now(),
    chatId
  );
  return { chat: getChatStmt.get(chatId) };
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
        historyMode: HistoryMode;
        summaryChunkSize: number;
        summaryTailMessages: number;
      }
    | undefined;

  if (!existingChat) {
    reply.code(404);
    return { error: "chat not found" };
  }

  const userPrompt = request.body?.userPrompt?.trim() ?? "";
  const temperature = parseTemperature(request.body?.temperature);
  const requestedModel = parseModel(request.body?.model);
  const model = requestedModel ?? existingChat.model;
  const requestedReasoningEffortRaw = request.body?.reasoningEffort;
  const reasoningEffort = parseReasoningEffort(requestedReasoningEffortRaw);
  const requestedHistoryMode = parseHistoryMode(request.body?.historyMode);
  const requestedSummaryChunkSize = parsePositiveInteger(request.body?.summaryChunkSize);
  const requestedSummaryTailMessages = parsePositiveInteger(request.body?.summaryTailMessages);
  const historyMode = requestedHistoryMode ?? existingChat.historyMode;
  const summaryChunkSize = requestedSummaryChunkSize ?? existingChat.summaryChunkSize;
  const summaryTailMessages = requestedSummaryTailMessages ?? existingChat.summaryTailMessages;
  const systemPrompt =
    typeof request.body?.systemPrompt === "string" ? request.body.systemPrompt : existingChat.systemPrompt;
  const startedAt = Date.now();

  if (!userPrompt) {
    reply.code(400);
    return { error: "userPrompt is required" };
  }

  if (!ALLOWED_MODELS.has(model)) {
    reply.code(400);
    return { error: `model must be one of: ${Array.from(ALLOWED_MODELS).join(", ")}` };
  }

  const modelProfile = MODEL_API_PROFILES[model];

  if (request.body?.temperature !== undefined && temperature === undefined) {
    reply.code(400);
    return { error: "temperature must be a valid number" };
  }

  if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
    reply.code(400);
    return { error: "temperature must be between 0 and 2" };
  }

  if (modelProfile.temperaturePolicy === "never" && request.body?.temperature !== undefined) {
    reply.code(400);
    return { error: `temperature is not supported for model ${model}` };
  }

  if (
    modelProfile.temperaturePolicy === "reasoning_none_only" &&
    request.body?.temperature !== undefined &&
    reasoningEffort !== "none"
  ) {
    reply.code(400);
    return { error: `temperature for model ${model} is only supported when reasoningEffort=none` };
  }

  if (requestedReasoningEffortRaw !== undefined && reasoningEffort === undefined) {
    reply.code(400);
    return { error: "reasoningEffort must be one of: none, minimal, low, medium, high, xhigh" };
  }

  if (reasoningEffort !== undefined && !modelProfile.reasoningEfforts.includes(reasoningEffort)) {
    reply.code(400);
    return {
      error: `reasoningEffort for ${model} must be one of: ${modelProfile.reasoningEfforts.join(", ")}`,
    };
  }

  if (request.body?.historyMode !== undefined && requestedHistoryMode === undefined) {
    reply.code(400);
    return { error: "historyMode must be one of: summary, full" };
  }
  if (
    request.body?.summaryChunkSize !== undefined &&
    parsePositiveInteger(request.body?.summaryChunkSize) === undefined
  ) {
    reply.code(400);
    return { error: "summaryChunkSize must be an integer between 1 and 100" };
  }
  if (
    request.body?.summaryTailMessages !== undefined &&
    parsePositiveInteger(request.body?.summaryTailMessages) === undefined
  ) {
    reply.code(400);
    return { error: "summaryTailMessages must be an integer between 1 and 100" };
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

  const persistedMessagesRaw = listMessagesStmt.all(chatId) as Array<{
    role: Role;
    content: string;
    createdAt: number;
    savedInputTokens: number | null;
  }>;
  const persistedMessages: PersistedMessage[] = persistedMessagesRaw.map((item) => ({
    role: item.role,
    content: item.content,
    createdAt: item.createdAt,
  }));
  const persistedInputMessages = persistedMessages.map((item) => ({
    role: item.role,
    content: item.content,
  }));
  const cumulativeSavedInputTokens = persistedMessagesRaw.reduce(
    (total, item) => total + (item.savedInputTokens ?? 0),
    0
  );

  let contextInstructions = systemPrompt;
  let historyModeUsed: HistoryMode = historyMode;
  let summaryIncluded = false;
  let summaryChars = 0;
  let summaryTailMessagesCount = persistedMessages.length;
  let inputMessages: Array<{ role: Role; content: string }> = [];

  if (historyMode === "summary") {
    const headMessages = persistedMessages.slice(0, Math.max(0, persistedMessages.length - summaryTailMessages));
    const tailMessages = persistedMessages.slice(-summaryTailMessages);
    const tailInputMessages = tailMessages.map((item) => ({ role: item.role, content: item.content }));
    summaryTailMessagesCount = tailMessages.length;

    try {
      const refreshedSummary = await refreshChatSummary({
        chatId,
        model,
        headMessages,
        chunkSize: summaryChunkSize,
        signal: abortController.signal,
      });
      const summaryChunks = refreshedSummary.summaryChunks;
      if (summaryChunks.length > 0) {
        contextInstructions = buildSummaryInstructions(systemPrompt, summaryChunks);
        summaryIncluded = true;
        summaryChars = summaryChunks.reduce((total, item) => total + item.length, 0);
      }
      inputMessages = [...tailInputMessages, { role: "user", content: userPrompt }];
    } catch (error) {
      app.log.warn({ err: error }, "Failed to build summary context, falling back to full history");
      historyModeUsed = "full";
      inputMessages = [...persistedInputMessages, { role: "user", content: userPrompt }];
      contextInstructions = systemPrompt;
      summaryIncluded = false;
      summaryChars = 0;
      summaryTailMessagesCount = persistedMessages.length;
    }
  } else {
    inputMessages = [...persistedInputMessages, { role: "user", content: userPrompt }];
  }

  const now = Date.now();
  updateChatStmt.run(
    existingChat.title,
    model,
    systemPrompt,
    historyMode,
    summaryChunkSize,
    summaryTailMessages,
    now,
    chatId
  );

  if (existingChat.title === "New chat") {
    const nextTitle = userPrompt.slice(0, 42).trim() || "New chat";
    updateChatStmt.run(
      nextTitle,
      model,
      systemPrompt,
      historyMode,
      summaryChunkSize,
      summaryTailMessages,
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
    null,
    null,
    null,
    null,
    now
  );
  updateChatUpdatedAtStmt.run(now, chatId);

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const sendSse = (event: string, data: unknown): void => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const openaiRequestBody = buildOpenAiRequestBody({
      model,
      instructions: contextInstructions,
      inputMessages,
      profile: modelProfile,
      reasoningEffort,
      temperature,
    });

    sendSse("debug_request", {
      target: "openai.responses.create",
      modelProfile,
      context: {
        historyModeRequested: historyMode,
        historyModeUsed,
        summaryChunkSize,
        summaryTailMessages,
        tailMessagesCount: summaryTailMessagesCount,
        summaryIncluded,
        summaryChars,
      },
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

          const actualInputTokens = finalUsage?.inputTokens ?? null;
          const fullInputTokens =
            historyModeUsed === "full" || !summaryIncluded
              ? actualInputTokens
              : await estimateFullInputTokens({
                  model,
                  profile: modelProfile,
                  systemPrompt,
                  reasoningEffort,
                  temperature,
                  inputMessages: [...persistedInputMessages, { role: "user", content: userPrompt }],
                  signal: abortController.signal,
                });
          const savedInputTokens =
            fullInputTokens !== null && actualInputTokens !== null
              ? Math.max(fullInputTokens - actualInputTokens, 0)
              : 0;
          const savedInputPercent =
            fullInputTokens && fullInputTokens > 0
              ? Number(((savedInputTokens / fullInputTokens) * 100).toFixed(2))
              : 0;
          const tokenSavings: TokenSavings = {
            actualInputTokens,
            fullInputTokens,
            savedInputTokens,
            savedInputPercent,
            cumulativeSavedInputTokens: cumulativeSavedInputTokens + savedInputTokens,
          };

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
            actualInputTokens,
            fullInputTokens,
            savedInputTokens,
            savedInputPercent,
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
              tokenSavings,
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
      const tokenSavings: TokenSavings = {
        actualInputTokens: null,
        fullInputTokens: null,
        savedInputTokens: 0,
        savedInputPercent: 0,
        cumulativeSavedInputTokens,
      };
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
        tokenSavings.actualInputTokens,
        tokenSavings.fullInputTokens,
        tokenSavings.savedInputTokens,
        tokenSavings.savedInputPercent,
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
        tokenSavings: {
          actualInputTokens: null,
          fullInputTokens: null,
          savedInputTokens: 0,
          savedInputPercent: 0,
          cumulativeSavedInputTokens,
        } satisfies TokenSavings,
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
          tokenSavings: {
            actualInputTokens: null,
            fullInputTokens: null,
            savedInputTokens: 0,
            savedInputPercent: 0,
            cumulativeSavedInputTokens,
          } satisfies TokenSavings,
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
