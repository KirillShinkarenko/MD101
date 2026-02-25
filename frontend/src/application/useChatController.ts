import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  ACTIVE_CHAT_STORAGE_KEY,
  DEFAULT_MODEL,
  DEFAULT_SYSTEM_PROMPT,
  MODEL_CONTEXT_WINDOW,
  MODEL_OPTIONS,
  MODEL_REASONING_OPTIONS,
  MODEL_TEMPERATURE_POLICY,
  SYSTEM_PROMPT_STORAGE_KEY,
  type ChatMessage,
  type ChatSummary,
  type FullScreenView,
  type HistoryTotals,
  type ReasoningEffort,
  type RunMetrics,
  type Status,
  type TurnGrowthRow,
} from "../domain/chat";
import { chatApi } from "../infrastructure/chatApi";
import { formatNumber, formatUsd } from "../shared/format";
import { createId } from "../shared/id";
import { parseJsonSafe, prettyJsonText } from "../shared/json";

const loadStoredSystemPrompt = (): string => {
  if (typeof window === "undefined") {
    return DEFAULT_SYSTEM_PROMPT;
  }
  const stored = localStorage.getItem(SYSTEM_PROMPT_STORAGE_KEY);
  return stored?.trim() || DEFAULT_SYSTEM_PROMPT;
};

const parseTemperature = (value: string): { value?: number; error?: string } => {
  const trimmed = value.trim();
  if (!trimmed) {
    return {};
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { error: "Temperature must be a valid number." };
  }
  if (parsed < 0 || parsed > 2) {
    return { error: "Temperature must be between 0 and 2." };
  }

  return { value: parsed };
};

const generateApprox5000TokenText = (): string => {
  const seed =
    "This is a generated long context block for stress testing token limits in the chat application. ";
  const targetChars = 20_000;
  let result = "";
  while (result.length < targetChars) {
    result += seed;
  }
  return result.slice(0, targetChars);
};

