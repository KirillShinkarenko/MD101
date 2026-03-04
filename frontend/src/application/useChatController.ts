import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ACTIVE_CHAT_STORAGE_KEY,
  DEFAULT_MEMORY_MODEL,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  EMPTY_MEMORY_SNAPSHOT,
  EMPTY_TASK_CONTEXT,
  MEMORY_MODEL_STORAGE_KEY,
  MODEL_CONTEXT_WINDOW,
  MODEL_OPTIONS,
  MODEL_REASONING_OPTIONS,
  SYSTEM_PROMPT_STORAGE_KEY,
  type ChatMemorySnapshot,
  type ChatMessage,
  type ChatSummary,
  type FullScreenView,
  type HistoryTotals,
  type LongTermMemory,
  type ReasoningEffort,
  type RunMetrics,
  type Status,
  type TaskCommandRequest,
  type TaskArtifactDraftStatus,
  type TaskContext,
  type TurnGrowthRow,
  type UserProfile,
  type WorkingMemory,
} from "../domain/chat";
import { chatApi } from "../infrastructure/chatApi";
import { formatNumber, formatUsd } from "../shared/format";
import { createId } from "../shared/id";
import { parseJsonSafe, prettyJsonText } from "../shared/json";

const loadStoredSystemPrompt = (): string => {
  const LEGACY_DEFAULT_SYSTEM_PROMPT = "You are a concise assistant.";
  if (typeof window === "undefined") {
    return DEFAULT_SYSTEM_PROMPT;
  }
  const stored = localStorage.getItem(SYSTEM_PROMPT_STORAGE_KEY);
  const normalized = stored?.trim() ?? "";
  if (!normalized || normalized === LEGACY_DEFAULT_SYSTEM_PROMPT) {
    return DEFAULT_SYSTEM_PROMPT;
  }
  return normalized;
};

const MODEL_VALUES: Set<string> = new Set(MODEL_OPTIONS.map((option) => option.value));

const loadStoredMemoryModel = (): string => {
  if (typeof window === "undefined") {
    return DEFAULT_MEMORY_MODEL;
  }
  const stored = localStorage.getItem(MEMORY_MODEL_STORAGE_KEY)?.trim() ?? "";
  if (!stored || !MODEL_VALUES.has(stored)) {
    return DEFAULT_MEMORY_MODEL;
  }
  return stored;
};

const extractRawApiPayload = (payload: unknown): unknown => {
  const candidate =
    payload && typeof payload === "object"
      ? (payload as {
          upstreamLastPayload?: unknown;
          raw?: unknown;
          error?: unknown;
        })
      : undefined;
  if (candidate?.upstreamLastPayload) {
    return candidate.upstreamLastPayload;
  }
  if (candidate?.raw) {
    return candidate.raw;
  }
  if (candidate?.error && typeof candidate.error === "object") {
    return candidate.error;
  }
  return payload;
};

const deriveTaskDraftMeta = (
  task: TaskContext
): { status: TaskArtifactDraftStatus; error: string } => {
  if (!task.draftArtifactText) {
    return {
      status: "missing",
      error: "No draft artifact from assistant yet for this stage.",
    };
  }
  if (task.draftArtifactState !== task.state || task.draftArtifactStep !== task.step) {
    return {
      status: "invalid",
      error: "Stored draft artifact does not match current state/step.",
    };
  }
  return {
    status: "valid",
    error: "",
  };
};

const shouldAutoStartAfterTaskCommand = (command: TaskCommandRequest["command"]): boolean =>
  command === "approve_plan" || command === "complete_step" || command === "request_rework";

const buildTaskAutoPrompt = (task: TaskContext): string =>
  `[AUTO] Continue current stage: ${task.state}, step ${task.step}/${task.total}. Follow TASK_STATE and TASK_STAGE_RULES.`;

export type ChatController = ReturnType<typeof useChatController>;

type ProfileDraft = {
  name: string;
  style: string;
  outputFormat: string;
  constraints: string;
  notes: string;
};

const EMPTY_PROFILE_DRAFT: ProfileDraft = {
  name: "",
  style: "",
  outputFormat: "",
  constraints: "",
  notes: "",
};

