import type { ChatSummary } from "../domain/chat";

type Props = {
  chats: ChatSummary[];
  activeChatId: string | null;
  isModelSettingsOpen: boolean;
  isSystemPromptOpen: boolean;
  activeModelLabel: string;
  onCreateChat: () => void;
  onSelectChat: (chatId: string) => void;
  onDeleteChat: (chatId: string) => void;
  onOpenSystemPrompt: () => void;
  onOpenModelSettings: () => void;
};

export function ChatSidebar(props: Props) {
  const {
    chats,
    activeChatId,
    isModelSettingsOpen,
    isSystemPromptOpen,
    activeModelLabel,
    onCreateChat,
    onSelectChat,
    onDeleteChat,
    onOpenSystemPrompt,
    onOpenModelSettings,
  } = props;

  return (
    <aside className="sidebar left-col">
      <div className="panel-header">
        <h2>Chats</h2>
        <button onClick={onCreateChat} type="button">
          New chat
        </button>
      </div>

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
          <button
            className="footer-control-button"
            type="button"
            onClick={onOpenSystemPrompt}
            aria-expanded={isSystemPromptOpen}
          >
            <span>System prompt</span>
          </button>
          <button
            className="footer-control-button"
            type="button"
            onClick={onOpenModelSettings}
            aria-expanded={isModelSettingsOpen}
          >
            <span>⚙</span>
            <span>{activeModelLabel}</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
