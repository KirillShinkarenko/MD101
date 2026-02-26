import { MODEL_OPTIONS } from "./domain/chat";
import { useChatController } from "./application/useChatController";
import { ChatSidebar } from "./presentation/ChatSidebar";
import { ChatMainPanel } from "./presentation/ChatMainPanel";
import { InspectorPanel } from "./presentation/InspectorPanel";
import { ModelSettingsModal } from "./presentation/ModelSettingsModal";
import { SystemPromptModal } from "./presentation/SystemPromptModal";
import { FullScreenJsonModal } from "./presentation/FullScreenJsonModal";

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
        onCreateChat={() => void actions.createChat()}
        onSelectChat={actions.selectChat}
        onDeleteChat={(chatId) => void actions.deleteChat(chatId)}
        onOpenSystemPrompt={() => actions.setIsSystemPromptOpen(true)}
        onOpenModelSettings={() => actions.setIsModelSettingsOpen(true)}
      />

      <ChatMainPanel
        status={view.status}
        userPrompt={view.userPrompt}
        isStreaming={view.isStreaming}
        historyMode={view.historyMode}
        currentContextTokens={view.currentContextTokens}
        maxContextTokens={view.maxContextTokens}
        formatNumber={view.formatNumber}
        messages={view.messages}
        requestSavedInputTokens={view.requestSavedInputTokens}
        requestSavedInputPercent={view.requestSavedInputPercent}
        chatEndRef={view.chatEndRef}
        onUserPromptChange={actions.setUserPrompt}
        onPromptKeyDown={actions.handlePromptKeyDown}
        onMainAction={actions.handleMainAction}
        onCopyConversationText={() => void actions.copyConversationText()}
        onGenerateLongPrompt={actions.generateLongPrompt}
        onHistoryModeChange={(value) => void actions.handleHistoryModeChange(value)}
      />

      <InspectorPanel
        model={view.model}
        metrics={view.metrics}
        historyTotals={view.historyTotals}
        turnRows={view.turnRows}
        requestRaw={view.requestRaw}
        responseRaw={view.responseRaw}
        overflowErrorRaw={view.overflowErrorRaw}
        errorText={view.errorText}
        historyMode={view.historyMode}
        cumulativeSavedInputTokens={view.cumulativeSavedInputTokens}
        averageSavedPercent={view.averageSavedPercent}
        formatNumber={view.formatNumber}
        formatUsd={view.formatUsd}
        onOpenFullScreenRequest={() => actions.setFullScreenView("request")}
        onOpenFullScreenResponse={() => actions.setFullScreenView("response")}
      />

      <ModelSettingsModal
        isOpen={view.isModelSettingsOpen}
        model={view.model}
        temperature={view.temperature}
        reasoningEffort={view.reasoningEffort}
        summaryChunkSize={view.summaryChunkSize}
        summaryTailMessages={view.summaryTailMessages}
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
        onSummaryChunkSizeChange={(value) => void actions.handleSummaryChunkSizeChange(value)}
        onSummaryTailMessagesChange={(value) => void actions.handleSummaryTailMessagesChange(value)}
        onSaveSummarySettings={() => void actions.saveSummarySettings()}
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
    </main>
  );
}

export default App;
