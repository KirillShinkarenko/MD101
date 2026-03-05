import { MODEL_OPTIONS } from "./domain/chat";
import { useChatController } from "./application/useChatController";
import { ChatSidebar } from "./presentation/ChatSidebar";
import { ChatMainPanel } from "./presentation/ChatMainPanel";
import { InspectorPanel } from "./presentation/InspectorPanel";
import { ModelSettingsModal } from "./presentation/ModelSettingsModal";
import { SystemPromptModal } from "./presentation/SystemPromptModal";
import { FullScreenJsonModal } from "./presentation/FullScreenJsonModal";
import { ConversationInfoModal } from "./presentation/ConversationInfoModal";
import { ProfileManagerModal } from "./presentation/ProfileManagerModal";

function App() {
  const { view, actions } = useChatController();

  return (
    <main className="layout">
      <ChatSidebar
        chats={view.chats}
        activeChatId={view.activeChatId}
        isModelSettingsOpen={view.isModelSettingsOpen}
        isProfilesOpen={view.isProfilesOpen}
        activeModelLabel={view.activeModelLabel}
        activeProfileLabel={view.activeProfileLabel}
        onCreateChat={() => void actions.createChat()}
        onSelectChat={actions.selectChat}
        onDeleteChat={(chatId) => void actions.deleteChat(chatId)}
        onOpenProfiles={actions.openProfiles}
        onOpenModelSettings={() => actions.setIsModelSettingsOpen(true)}
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
        onRegenerateInvariantViolation={(payload) => void actions.regenerateFromInvariantViolation(payload)}
        onOpenConversationInfo={() => actions.setIsConversationInfoOpen(true)}
        onBranchInNewChat={() => void actions.branchInNewChat()}
        onOpenBranchSource={actions.openBranchSourceChat}
      />

      <InspectorPanel
        requestRaw={view.requestRaw}
        responseRaw={view.responseRaw}
        taskContext={view.taskContext}
        taskDraftStatus={view.taskDraftStatus}
        taskDraftError={view.taskDraftError}
        isTaskCommandPending={view.isTaskCommandPending}
        memory={view.memory}
        shortTermEnabled={view.shortTermEnabled}
        workingEnabled={view.workingEnabled}
        longTermEnabled={view.longTermEnabled}
        invariants={view.invariants}
        invariantsEnabled={view.invariantsEnabled}
        injectInvariantsInSystemPrompt={view.injectInvariantsInSystemPrompt}
        isInvariantSettingsSaving={view.isInvariantSettingsSaving}
        isInvariantsSaving={view.isInvariantsSaving}
        effectiveMemoryBlock={view.effectiveMemoryBlock}
        errorText={view.errorText}
        isStreaming={view.isStreaming}
        onOpenFullScreenRequest={() => actions.setFullScreenView("request")}
        onOpenFullScreenResponse={() => actions.setFullScreenView("response")}
        onPauseTask={() => void actions.pauseTask()}
        onResumeTask={() => void actions.resumeTask()}
        onApprovePlan={(artifactText, isEdited) => void actions.approvePlan(artifactText, isEdited)}
        onCompleteStep={(artifactText, isEdited) => void actions.completeStep(artifactText, isEdited)}
        onApproveValidation={(artifactText, isEdited) =>
          void actions.approveValidation(artifactText, isEdited)
        }
        onRequestReplan={() => void actions.requestReplan()}
        onRequestRework={() => void actions.requestRework()}
        onSaveWorking={actions.saveWorkingMemory}
        onSaveLongTerm={actions.saveLongTermMemory}
        onApproveCandidate={actions.approveCandidate}
        onRejectCandidate={actions.rejectCandidate}
        onInvariantsEnabledChange={actions.setInvariantsEnabled}
        onInjectInvariantsInSystemPromptChange={actions.setInjectInvariantsInSystemPrompt}
        onCreateInvariant={actions.createInvariant}
        onUpdateInvariant={actions.updateInvariant}
        onDeleteInvariant={actions.deleteInvariant}
      />

      <ModelSettingsModal
        isOpen={view.isModelSettingsOpen}
        model={view.model}
        memoryModel={view.memoryModel}
        reasoningEffort={view.reasoningEffort}
        shortTermEnabled={view.shortTermEnabled}
        workingEnabled={view.workingEnabled}
        longTermEnabled={view.longTermEnabled}
        isStreaming={view.isStreaming}
        isMemorySettingsSaving={view.isMemorySettingsSaving}
        isReasoningSupported={view.isReasoningSupported}
        reasoningOptions={view.reasoningOptions}
        modelOptions={[...MODEL_OPTIONS]}
        onClose={() => actions.setIsModelSettingsOpen(false)}
        onModelChange={(value) => void actions.handleModelChange(value)}
        onMemoryModelChange={actions.handleMemoryModelChange}
        onShortTermEnabledChange={(value) => void actions.setShortTermEnabled(value)}
        onWorkingEnabledChange={(value) => void actions.setWorkingEnabled(value)}
        onLongTermEnabledChange={(value) => void actions.setLongTermEnabled(value)}
        onReasoningEffortChange={actions.setReasoningEffort}
      />

      <SystemPromptModal
        isOpen={view.isSystemPromptOpen}
        systemPrompt={view.systemPrompt}
        onClose={() => actions.setIsSystemPromptOpen(false)}
        onChange={actions.setSystemPrompt}
      />

      <ProfileManagerModal
        isOpen={view.isProfilesOpen}
        profiles={view.profiles}
        activeProfileId={view.activeProfileId}
        selectedProfileId={view.selectedProfileId}
        draft={view.profileDraft}
        isSaving={view.isProfilesSaving}
        onClose={actions.closeProfiles}
        onCreate={() => void actions.createProfile()}
        onDelete={(profileId) => void actions.deleteProfile(profileId)}
        onSelect={actions.selectProfile}
        onSetActive={(profileId) => void actions.setActiveProfile(profileId)}
        onChangeDraft={actions.setProfileDraft}
        onSave={() => void actions.saveProfile()}
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
