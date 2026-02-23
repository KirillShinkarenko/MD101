import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

type Status = "idle" | "streaming" | "stopped" | "done" | "error";
type Role = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: Role;
  text: string;
};

type RecentAnswer = {
  id: string;
  text: string;
  createdAt: number;
  model: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
  totalCostUsd: number | null;
};

type RunMetrics = {
  model: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  costUsd: number | null;
  inputCostUsd: number | null;
  outputCostUsd: number | null;
};

const MODEL_OPTIONS = [
  { value: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
  { value: "gpt-5-mini", label: "GPT-5 Mini" },
  { value: "gpt-5.1", label: "GPT-5.1" },
  { value: "gpt-5.2", label: "GPT-5.2" },
];
const MODEL_PRICING_PER_1M: Record<string, { input: number; output: number }> = {
  "gpt-4.1-nano": { input: 0.1, output: 0.4 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5.1": { input: 1.25, output: 10 },
  "gpt-5.2": { input: 1.75, output: 14 },
};
const MODEL_STRENGTH_CLASS: Record<string, string> = {
  "gpt-5.2": "model-tier-strong",
  "gpt-5.1": "model-tier-good",
  "gpt-5-mini": "model-tier-mid",
  "gpt-4.1-nano": "model-tier-weak",
};

const MODEL_TEMPERATURE_POLICY: Record<string, "never" | "always" | "reasoning_none_only"> = {
  "gpt-4.1-nano": "always",
  "gpt-5-mini": "never",
  "gpt-5.1": "reasoning_none_only",
  "gpt-5.2": "reasoning_none_only",
};

type ReasoningEffort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

const MODEL_REASONING_OPTIONS: Record<string, ReasoningEffort[]> = {
  "gpt-4.1-nano": [],
  "gpt-5-mini": ["minimal", "low", "medium", "high"],
  "gpt-5.1": ["none", "low", "medium", "high"],
  "gpt-5.2": ["none", "low", "medium", "high", "xhigh"],
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";
const USD_6_DP: Intl.NumberFormatOptions = { minimumFractionDigits: 6, maximumFractionDigits: 6 };
const USD_2_DP: Intl.NumberFormatOptions = { minimumFractionDigits: 2, maximumFractionDigits: 2 };

const createId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const resolveModelTierClass = (modelId: string): string => {
  const normalized = modelId.trim().toLowerCase();
  if (normalized.startsWith("gpt-5.2")) {
    return MODEL_STRENGTH_CLASS["gpt-5.2"];
  }
  if (normalized.startsWith("gpt-5.1")) {
    return MODEL_STRENGTH_CLASS["gpt-5.1"];
  }
  if (normalized.startsWith("gpt-5-mini")) {
    return MODEL_STRENGTH_CLASS["gpt-5-mini"];
  }
  if (normalized.startsWith("gpt-4.1-nano")) {
    return MODEL_STRENGTH_CLASS["gpt-4.1-nano"];
  }
  return "model-tier-neutral";
};

function App() {
  const [systemPrompt, setSystemPrompt] = useState("You are a concise assistant.");
  const [userPrompt, setUserPrompt] = useState("");
  const [model, setModel] = useState("gpt-5-mini");
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort>("low");
  const [temperature, setTemperature] = useState("0.7");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recentAnswers, setRecentAnswers] = useState<RecentAnswer[]>([]);
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [isRecentAnswersOpen, setIsRecentAnswersOpen] = useState(false);
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");
  const [openaiRequestRaw, setOpenaiRequestRaw] = useState("");
  const [openaiResponseRaw, setOpenaiResponseRaw] = useState("");
  const [metrics, setMetrics] = useState<RunMetrics | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(createId());
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const isStreaming = status === "streaming";
  const temperaturePolicy = MODEL_TEMPERATURE_POLICY[model] ?? "always";
  const reasoningOptions = MODEL_REASONING_OPTIONS[model] ?? [];
  const isReasoningSupported = reasoningOptions.length > 0;
  const isTemperatureSupported =
    temperaturePolicy === "always" ||
    (temperaturePolicy === "reasoning_none_only" && reasoningEffort === "none");

  useEffect(() => {
    if (!isReasoningSupported) {
      return;
    }
    if (!reasoningOptions.includes(reasoningEffort)) {
      setReasoningEffort(reasoningOptions[0]);
    }
  }, [isReasoningSupported, reasoningEffort, reasoningOptions]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  const statusLabel = useMemo(() => {
    switch (status) {
      case "idle":
        return "Idle";
      case "streaming":
        return "Streaming...";
      case "stopped":
        return "Stopped";
      case "done":
        return "Done";
      case "error":
        return "Error";
      default:
        return "Idle";
    }
  }, [status]);

  const latestAssistantMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index].role === "assistant") {
        return messages[index].id;
      }
    }
    return null;
  }, [messages]);

  const appendDelta = (assistantMessageId: string, text: string): void => {
    if (!text) {
      return;
    }
    setMessages((prev) =>
      prev.map((message) =>
        message.id === assistantMessageId ? { ...message, text: message.text + text } : message
      )
    );
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

  const formatMetric = (value: number | null, options?: Intl.NumberFormatOptions): string => {
    if (value === null || Number.isNaN(value)) {
      return "-";
    }
    return new Intl.NumberFormat("en-US", options).format(value);
  };

  const formatUsd = (value: number | null, options: Intl.NumberFormatOptions = USD_6_DP): string =>
    value === null ? "N/A" : `$${formatMetric(value, options)}`;

  const startStreaming = async (promptOverride?: string) => {
    const trimmedPrompt = (promptOverride ?? userPrompt).trim();
    if (!trimmedPrompt || isStreaming) {
      return;
    }

    const parsedTemperature = parseTemperature(temperature);
    if (parsedTemperature.error) {
      setErrorText(parsedTemperature.error);
      setStatus("error");
      return;
    }

    setErrorText("");
    setStatus("streaming");

    const userMessage: ChatMessage = { id: createId(), role: "user", text: trimmedPrompt };
    const assistantMessageId = createId();
    const assistantMessage: ChatMessage = { id: assistantMessageId, role: "assistant", text: "" };
    let assistantTextBuffer = "";
    let isRecentAnswerStored = false;
    let recentAnswerModel = model;
    let recentAnswerLatencyMs: number | null = null;
    let recentAnswerInputTokens: number | null = null;
    let recentAnswerOutputTokens: number | null = null;
    let recentAnswerTotalTokens: number | null = null;
    let recentAnswerInputCostUsd: number | null = null;
    let recentAnswerOutputCostUsd: number | null = null;
    let recentAnswerTotalCostUsd: number | null = null;

    const storeRecentAnswer = () => {
      if (isRecentAnswerStored || !assistantTextBuffer.trim()) {
        return;
      }
      setRecentAnswers((prev) =>
        [
          {
            id: createId(),
            text: assistantTextBuffer,
            createdAt: Date.now(),
            model: recentAnswerModel,
            latencyMs: recentAnswerLatencyMs,
            inputTokens: recentAnswerInputTokens,
            outputTokens: recentAnswerOutputTokens,
            totalTokens: recentAnswerTotalTokens,
            inputCostUsd: recentAnswerInputCostUsd,
            outputCostUsd: recentAnswerOutputCostUsd,
            totalCostUsd: recentAnswerTotalCostUsd,
          },
          ...prev,
        ].slice(0, 20)
      );
      isRecentAnswerStored = true;
    };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setLastUserMessage(trimmedPrompt);
    setUserPrompt("");

    const controller = new AbortController();
    controllerRef.current = controller;
    const backendRequestBody = {
      sessionId: sessionIdRef.current,
      systemPrompt,
      userPrompt: trimmedPrompt,
      model,
      reasoningEffort: isReasoningSupported ? reasoningEffort : undefined,
      temperature: isTemperatureSupported ? parsedTemperature.value : undefined,
    };
    setMetrics(null);
    setOpenaiRequestRaw("");
    setOpenaiResponseRaw("");

    try {
      const response = await fetch(`${API_BASE}/api/chat/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(backendRequestBody),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let eventName = "message";

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

          const jsonText = dataLines.join("\n");
          let payload: any;
          try {
            payload = JSON.parse(jsonText);
          } catch {
            continue;
          }

          if (eventName === "delta") {
            const delta = payload.text ?? "";
            assistantTextBuffer += delta;
            appendDelta(assistantMessageId, delta);
          }

          if (eventName === "error") {
            setStatus("error");
            setErrorText(payload.message ?? "Unknown error");
            const errorMessage = payload.message ? `[Error] ${payload.message}` : "";
            assistantTextBuffer += errorMessage;
            appendDelta(assistantMessageId, errorMessage);
            storeRecentAnswer();
          }

          if (eventName === "done") {
            setStatus((prev) => (prev === "streaming" ? "done" : prev));
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
            recentAnswerModel = nextMetrics.model;
            recentAnswerLatencyMs = nextMetrics.latencyMs;
            recentAnswerInputTokens = nextMetrics.inputTokens;
            recentAnswerOutputTokens = nextMetrics.outputTokens;
            recentAnswerTotalTokens = nextMetrics.totalTokens;
            recentAnswerInputCostUsd = nextMetrics.inputCostUsd;
            recentAnswerOutputCostUsd = nextMetrics.outputCostUsd;
            recentAnswerTotalCostUsd = nextMetrics.costUsd;
            storeRecentAnswer();
          }

          if (eventName === "debug_request") {
            setOpenaiRequestRaw(JSON.stringify(payload.body ?? {}, null, 2));
          }

          if (eventName === "debug_response_final") {
            setOpenaiResponseRaw(JSON.stringify(payload.body ?? {}, null, 2));
          }

          eventName = "message";
        }
      }

      setStatus((prev) => (prev === "streaming" ? "done" : prev));
      storeRecentAnswer();
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        setStatus("stopped");
        appendDelta(assistantMessageId, "[Stopped. Waiting for the next command.]");
        return;
      }
      const message = error instanceof Error ? error.message : "Unexpected client error";
      setStatus("error");
      setErrorText(message);
      const errorMessage = `[Error] ${message}`;
      assistantTextBuffer += errorMessage;
      appendDelta(assistantMessageId, errorMessage);
      storeRecentAnswer();
    } finally {
      controllerRef.current = null;
    }
  };

  const stopStreaming = () => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setStatus((prev) => (prev === "streaming" ? "stopped" : prev));
  };

  const clearSession = async () => {
    controllerRef.current?.abort();
    controllerRef.current = null;

    const currentSessionId = sessionIdRef.current;
    sessionIdRef.current = createId();

    setMessages([]);
    setErrorText("");
    setStatus("idle");
    setOpenaiRequestRaw("");
    setOpenaiResponseRaw("");
    setMetrics(null);

    try {
      await fetch(`${API_BASE}/api/chat/session/reset`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ sessionId: currentSessionId }),
      });
    } catch {
      // Ignore reset errors locally; a new session id is already generated.
    }
  };

  const handleMainAction = () => {
    if (isStreaming) {
      stopStreaming();
      return;
    }
    void startStreaming();
  };

  const handlePromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) {
      return;
    }
    event.preventDefault();
    if (!isStreaming && userPrompt.trim()) {
      void startStreaming();
    }
  };

  const clearSessionAndRepeatMessage = async () => {
    if (!lastUserMessage || isStreaming) {
      return;
    }
    await clearSession();
    await startStreaming(lastUserMessage);
  };

  return (
    <main className="page">
      <section className="panel controls controls-panel">
        <div className="controls-header">
          <h1>MD201 UI</h1>
        </div>

        <label htmlFor="system-prompt">System Prompt</label>
        <textarea
          id="system-prompt"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={4}
          placeholder="System prompt"
        />
        <div className="model-config-row">
          <div>
            <div className="label-with-info">
              <label htmlFor="model">Model</label>
              <button
                className="info-icon-button"
                onClick={() => setIsPricingOpen(true)}
                aria-label="Show model pricing"
                title="Show model pricing"
                type="button"
              >
                ?
              </button>
            </div>
            <select
              id="model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={isStreaming}
            >
              {MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="temperature-field">
            <label htmlFor="temperature">Temperature</label>
            <input
              id="temperature"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={temperature}
              onChange={(event) => setTemperature(event.target.value)}
              placeholder="0.7"
              disabled={!isTemperatureSupported || isStreaming}
            />
          </div>
          <div>
            <label htmlFor="reasoning-effort">Reasoning effort</label>
            <select
              id="reasoning-effort"
              value={isReasoningSupported ? reasoningEffort : "none"}
              onChange={(event) => setReasoningEffort(event.target.value as ReasoningEffort)}
              disabled={!isReasoningSupported || isStreaming}
            >
              {!isReasoningSupported ? (
                <option value="none">Not supported by this model</option>
              ) : (
                reasoningOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))
              )}
            </select>
          </div>
        </div>
        {temperaturePolicy === "never" ? (
          <p className="hint model-config-hint">This model does not support temperature.</p>
        ) : null}
        {temperaturePolicy === "reasoning_none_only" ? (
          <p className="hint model-config-hint">Temperature is available only when reasoning effort is set to none.</p>
        ) : null}

        {errorText ? <p className="error">{errorText}</p> : null}
      </section>

      <section className="panel output chat-panel">
        <div className="chat-header">
          <h2>Chat</h2>
          <button onClick={() => setIsRecentAnswersOpen(true)}>Recent answers</button>
          <button className="danger clear-top" onClick={clearSession} disabled={isStreaming}>
            Clear Session
          </button>
        </div>
        <div className="chat">
          {messages.length === 0 ? <p className="chat-empty">Conversation will appear here...</p> : null}
          {messages.map((message) => (
            <article key={message.id} className={`bubble ${message.role}`}>
              <p className="bubble-role">{message.role === "user" ? "You" : "Assistant"}</p>
              <p className="bubble-text">
                {message.text ? (
                  message.text
                ) : message.role === "assistant" &&
                  isStreaming &&
                  message.id === latestAssistantMessageId ? (
                  <span className="typing-indicator" aria-label="Assistant is typing" role="status">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </span>
                ) : (
                  "..."
                )}
              </p>
            </article>
          ))}
          <div ref={chatEndRef} />
        </div>
        <div className="composer">
          <label htmlFor="user-prompt">Message</label>
          <textarea
            id="user-prompt"
            value={userPrompt}
            onChange={(event) => setUserPrompt(event.target.value)}
            onKeyDown={handlePromptKeyDown}
            rows={4}
            placeholder="Ask anything..."
          />
          <div className="actions">
            <button
              className={`main-action ${isStreaming ? "secondary" : ""}`}
              onClick={handleMainAction}
              disabled={!isStreaming && !userPrompt.trim()}
            >
              {isStreaming ? "Stop" : "Send"}
            </button>
            <button onClick={() => void clearSessionAndRepeatMessage()} disabled={!lastUserMessage || isStreaming}>
              Clear and repeat
            </button>
            <span className={`status ${status}`}>{statusLabel}</span>
          </div>
        </div>
      </section>

      <section className="panel output raw-panel">
        <h2>Run metrics</h2>
        <div className="metrics-grid">
          <article className="metric-card">
            <p className="metric-label">Model</p>
            <p className="metric-value">{metrics?.model ?? model}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Latency</p>
            <p className="metric-value">
              {metrics ? `${formatMetric(metrics.latencyMs)} ms` : "After send"}
            </p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Estimated cost (USD)</p>
            <p className="metric-value">
              {metrics ? formatUsd(metrics.costUsd) : "After send"}
            </p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Input tokens</p>
            <p className="metric-value">{metrics ? formatMetric(metrics.inputTokens) : "After send"}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Output tokens</p>
            <p className="metric-value">{metrics ? formatMetric(metrics.outputTokens) : "After send"}</p>
          </article>
          <article className="metric-card">
            <p className="metric-label">Total tokens</p>
            <p className="metric-value">{metrics ? formatMetric(metrics.totalTokens) : "After send"}</p>
          </article>
        </div>

        <h2>Raw</h2>
        <div className="raw-block">
          <p className="raw-title">Backend -&gt; OpenAI body</p>
          <pre>{openaiRequestRaw || "Will appear after Send..."}</pre>
        </div>
        <div className="raw-block">
          <p className="raw-title">OpenAI -&gt; Backend final useful body</p>
          <pre>{openaiResponseRaw || "Will appear after stream completion..."}</pre>
        </div>
      </section>

      {isRecentAnswersOpen ? (
        <div className="modal-overlay" role="presentation" onClick={() => setIsRecentAnswersOpen(false)}>
          <section className="modal-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Recent Answers</h2>
              <div className="modal-actions">
                <button
                  onClick={() => {
                    setRecentAnswers([]);
                    setIsRecentAnswersOpen(false);
                  }}
                  disabled={recentAnswers.length === 0}
                >
                  Clear
                </button>
                <button onClick={() => setIsRecentAnswersOpen(false)}>Close</button>
              </div>
            </div>
            <div className="recent-list">
              {recentAnswers.length === 0 ? (
                <p className="chat-empty">No answers yet.</p>
              ) : (
                recentAnswers.map((answer, index) => {
                    const modelTierClass = resolveModelTierClass(answer.model);
                    const formattedDuration =
                      answer.latencyMs === null ? "N/A" : `${formatMetric(answer.latencyMs)} ms`;
                    const formattedCostTio = `${formatUsd(answer.totalCostUsd)} / ${formatUsd(answer.inputCostUsd)} / ${formatUsd(answer.outputCostUsd)}`;
                    const formattedTokensTio = `${answer.totalTokens === null ? "N/A" : formatMetric(answer.totalTokens)} / ${answer.inputTokens === null ? "N/A" : formatMetric(answer.inputTokens)} / ${answer.outputTokens === null ? "N/A" : formatMetric(answer.outputTokens)}`;

                    return (
                      <article key={answer.id} className="recent-item">
                        <p className="recent-title">
                          #{recentAnswers.length - index} • {new Date(answer.createdAt).toLocaleTimeString()}
                        </p>
                        <div className="recent-content">
                          <p className="bubble-text">{answer.text}</p>
                          <div className={`recent-metrics ${modelTierClass}`}>
                            <p className="recent-meta">
                              <strong>Model:</strong> <span className={`model-name ${modelTierClass}`}>{answer.model}</span>
                            </p>
                            <p className="recent-meta">
                              <strong>Duration:</strong> {formattedDuration}
                            </p>
                            <p className="recent-meta">
                              <strong>Cost T/I/O:</strong> {formattedCostTio}
                            </p>
                            <p className="recent-meta">
                              <strong>Tokens T/I/O:</strong> {formattedTokensTio}
                            </p>
                          </div>
                        </div>
                      </article>
                    );
                  })
              )}
            </div>
          </section>
        </div>
      ) : null}

      {isPricingOpen ? (
        <div className="modal-overlay" role="presentation" onClick={() => setIsPricingOpen(false)}>
          <section className="modal-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h2>Model pricing</h2>
              <div className="modal-actions">
                <button onClick={() => setIsPricingOpen(false)}>Close</button>
              </div>
            </div>
            <div className="recent-list">
              {MODEL_OPTIONS.map((option) => {
                const pricing = MODEL_PRICING_PER_1M[option.value];
                const modelTierClass = resolveModelTierClass(option.value);
                return (
                  <article key={option.value} className={`recent-item pricing-item ${modelTierClass}`}>
                    <p className={`recent-title model-name ${modelTierClass}`}>{option.label}</p>
                    <p className="recent-meta">
                      Input: {formatUsd(pricing.input, USD_2_DP)} / 1M • Output: {formatUsd(pricing.output, USD_2_DP)} / 1M
                    </p>
                  </article>
                );
              })}
            </div>
            <p className="hint">Standard text token pricing per 1M tokens.</p>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
