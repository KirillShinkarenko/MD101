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
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

const createId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

function App() {
  const [systemPrompt, setSystemPrompt] = useState("You are a concise assistant.");
  const [userPrompt, setUserPrompt] = useState("");
  const [temperature, setTemperature] = useState("0.7");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [recentAnswers, setRecentAnswers] = useState<RecentAnswer[]>([]);
  const [lastUserMessage, setLastUserMessage] = useState("");
  const [isRecentAnswersOpen, setIsRecentAnswersOpen] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorText, setErrorText] = useState("");
  const [openaiRequestRaw, setOpenaiRequestRaw] = useState("");
  const [openaiResponseRaw, setOpenaiResponseRaw] = useState("");

  const controllerRef = useRef<AbortController | null>(null);
  const sessionIdRef = useRef<string>(createId());
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const isStreaming = status === "streaming";

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

    const storeRecentAnswer = () => {
      if (isRecentAnswerStored || !assistantTextBuffer.trim()) {
        return;
      }
      setRecentAnswers((prev) =>
        [{ id: createId(), text: assistantTextBuffer, createdAt: Date.now() }, ...prev].slice(0, 20)
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
      temperature: parsedTemperature.value,
    };
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
          let payload: { text?: string; message?: string; body?: unknown };
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
        <h1>MD104 UI</h1>

        <label htmlFor="system-prompt">System Prompt</label>
        <textarea
          id="system-prompt"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={4}
          placeholder="System prompt"
        />
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
        />

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
          <div className="message-tools">
            <button onClick={() => void clearSessionAndRepeatMessage()} disabled={!lastUserMessage || isStreaming}>
              Clear Session and Repeat Message
            </button>
          </div>
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
            <span className={`status ${status}`}>{statusLabel}</span>
          </div>
        </div>
      </section>

      <section className="panel output raw-panel">
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
                recentAnswers.map((answer, index) => (
                  <article key={answer.id} className="recent-item">
                    <p className="recent-title">
                      #{recentAnswers.length - index} • {new Date(answer.createdAt).toLocaleTimeString()}
                    </p>
                    <p className="bubble-text">{answer.text}</p>
                  </article>
                ))
              )}
            </div>
          </section>
        </div>
      ) : null}
    </main>
  );
}

export default App;
