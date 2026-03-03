import type { ChatSummary } from "../domain/chat";
import { PanelHeader } from "./ui/PanelHeader";
import { UiButton } from "./ui/UiButton";

type Props = {
  chats: ChatSummary[];
  activeChatId: string | null;
  isModelSettingsOpen: boolean;
  isSystemPromptOpen: boolean;
  activeModelLabel: string;
  isStreaming: boolean;
  isBranchAvailable: boolean;
  onCreateChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onOpenSystemPrompt: () => void;
  onOpenModelSettings: () => void;
  onBranchInNewChat: () => void;
};

export function ChatSidebar(props: Props) {
  const {
    chats,
    activeChatId,
    isModelSettingsOpen,
    isSystemPromptOpen,
    activeModelLabel,
    isStreaming,
    isBranchAvailable,
    onCreateChat,
    onSelectChat,
    onDeleteChat,
    onOpenSystemPrompt,
    onOpenModelSettings,
    onBranchInNewChat,
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
          <UiButton
            className="footer-control-button"
            fullWidth
            onClick={onBranchInNewChat}
            disabled={!isBranchAvailable || isStreaming}
          >
            <span>Branch in new chat</span>
          </UiButton>
        </div>
      </div>
    </aside>
  );
}
