export type Status = "idle" | "streaming" | "stopped" | "done" | "error";
export type Role = "user" | "assistant";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
export type MemoryStrategy = "none" | "sliding_window" | "sticky_facts" | "branching";

export type ChatSummary = {
  id: string;
  title: string;
  model: string;
  systemPrompt: string;
  memoryStrategy: MemoryStrategy;
  slidingWindowSize: number;
  stickyWindowSize: number;
  createdAt: number;
  updatedAt: number;
  lastMessagePreview: string | null;
};

export type StickyFacts = {
  goal: string | null;
  constraints: string[];
  preferences: string[];
  decisions: string[];
  agreements: string[];
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

export type HistoryTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
};

export type TurnGrowthRow = {
  turnIndex: number;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  cumulativeTotalTokens: number;
  cumulativeCostUsd: number;
  latencyMs: number | null;
};

export type FullScreenView = "request" | "response" | null;

export const MODEL_OPTIONS = [
  { value: "gpt-3.5-turbo", label: "GPT-3.5 Turbo" },
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
  { value: "gpt-5-mini", label: "GPT-5 Mini" },
  { value: "gpt-5.1", label: "GPT-5.1" },
  { value: "gpt-5.2", label: "GPT-5.2" },
] as const;

export const DEFAULT_MODEL = "gpt-5-mini";
export const DEFAULT_SYSTEM_PROMPT = "";
export const DEFAULT_MEMORY_STRATEGY: MemoryStrategy = "none";
export const DEFAULT_SLIDING_WINDOW_SIZE = 10;
export const DEFAULT_STICKY_WINDOW_SIZE = 10;
export const EMPTY_STICKY_FACTS: StickyFacts = {
  goal: null,
  constraints: [],
  preferences: [],
  decisions: [],
  agreements: [],
};

export const MEMORY_STRATEGY_OPTIONS = [
  { value: "none", label: "None", implemented: true },
  { value: "sliding_window", label: "Sliding Window", implemented: true },
  { value: "sticky_facts", label: "Sticky Facts / Key-Value Memory", implemented: true },
  { value: "branching", label: "Branching (coming soon)", implemented: false },
] as const satisfies ReadonlyArray<{
  value: MemoryStrategy;
  label: string;
  implemented: boolean;
}>;

export const MODEL_TEMPERATURE_POLICY: Record<string, "never" | "always" | "reasoning_none_only"> = {
  "gpt-3.5-turbo": "always",
  "gpt-4.1-nano": "always",
  "gpt-5-mini": "never",
  "gpt-5.1": "reasoning_none_only",
  "gpt-5.2": "reasoning_none_only",
};

export const MODEL_REASONING_OPTIONS: Record<string, ReasoningEffort[]> = {
  "gpt-3.5-turbo": [],
  "gpt-4.1-nano": [],
  "gpt-5-mini": ["minimal", "low", "medium", "high"],
  "gpt-5.1": ["none", "low", "medium", "high"],
  "gpt-5.2": ["none", "low", "medium", "high", "xhigh"],
};

export const MODEL_CONTEXT_WINDOW: Record<string, number> = {
  "gpt-3.5-turbo": 16385,
  "gpt-4.1-nano": 1047576,
  "gpt-5-mini": 400000,
  "gpt-5.1": 400000,
  "gpt-5.2": 400000,
};

export const ACTIVE_CHAT_STORAGE_KEY = "md.activeChatId";
export const SYSTEM_PROMPT_STORAGE_KEY = "md.globalSystemPrompt";