const generateOverflowPromptText = (): string => {
  const seed =
    "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega ";
  const targetChars = 150_000;
  let result = "";
  while (result.length < targetChars) {
    result += seed;
  }
  return result.slice(0, targetChars);
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

export type ChatController = ReturnType<typeof useChatController>;

export function useChatController() {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [userPrompt, setUserPrompt] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");

  const [model, setModel] = useState(DEFAULT_MODEL);
  const [systemPrompt, setSystemPrompt] = useState(loadStoredSystemPrompt);
  const [temperature, setTemperature] = useState("0.7");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("low");

  const [metrics, setMetrics] = useState<RunMetrics | null>(null);
  const [requestRaw, setRequestRaw] = useState("");
  const [responseRaw, setResponseRaw] = useState("");
  const [overflowErrorRaw, setOverflowErrorRaw] = useState("");

  const [isModelSettingsOpen, setIsModelSettingsOpen] = useState(false);
  const [isSystemPromptOpen, setIsSystemPromptOpen] = useState(false);
  const [isMetricsOpen, setIsMetricsOpen] = useState(false);
  const [fullScreenView, setFullScreenView] = useState<FullScreenView>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  const activeModelLabel = useMemo(
    () => MODEL_OPTIONS.find((option) => option.value === model)?.label ?? model,
    [model]
  );

  const isStreaming = status === "streaming";
  const temperaturePolicy = MODEL_TEMPERATURE_POLICY[model] ?? "always";
  const reasoningOptions = MODEL_REASONING_OPTIONS[model] ?? [];
  const isReasoningSupported = reasoningOptions.length > 0;
  const isTemperatureSupported =
    temperaturePolicy === "always" ||
    (temperaturePolicy === "reasoning_none_only" && reasoningEffort === "none");
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

  const loadChats = useCallback(async () => {
    const listed = await chatApi.listChats();

    if (listed.length === 0) {
      const created = await chatApi.createChat({ model });
      setChats([created]);
      selectChat(created.id);
      setModel(created.model);
      await loadMessages(created.id);
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
    await loadMessages(selected.id);
  }, [activeChatId, loadMessages, model, selectChat]);

  const createChat = useCallback(async () => {
    const chat = await chatApi.createChat({ model });
    setChats((prev) => [chat, ...prev]);
    selectChat(chat.id);
    setMessages([]);
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

  const patchChat = useCallback(async (chatId: string, body: Partial<{ title: string; model: string }>) => {
    const updated = await chatApi.updateChat(chatId, body);
    setChats((prev) => prev.map((chat) => (chat.id === updated.id ? { ...chat, ...updated } : chat)));
  }, []);

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

  const stopStreaming = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus((prev) => (prev === "streaming" ? "stopped" : prev));
  }, []);

  const sendMessage = useCallback(async () => {
    if (!activeChatId || isStreaming || !userPrompt.trim()) {
      return;
    }

    const parsedTemperature = parseTemperature(temperature);
    if (parsedTemperature.error) {
      setErrorText(parsedTemperature.error);
      setStatus("error");
      return;
    }

    setStatus("streaming");
    setErrorText("");

    const promptText = userPrompt.trim();
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
    setUserPrompt("");

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
          temperature: isTemperatureSupported ? parsedTemperature.value : undefined,
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
      await loadChats();
      await loadMessages(activeChatId);
    } catch (error) {
      if (controller.signal.aborted) {
        setStatus("stopped");
      } else {
        setStatus("error");
        const fallbackMessage = error instanceof Error ? error.message : "Unexpected error";
        const payload = (error as { payload?: unknown } | null)?.payload;
        const payloadText = payload
          ? JSON.stringify(payload, null, 2)
          : JSON.stringify({ message: fallbackMessage }, null, 2);
        setResponseRaw(payloadText);

        const payloadCandidate =
          payload && typeof payload === "object"
            ? (payload as { error?: unknown; code?: unknown; message?: unknown })
            : undefined;
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
  }, [
    activeChatId,
    isStreaming,
    isReasoningSupported,
    isTemperatureSupported,
    loadChats,
    loadMessages,
    model,
    reasoningEffort,
    systemPrompt,
    temperature,
    userPrompt,
  ]);

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

  const copyConversationText = useCallback(async () => {
    const transcript = messages
      .map((message) => `${message.role === "user" ? "You" : "Assistant"}:\n${message.content}`)
      .join("\n\n");

    if (!transcript.trim()) {
      setErrorText("No messages to copy.");
      return;
    }

    try {
      await navigator.clipboard.writeText(transcript);
    } catch {
      setErrorText("Failed to copy conversation text.");
      setStatus("error");
    }
  }, [messages]);

  const generateLongPrompt = useCallback(() => {
    setUserPrompt(generateApprox5000TokenText());
    setErrorText("");
  }, []);

  const generateOverflowPrompt = useCallback(() => {
    setUserPrompt(generateOverflowPromptText());
    setErrorText("");
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  useEffect(() => {
    void loadChats().catch((error: unknown) => {
      setErrorText(error instanceof Error ? error.message : "Failed to initialize");
      setStatus("error");
    });
  }, [loadChats]);

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
    localStorage.setItem(SYSTEM_PROMPT_STORAGE_KEY, systemPrompt);
  }, [systemPrompt]);

  useEffect(() => {
    if (!activeChatId) {
      return;
    }
    void loadMessages(activeChatId).catch((error: unknown) => {
      setErrorText(error instanceof Error ? error.message : "Failed to load chat history");
      setStatus("error");
    });
  }, [activeChatId, loadMessages]);

  return {
    view: {
      chats,
      activeChatId,
      messages,
      userPrompt,
      status,
      errorText,
      model,
      systemPrompt,
      temperature,
      reasoningEffort,
      metrics,
      requestRaw,
      responseRaw,
      overflowErrorRaw,
      isModelSettingsOpen,
      isSystemPromptOpen,
      isMetricsOpen,
      fullScreenView,
      activeModelLabel,
      isStreaming,
      temperaturePolicy,
      reasoningOptions,
      isReasoningSupported,
      isTemperatureSupported,
      historyTotals,
      turnRows,
      currentContextTokens,
      maxContextTokens,
      chatEndRef,
      formatNumber,
      formatUsd,
    },
    actions: {
      setUserPrompt,
      setSystemPrompt,
      setTemperature,
      setReasoningEffort,
      setIsModelSettingsOpen,
      setIsSystemPromptOpen,
      setIsMetricsOpen,
      setFullScreenView,
      createChat,
      deleteChat,
      selectChat,
      handleModelChange,
      handleMainAction,
      handlePromptKeyDown,
      copyConversationText,
      generateLongPrompt,
      generateOverflowPrompt,
    },
  };
}
