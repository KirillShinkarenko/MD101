import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

type Status = "idle" | "streaming" | "stopped" | "done" | "error";
type Role = "user" | "assistant";

type ChatMessage = {
  id: string;
  role: Role;
  text: string;
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  const startStreaming = async () => {
    const trimmedPrompt = userPrompt.trim();
    if (!trimmedPrompt || isStreaming) {
      return;
    }

    setErrorText("");
    setStatus("streaming");

    const userMessage: ChatMessage = { id: createId(), role: "user", text: trimmedPrompt };
    const assistantMessageId = createId();
    const assistantMessage: ChatMessage = { id: assistantMessageId, role: "assistant", text: "" };

    setMessages((prev) => [...prev, userMessage, assistantMessage]);
    setUserPrompt("");

    const controller = new AbortController();
    controllerRef.current = controller;
    const backendRequestBody = {
      sessionId: sessionIdRef.current,
      systemPrompt,
      userPrompt: trimmedPrompt,
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
            appendDelta(assistantMessageId, payload.text ?? "");
          }

          if (eventName === "error") {
            setStatus("error");
            setErrorText(payload.message ?? "Unknown error");
            appendDelta(assistantMessageId, payload.message ? `\n[Error] ${payload.message}` : "");
          }

          if (eventName === "done") {
            setStatus((prev) => (prev === "streaming" ? "done" : prev));
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
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        setStatus("stopped");
        appendDelta(assistantMessageId, "[Stopped. Waiting for the next command.]");
        return;
      }
      const message = error instanceof Error ? error.message : "Unexpected client error";
      setStatus("error");
      setErrorText(message);
      appendDelta(assistantMessageId, `\n[Error] ${message}`);
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

  return (
    <main className="page">
      <section className="panel controls controls-panel">
        <h1>MD102 UI</h1>

        <label htmlFor="system-prompt">System Prompt</label>
        <textarea
          id="system-prompt"
          value={systemPrompt}
          onChange={(event) => setSystemPrompt(event.target.value)}
          rows={4}
          placeholder="System prompt"
        />

        {errorText ? <p className="error">{errorText}</p> : null}
      </section>

      <section className="panel output chat-panel">
        <div className="chat-header">
          <h2>Chat</h2>
          <button className="danger clear-top" onClick={clearSession} disabled={isStreaming}>
            Clear Session
          </button>
        </div>
        <div className="chat">
          {messages.length === 0 ? <p className="chat-empty">Conversation will appear here...</p> : null}
          {messages.map((message) => (
            <article key={message.id} className={`bubble ${message.role}`}>
              <p className="bubble-role">{message.role === "user" ? "You" : "Assistant"}</p>
              <p className="bubble-text">{message.text || "..."}</p>
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
    </main>
  );
}

export default App;