export function useChatController() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memory, setMemory] = useState<ChatMemorySnapshot>({ ...EMPTY_MEMORY_SNAPSHOT });
  const [taskContext, setTaskContext] = useState<TaskContext>({ ...EMPTY_TASK_CONTEXT });
  const [taskDraftStatus, setTaskDraftStatus] = useState<TaskArtifactDraftStatus>("missing");
  const [taskDraftError, setTaskDraftError] = useState("");
  const [isTaskCommandPending, setIsTaskCommandPending] = useState(false);
  const [pendingAutoPrompt, setPendingAutoPrompt] = useState<string | null>(null);
  const [effectiveMemoryBlock, setEffectiveMemoryBlock] = useState("");
  const [userPrompt, setUserPrompt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");

  const [model, setModel] = useState(DEFAULT_MODEL);
  const [systemPrompt, setSystemPrompt] = useState(loadStoredSystemPrompt);
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("low");
  const [memoryModel, setMemoryModel] = useState(loadStoredMemoryModel);

  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [requestRaw, setRequestRaw] = useState("");
  const [responseRaw, setResponseRaw] = useState("");
  const [overflowErrorRaw, setOverflowErrorRaw] = useState("");

  const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false);
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [isProfilesOpen, setIsProfilesOpen] = useState(false);
  const [isConversationInfoOpen, setIsConversationInfoOpen] = useState(false);
  const [fullScreenView, setFullScreenView] = useState<FullScreenView>(null);
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>({ ...EMPTY_PROFILE_DRAFT });
  const [isProfilesSaving, setIsProfilesSaving] = useState(false);
  const [shortTermEnabled, setShortTermEnabledState] = useState(true);
  const [workingEnabled, setWorkingEnabledState] = useState(true);
  const [longTermEnabled, setLongTermEnabledState] = useState(true);
  const [isMemorySettingsSaving, setIsMemorySettingsSaving] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const modelRef = useRef(model);

  useEffect(() => {
    modelRef.current = model;
  }, [model]);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [chats, activeChatId]
  );
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId]
  );

  const activeModelLabel = useMemo(
    () => MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model,
    [model]
  );
  const activeProfileLabel = useMemo(
    () => profiles.find((profile) => profile.id === activeProfileId)?.name ?? "Не выбран",
    [profiles, activeProfileId]
  );

  const isStreaming = status === "streaming";
  const reasoningOptions = MODEL_REASONING_OPTIONS[model] ?? [];
  const isReasoningSupported = reasoningOptions.length > 0;

  const historyTotals = useMemo<HistoryTotals>(() => {
    return messages.reduce<HistoryTotals>(
      (acc, message) => {
        if (message.role !== "assistant") {
          return acc;
        }
        return {
          inputTokens: acc.inputTokens + (message.inputTokens ?? 0),
          outputTokens: acc.outputTokens + (message.outputTokens ?? 0),
          totalTokens: acc.totalTokens + (message.totalTokens ?? 0),
          costUsd: Number((acc.costUsd + (message.costUsd ?? 0)).toFixed(8)),
        };
      },
      {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      }
    );
  }, [messages]);

  const turnRows = useMemo<TurnGrowthRow[]>(() => {
    const rows: TurnGrowthRow[] = [];
    let cumulativeTotalTokens = 0;
    let cumulativeCostUsd = 0;

    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }

      cumulativeTotalTokens += message.totalTokens ?? 0;
      cumulativeCostUsd = Number((cumulativeCostUsd + (message.costUsd ?? 0)).toFixed(8));

      rows.push({
        turnIndex: rows.length + 1,
        inputTokens: message.inputTokens,
        outputTokens: message.outputTokens,
        totalTokens: message.totalTokens,
        costUsd: message.costUsd,
        cumulativeTotalTokens,
        cumulativeCostUsd,
        latencyMs: message.latencyMs,
      });
    }

    return rows;
  }, [messages]);

  const currentContextTokens = useMemo<number | null>(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant" && typeof message.totalTokens === "number") {
        return message.totalTokens;
      }
    }
    return null;
  }, [messages]);

  const maxContextTokens = MODEL_CONTEXT_WINDOW[model] ?? null;

  const selectChat = useCallback((chatId: string) => {
    setActiveChatId(chatId);
    localStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, chatId);
  }, []);

  const hydrateMessages = useCallback(
    (nextMessages: ChatMessage[]) => {
      setMessages(nextMessages);

      const latestWithDebug = [...nextMessages]
        .reverse()
        .find((item) => item.role === "assistant" && (item.requestJson || item.responseJson));

      setRequestRaw(prettyJsonText(latestWithDebug?.requestJson));
      setResponseRaw(prettyJsonText(latestWithDebug?.responseJson));
      setOverflowErrorRaw("");

      const latestAssistant = [...nextMessages].reverse().find((item) => item.role === "assistant");
      if (!latestAssistant) {
        setMetrics(null);
        return;
      }

      setMetrics({
        model: activeChat?.model ?? model,
        latencyMs: latestAssistant.latencyMs,
        inputTokens: latestAssistant.inputTokens,
        outputTokens: latestAssistant.outputTokens,
        totalTokens: latestAssistant.totalTokens,
        costUsd: latestAssistant.costUsd,
        inputCostUsd: latestAssistant.inputCostUsd,
        outputCostUsd: latestAssistant.outputCostUsd,
      });
    },
    [activeChat?.model, model]
  );

  const loadMessages = useCallback(
    async (chatId: string) => {
      const { messages: nextMessages, isNotFound } = await chatApi.getMessages(chatId);
      if (isNotFound) {
        setMessages([]);
        setRequestRaw("");
        setResponseRaw("");
        setOverflowErrorRaw("");
        setMetrics(null);
        return;
      }
      hydrateMessages(nextMessages);
    },
    [hydrateMessages]
  );

  const loadMemory = useCallback(async (chatId: string) => {
    const { memory: nextMemory, isNotFound } = await chatApi.getMemory(chatId);
    if (isNotFound) {
      setMemory({ ...EMPTY_MEMORY_SNAPSHOT });
      setEffectiveMemoryBlock("");
      return;
    }
    setMemory(nextMemory);
  }, []);

  const loadTaskState = useCallback(async (chatId: string) => {
    const { task, isNotFound } = await chatApi.getTaskState(chatId);
    if (isNotFound) {
      const fallbackTask = { ...EMPTY_TASK_CONTEXT };
      const draftMeta = deriveTaskDraftMeta(fallbackTask);
      setTaskContext(fallbackTask);
      setTaskDraftStatus(draftMeta.status);
      setTaskDraftError(draftMeta.error);
      return;
    }
    setTaskContext(task);
    const draftMeta = deriveTaskDraftMeta(task);
    setTaskDraftStatus(draftMeta.status);
    setTaskDraftError(draftMeta.error);
  }, []);

  const loadProfiles = useCallback(async () => {
    const payload = await chatApi.listProfiles();
    setProfiles(payload.profiles);
    setActiveProfileId(payload.activeProfileId);
    setSelectedProfileId((prev) => {
      if (prev && payload.profiles.some((profile) => profile.id === prev)) {
        return prev;
      }
      if (payload.activeProfileId && payload.profiles.some((profile) => profile.id === payload.activeProfileId)) {
        return payload.activeProfileId;
      }
      return payload.profiles[0]?.id ?? null;
    });
  }, []);

  const loadMemorySettings = useCallback(async () => {
    const settings = await chatApi.getMemorySettings();
    setShortTermEnabledState(settings.shortTermEnabled);
    setWorkingEnabledState(settings.workingEnabled);
    setLongTermEnabledState(settings.longTermEnabled);
  }, []);

  const loadChats = useCallback(async () => {
    const listed = await chatApi.listChats();

    if (listed.length === 0) {
      const created = await chatApi.createChat({ model: modelRef.current });
      setChats([created]);
      selectChat(created.id);
      setModel(created.model);
      await Promise.all([loadMessages(created.id), loadMemory(created.id), loadTaskState(created.id)]);
      return;
    }

    setChats(listed);

    const savedId = localStorage.getItem(ACTIVE_CHAT_STORAGE_KEY);
    const nextActiveId =
      (savedId && listed.some((chat) => chat.id === savedId) ? savedId : null) ??
      (activeChatId && listed.some((chat) => chat.id === activeChatId) ? activeChatId : null) ??
      listed[0].id;

    selectChat(nextActiveId);
    const selected = listed.find((chat) => chat.id === nextActiveId) ?? listed[0];
    setModel(selected.model);
    await Promise.all([loadMessages(selected.id), loadMemory(selected.id), loadTaskState(selected.id)]);
  }, [activeChatId, loadMemory, loadMessages, loadTaskState, selectChat]);

  const createChat = useCallback(async () => {
    const chat = await chatApi.createChat({ model });
    setChats((prev) => [chat, ...prev]);
    selectChat(chat.id);
    setMessages([]);
    setMemory({ ...EMPTY_MEMORY_SNAPSHOT });
    const fallbackTask = { ...EMPTY_TASK_CONTEXT };
    const draftMeta = deriveTaskDraftMeta(fallbackTask);
    setTaskContext(fallbackTask);
    setTaskDraftStatus(draftMeta.status);
    setTaskDraftError(draftMeta.error);
    setEffectiveMemoryBlock("");
    setMetrics(null);
    setRequestRaw("");
    setResponseRaw("");
    setOverflowErrorRaw("");
    setModel(chat.model);
  }, [model, selectChat]);

  const deleteChat = useCallback(
    async (chatId: string) => {
      await chatApi.deleteChat(chatId);
      await loadChats();
    },
    [loadChats]
  );

  const branchInNewChat = useCallback(async () => {
    if (!activeChatId || isStreaming) {
      return;
    }

    try {
      const branched = await chatApi.branchChat(activeChatId);
      setChats((prev) => [branched, ...prev.filter((chat) => chat.id !== branched.id)]);
      selectChat(branched.id);
      setModel(branched.model);
      setErrorText("");
      setStatus("idle");
      await Promise.all([loadMessages(branched.id), loadMemory(branched.id), loadTaskState(branched.id)]);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to branch chat");
      setStatus("error");
    }
  }, [activeChatId, isStreaming, loadMemory, loadMessages, loadTaskState, selectChat]);

  const openBranchSourceChat = useCallback(
    (sourceChatId: string) => {
      if (!sourceChatId) {
        return;
      }
      const hasSource = chats.some((chat) => chat.id === sourceChatId);
      if (!hasSource) {
        setErrorText("Source chat is not available.");
        setStatus("error");
        return;
      }
      selectChat(sourceChatId);
      setErrorText("");
      setStatus("idle");
    },
    [chats, selectChat]
  );

  const patchChat = useCallback(
    async (
      chatId: string,
      body: Partial<{
        title: string;
        model: string;
      }>
    ) => {
      const updated = await chatApi.updateChat(chatId, body);
      setChats((prev) => prev.map((chat) => (chat.id === updated.id ? { ...chat, ...updated } : chat)));
    },
    []
  );

  const handleModelChange = useCallback(
    async (nextModel: string) => {
      setModel(nextModel);
      if (!activeChatId) {
        return;
      }
      try {
        await patchChat(activeChatId, { model: nextModel });
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Failed to update model");
        setStatus("error");
      }
    },
    [activeChatId, patchChat]
  );

  const handleMemoryModelChange = useCallback((nextMemoryModel: string) => {
    if (!MODEL_VALUES.has(nextMemoryModel)) {
      return;
    }
    setMemoryModel(nextMemoryModel);
  }, []);

  const saveWorkingMemory = useCallback(
    async (body: Partial<Pick<WorkingMemory, "goal" | "constraints" | "status" | "nextSteps">>) => {
      if (!activeChatId || !workingEnabled) {
        return;
      }
      try {
        await chatApi.patchWorkingMemory(activeChatId, body);
        const { memory: nextMemory } = await chatApi.getMemory(activeChatId);
        setMemory(nextMemory);
        setErrorText("");
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Failed to update working memory");
        setStatus("error");
      }
    },
    [activeChatId, workingEnabled]
  );

  const saveLongTermMemory = useCallback(
    async (body: Partial<Pick<LongTermMemory, "profile" | "preferences" | "decisions" | "knowledge">>) => {
      if (!activeChatId || !longTermEnabled) {
        return;
      }
      try {
        await chatApi.patchLongTermMemory(body);
        const { memory: nextMemory } = await chatApi.getMemory(activeChatId);
        setMemory(nextMemory);
        setErrorText("");
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Failed to update long-term memory");
        setStatus("error");
      }
    },
    [activeChatId, longTermEnabled]
  );

  const updateMemorySettings = useCallback(
    async (patch: { shortTermEnabled?: boolean; workingEnabled?: boolean; longTermEnabled?: boolean }) => {
      setIsMemorySettingsSaving(true);
      try {
        const settings = await chatApi.patchMemorySettings(patch);
        setShortTermEnabledState(settings.shortTermEnabled);
        setWorkingEnabledState(settings.workingEnabled);
        setLongTermEnabledState(settings.longTermEnabled);
        setErrorText("");
        setStatus("idle");
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Failed to update memory settings");
        setStatus("error");
      } finally {
        setIsMemorySettingsSaving(false);
      }
    },
    []
  );

  const setShortTermEnabled = useCallback(async (nextValue: boolean) => {
    await updateMemorySettings({ shortTermEnabled: nextValue });
  }, [updateMemorySettings]);

  const setWorkingEnabled = useCallback(async (nextValue: boolean) => {
    await updateMemorySettings({ workingEnabled: nextValue });
  }, [updateMemorySettings]);

  const setLongTermEnabled = useCallback(async (nextValue: boolean) => {
    await updateMemorySettings({ longTermEnabled: nextValue });
  }, [updateMemorySettings]);

  const approveCandidate = useCallback(
    async (candidateId: string) => {
      if (!activeChatId) {
        return;
      }
      try {
        await chatApi.approveCandidate(candidateId);
        const { memory: nextMemory } = await chatApi.getMemory(activeChatId);
        setMemory(nextMemory);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Failed to approve candidate");
        setStatus("error");
      }
    },
    [activeChatId]
  );

  const rejectCandidate = useCallback(
    async (candidateId: string) => {
      if (!activeChatId) {
        return;
      }
      try {
        await chatApi.rejectCandidate(candidateId);
        const { memory: nextMemory } = await chatApi.getMemory(activeChatId);
        setMemory(nextMemory);
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Failed to reject candidate");
        setStatus("error");
      }
    },
    [activeChatId]
  );

  const sendTaskCommand = useCallback(
    async (body: TaskCommandRequest) => {
      if (!activeChatId || isTaskCommandPending) {
        return;
      }
      setPendingAutoPrompt(null);
      setIsTaskCommandPending(true);
      try {
        const nextTask = await chatApi.sendTaskCommand(activeChatId, body);
        setTaskContext(nextTask);
        const draftMeta = deriveTaskDraftMeta(nextTask);
        setTaskDraftStatus(draftMeta.status);
        setTaskDraftError(draftMeta.error);
        const shouldAutoStart =
          !isStreaming &&
          shouldAutoStartAfterTaskCommand(body.command) &&
          !nextTask.paused &&
          nextTask.expectedAction !== "none" &&
          nextTask.expectedAction !== "resume";
        if (shouldAutoStart) {
          setPendingAutoPrompt(buildTaskAutoPrompt(nextTask));
        }
        setErrorText("");
        setStatus("idle");
      } catch (error) {
        const payload = (error as { payload?: unknown } | null)?.payload;
        const nextTask =
          payload && typeof payload === "object" && payload !== null
            ? (payload as { task?: TaskContext }).task
            : undefined;
        if (nextTask && typeof nextTask === "object") {
          setTaskContext(nextTask);
          const draftMeta = deriveTaskDraftMeta(nextTask);
          setTaskDraftStatus(draftMeta.status);
          setTaskDraftError(draftMeta.error);
        }
        setErrorText(error instanceof Error ? error.message : "Failed to update task state");
        setStatus("error");
      } finally {
        setIsTaskCommandPending(false);
      }
    },
    [activeChatId, isStreaming, isTaskCommandPending]
  );

  const pauseTask = useCallback(
    async (reason?: string) => {
      await sendTaskCommand({ command: "pause", reason });
    },
    [sendTaskCommand]
  );

  const resumeTask = useCallback(async () => {
    await sendTaskCommand({ command: "resume" });
  }, [sendTaskCommand]);

  const approvePlan = useCallback(
    async (artifactText: string, isEdited: boolean, plan?: string[]) => {
      const payload: TaskCommandRequest = {
        command: "approve_plan",
        plan,
      };
      if (isEdited) {
        payload.artifactText = artifactText;
      }
      await sendTaskCommand(payload);
    },
    [sendTaskCommand]
  );

  const completeStep = useCallback(
    async (artifactText: string, isEdited: boolean) => {
      const payload: TaskCommandRequest = {
        command: "complete_step",
      };
      if (isEdited) {
        payload.artifactText = artifactText;
      }
      await sendTaskCommand(payload);
    },
    [sendTaskCommand]
  );

  const approveValidation = useCallback(
    async (artifactText: string, isEdited: boolean) => {
      const payload: TaskCommandRequest = {
        command: "approve_validation",
      };
      if (isEdited) {
        payload.artifactText = artifactText;
      }
      await sendTaskCommand(payload);
    },
    [sendTaskCommand]
  );

  const requestReplan = useCallback(
    async (reason?: string) => {
      await sendTaskCommand({ command: "request_replan", reason });
    },
    [sendTaskCommand]
  );

  const requestRework = useCallback(
    async (reason?: string) => {
      await sendTaskCommand({ command: "request_rework", reason });
    },
    [sendTaskCommand]
  );

  const openProfiles = useCallback(() => {
    void loadProfiles().catch((error: unknown) => {
      setErrorText(error instanceof Error ? error.message : "Failed to load profiles");
      setStatus("error");
    });
    setIsProfilesOpen(true);
    setSelectedProfileId((prev) => prev ?? activeProfileId ?? profiles[0]?.id ?? null);
  }, [activeProfileId, loadProfiles, profiles]);

  const closeProfiles = useCallback(() => {
    setIsProfilesOpen(false);
  }, []);

  const selectProfile = useCallback((profileId: string) => {
    setSelectedProfileId(profileId);
  }, []);

  const createProfile = useCallback(async () => {
    setIsProfilesSaving(true);
    try {
      const { profile, activeProfileId: nextActiveProfileId } = await chatApi.createProfile("New profile");
      setProfiles((prev) => [profile, ...prev.filter((item) => item.id !== profile.id)]);
      setActiveProfileId(nextActiveProfileId);
      setSelectedProfileId(profile.id);
      setErrorText("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to create profile");
      setStatus("error");
    } finally {
      setIsProfilesSaving(false);
    }
  }, []);

  const saveProfile = useCallback(async () => {
    if (!selectedProfileId) {
      return;
    }
    setIsProfilesSaving(true);
    try {
      const updated = await chatApi.updateProfile(selectedProfileId, profileDraft);
      setProfiles((prev) => prev.map((profile) => (profile.id === updated.id ? updated : profile)));
      setErrorText("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to save profile");
      setStatus("error");
    } finally {
      setIsProfilesSaving(false);
    }
  }, [profileDraft, selectedProfileId]);

  const deleteProfile = useCallback(
    async (profileId: string) => {
      setIsProfilesSaving(true);
      try {
        const { activeProfileId: nextActiveProfileId } = await chatApi.deleteProfile(profileId);
        setProfiles((prev) => prev.filter((profile) => profile.id !== profileId));
        setActiveProfileId(nextActiveProfileId);
        setSelectedProfileId((prev) => {
          if (prev !== profileId) {
            return prev;
          }
          if (nextActiveProfileId) {
            return nextActiveProfileId;
          }
          const remaining = profiles.filter((profile) => profile.id !== profileId);
          return remaining[0]?.id ?? null;
        });
        setErrorText("");
      } catch (error) {
        setErrorText(error instanceof Error ? error.message : "Failed to delete profile");
        setStatus("error");
      } finally {
        setIsProfilesSaving(false);
      }
    },
    [profiles]
  );

  const setActiveProfile = useCallback(async (profileId: string | null) => {
    setIsProfilesSaving(true);
    try {
      const { activeProfileId: nextActiveProfileId } = await chatApi.setActiveProfile(profileId);
      setActiveProfileId(nextActiveProfileId);
      if (nextActiveProfileId) {
        setSelectedProfileId(nextActiveProfileId);
      }
      setErrorText("");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to set active profile");
      setStatus("error");
    } finally {
      setIsProfilesSaving(false);
    }
  }, []);

  const stopStreaming = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus((prev) => (prev === "streaming" ? "stopped" : prev));
  }, []);

  const runStreamWithPrompt = useCallback(
    async (promptTextRaw: string, options?: { clearComposer?: boolean }) => {
      const promptText = promptTextRaw.trim();
      if (!activeChatId || isStreaming || !promptText) {
        return;
      }

      setStatus("streaming");
      setErrorText("");

      const userMessage: ChatMessage = {
        id: createId(),
        chatId: activeChatId,
        role: "user",
        content: promptText,
        requestJson: null,
        responseJson: null,
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        inputCostUsd: null,
        outputCostUsd: null,
        createdAt: Date.now(),
      };

      const assistantMessageId = createId();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        chatId: activeChatId,
        role: "assistant",
        content: "",
        requestJson: null,
        responseJson: null,
        latencyMs: null,
        inputTokens: null,
        outputTokens: null,
        totalTokens: null,
        costUsd: null,
        inputCostUsd: null,
        outputCostUsd: null,
        createdAt: Date.now(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      if (options?.clearComposer) {
        setUserPrompt("");
      }

      const controller = new AbortController();
      controllerRef.current = controller;

      try {
        const response = await chatApi.streamChat(
          activeChatId,
          {
            userPrompt: promptText,
            model,
            systemPrompt,
            reasoningEffort: isReasoningSupported ? reasoningEffort : undefined,
            memoryModel,
          },
          controller.signal
        );

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("Streaming reader is unavailable");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let eventName = "message";
        let hasStreamError = false;
        let hasApiResponsePayload = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            const lines = block.split("\n");
            const dataLines: string[] = [];

            for (const line of lines) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              }
              if (line.startsWith("data:")) {
                dataLines.push(line.slice(5).trim());
              }
            }

            if (dataLines.length === 0) {
              continue;
            }

            const payload = parseJsonSafe<any>(dataLines.join("\n"));
            if (!payload) {
              continue;
            }

            if (eventName === "delta") {
              const delta = payload.text ?? "";
              setMessages((prev) =>
                prev.map((message) =>
                  message.id === assistantMessageId
                    ? {
                        ...message,
                        content: `${message.content}${delta}`,
                      }
                    : message
                )
              );
            }

            if (eventName === "debug_request") {
              setRequestRaw(JSON.stringify(payload.body ?? {}, null, 2));
            }

            if (eventName === "debug_response_final") {
              setResponseRaw(JSON.stringify(payload.body ?? {}, null, 2));
              hasApiResponsePayload = true;
            }

            if (eventName === "debug_memory") {
              const nextMemory = payload.snapshot as ChatMemorySnapshot | undefined;
              if (nextMemory && typeof nextMemory === "object") {
                setMemory(nextMemory);
              }
              const nextTask = payload.task as TaskContext | undefined;
              if (nextTask && typeof nextTask === "object") {
                setTaskContext(nextTask);
                const fallbackDraftMeta = deriveTaskDraftMeta(nextTask);
                const nextStatus =
                  payload.taskDraftStatus === "valid" ||
                  payload.taskDraftStatus === "invalid" ||
                  payload.taskDraftStatus === "missing"
                    ? (payload.taskDraftStatus as TaskArtifactDraftStatus)
                    : fallbackDraftMeta.status;
                const nextError =
                  typeof payload.taskDraftError === "string"
                    ? payload.taskDraftError
                    : nextStatus === "valid"
                    ? ""
                    : fallbackDraftMeta.error;
                setTaskDraftStatus(nextStatus);
                setTaskDraftError(nextError);
              }
              setEffectiveMemoryBlock(typeof payload.memoryBlock === "string" ? payload.memoryBlock : "");
              if (typeof payload.shortTermEnabled === "boolean") {
                setShortTermEnabledState(payload.shortTermEnabled);
              }
              if (typeof payload.workingEnabled === "boolean") {
                setWorkingEnabledState(payload.workingEnabled);
              }
              if (typeof payload.longTermEnabled === "boolean") {
                setLongTermEnabledState(payload.longTermEnabled);
              }
            }

            if (eventName === "error") {
              hasStreamError = true;
              setStatus("error");
              setResponseRaw(JSON.stringify(payload, null, 2));
              hasApiResponsePayload = true;
              const code = typeof payload.code === "string" ? payload.code : "";
              const nestedCode =
                typeof payload?.upstreamLastPayload?.response?.error?.code === "string"
                  ? payload.upstreamLastPayload.response.error.code
                  : "";
              const nestedMessage =
                typeof payload?.upstreamLastPayload?.response?.error?.message === "string"
                  ? payload.upstreamLastPayload.response.error.message
                  : "";
              const isContextOverflow =
                payload.isContextOverflow === true ||
                code.toLowerCase() === "context_length_exceeded" ||
                nestedCode.toLowerCase() === "context_length_exceeded";
              const apiMessage =
                nestedMessage || (typeof payload.message === "string" ? payload.message : "Unknown error");
              if (isContextOverflow) {
                setOverflowErrorRaw(JSON.stringify(extractRawApiPayload(payload), null, 2));
                setErrorText("");
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === assistantMessageId
                      ? {
                          ...message,
                          content: message.content || `[Context limit reached] ${apiMessage}`,
                        }
                      : message
                  )
                );
              } else {
                setOverflowErrorRaw("");
                setErrorText("");
                setMessages((prev) =>
                  prev.map((message) =>
                    message.id === assistantMessageId
                      ? {
                          ...message,
                          content: message.content || `[API error] ${apiMessage}`,
                        }
                      : message
                  )
                );
              }
            }

            if (eventName === "done") {
              if (!hasApiResponsePayload) {
                setResponseRaw(JSON.stringify(payload, null, 2));
                hasApiResponsePayload = true;
              }
              const doneTask = payload.task as TaskContext | undefined;
              if (doneTask && typeof doneTask === "object") {
                setTaskContext(doneTask);
                const fallbackDraftMeta = deriveTaskDraftMeta(doneTask);
                const nextStatus =
                  payload.taskDraftStatus === "valid" ||
                  payload.taskDraftStatus === "invalid" ||
                  payload.taskDraftStatus === "missing"
                    ? (payload.taskDraftStatus as TaskArtifactDraftStatus)
                    : fallbackDraftMeta.status;
                const nextError =
                  typeof payload.taskDraftError === "string"
                    ? payload.taskDraftError
                    : nextStatus === "valid"
                    ? ""
                    : fallbackDraftMeta.error;
                setTaskDraftStatus(nextStatus);
                setTaskDraftError(nextError);
              }
              const usage = payload?.metrics?.usage;
              const nextMetrics: RunMetrics = {
                model: payload?.metrics?.model ?? model,
                latencyMs:
                  typeof payload?.metrics?.latencyMs === "number" ? payload.metrics.latencyMs : null,
                inputTokens: typeof usage?.inputTokens === "number" ? usage.inputTokens : null,
                outputTokens: typeof usage?.outputTokens === "number" ? usage.outputTokens : null,
                totalTokens: typeof usage?.totalTokens === "number" ? usage.totalTokens : null,
                costUsd: typeof payload?.metrics?.costUsd === "number" ? payload.metrics.costUsd : null,
                inputCostUsd:
                  typeof payload?.metrics?.inputCostUsd === "number" ? payload.metrics.inputCostUsd : null,
                outputCostUsd:
                  typeof payload?.metrics?.outputCostUsd === "number" ? payload.metrics.outputCostUsd : null,
              };
              setMetrics(nextMetrics);
              setStatus((prev) => (prev === "streaming" ? "done" : prev));
            }

            eventName = "message";
          }
        }

        if (hasStreamError) {
          return;
        }

        setStatus((prev) => (prev === "streaming" ? "done" : prev));
        await Promise.all([loadChats(), loadMessages(activeChatId), loadMemory(activeChatId), loadTaskState(activeChatId)]);
      } catch (error) {
        if (controller.signal.aborted) {
          setStatus("stopped");
        } else {
          const fallbackMessage = error instanceof Error ? error.message : "Unexpected error";
          const payload = (error as { payload?: unknown; status?: number } | null)?.payload;
          const statusCode = (error as { payload?: unknown; status?: number } | null)?.status;
          const payloadText = payload
            ? JSON.stringify(payload, null, 2)
            : JSON.stringify({ message: fallbackMessage }, null, 2);
          setResponseRaw(payloadText);

          const payloadCandidate =
            payload && typeof payload === "object"
              ? (payload as { error?: unknown; code?: unknown; message?: unknown; task?: unknown })
              : undefined;
          const payloadTask =
            payloadCandidate &&
            typeof payloadCandidate.task === "object" &&
            payloadCandidate.task !== null
              ? (payloadCandidate.task as TaskContext)
              : undefined;
          if (payloadTask) {
            setTaskContext(payloadTask);
            const draftMeta = deriveTaskDraftMeta(payloadTask);
            setTaskDraftStatus(draftMeta.status);
            setTaskDraftError(draftMeta.error);
          }
          const nestedError =
            payloadCandidate &&
            typeof payloadCandidate.error === "object" &&
            payloadCandidate.error !== null
              ? (payloadCandidate.error as { code?: unknown; message?: unknown })
              : undefined;

          const code =
            typeof nestedError?.code === "string"
              ? nestedError.code
              : typeof payloadCandidate?.code === "string"
              ? payloadCandidate.code
              : "";
          const message =
            typeof nestedError?.message === "string"
              ? nestedError.message
              : typeof payloadCandidate?.message === "string"
              ? payloadCandidate.message
              : fallbackMessage;

          if (statusCode === 409 && payloadTask?.paused) {
            setOverflowErrorRaw("");
            setErrorText(message || "Task is paused. Resume it to continue.");
            setMessages((prev) =>
              prev.map((chatMessage) =>
                chatMessage.id === assistantMessageId
                  ? {
                      ...chatMessage,
                      content: chatMessage.content || "[Task paused] Resume the task and try again.",
                    }
                  : chatMessage
              )
            );
            setStatus("stopped");
            return;
          }

          setStatus("error");
          const messageLower = message.toLowerCase();
          const isContextOverflow =
            code.toLowerCase() === "context_length_exceeded" ||
            messageLower.includes("context_length_exceeded") ||
            messageLower.includes("maximum context length") ||
            messageLower.includes("too many tokens");

          if (isContextOverflow) {
            setOverflowErrorRaw(JSON.stringify(extractRawApiPayload(payload), null, 2));
            setErrorText("");
          } else {
            setOverflowErrorRaw("");
            setErrorText("");
          }

          setMessages((prev) =>
            prev.map((chatMessage) =>
              chatMessage.id === assistantMessageId
                ? {
                    ...chatMessage,
                    content: chatMessage.content || `[API error] ${message}`,
                  }
                : chatMessage
            )
          );
        }
      } finally {
        controllerRef.current = null;
      }
    },
    [
      activeChatId,
      isStreaming,
      isReasoningSupported,
      loadChats,
      loadMemory,
      loadTaskState,
      loadMessages,
      memoryModel,
      model,
      reasoningEffort,
      systemPrompt,
    ]
  );

  const sendMessage = useCallback(async () => {
    await runStreamWithPrompt(userPrompt, { clearComposer: true });
  }, [runStreamWithPrompt, userPrompt]);

  useEffect(() => {
    if (!pendingAutoPrompt || isStreaming) {
      return;
    }
    const autoPrompt = pendingAutoPrompt;
    setPendingAutoPrompt(null);
    void runStreamWithPrompt(autoPrompt);
  }, [isStreaming, pendingAutoPrompt, runStreamWithPrompt]);

  const handleMainAction = useCallback(() => {
    if (isStreaming) {
      stopStreaming();
      return;
    }
    void sendMessage();
  }, [isStreaming, sendMessage, stopStreaming]);

  const handlePromptKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey) {
        return;
      }
      event.preventDefault();
      void sendMessage();
    },
    [sendMessage]
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    void Promise.all([loadChats(), loadProfiles(), loadMemorySettings()]).catch((error: unknown) => {
      setErrorText(error instanceof Error ? error.message : "Failed to initialize");
      setStatus("error");
    });
  }, [loadChats, loadProfiles, loadMemorySettings]);

  useEffect(() => {
    if (!activeChat) {
      return;
    }
    setModel(activeChat.model);
    if (isReasoningSupported && !reasoningOptions.includes(reasoningEffort)) {
      setReasoningEffort(reasoningOptions[0] ?? "low");
    }
  }, [activeChat, isReasoningSupported, reasoningEffort, reasoningOptions]);

  useEffect(() => {
    if (!selectedProfile) {
      setProfileDraft({ ...EMPTY_PROFILE_DRAFT });
      return;
    }
    setProfileDraft({
      name: selectedProfile.name,
      style: selectedProfile.style,
      outputFormat: selectedProfile.outputFormat,
      constraints: selectedProfile.constraints,
      notes: selectedProfile.notes,
    });
  }, [selectedProfile]);

  useEffect(() => {
    localStorage.setItem(SYSTEM_PROMPT_STORAGE_KEY, systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    localStorage.setItem(MEMORY_MODEL_STORAGE_KEY, memoryModel);
  }, [memoryModel]);

  useEffect(() => {
    if (!activeChatId) {
      return;
    }
    void Promise.all([loadMessages(activeChatId), loadMemory(activeChatId), loadTaskState(activeChatId)]).catch((error: unknown) => {
      setErrorText(error instanceof Error ? error.message : "Failed to load chat state");
      setStatus("error");
    });
  }, [activeChatId, loadMemory, loadMessages, loadTaskState]);

  return {
    view: {
      chats,
      activeChatId,
      messages,
      memory,
      taskContext,
      taskDraftStatus,
      taskDraftError,
      isTaskCommandPending,
      effectiveMemoryBlock,
      userPrompt,
      status,
      errorText,
      model,
      systemPrompt,
      reasoningEffort,
      memoryModel,
      metrics,
      requestRaw,
      responseRaw,
      overflowErrorRaw,
      isModelSettingsOpen,
      isSystemPromptOpen,
      isProfilesOpen,
      isConversationInfoOpen,
      fullScreenView,
      profiles,
      activeProfileId,
      selectedProfileId,
      profileDraft,
      isProfilesSaving,
      shortTermEnabled,
      workingEnabled,
      longTermEnabled,
      isMemorySettingsSaving,
      activeModelLabel,
      activeProfileLabel,
      isStreaming,
      reasoningOptions,
      isReasoningSupported,
      historyTotals,
      turnRows,
      currentContextTokens,
      maxContextTokens,
      branchFromChatId: activeChat?.branchFromChatId ?? null,
      branchFromChatTitle: activeChat?.branchFromChatTitle ?? null,
      branchCheckpointMessageCount: activeChat?.branchCheckpointMessageCount ?? null,
      chatEndRef,
      formatNumber,
      formatUsd,
    },
    actions: {
      setUserPrompt,
      setSystemPrompt,
      setReasoningEffort,
      handleMemoryModelChange,
      setShortTermEnabled,
      setWorkingEnabled,
      setLongTermEnabled,
      saveWorkingMemory,
      saveLongTermMemory,
      pauseTask,
      resumeTask,
      approvePlan,
      completeStep,
      approveValidation,
      requestReplan,
      requestRework,
      approveCandidate,
      rejectCandidate,
      setIsModelSettingsOpen,
      setIsSystemPromptOpen,
      openProfiles,
      closeProfiles,
      createProfile,
      deleteProfile,
      selectProfile,
      setProfileDraft,
      saveProfile,
      setActiveProfile,
      setIsConversationInfoOpen,
      setFullScreenView,
      createChat,
      branchInNewChat,
      deleteChat,
      selectChat,
      openBranchSourceChat,
      handleModelChange,
      handleMainAction,
      handlePromptKeyDown,
    },
  };
}
