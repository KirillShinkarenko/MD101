import type { ChatMessage, InvariantViolation } from "../domain/chat";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { PanelHeader } from "./ui/PanelHeader";
import { UiButton } from "./ui/UiButton";

type Props = {
  userPrompt: string;
  errorText: string;
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
  onRegenerateInvariantViolation: (payload: {
    violations: InvariantViolation[];
    rejectedResponse: string;
  }) => void;
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

type InvariantViolationPayload = {
  violations: InvariantViolation[];
  rejectedResponse: string;
  sourceModel: string;
  createdAt: number;
};

type ParsedInvariantViolationMessage = {
  isViolation: boolean;
  payload: InvariantViolationPayload | null;
  visibleText: string;
};

const createTaskArtifactBlockRegex = (): RegExp =>
  /\[TASK_ARTIFACT_JSON\]([\s\S]*?)\[\/TASK_ARTIFACT_JSON\]/g;
const TASK_ARTIFACT_OPEN_TAG = "[TASK_ARTIFACT_JSON]";
const TASK_ARTIFACT_CLOSE_TAG = "[/TASK_ARTIFACT_JSON]";

const createInvariantViolationBlockRegex = (): RegExp =>
  /\[INVARIANT_VIOLATION_JSON\]([\s\S]*?)\[\/INVARIANT_VIOLATION_JSON\]/g;

const normalizeVisibleText = (value: string): string =>
  value
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const stripUnclosedTaskArtifactBlock = (content: string): string => {
  const openIndex = content.lastIndexOf(TASK_ARTIFACT_OPEN_TAG);
  if (openIndex === -1) {
    return content;
  }

  const closeIndex = content.indexOf(TASK_ARTIFACT_CLOSE_TAG, openIndex + TASK_ARTIFACT_OPEN_TAG.length);
  if (closeIndex !== -1) {
    return content;
  }

  return content.slice(0, openIndex);
};

const parseTaskArtifactMessage = (
  content: string,
  options?: { hideUnclosedArtifactBlock?: boolean }
): ParsedTaskArtifactMessage => {
  const blockRegex = createTaskArtifactBlockRegex();
  const matches = Array.from(content.matchAll(blockRegex));
  if (matches.length === 0) {
    const visibleSource = options?.hideUnclosedArtifactBlock ? stripUnclosedTaskArtifactBlock(content) : content;
    return {
      visibleText: normalizeVisibleText(visibleSource),
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

  let visibleSource = content.replace(createTaskArtifactBlockRegex(), "");
  if (options?.hideUnclosedArtifactBlock) {
    visibleSource = stripUnclosedTaskArtifactBlock(visibleSource);
  }
  const visibleText = normalizeVisibleText(visibleSource);

  return {
    visibleText,
    hasArtifact: true,
    artifactPrettyText,
    artifactRawText,
    isArtifactJsonValid,
  };
};

const parseInvariantViolationMessage = (content: string): ParsedInvariantViolationMessage => {
  const blockRegex = createInvariantViolationBlockRegex();
  const matches = Array.from(content.matchAll(blockRegex));
  if (matches.length === 0) {
    return {
      isViolation: false,
      payload: null,
      visibleText: normalizeVisibleText(content),
    };
  }

  const rawJson = (matches[matches.length - 1]?.[1] ?? "").trim();
  const visibleText = normalizeVisibleText(content.replace(createInvariantViolationBlockRegex(), ""));

  try {
    const parsed = JSON.parse(rawJson) as {
      violations?: unknown;
      rejectedResponse?: unknown;
      sourceModel?: unknown;
      createdAt?: unknown;
    };
    const violations = Array.isArray(parsed.violations)
      ? parsed.violations
          .map((item) => {
            if (!item || typeof item !== "object") {
              return null;
            }
            const candidate = item as { invariantId?: unknown; description?: unknown };
            if (typeof candidate.invariantId !== "string" || typeof candidate.description !== "string") {
              return null;
            }
            const invariantId = candidate.invariantId.trim();
            const description = candidate.description.trim();
            if (!invariantId || !description) {
              return null;
            }
            return {
              invariantId,
              description,
            };
          })
          .filter((item): item is InvariantViolation => Boolean(item))
      : [];

    return {
      isViolation: true,
      payload: {
        violations,
        rejectedResponse:
          typeof parsed.rejectedResponse === "string" ? parsed.rejectedResponse : "",
        sourceModel: typeof parsed.sourceModel === "string" ? parsed.sourceModel : "",
        createdAt: typeof parsed.createdAt === "number" ? parsed.createdAt : Date.now(),
      },
      visibleText: visibleText || "Ответ отклонен: обнаружены нарушения инвариантов.",
    };
  } catch {
    return {
      isViolation: false,
      payload: null,
      visibleText: normalizeVisibleText(content),
    };
  }
};

export function ChatMainPanel(props: Props) {
  const {
    userPrompt,
    errorText,
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
    onRegenerateInvariantViolation,
    onOpenConversationInfo,
    onBranchInNewChat,
    onOpenBranchSource,
  } = props;
  const [isActionsOpen, setIsActionsOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement | null>(null);
  const streamingAssistantMessageId = useMemo(() => {
    if (!isStreaming) {
      return null;
    }

    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (message.role === "assistant") {
        return message.id;
      }
    }

    return null;
  }, [isStreaming, messages]);

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
        title="День 15. Контролируемые переходы состояний"
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
          const parsedInvariantViolation = parseInvariantViolationMessage(message.content);
          const isInvariantViolation =
            message.role === "assistant" &&
            parsedInvariantViolation.isViolation &&
            Boolean(parsedInvariantViolation.payload);
          const isLiveAssistantMessage =
            message.role === "assistant" && Boolean(streamingAssistantMessageId) && message.id === streamingAssistantMessageId;
          const parsedMessage = parseTaskArtifactMessage(message.content, {
            hideUnclosedArtifactBlock: isLiveAssistantMessage,
          });
          const shouldShowArtifactInfo =
            message.role === "assistant" && parsedMessage.hasArtifact && !isLiveAssistantMessage;
          const shouldRenderContent = parsedMessage.visibleText.length > 0;
          const shouldShowThinkingIndicator =
            isLiveAssistantMessage && parsedMessage.visibleText.length === 0 && !isInvariantViolation;
          const contentText = parsedMessage.visibleText;
          const violationPayload = parsedInvariantViolation.payload;

          return (
            <Fragment key={message.id}>
              <article className={`message-row role-${message.role}`}>
                <div className={`message-surface is-${message.role}`}>
                  {isInvariantViolation && violationPayload ? (
                    <div className="invariant-violation-card">
                      <p className="content">{parsedInvariantViolation.visibleText}</p>
                      {violationPayload.violations.length > 0 ? (
                        <ul className="invariant-violation-list">
                          {violationPayload.violations.map((violation, violationIndex) => (
                            <li key={`${violation.invariantId}-${violationIndex}`}>
                              <strong>{violation.invariantId}:</strong> {violation.description}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="hint">Нарушения не детализированы.</p>
                      )}
                      <div className="invariant-violation-actions">
                        <UiButton
                          size="sm"
                          onClick={() =>
                            onRegenerateInvariantViolation({
                              violations: violationPayload.violations,
                              rejectedResponse: violationPayload.rejectedResponse,
                            })
                          }
                          disabled={isStreaming}
                        >
                          Regenerate
                        </UiButton>
                      </div>
                      <details className="message-artifact">
                        <summary className="message-artifact-summary">Показать отклоненный ответ</summary>
                        <pre className="message-artifact-body">
                          {violationPayload.rejectedResponse || "(empty)"}
                        </pre>
                      </details>
                    </div>
                  ) : null}
                  {!isInvariantViolation && shouldRenderContent ? <p className="content">{contentText}</p> : null}
                  {!isInvariantViolation && shouldShowThinkingIndicator ? (
                    <div className="agent-thinking" aria-live="polite" aria-label="Агент думает">
                      <span>Агент думает</span>
                      <span className="agent-thinking-dots" aria-hidden="true">
                        <i />
                        <i />
                        <i />
                      </span>
                    </div>
                  ) : null}
                  {!isInvariantViolation && shouldShowArtifactInfo ? (
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
        {errorText ? <p className="error">{errorText}</p> : null}

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
