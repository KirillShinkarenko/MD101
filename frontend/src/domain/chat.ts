export type Status = "idle" | "streaming" | "stopped" | "done" | "error";
export type Role = "user" | "assistant";
export type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type ShortTermMemory = {
  rollingSummary: string;
  lastProcessedMessageCount: number;
  updatedAt: number;
};

export type WorkingMemory = {
  goal: string;
  constraints: string;
  status: string;
  nextSteps: string;
  updatedBy: "auto" | "manual";
  updatedAt: number;
};

export type LongTermMemory = {
  profile: string;
  preferences: string;
  decisions: string;
  knowledge: string;
  updatedBy: "auto" | "manual";
  updatedAt: number;
};

export type LongTermCandidate = {
  id: string;
  chatId: string;
  targetField: "profile" | "preferences" | "decisions" | "knowledge";
  value: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  createdAt: number;
  resolvedAt: number | null;
};

export type ChatMemorySnapshot = {
  shortTerm: ShortTermMemory;
  working: WorkingMemory;
  longTerm: LongTermMemory;
  pendingCandidates: LongTermCandidate[];
};

export type ChatSummary = {
  id: string;
  title: string;
  model: string;
  systemPrompt: string;
  branchFromChatId: string | null;
  branchFromChatTitle: string | null;
  branchCheckpointMessageCount: number | null;
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
export const DEFAULT_MEMORY_MODEL = "gpt-4.1-nano";

export const EMPTY_MEMORY_SNAPSHOT: ChatMemorySnapshot = {
  shortTerm: {
    rollingSummary: "",
    lastProcessedMessageCount: 0,
    updatedAt: Date.now(),
  },
  working: {
    goal: "",
    constraints: "",
    status: "",
    nextSteps: "",
    updatedBy: "auto",
    updatedAt: Date.now(),
  },
  longTerm: {
    profile: "",
    preferences: "",
    decisions: "",
    knowledge: "",
    updatedBy: "auto",
    updatedAt: Date.now(),
  },
  pendingCandidates: [],
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
export const MEMORY_MODEL_STORAGE_KEY = "md.memoryModel";
