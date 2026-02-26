import type { ChatMessage, HistoryMode, Status } from "../domain/chat";
import type { KeyboardEvent, RefObject } from "react";

type Props = {
  status: Status;
  userPrompt: string;
  isStreaming: boolean;
  historyMode: HistoryMode;
  currentContextTokens: number | null;
  maxContextTokens: number | null;
  requestSavedInputTokens: number;
  requestSavedInputPercent: number;
  formatNumber: (value: number | null) => string;
  messages: ChatMessage[];
  chatEndRef: RefObject<HTMLDivElement>;
  onUserPromptChange: (value: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onMainAction: () => void;
  onCopyConversationText: () => void;
  onGenerateLongPrompt: () => void;
  onHistoryModeChange: (value: HistoryMode) => void;
};

export function ChatMainPanel(props: Props) {
  const {
    status,
    userPrompt,
    isStreaming,
    historyMode,
    currentContextTokens,
    maxContextTokens,
    requestSavedInputTokens,
    requestSavedInputPercent,
    formatNumber,
    messages,
    chatEndRef,
    onUserPromptChange,
    onPromptKeyDown,
    onMainAction,
    onCopyConversationText,
    onGenerateLongPrompt,
    onHistoryModeChange,
  } = props;

  return (
    <section className="center-col">
      <div className="panel-header">
        <h1>MD109 UI</h1>
        <div className="header-actions">
          <button
            type="button"
            className="copy-dialog-button"
            onClick={onCopyConversationText}
            title="Copy conversation text"
            aria-label="Copy conversation text"
          >
            📋
          </button>
          <span className={`status ${status}`}>{status}</span>
        </div>
      </div>

      <div className="messages">
        {messages.length === 0 ? <p className="empty">Start a conversation...</p> : null}
        {messages.map((message) => (
          <article key={message.id} className={`bubble ${message.role}`}>
            <p className="role">{message.role === "user" ? "You" : "Assistant"}</p>
            <p className="content">{message.content || "..."}</p>
          </article>
        ))}
        <div ref={chatEndRef} />
      </div>

      <div className="composer">
        <textarea
          value={userPrompt}
          onChange={(event) => onUserPromptChange(event.target.value)}
          onKeyDown={onPromptKeyDown}
          rows={3}
          placeholder="Ask anything..."
        />

        <div className="composer-bottom">
          <div className="context-meta">
            <p className="context-indicator">
              <strong>Context:</strong> {formatNumber(currentContextTokens)} / {formatNumber(maxContextTokens)} tokens
            </p>
            <p className="context-indicator">
              <strong>Saved this request:</strong>{" "}
              {historyMode === "full"
                ? "0 tokens (full request mode)"
                : `${formatNumber(requestSavedInputTokens)} (${requestSavedInputPercent.toFixed(2)}%)`}
            </p>
          </div>
          <div className="composer-actions">
            <div className="history-mode-switch" role="group" aria-label="History mode">
              <button
                type="button"
                className={historyMode === "summary" ? "active" : ""}
                onClick={() => onHistoryModeChange("summary")}
                disabled={isStreaming}
              >
                Summary mode
              </button>
              <button
                type="button"
                className={historyMode === "full" ? "active" : ""}
                onClick={() => onHistoryModeChange("full")}
                disabled={isStreaming}
              >
                Full request
              </button>
            </div>
            <button type="button" className="secondary-action" onClick={onGenerateLongPrompt} disabled={isStreaming}>
              Gen ~5k
            </button>
            <button type="button" onClick={onMainAction} disabled={!isStreaming && !userPrompt.trim()}>
              {isStreaming ? "Stop" : "Send"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
