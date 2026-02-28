import type { ChatSummary, MemoryStrategy } from "../domain/chat";
import { DropdownSelect } from "./DropdownSelect";
import { FormField } from "./ui/FormField";
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
    isStreaming,
    memoryStrategyOptions,
    onCreateChat,
    onSelectChat,
    onDeleteChat,
    onOpenSystemPrompt,
    onOpenModelSettings,
    onMemoryStrategyChange,
    onSlidingWindowSizeChange,
  } = props;

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
              hint="Only Sliding Window is implemented for now."
            >
              <input
                id="sliding-window-size-input"
                type="number"
                min={1}
                value={slidingWindowSize}
                onChange={(event) => onSlidingWindowSizeChange(event.target.value)}
                disabled={isStreaming}
              />
            </FormField>
          ) : (
            <p className="hint">History is sent in full.</p>
          )}
        </section>
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
