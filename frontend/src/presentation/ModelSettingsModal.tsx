import type { ReasoningEffort } from "../domain/chat";

type Props = {
  isOpen: boolean;
  model: string;
  temperature: string;
  reasoningEffort: ReasoningEffort;
  summaryChunkSize: string;
  summaryTailMessages: string;
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
  onSummaryChunkSizeChange: (value: string) => void;
  onSummaryTailMessagesChange: (value: string) => void;
  onSaveSummarySettings: () => void;
};

export function ModelSettingsModal(props: Props) {
  const {
    isOpen,
    model,
    temperature,
    reasoningEffort,
    summaryChunkSize,
    summaryTailMessages,
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
    onSummaryChunkSizeChange,
    onSummaryTailMessagesChange,
    onSaveSummarySettings,
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
          <label htmlFor="modal-summary-tail">Messages without summary</label>
          <input
            id="modal-summary-tail"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={summaryTailMessages}
            onChange={(event) => onSummaryTailMessagesChange(event.target.value)}
            disabled={isStreaming}
          />
          <label htmlFor="modal-summary-chunk">Summary chunk size</label>
          <input
            id="modal-summary-chunk"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={summaryChunkSize}
            onChange={(event) => onSummaryChunkSizeChange(event.target.value)}
            disabled={isStreaming}
          />
          <button type="button" onClick={onSaveSummarySettings} disabled={isStreaming}>
            Save summary settings
          </button>
        </div>
      </section>
    </div>
  );
}
