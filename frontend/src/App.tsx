import { MEMORY_STRATEGY_OPTIONS, MODEL_OPTIONS } from "./domain/chat";
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
        memoryStrategy={view.memoryStrategy}
        slidingWindowSize={view.slidingWindowSize}
        stickyWindowSize={view.stickyWindowSize}
        stickyFacts={view.stickyFacts}
        isStreaming={view.isStreaming}
        memoryStrategyOptions={MEMORY_STRATEGY_OPTIONS}
        onCreateChat={() => void actions.createChat()}
        onSelectChat={actions.selectChat}
        onDeleteChat={(chatId) => void actions.deleteChat(chatId)}
        onOpenSystemPrompt={() => actions.setIsSystemPromptOpen(true)}
        onOpenModelSettings={() => actions.setIsModelSettingsOpen(true)}
        onMemoryStrategyChange={(value) => void actions.handleMemoryStrategyChange(value)}
        onSlidingWindowSizeChange={(value) => void actions.handleSlidingWindowSizeChange(value)}
        onStickyWindowSizeChange={(value) => void actions.handleStickyWindowSizeChange(value)}
      />

      <ChatMainPanel
        status={view.status}
        userPrompt={view.userPrompt}
        isStreaming={view.isStreaming}
        currentContextTokens={view.currentContextTokens}
        maxContextTokens={view.maxContextTokens}
        formatNumber={view.formatNumber}
        messages={view.messages}
        chatEndRef={view.chatEndRef}
        onUserPromptChange={actions.setUserPrompt}
        onPromptKeyDown={actions.handlePromptKeyDown}
        onMainAction={actions.handleMainAction}
        onOpenConversationInfo={() => actions.setIsConversationInfoOpen(true)}
      />

      <InspectorPanel
        requestRaw={view.requestRaw}
        responseRaw={view.responseRaw}
        errorText={view.errorText}
        onOpenFullScreenRequest={() => actions.setFullScreenView("request")}
        onOpenFullScreenResponse={() => actions.setFullScreenView("response")}
      />

      <ModelSettingsModal
        isOpen={view.isModelSettingsOpen}
        model={view.model}
        temperature={view.temperature}
        reasoningEffort={view.reasoningEffort}
        isStreaming={view.isStreaming}
        isTemperatureSupported={view.isTemperatureSupported}
        isReasoningSupported={view.isReasoningSupported}
        temperaturePolicy={view.temperaturePolicy}
        reasoningOptions={view.reasoningOptions}
        modelOptions={[...MODEL_OPTIONS]}
        onClose={() => actions.setIsModelSettingsOpen(false)}
        onModelChange={(value) => void actions.handleModelChange(value)}
        onTemperatureChange={actions.setTemperature}
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
