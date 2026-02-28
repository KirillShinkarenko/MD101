import type { ReasoningEffort } from "../domain/chat";
import { DropdownSelect } from "./DropdownSelect";
import { FormField } from "./ui/FormField";
import { ModalShell } from "./ui/ModalShell";

type Props = {
  isOpen: boolean;
  model: string;
  temperature: string;
  reasoningEffort: ReasoningEffort;
  isStreaming: boolean;
  isTemperatureSupported: boolean;
  isReasoningSupported: boolean;
  temperaturePolicy: "never" | "always" | "reasoning_none_only";
  reasoningOptions: ReasoningEffort[];
  modelOptions: Array<{ value: string; label: string }>;
  onClose: () => void;
  onModelChange: (value: string) => void;
  onTemperatureChange: (value: string) => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
};

export function ModelSettingsModal(props: Props) {
  const {
    isOpen,
    model,
    temperature,
    reasoningEffort,
    isStreaming,
    isTemperatureSupported,
    isReasoningSupported,
    temperaturePolicy,
    reasoningOptions,
    modelOptions,
    onClose,
    onModelChange,
    onTemperatureChange,
    onReasoningEffortChange,
  } = props;

  if (!isOpen) {
    return null;
  }

  const temperatureHint =
    temperaturePolicy === "never"
      ? "This model does not support temperature."
      : temperaturePolicy === "reasoning_none_only"
      ? "Temperature is available only with reasoning effort = none."
      : undefined;

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
      <FormField label="Temperature" htmlFor="modal-temperature" hint={temperatureHint}>
        <input
          id="modal-temperature"
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={(event) => onTemperatureChange(event.target.value)}
          disabled={!isTemperatureSupported || isStreaming}
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
