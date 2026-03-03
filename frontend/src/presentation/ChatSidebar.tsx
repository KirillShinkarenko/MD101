import type { ChatSummary } from "../domain/chat";
import { PanelHeader } from "./ui/PanelHeader";
import { UiButton } from "./ui/UiButton";

type Props = {
  chats: ChatSummary[];
  activeChatId: string | null;
  isModelSettingsOpen: boolean;
  isProfilesOpen: boolean;
  activeModelLabel: string;
  activeProfileLabel: string;
  onCreateChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onOpenProfiles: () => void;
  onOpenModelSettings: () => void;
};

export function ChatSidebar(props: Props) {
  const {
    chats,
    activeChatId,
    isModelSettingsOpen,
    isProfilesOpen,
    activeModelLabel,
    activeProfileLabel,
    onCreateChat,
    onSelectChat,
    onDeleteChat,
    onOpenProfiles,
    onOpenModelSettings,
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
            className="footer-setting-button"
            fullWidth
            onClick={onOpenProfiles}
            aria-expanded={isProfilesOpen}
            title={`Профиль: ${activeProfileLabel}`}
          >
            <span className="footer-setting-text">Профиль: {activeProfileLabel}</span>
            <span className="footer-setting-icon" aria-hidden="true">
              ⚙
            </span>
          </UiButton>
          <UiButton
            className="footer-setting-button"
            fullWidth
            onClick={onOpenModelSettings}
            aria-expanded={isModelSettingsOpen}
            title={`Модель: ${activeModelLabel}`}
          >
            <span className="footer-setting-text">Модель: {activeModelLabel}</span>
            <span className="footer-setting-icon" aria-hidden="true">
              ⚙
            </span>
          </UiButton>
        </div>
      </div>
    </aside>
  );
}
