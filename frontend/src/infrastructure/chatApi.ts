import {
  EMPTY_MEMORY_SNAPSHOT,
  type ChatMemorySnapshot,
  type ChatMessage,
  type ChatSummary,
  type LongTermMemory,
  type WorkingMemory,
} from "../domain/chat";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

const jsonHeaders = { "Content-Type": "application/json" };

const readJson = async <T>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const extractError = (payload: unknown, fallback: string): Error => {
  const candidate = payload as { error?: unknown } | null;
  if (candidate && typeof candidate.error === "string") {
    const err = new Error(candidate.error);
    (err as Error & { payload?: unknown }).payload = payload;
    return err;
  }
  if (
    candidate &&
    typeof candidate.error === "object" &&
    candidate.error !== null &&
    typeof (candidate.error as { message?: unknown }).message === "string"
  ) {
    const err = new Error((candidate.error as { message: string }).message);
    (err as Error & { payload?: unknown }).payload = payload;
    return err;
  }
  const err = new Error(fallback);
  (err as Error & { payload?: unknown }).payload = payload;
  return err;
};

export const chatApi = {
  async listChats(): Promise<ChatSummary[]> {
    const response = await fetch(`${API_BASE}/api/chats`);
    const payload = await readJson<{ chats?: ChatSummary[]; error?: string }>(response);
    if (!response.ok) {
      throw extractError(payload, "Failed to load chats");
    }
    return payload?.chats ?? [];
  },

  async createChat(
    body?: Partial<{
      title: string;
      model: string;
      systemPrompt: string;
    }>
  ): Promise<ChatSummary> {
    const response = await fetch(`${API_BASE}/api/chats`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body ?? {}),
    });
    const payload = await readJson<{ chat?: ChatSummary; error?: string }>(response);
    if (!response.ok || !payload?.chat) {
      throw extractError(payload, "Failed to create chat");
    }
    return payload.chat;
  },

  async branchChat(chatId: string): Promise<ChatSummary> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}/branch`, {
      method: "POST",
    });
    const payload = await readJson<{ chat?: ChatSummary; error?: string }>(response);
    if (!response.ok || !payload?.chat) {
      throw extractError(payload, "Failed to branch chat");
    }
    return payload.chat;
  },

  async deleteChat(chatId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}`, {
      method: "DELETE",
    });
    const payload = await readJson<{ error?: string }>(response);
    if (!response.ok && response.status !== 404) {
      throw extractError(payload, "Failed to delete chat");
    }
  },

  async getMessages(chatId: string): Promise<{ messages: ChatMessage[]; isNotFound: boolean }> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}/messages`);
    const payload = await readJson<{ messages?: ChatMessage[]; error?: string }>(response);

    if (!response.ok) {
      if (response.status === 404) {
        return { messages: [], isNotFound: true };
      }
      throw extractError(payload, "Failed to load messages");
    }

    return {
      messages: payload?.messages ?? [],
      isNotFound: false,
    };
  },

  async getMemory(chatId: string): Promise<{ memory: ChatMemorySnapshot; isNotFound: boolean }> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}/memory`);
    const payload = await readJson<ChatMemorySnapshot & { error?: string }>(response);

    if (!response.ok) {
      if (response.status === 404) {
        return { memory: { ...EMPTY_MEMORY_SNAPSHOT }, isNotFound: true };
      }
      throw extractError(payload, "Failed to load memory");
    }

    return {
      memory: payload ?? { ...EMPTY_MEMORY_SNAPSHOT },
      isNotFound: false,
    };
  },

  async updateChat(
    chatId: string,
    body: Partial<{
      title: string;
      model: string;
      systemPrompt: string;
    }>
  ): Promise<ChatSummary> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    const payload = await readJson<{ chat?: ChatSummary; error?: string }>(response);
    if (!response.ok || !payload?.chat) {
      throw extractError(payload, "Failed to update chat");
    }
    return payload.chat;
  },

  async patchWorkingMemory(
    chatId: string,
    body: Partial<Pick<WorkingMemory, "goal" | "constraints" | "status" | "nextSteps">>
  ): Promise<WorkingMemory> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}/memory/working`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    const payload = await readJson<{ working?: WorkingMemory; error?: string }>(response);
    if (!response.ok || !payload?.working) {
      throw extractError(payload, "Failed to update working memory");
    }
    return payload.working;
  },

  async patchLongTermMemory(
    body: Partial<Pick<LongTermMemory, "profile" | "preferences" | "decisions" | "knowledge">>
  ): Promise<LongTermMemory> {
    const response = await fetch(`${API_BASE}/api/memory/long-term`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    const payload = await readJson<{ longTerm?: LongTermMemory; error?: string }>(response);
    if (!response.ok || !payload?.longTerm) {
      throw extractError(payload, "Failed to update long-term memory");
    }
    return payload.longTerm;
  },

  async approveCandidate(candidateId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/memory/candidates/${candidateId}/approve`, {
      method: "POST",
    });
    const payload = await readJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok) {
      throw extractError(payload, "Failed to approve candidate");
    }
  },

  async rejectCandidate(candidateId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/memory/candidates/${candidateId}/reject`, {
      method: "POST",
    });
    const payload = await readJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok) {
      throw extractError(payload, "Failed to reject candidate");
    }
  },

  async streamChat(
    chatId: string,
    body: {
      userPrompt: string;
      model: string;
      systemPrompt: string;
      reasoningEffort?: string;
      memoryModel?: string;
    },
    signal: AbortSignal
  ): Promise<Response> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}/stream`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok || !response.body) {
      const payload = await readJson<{ error?: string }>(response);
      throw extractError(payload, `HTTP ${response.status}`);
    }

    return response;
  },
};
