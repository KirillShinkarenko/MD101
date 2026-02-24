export type Status = "idle" | "streaming" | "stopped" | "done" | "error";
export type Role = "user" | "assistant";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ChatSummary = {
  id: string;
  title: string;
  model: string;
  systemPrompt: string;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview: string | null;
};

export type ChatMessage = {
  id: string;
  chatId: string;
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
  createdAt: number;
};

export type RunMetrics = {
  model: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
};

export type FullScreenView = "request" | "response" | null;

export const MODEL_OPTIONS = [
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
  { value: "gpt-5-mini", label: "GPT-5 Mini" },
  { value: "gpt-5.1", label: "GPT-5.1" },
  { value: "gpt-5.2", label: "GPT-5.2" },
] as const;

export const DEFAULT_MODEL = "gpt-5-mini";
export const DEFAULT_SYSTEM_PROMPT = "You are a concise assistant.";

export const MODEL_TEMPERATURE_POLICY: Record<string, "never" | "always" | "reasoning_none_only"> = {
  "gpt-4.1-nano": "always",
  "gpt-5-mini": "never",
  "gpt-5.1": "reasoning_none_only",
  "gpt-5.2": "reasoning_none_only",
};

export const MODEL_REASONING_OPTIONS: Record<string, ReasoningEffort[]> = {
  "gpt-4.1-nano": [],
  "gpt-5-mini": ["minimal", "low", "medium", "high"],
  "gpt-5.1": ["none", "low", "medium", "high"],
  "gpt-5.2": ["none", "low", "medium", "high", "xhigh"],
};

export const ACTIVE_CHAT_STORAGE_KEY = "md.activeChatId";
export const SYSTEM_PROMPT_STORAGE_KEY = "md.globalSystemPrompt";
