import type { ChatMessage, Status } from "../domain/chat";
import type { KeyboardEvent, RefObject } from "react";

type Props = {
  status: Status;
  userPrompt: string;
  isStreaming: boolean;
  messages: ChatMessage[];
  chatEndRef: RefObject<HTMLDivElement>;
  onUserPromptChange: (value: string) => void;
  onPromptKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onMainAction: () => void;
};

export function ChatMainPanel(props: Props) {
  const {
    status,
    userPrompt,
    isStreaming,
    messages,
    chatEndRef,
    onUserPromptChange,
    onPromptKeyDown,
    onMainAction,
  } = props;

  return (
    <section className="center-col">
      <div className="panel-header">
        <h1>MD107 UI</h1>
        <span className={`status ${status}`}>{status}</span>
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
          <button type="button" onClick={onMainAction} disabled={!isStreaming && !userPrompt.trim()}>
            {isStreaming ? "Stop" : "Send"}
          </button>
        </div>
      </div>
    </section>
  );
}
