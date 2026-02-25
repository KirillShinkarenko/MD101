import type { ChatMessage, Status } from "../domain/chat";
import type { KeyboardEvent, RefObject } from "react";

type Props = {
  status: Status;
  userPrompt: string;
  isStreaming: boolean;
  currentContextTokens: number | null;
  maxContextTokens: number | null;
  formatNumber: (value: number | null) => string;
  messages: ChatMessage[];
  chatEndRef: RefObject<HTMLDivElement>;
  onUserPromptChange: (value: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onMainAction: () => void;
  onCopyConversationText: () => void;
  onGenerateLongPrompt: () => void;
  onGenerateOverflowPrompt: () => void;
};

export function ChatMainPanel(props: Props) {
  const {
    status,
    userPrompt,
    isStreaming,
    currentContextTokens,
    maxContextTokens,
    formatNumber,
    messages,
    chatEndRef,
    onUserPromptChange,
    onPromptKeyDown,
    onMainAction,
    onCopyConversationText,
    onGenerateLongPrompt,
    onGenerateOverflowPrompt,
  } = props;

  return (
    <section className="center-col">
      <div className="panel-header">
        <h1>MD108 UI</h1>
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
          <p className="context-indicator">
            <strong>Context:</strong> {formatNumber(currentContextTokens)} / {formatNumber(maxContextTokens)} tokens
          </p>
          <div className="composer-actions">
            <button type="button" className="secondary-action" onClick={onGenerateLongPrompt} disabled={isStreaming}>
              Gen ~5k
            </button>
            <button
              type="button"
              className="secondary-action"
              onClick={onGenerateOverflowPrompt}
              disabled={isStreaming}
            >
              Gen overflow
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
