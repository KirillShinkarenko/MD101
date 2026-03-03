import { MODEL_OPTIONS } from "./domain/chat";
import { useChatController } from "./application/useChatController";
import { ChatSidebar } from "./presentation/ChatSidebar";
import { ChatMainPanel } from "./presentation/ChatMainPanel";
import { InspectorPanel } from "./presentation/InspectorPanel";
import { ModelSettingsModal } from "./presentation/ModelSettingsModal";
import { SystemPromptModal } from "./presentation/SystemPromptModal";
import { FullScreenJsonModal } from "./presentation/FullScreenJsonModal";
import { ConversationInfoModal } from "./presentation/ConversationInfoModal";

function App() {
  const { view, actions } = useChatController();

  return (
    <main className="layout">
      <ChatSidebar
        chats={view.chats}
        activeChatId={view.activeChatId}
        isModelSettingsOpen={view.isModelSettingsOpen}
        isSystemPromptOpen={view.isSystemPromptOpen}
        activeModelLabel={view.activeModelLabel}
        isStreaming={view.isStreaming}
        isBranchAvailable={Boolean(view.activeChatId)}
        onCreateChat={() => void actions.createChat()}
        onSelectChat={actions.selectChat}
        onDeleteChat={(chatId) => void actions.deleteChat(chatId)}
        onOpenSystemPrompt={() => actions.setIsSystemPromptOpen(true)}
        onOpenModelSettings={() => actions.setIsModelSettingsOpen(true)}
        onBranchInNewChat={() => void actions.branchInNewChat()}
      />

      <ChatMainPanel
        userPrompt={view.userPrompt}
        isStreaming={view.isStreaming}
        isBranchAvailable={Boolean(view.activeChatId)}
        branchFromChatId={view.branchFromChatId}
        branchFromChatTitle={view.branchFromChatTitle}
        branchCheckpointMessageCount={view.branchCheckpointMessageCount}
        currentContextTokens={view.currentContextTokens}
        maxContextTokens={view.maxContextTokens}
        formatNumber={view.formatNumber}
        messages={view.messages}
        chatEndRef={view.chatEndRef}
        onUserPromptChange={actions.setUserPrompt}
        onPromptKeyDown={actions.handlePromptKeyDown}
        onMainAction={actions.handleMainAction}
        onOpenConversationInfo={() => actions.setIsConversationInfoOpen(true)}
        onBranchInNewChat={() => void actions.branchInNewChat()}
        onOpenBranchSource={actions.openBranchSourceChat}
      />

      <InspectorPanel
        requestRaw={view.requestRaw}
        responseRaw={view.responseRaw}
        memory={view.memory}
        effectiveMemoryBlock={view.effectiveMemoryBlock}
        errorText={view.errorText}
        isStreaming={view.isStreaming}
        onOpenFullScreenRequest={() => actions.setFullScreenView("request")}
        onOpenFullScreenResponse={() => actions.setFullScreenView("response")}
        onSaveWorking={actions.saveWorkingMemory}
        onSaveLongTerm={actions.saveLongTermMemory}
        onApproveCandidate={actions.approveCandidate}
        onRejectCandidate={actions.rejectCandidate}
      />

      <ModelSettingsModal
        isOpen={view.isModelSettingsOpen}
        model={view.model}
        memoryModel={view.memoryModel}
        reasoningEffort={view.reasoningEffort}
        isStreaming={view.isStreaming}
        isReasoningSupported={view.isReasoningSupported}
        reasoningOptions={view.reasoningOptions}
        modelOptions={[...MODEL_OPTIONS]}
        onClose={() => actions.setIsModelSettingsOpen(false)}
        onModelChange={(value) => void actions.handleModelChange(value)}
        onMemoryModelChange={actions.handleMemoryModelChange}
        onReasoningEffortChange={actions.setReasoningEffort}
      />

      <SystemPromptModal
        isOpen={view.isSystemPromptOpen}
        systemPrompt={view.systemPrompt}
        onClose={() => actions.setIsSystemPromptOpen(false)}
        onChange={actions.setSystemPrompt}
      />

      <FullScreenJsonModal
        view={view.fullScreenView}
        requestRaw={view.requestRaw}
        responseRaw={view.responseRaw}
        onClose={() => actions.setFullScreenView(null)}
      />

      <ConversationInfoModal
        isOpen={view.isConversationInfoOpen}
        model={view.model}
        metrics={view.metrics}
        historyTotals={view.historyTotals}
        turnRows={view.turnRows}
        formatNumber={view.formatNumber}
        formatUsd={view.formatUsd}
        onClose={() => actions.setIsConversationInfoOpen(false)}
      />
    </main>
  );
}

export default App;
