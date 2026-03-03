import type { ReasoningEffort } from "../domain/chat";
import { DropdownSelect } from "./DropdownSelect";
import { FormField } from "./ui/FormField";
import { ModalShell } from "./ui/ModalShell";

type Props = {
  isOpen: boolean;
  model: string;
  memoryModel: string;
  reasoningEffort: ReasoningEffort;
  shortTermEnabled: boolean;
  workingEnabled: boolean;
  longTermEnabled: boolean;
  isStreaming: boolean;
  isMemorySettingsSaving: boolean;
  isReasoningSupported: boolean;
  reasoningOptions: ReasoningEffort[];
  modelOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
  onModelChange: (value: string) => void;
  onMemoryModelChange: (value: string) => void;
  onShortTermEnabledChange: (value: boolean) => void;
  onWorkingEnabledChange: (value: boolean) => void;
  onLongTermEnabledChange: (value: boolean) => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
};

export function ModelSettingsModal(props: Props) {
  const {
    isOpen,
    model,
    memoryModel,
    reasoningEffort,
    shortTermEnabled,
    workingEnabled,
    longTermEnabled,
    isStreaming,
    isMemorySettingsSaving,
    isReasoningSupported,
    reasoningOptions,
    modelOptions,
    onClose,
    onModelChange,
    onMemoryModelChange,
    onShortTermEnabledChange,
    onWorkingEnabledChange,
    onLongTermEnabledChange,
    onReasoningEffortChange,
  } = props;

  if (!isOpen) {
    return null;
  }

  return (
    <ModalShell isOpen={isOpen} title="Model settings" onClose={onClose}>
      <FormField label="Model" htmlFor="modal-model">
        <DropdownSelect
          id="modal-model"
          value={model}
          onChange={onModelChange}
          disabled={isStreaming}
          options={modelOptions.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </FormField>
      <FormField label="Memory updater model" htmlFor="modal-memory-model">
        <DropdownSelect
          id="modal-memory-model"
          value={memoryModel}
          onChange={onMemoryModelChange}
          disabled={isStreaming}
          options={modelOptions.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
      </FormField>
      <FormField label="Short-term memory" htmlFor="modal-short-term-enabled">
        <label className="memory-toggle-control" htmlFor="modal-short-term-enabled">
          <input
            id="modal-short-term-enabled"
            className="memory-toggle-input"
            type="checkbox"
            checked={shortTermEnabled}
            onChange={(event) => onShortTermEnabledChange(event.target.checked)}
            disabled={isStreaming || isMemorySettingsSaving}
          />
          <span>{shortTermEnabled ? "Enabled" : "Disabled"}</span>
        </label>
      </FormField>
      <FormField label="Working memory" htmlFor="modal-working-enabled">
        <label className="memory-toggle-control" htmlFor="modal-working-enabled">
          <input
            id="modal-working-enabled"
            className="memory-toggle-input"
            type="checkbox"
            checked={workingEnabled}
            onChange={(event) => onWorkingEnabledChange(event.target.checked)}
            disabled={isStreaming || isMemorySettingsSaving}
          />
          <span>{workingEnabled ? "Enabled" : "Disabled"}</span>
        </label>
      </FormField>
      <FormField label="Long-term memory" htmlFor="modal-long-term-enabled">
        <label className="memory-toggle-control" htmlFor="modal-long-term-enabled">
          <input
            id="modal-long-term-enabled"
            className="memory-toggle-input"
            type="checkbox"
            checked={longTermEnabled}
            onChange={(event) => onLongTermEnabledChange(event.target.checked)}
            disabled={isStreaming || isMemorySettingsSaving}
          />
          <span>{longTermEnabled ? "Enabled" : "Disabled"}</span>
        </label>
      </FormField>
      <FormField label="Reasoning effort" htmlFor="modal-reasoning-effort">
        <DropdownSelect
          id="modal-reasoning-effort"
          value={isReasoningSupported ? reasoningEffort : "none"}
          onChange={(value) => onReasoningEffortChange(value as ReasoningEffort)}
          disabled={!isReasoningSupported || isStreaming}
          options={
            !isReasoningSupported
              ? [{ value: "none", label: "Not supported" }]
              : reasoningOptions.map((option) => ({
                  value: option,
                  label: option,
                }))
          }
        />
      </FormField>
    </ModalShell>
  );
}
