import type { ReasoningEffort } from "../domain/chat";

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

  return (
    <div className="modal-overlay" onClick={onClose} role="presentation">
      <section className="modal-panel" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <h3>Model settings</h3>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-content">
          <label htmlFor="modal-model">Model</label>
          <select
            id="modal-model"
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            disabled={isStreaming}
          >
            {modelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <label htmlFor="modal-temperature">Temperature</label>
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
          <label htmlFor="modal-reasoning-effort">Reasoning effort</label>
          <select
            id="modal-reasoning-effort"
            value={isReasoningSupported ? reasoningEffort : "none"}
            onChange={(event) => onReasoningEffortChange(event.target.value as ReasoningEffort)}
            disabled={!isReasoningSupported || isStreaming}
          >
            {!isReasoningSupported ? (
              <option value="none">Not supported</option>
            ) : (
              reasoningOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))
            )}
          </select>
          {temperaturePolicy === "never" ? (
            <p className="hint">This model does not support temperature.</p>
          ) : null}
          {temperaturePolicy === "reasoning_none_only" ? (
            <p className="hint">Temperature is available only with reasoning effort = none.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
