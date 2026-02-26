import type { HistoryMode } from "../domain/chat";
import { useMemo, useState } from "react";
import type { HistoryTotals, RunMetrics, TurnGrowthRow } from "../domain/chat";

type Props = {
  model: string;
  metrics: RunMetrics | null;
  historyTotals: HistoryTotals;
  turnRows: TurnGrowthRow[];
  requestRaw: string;
  responseRaw: string;
  overflowErrorRaw: string;
  errorText: string;
  historyMode: HistoryMode;
  cumulativeSavedInputTokens: number;
  averageSavedPercent: number;
  formatNumber: (value: number | null) => string;
  formatUsd: (value: number | null) => string;
  onOpenFullScreenRequest: () => void;
  onOpenFullScreenResponse: () => void;
};

export function InspectorPanel(props: Props) {
  const {
    model,
    metrics,
    historyTotals,
    turnRows,
    requestRaw,
    responseRaw,
    overflowErrorRaw,
    errorText,
    historyMode,
    cumulativeSavedInputTokens,
    averageSavedPercent,
    formatNumber,
    formatUsd,
    onOpenFullScreenRequest,
    onOpenFullScreenResponse,
  } = props;
  const [isRequestOpen, setIsRequestOpen] = useState(false);
  const [isResponseOpen, setIsResponseOpen] = useState(false);
  const growthRows = useMemo(() => [...turnRows].reverse(), [turnRows]);

  return (
    <aside className="sidebar right-col">
      <section className="side-section metrics-section">
        <div className="side-section-header">
          <h3>Metrics</h3>
        </div>
        <div className="metrics-blocks">
          <section className="metrics-card">
            <h4>Current request</h4>
            <div className="metrics-compact">
              <p><strong>Model:</strong> {metrics?.model ?? model}</p>
              <p><strong>Latency:</strong> {formatNumber(metrics?.latencyMs ?? null)} ms</p>
              <p><strong>Input:</strong> {formatNumber(metrics?.inputTokens ?? null)}</p>
              <p><strong>Output:</strong> {formatNumber(metrics?.outputTokens ?? null)}</p>
              <p><strong>Total:</strong> {formatNumber(metrics?.totalTokens ?? null)}</p>
              <p><strong>Cost:</strong> {formatUsd(metrics?.costUsd ?? null)}</p>
            </div>
          </section>

          <section className="metrics-card">
            <h4>Conversation total</h4>
            <div className="metrics-compact">
              <p><strong>Input:</strong> {formatNumber(historyTotals.inputTokens)}</p>
              <p><strong>Output:</strong> {formatNumber(historyTotals.outputTokens)}</p>
              <p><strong>Total:</strong> {formatNumber(historyTotals.totalTokens)}</p>
              <p><strong>Cost:</strong> {formatUsd(historyTotals.costUsd)}</p>
            </div>
          </section>

          <section className="metrics-card">
            <h4>Context savings</h4>
            <div className="metrics-compact">
              <p><strong>Mode:</strong> {historyMode}</p>
              <p><strong>Saved this request:</strong> {formatNumber(metrics?.tokenSavings.savedInputTokens ?? 0)}</p>
              <p><strong>Saved this request %:</strong> {(metrics?.tokenSavings.savedInputPercent ?? 0).toFixed(2)}%</p>
              <p><strong>Cumulative saved:</strong> {formatNumber(cumulativeSavedInputTokens)}</p>
              <p><strong>Avg saved %:</strong> {averageSavedPercent.toFixed(2)}%</p>
            </div>
          </section>

          <section className="metrics-card">
            <h4>Growth by turns</h4>
            {growthRows.length === 0 ? (
              <p className="hint">No completed assistant responses yet.</p>
            ) : (
              <div className="metrics-table-wrap metrics-table-wrap-growth">
                <table className="metrics-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>current</th>
                      <th>total</th>
                      <th>saved</th>
                      <th>saved total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {growthRows.map((row) => (
                      <tr key={row.turnIndex}>
                        <td>{row.turnIndex}</td>
                        <td>{formatNumber(row.totalTokens)}</td>
                        <td>{formatNumber(row.cumulativeTotalTokens)}</td>
                        <td>{formatNumber(row.savedInputTokens)}</td>
                        <td>{formatNumber(row.cumulativeSavedInputTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </section>

      <section className="side-section raw-section">
        <div className="side-section-header">
          <h3>Request</h3>
          <div className="section-actions">
            <button className="section-action" type="button" onClick={() => setIsRequestOpen((prev) => !prev)}>
              {isRequestOpen ? "Collapse" : "Expand"}
            </button>
            <button className="section-action" type="button" onClick={onOpenFullScreenRequest}>
              Full screen
            </button>
          </div>
        </div>
        {isRequestOpen ? <pre>{requestRaw || "Will appear after send"}</pre> : null}
      </section>

      <section className="side-section raw-section">
        <div className="side-section-header">
          <h3>Response</h3>
          <div className="section-actions">
            <button className="section-action" type="button" onClick={() => setIsResponseOpen((prev) => !prev)}>
              {isResponseOpen ? "Collapse" : "Expand"}
            </button>
            <button className="section-action" type="button" onClick={onOpenFullScreenResponse}>
              Full screen
            </button>
          </div>
        </div>
        {isResponseOpen ? <pre>{responseRaw || "Will appear after completion"}</pre> : null}
      </section>

      <section className="side-section raw-section">
        <div className="side-section-header">
          <h3>Overflow error</h3>
        </div>
        <pre>{overflowErrorRaw || "Will appear when context_length_exceeded happens"}</pre>
      </section>

      {errorText ? <p className="error">{errorText}</p> : null}
    </aside>
  );
}
