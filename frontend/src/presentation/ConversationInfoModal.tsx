import { useMemo } from "react";
import type { HistoryTotals, RunMetrics, TurnGrowthRow } from "../domain/chat";
import { ModalShell } from "./ui/ModalShell";
import { UiCard } from "./ui/UiCard";

type Props = {
  isOpen: boolean;
  model: string;
  metrics: RunMetrics | null;
  historyTotals: HistoryTotals;
  turnRows: TurnGrowthRow[];
  formatNumber: (value: number | null) => string;
  formatUsd: (value: number | null) => string;
  onClose: () => void;
};

export function ConversationInfoModal(props: Props) {
  const { isOpen, model, metrics, historyTotals, turnRows, formatNumber, formatUsd, onClose } = props;
  const growthRows = useMemo(() => [...turnRows].reverse(), [turnRows]);

  if (!isOpen) {
    return null;
  }

  return (
    <ModalShell isOpen={isOpen} title="Conversation info" onClose={onClose} panelClassName="modal-panel-info">
      <div className="metrics-blocks">
        <UiCard title="Current request">
          <div className="metrics-compact">
            <p><strong>Model:</strong> {metrics?.model ?? model}</p>
            <p><strong>Latency:</strong> {formatNumber(metrics?.latencyMs ?? null)} ms</p>
            <p><strong>Input:</strong> {formatNumber(metrics?.inputTokens ?? null)}</p>
            <p><strong>Output:</strong> {formatNumber(metrics?.outputTokens ?? null)}</p>
            <p><strong>Total:</strong> {formatNumber(metrics?.totalTokens ?? null)}</p>
            <p><strong>Cost:</strong> {formatUsd(metrics?.costUsd ?? null)}</p>
          </div>
        </UiCard>

        <UiCard title="Conversation total">
          <div className="metrics-compact">
            <p><strong>Input:</strong> {formatNumber(historyTotals.inputTokens)}</p>
            <p><strong>Output:</strong> {formatNumber(historyTotals.outputTokens)}</p>
            <p><strong>Total:</strong> {formatNumber(historyTotals.totalTokens)}</p>
            <p><strong>Cost:</strong> {formatUsd(historyTotals.costUsd)}</p>
          </div>
        </UiCard>

        <UiCard title="Growth by turns">
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
                  </tr>
                </thead>
                <tbody>
                  {growthRows.map((row) => (
                    <tr key={row.turnIndex}>
                      <td>{row.turnIndex}</td>
                      <td>{formatNumber(row.totalTokens)}</td>
                      <td>{formatNumber(row.cumulativeTotalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </UiCard>
      </div>
    </ModalShell>
  );
}
