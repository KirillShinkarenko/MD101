import type { ReasoningEffort } from "../domain/chat";
import { DropdownSelect } from "./DropdownSelect";
import { FormField } from "./ui/FormField";
import { ModalShell } from "./ui/ModalShell";

type Props = {
  isOpen: boolean;
  model: string;
  factsModel: string;
  reasoningEffort: ReasoningEffort;
  isStreaming: boolean;
  isReasoningSupported: boolean;
  reasoningOptions: ReasoningEffort[];
  modelOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
  onModelChange: (value: string) => void;
  onFactsModelChange: (value: string) => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
};

export function ModelSettingsModal(props: Props) {
  const {
    isOpen,
    model,
    factsModel,
    reasoningEffort,
    isStreaming,
    isReasoningSupported,
    reasoningOptions,
    modelOptions,
    onClose,
    onModelChange,
    onFactsModelChange,
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
      <FormField label="Facts model" htmlFor="modal-facts-model">
        <DropdownSelect
          id="modal-facts-model"
          value={factsModel}
          onChange={onFactsModelChange}
          disabled={isStreaming}
          options={modelOptions.map((option) => ({
            value: option.value,
            label: option.label,
          }))}
        />
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
