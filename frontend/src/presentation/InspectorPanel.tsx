import type { RunMetrics } from "../domain/chat";

type Props = {
  model: string;
  metrics: RunMetrics | null;
  isMetricsOpen: boolean;
  requestRaw: string;
  responseRaw: string;
  errorText: string;
  formatNumber: (value: number | null) => string;
  formatUsd: (value: number | null) => string;
  onToggleMetrics: () => void;
  onOpenFullScreenRequest: () => void;
  onOpenFullScreenResponse: () => void;
};

export function InspectorPanel(props: Props) {
  const {
    model,
    metrics,
    isMetricsOpen,
    requestRaw,
    responseRaw,
    errorText,
    formatNumber,
    formatUsd,
    onToggleMetrics,
    onOpenFullScreenRequest,
    onOpenFullScreenResponse,
  } = props;

  return (
    <aside className="sidebar right-col">
      <section className="side-section metrics-section">
        <div className="side-section-header">
          <h3>Metrics</h3>
          <button className="section-action" type="button" onClick={onToggleMetrics}>
            {isMetricsOpen ? "Hide" : "Show"}
          </button>
        </div>
        {isMetricsOpen ? (
          <div className="metrics-compact">
            <p><strong>Model:</strong> {metrics?.model ?? model}</p>
            <p><strong>Latency:</strong> {formatNumber(metrics?.latencyMs ?? null)} ms</p>
            <p><strong>Input tokens:</strong> {formatNumber(metrics?.inputTokens ?? null)}</p>
            <p><strong>Output tokens:</strong> {formatNumber(metrics?.outputTokens ?? null)}</p>
            <p><strong>Total tokens:</strong> {formatNumber(metrics?.totalTokens ?? null)}</p>
            <p><strong>Cost (USD):</strong> {formatUsd(metrics?.costUsd ?? null)}</p>
          </div>
        ) : null}
      </section>

      <section className="side-section raw-section">
        <div className="side-section-header">
          <h3>Request</h3>
          <button className="section-action" type="button" onClick={onOpenFullScreenRequest}>
            Full screen
          </button>
        </div>
        <pre>{requestRaw || "Will appear after send"}</pre>
      </section>

      <section className="side-section raw-section">
        <div className="side-section-header">
          <h3>Response</h3>
          <button className="section-action" type="button" onClick={onOpenFullScreenResponse}>
            Full screen
          </button>
        </div>
        <pre>{responseRaw || "Will appear after completion"}</pre>
      </section>

      {errorText ? <p className="error">{errorText}</p> : null}
    </aside>
  );
}
