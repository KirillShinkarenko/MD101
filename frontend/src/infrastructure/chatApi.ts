import {
  type ApprovePlanStreamRequest,
  EMPTY_MEMORY_SNAPSHOT,
  EMPTY_TASK_CONTEXT,
  type ChatMemorySnapshot,
  type ChatMessage,
  type ChatSummary,
  type Invariant,
  type InvariantSettings,
  type LongTermMemory,
  type MemorySettings,
  type TaskCommandRequest,
  type TaskContext,
  type UserProfile,
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

const extractError = (payload: unknown, fallback: string, status?: number): Error => {
  const candidate = payload as { error?: unknown } | null;
  if (candidate && typeof candidate.error === "string") {
    const err = new Error(candidate.error);
    (err as Error & { payload?: unknown; status?: number }).payload = payload;
    (err as Error & { payload?: unknown; status?: number }).status = status;
    return err;
  }
  if (
    candidate &&
    typeof candidate.error === "object" &&
    candidate.error !== null &&
    typeof (candidate.error as { message?: unknown }).message === "string"
  ) {
    const err = new Error((candidate.error as { message: string }).message);
    (err as Error & { payload?: unknown; status?: number }).payload = payload;
    (err as Error & { payload?: unknown; status?: number }).status = status;
    return err;
  }
  const err = new Error(fallback);
  (err as Error & { payload?: unknown; status?: number }).payload = payload;
  (err as Error & { payload?: unknown; status?: number }).status = status;
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

  async getTaskState(chatId: string): Promise<{ task: TaskContext; isNotFound: boolean }> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}/task-state`);
    const payload = await readJson<{ task?: TaskContext; error?: string }>(response);
    if (!response.ok) {
      if (response.status === 404) {
        return { task: { ...EMPTY_TASK_CONTEXT }, isNotFound: true };
      }
      throw extractError(payload, "Failed to load task state", response.status);
    }
    return {
      task: payload?.task ?? { ...EMPTY_TASK_CONTEXT },
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

  async sendTaskCommand(chatId: string, body: TaskCommandRequest): Promise<TaskContext> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}/task-state/command`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    const payload = await readJson<{ task?: TaskContext; error?: string }>(response);
    if (!response.ok || !payload?.task) {
      throw extractError(payload, "Failed to send task command", response.status);
    }
    return payload.task;
  },

  async streamApprovePlan(chatId: string, body: ApprovePlanStreamRequest, signal?: AbortSignal): Promise<Response> {
    const response = await fetch(`${API_BASE}/api/chats/${chatId}/task-state/approve-plan/stream`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) {
      const payload = await readJson<{ error?: string }>(response);
      throw extractError(payload, "Failed to start approve-plan execution stream", response.status);
    }
    return response;
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

  async getMemorySettings(): Promise<MemorySettings> {
    const response = await fetch(`${API_BASE}/api/memory/settings`);
    const payload = await readJson<MemorySettings & { error?: string }>(response);
    if (!response.ok || !payload || typeof payload.longTermEnabled !== "boolean") {
      throw extractError(payload, "Failed to load memory settings");
    }
    return {
      shortTermEnabled:
        typeof payload.shortTermEnabled === "boolean" ? payload.shortTermEnabled : true,
      workingEnabled:
        typeof payload.workingEnabled === "boolean" ? payload.workingEnabled : true,
      longTermEnabled: payload.longTermEnabled,
      updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : Date.now(),
    };
  },

  async patchMemorySettings(
    body: { shortTermEnabled?: boolean; workingEnabled?: boolean; longTermEnabled?: boolean }
  ): Promise<MemorySettings> {
    const response = await fetch(`${API_BASE}/api/memory/settings`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    const payload = await readJson<MemorySettings & { error?: string }>(response);
    if (
      !response.ok ||
      !payload ||
      typeof payload.shortTermEnabled !== "boolean" ||
      typeof payload.workingEnabled !== "boolean" ||
      typeof payload.longTermEnabled !== "boolean"
    ) {
      throw extractError(payload, "Failed to update memory settings");
    }
    return {
      shortTermEnabled: payload.shortTermEnabled,
      workingEnabled: payload.workingEnabled,
      longTermEnabled: payload.longTermEnabled,
      updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : Date.now(),
    };
  },

  async getInvariants(): Promise<{ settings: InvariantSettings; invariants: Invariant[] }> {
    const response = await fetch(`${API_BASE}/api/invariants`);
    const payload = await readJson<{
      enabled?: boolean;
      injectInSystemPrompt?: boolean;
      updatedAt?: number;
      invariants?: Invariant[];
      error?: string;
    }>(response);
    if (!response.ok || !payload) {
      throw extractError(payload, "Failed to load invariants");
    }
    return {
      settings: {
        enabled: payload.enabled === true,
        injectInSystemPrompt: payload.injectInSystemPrompt === true,
        updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : Date.now(),
      },
      invariants: Array.isArray(payload.invariants) ? payload.invariants : [],
    };
  },

  async patchInvariantSettings(
    body: Partial<Pick<InvariantSettings, "enabled" | "injectInSystemPrompt">>
  ): Promise<InvariantSettings> {
    const response = await fetch(`${API_BASE}/api/invariants/settings`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    const payload = await readJson<InvariantSettings & { error?: string }>(response);
    if (
      !response.ok ||
      !payload ||
      typeof payload.enabled !== "boolean" ||
      typeof payload.injectInSystemPrompt !== "boolean"
    ) {
      throw extractError(payload, "Failed to update invariant settings");
    }
    return {
      enabled: payload.enabled,
      injectInSystemPrompt: payload.injectInSystemPrompt,
      updatedAt: typeof payload.updatedAt === "number" ? payload.updatedAt : Date.now(),
    };
  },

  async createInvariant(body: { name: string; ruleText: string }): Promise<Invariant> {
    const response = await fetch(`${API_BASE}/api/invariants`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    const payload = await readJson<{ invariant?: Invariant; error?: string }>(response);
    if (!response.ok || !payload?.invariant) {
      throw extractError(payload, "Failed to create invariant");
    }
    return payload.invariant;
  },

  async updateInvariant(
    invariantId: string,
    body: Partial<Pick<Invariant, "name" | "ruleText">>
  ): Promise<Invariant> {
    const response = await fetch(`${API_BASE}/api/invariants/${invariantId}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    const payload = await readJson<{ invariant?: Invariant; error?: string }>(response);
    if (!response.ok || !payload?.invariant) {
      throw extractError(payload, "Failed to update invariant");
    }
    return payload.invariant;
  },

  async deleteInvariant(invariantId: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/invariants/${invariantId}`, {
      method: "DELETE",
    });
    const payload = await readJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok) {
      throw extractError(payload, "Failed to delete invariant");
    }
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

  async listProfiles(): Promise<{ profiles: UserProfile[]; activeProfileId: string | null }> {
    const response = await fetch(`${API_BASE}/api/profiles`);
    const payload = await readJson<{
      profiles?: UserProfile[];
      activeProfileId?: string | null;
      error?: string;
    }>(response);
    if (!response.ok) {
      throw extractError(payload, "Failed to load profiles");
    }
    return {
      profiles: payload?.profiles ?? [],
      activeProfileId: typeof payload?.activeProfileId === "string" ? payload.activeProfileId : null,
    };
  },

  async createProfile(name: string): Promise<{ profile: UserProfile; activeProfileId: string | null }> {
    const response = await fetch(`${API_BASE}/api/profiles`, {
      method: "POST",
      headers: jsonHeaders,
      body: JSON.stringify({ name }),
    });
    const payload = await readJson<{ profile?: UserProfile; activeProfileId?: string | null; error?: string }>(
      response
    );
    if (!response.ok || !payload?.profile) {
      throw extractError(payload, "Failed to create profile");
    }
    return {
      profile: payload.profile,
      activeProfileId: typeof payload.activeProfileId === "string" ? payload.activeProfileId : null,
    };
  },

  async updateProfile(
    profileId: string,
    body: Partial<Pick<UserProfile, "name" | "style" | "outputFormat" | "constraints" | "notes">>
  ): Promise<UserProfile> {
    const response = await fetch(`${API_BASE}/api/profiles/${profileId}`, {
      method: "PATCH",
      headers: jsonHeaders,
      body: JSON.stringify(body),
    });
    const payload = await readJson<{ profile?: UserProfile; error?: string }>(response);
    if (!response.ok || !payload?.profile) {
      throw extractError(payload, "Failed to update profile");
    }
    return payload.profile;
  },

  async deleteProfile(profileId: string): Promise<{ activeProfileId: string | null }> {
    const response = await fetch(`${API_BASE}/api/profiles/${profileId}`, {
      method: "DELETE",
    });
    const payload = await readJson<{ ok?: boolean; activeProfileId?: string | null; error?: string }>(response);
    if (!response.ok) {
      throw extractError(payload, "Failed to delete profile");
    }
    return {
      activeProfileId: typeof payload?.activeProfileId === "string" ? payload.activeProfileId : null,
    };
  },

  async setActiveProfile(profileId: string | null): Promise<{ activeProfileId: string | null }> {
    const response = await fetch(`${API_BASE}/api/profiles/active`, {
      method: "PUT",
      headers: jsonHeaders,
      body: JSON.stringify({ profileId }),
    });
    const payload = await readJson<{ activeProfileId?: string | null; error?: string }>(response);
    if (!response.ok) {
      throw extractError(payload, "Failed to set active profile");
    }
    return {
      activeProfileId: typeof payload?.activeProfileId === "string" ? payload.activeProfileId : null,
    };
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
      const payload = await readJson<{ error?: string; task?: TaskContext }>(response);
      throw extractError(payload, `HTTP ${response.status}`, response.status);
    }

    return response;
  },
};
