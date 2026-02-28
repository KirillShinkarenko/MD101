import type { ChatMessage, Status } from "../domain/chat";
import type { KeyboardEvent, RefObject } from "react";
import { PanelHeader } from "./ui/PanelHeader";
import { UiButton } from "./ui/UiButton";

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
  onOpenConversationInfo: () => void;
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
    onOpenConversationInfo,
  } = props;

  return (
    <section className="center-col">
      <PanelHeader
        as="h1"
        variant="panel"
        title="День 10. Управление контекстом: разные стратегии"
        titleClassName="day-task-heading"
        actions={
          <>
            <UiButton
              className="conversation-info-button"
              onClick={onOpenConversationInfo}
            >
              Conversation info
            </UiButton>
            <span className={`status ${status}`}>{status}</span>
          </>
        }
      />

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
            <UiButton onClick={onMainAction} disabled={!isStreaming && !userPrompt.trim()}>
              {isStreaming ? "Stop" : "Send"}
            </UiButton>
          </div>
        </div>
      </div>
    </section>
  );
}
