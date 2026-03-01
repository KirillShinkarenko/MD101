import type { ChatSummary, MemoryStrategy, StickyFacts } from "../domain/chat";
import { DropdownSelect } from "./DropdownSelect";
import { FormField } from "./ui/FormField";
import { NumberStepperInput } from "./ui/NumberStepperInput";
import { PanelHeader } from "./ui/PanelHeader";
import { UiButton } from "./ui/UiButton";

type Props = {
  chats: ChatSummary[];
  activeChatId: string | null;
  isModelSettingsOpen: boolean;
  isSystemPromptOpen: boolean;
  activeModelLabel: string;
  memoryStrategy: MemoryStrategy;
  slidingWindowSize: string;
  stickyWindowSize: string;
  facts: StickyFacts;
  isStreaming: boolean;
  memoryStrategyOptions: ReadonlyArray<{
    value: MemoryStrategy;
    label: string;
    implemented: boolean;
  }>;
  onCreateChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onOpenSystemPrompt: () => void;
  onOpenModelSettings: () => void;
  onMemoryStrategyChange: (value: MemoryStrategy) => void;
  onSlidingWindowSizeChange: (value: string) => void;
  onStickyWindowSizeChange: (value: string) => void;
  onBranchInNewChat: () => void;
};

export function ChatSidebar(props: Props) {
  const {
    chats,
    activeChatId,
    isModelSettingsOpen,
    isSystemPromptOpen,
    activeModelLabel,
    memoryStrategy,
    slidingWindowSize,
    stickyWindowSize,
    facts,
    isStreaming,
    memoryStrategyOptions,
    onCreateChat,
    onSelectChat,
    onDeleteChat,
    onOpenSystemPrompt,
    onOpenModelSettings,
    onMemoryStrategyChange,
    onSlidingWindowSizeChange,
    onStickyWindowSizeChange,
    onBranchInNewChat,
  } = props;

  const factRows: Array<{ label: string; value: string }> = [
    { label: "Goal", value: facts.goal },
    { label: "Constraints", value: facts.constraints },
    { label: "Preferences", value: facts.preferences },
    { label: "Decisions", value: facts.decisions },
    { label: "Agreements", value: facts.agreements },
  ];

  return (
    <aside className="sidebar left-col">
      <PanelHeader
        as="h2"
        variant="panel"
        title="Chats"
        actions={<UiButton onClick={onCreateChat}>New chat</UiButton>}
      />

      <div className="chat-list">
        {chats.map((chat) => (
          <article
            key={chat.id}
            className={`chat-item ${chat.id === activeChatId ? "active" : ""}`}
            onClick={() => onSelectChat(chat.id)}
          >
            <button className="chat-title" type="button">
              <span>{chat.title}</span>
              <small>{chat.lastMessagePreview ?? "No messages yet"}</small>
            </button>
            <button
              className="delete-chat"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onDeleteChat(chat.id);
              }}
              aria-label="Delete chat"
              title="Delete chat"
            >
              ×
            </button>
          </article>
        ))}
      </div>

      <div className="left-footer">
        <section className="memory-settings">
          <p className="memory-settings-title">Memory strategy</p>
          <FormField label="Strategy" htmlFor="memory-strategy-select">
            <DropdownSelect
              id="memory-strategy-select"
              value={memoryStrategy}
              onChange={(value) => onMemoryStrategyChange(value as MemoryStrategy)}
              disabled={isStreaming}
              options={memoryStrategyOptions.map((option) => ({
                value: option.value,
                label: option.label,
                disabled: !option.implemented,
              }))}
            />
          </FormField>
          {memoryStrategy === "sliding_window" ? (
            <FormField
              label="Sliding window size (N)"
              htmlFor="sliding-window-size-input"
            >
              <NumberStepperInput
                id="sliding-window-size-input"
                min={1}
                value={slidingWindowSize}
                onChange={onSlidingWindowSizeChange}
                disabled={isStreaming}
              />
            </FormField>
          ) : null}
          {memoryStrategy === "sticky_facts" ? (
            <>
              <FormField label="Sticky facts window size (N)" htmlFor="sticky-window-size-input">
                <NumberStepperInput
                  id="sticky-window-size-input"
                  min={1}
                  value={stickyWindowSize}
                  onChange={onStickyWindowSizeChange}
                  disabled={isStreaming}
                />
              </FormField>
              <div className="facts-view">
                <p className="facts-view-title">Facts</p>
                <dl className="facts-list">
                  {factRows.map((row) => (
                    <div className="facts-row" key={row.label}>
                      <dt>{row.label}</dt>
                      <dd>{row.value.trim() || "—"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </>
          ) : null}
          {memoryStrategy === "none" ? (
            <p className="hint">History is sent in full.</p>
          ) : null}
          {memoryStrategy === "branching" ? (
            <>
              <p className="hint">Branching uses full history and creates a copied chat branch.</p>
              <UiButton onClick={onBranchInNewChat} disabled={isStreaming}>
                Branch in new chat
              </UiButton>
            </>
          ) : null}
        </section>
        <div className="memory-settings-divider" aria-hidden="true" />
        <div className="left-footer-buttons">
          <UiButton
            className="footer-control-button"
            fullWidth
            onClick={onOpenSystemPrompt}
            aria-expanded={isSystemPromptOpen}
          >
            <span>System prompt</span>
          </UiButton>
          <UiButton
            className="footer-control-button"
            fullWidth
            onClick={onOpenModelSettings}
            aria-expanded={isModelSettingsOpen}
          >
            <span>⚙</span>
            <span>{activeModelLabel}</span>
          </UiButton>
        </div>
      </div>
    </aside>
  );
}
