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

type ParsedTaskArtifactMessage = {
  visibleText: string;
  hasArtifact: boolean;
  artifactPrettyText: string;
  artifactRawText: string;
  isArtifactJsonValid: boolean;
};

const createTaskArtifactBlockRegex = (): RegExp =>
  /\[TASK_ARTIFACT_JSON\]([\s\S]*?)\[\/TASK_ARTIFACT_JSON\]/g;

const normalizeVisibleText = (value: string): string =>
  value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const parseTaskArtifactMessage = (content: string): ParsedTaskArtifactMessage => {
  const blockRegex = createTaskArtifactBlockRegex();
  const matches = Array.from(content.matchAll(blockRegex));
  if (matches.length === 0) {
    return {
      visibleText: normalizeVisibleText(content),
      hasArtifact: false,
      artifactPrettyText: "",
      artifactRawText: "",
      isArtifactJsonValid: false,
    };
  }

  const artifactRawText = (matches[matches.length - 1]?.[1] ?? "").trim();
  let artifactPrettyText = artifactRawText;
  let isArtifactJsonValid = false;

  try {
    artifactPrettyText = JSON.stringify(JSON.parse(artifactRawText), null, 2);
    isArtifactJsonValid = true;
  } catch {
    isArtifactJsonValid = false;
  }

  const visibleText = normalizeVisibleText(content.replace(createTaskArtifactBlockRegex(), ""));

  return {
    visibleText,
    hasArtifact: true,
    artifactPrettyText,
    artifactRawText,
    isArtifactJsonValid,
  };
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

  return (
    <section className="center-col">
      <PanelHeader
        as="h1"
        variant="panel"
        title="День 13. Состояние задачи (Task State Machine)"
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
        {messages.map((message, index) => {
          const parsedMessage = parseTaskArtifactMessage(message.content);
          const shouldShowArtifactInfo = message.role === "assistant" && parsedMessage.hasArtifact;
          const shouldRenderContent = parsedMessage.visibleText.length > 0 || !parsedMessage.hasArtifact;
          const contentText = parsedMessage.hasArtifact ? parsedMessage.visibleText : message.content || "...";

          return (
            <Fragment key={message.id}>
              <article className={`message-row role-${message.role}`}>
                <div className={`message-surface is-${message.role}`}>
                  {shouldRenderContent ? <p className="content">{contentText}</p> : null}
                  {shouldShowArtifactInfo ? (
                    <details className="message-artifact">
                      <summary className="message-artifact-summary">Доп. инфо</summary>
                      <pre className="message-artifact-body">
                        {parsedMessage.isArtifactJsonValid
                          ? parsedMessage.artifactPrettyText
                          : parsedMessage.artifactRawText}
                      </pre>
                    </details>
                  ) : null}
                </div>
              </article>
              {dividerPlacement === "between" && dividerAfterIndex === index
                ? renderBranchDivider(`branch-divider-between-${message.id}`)
                : null}
            </Fragment>
          );
        })}
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
