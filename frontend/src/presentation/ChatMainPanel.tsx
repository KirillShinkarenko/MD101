import type { ChatMessage } from "../domain/chat";
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { PanelHeader } from "./ui/PanelHeader";
import { UiButton } from "./ui/UiButton";

type Props = {
  userPrompt: string;
  isStreaming: boolean;
  isBranchAvailable: boolean;
  branchFromChatId: string | null;
  branchFromChatTitle: string | null;
  branchCheckpointMessageCount: number | null;
  currentContextTokens: number | null;
  maxContextTokens: number | null;
  formatNumber: (value: number | null) => string;
  messages: ChatMessage[];
  chatEndRef: RefObject<HTMLDivElement>;
  onUserPromptChange: (value: string) => void;
  onPromptKeyDown: (event: ReactKeyboardEvent<HTMLTextAreaElement>) => void;
  onMainAction: () => void;
  onOpenConversationInfo: () => void;
  onBranchInNewChat: () => void;
  onOpenBranchSource: (chatId: string) => void;
};

export function ChatMainPanel(props: Props) {
  const {
    userPrompt,
    isStreaming,
    isBranchAvailable,
    branchFromChatId,
    branchFromChatTitle,
    branchCheckpointMessageCount,
    currentContextTokens,
    maxContextTokens,
    formatNumber,
    messages,
    chatEndRef,
    onUserPromptChange,
    onPromptKeyDown,
    onMainAction,
    onOpenConversationInfo,
    onBranchInNewChat,
    onOpenBranchSource,
  } = props;
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isActionsOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const root = actionsMenuRef.current;
      if (!root || root.contains(event.target as Node)) {
        return;
      }
      setIsActionsOpen(false);
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsActionsOpen(false);
      }
    };

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);

    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isActionsOpen]);

  const hasBranchDivider = Boolean(branchFromChatId && branchFromChatTitle);
  let dividerPlacement: "none" | "top" | "between" | "bottom" = "none";
  let dividerAfterIndex: number | null = null;

  if (hasBranchDivider) {
    const checkpoint = branchCheckpointMessageCount;
    if (checkpoint === null || checkpoint <= 0) {
      dividerPlacement = "top";
    } else if (checkpoint < messages.length) {
      dividerPlacement = "between";
      dividerAfterIndex = checkpoint - 1;
    } else {
      dividerPlacement = "bottom";
    }
  }

  const renderBranchDivider = (key: string) =>
    hasBranchDivider && branchFromChatId && branchFromChatTitle ? (
      <article key={key} className="branch-divider">
        <span className="branch-divider-line" />
        <span className="branch-divider-text">
          <span>Ответвление от </span>
          <button
            type="button"
            className="branch-link"
            onClick={() => onOpenBranchSource(branchFromChatId)}
          >
            {branchFromChatTitle}
          </button>
        </span>
        <span className="branch-divider-line" />
      </article>
    ) : null;

  return (
    <section className="center-col">
      <PanelHeader
        as="h1"
        variant="panel"
        title="День 11. Модель памяти ассистента"
        titleClassName="day-task-heading"
        actions={
          <>
            <div ref={actionsMenuRef} className="chat-actions-menu">
              <UiButton
                className="chat-actions-trigger"
                aria-haspopup="menu"
                aria-expanded={isActionsOpen}
                aria-controls="chat-actions-panel"
                onClick={() => setIsActionsOpen((prev) => !prev)}
              >
                ...
              </UiButton>
              {isActionsOpen ? (
                <div id="chat-actions-panel" className="chat-actions-panel" role="menu">
                  <button
                    type="button"
                    className="chat-actions-item"
                    role="menuitem"
                    onClick={() => {
                      setIsActionsOpen(false);
                      onOpenConversationInfo();
                    }}
                  >
                    Conversation info
                  </button>
                  <button
                    type="button"
                    className="chat-actions-item"
                    role="menuitem"
                    disabled={!isBranchAvailable || isStreaming}
                    onClick={() => {
                      setIsActionsOpen(false);
                      onBranchInNewChat();
                    }}
                  >
                    Branch in new chat
                  </button>
                </div>
              ) : null}
            </div>
          </>
        }
      />

      <div className="messages">
        {dividerPlacement === "top" ? renderBranchDivider("branch-divider-top") : null}
        {messages.length === 0 ? <p className="empty">Start a conversation...</p> : null}
        {messages.map((message, index) => (
          <Fragment key={message.id}>
            <article className={`message-row role-${message.role}`}>
              <div className={`message-surface is-${message.role}`}>
                <p className="content">{message.content || "..."}</p>
              </div>
            </article>
            {dividerPlacement === "between" && dividerAfterIndex === index
              ? renderBranchDivider(`branch-divider-between-${message.id}`)
              : null}
          </Fragment>
        ))}
        {dividerPlacement === "bottom" ? renderBranchDivider("branch-divider-bottom") : null}
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
