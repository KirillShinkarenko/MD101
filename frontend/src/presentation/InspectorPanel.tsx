import { useEffect, useMemo, useState } from "react";
import type { ChatMemorySnapshot, LongTermMemory, WorkingMemory } from "../domain/chat";
import { PanelHeader } from "./ui/PanelHeader";
import { UiButton } from "./ui/UiButton";

type TabKey = "request" | "response" | "memory";

type Props = {
  requestRaw: string;
  responseRaw: string;
  memory: ChatMemorySnapshot;
  effectiveMemoryBlock: string;
  errorText: string;
  isStreaming: boolean;
  onOpenFullScreenRequest: () => void;
  onOpenFullScreenResponse: () => void;
  onSaveWorking: (body: Partial<Pick<WorkingMemory, "goal" | "constraints" | "status" | "nextSteps">>) => Promise<void>;
  onSaveLongTerm: (
    body: Partial<Pick<LongTermMemory, "profile" | "preferences" | "decisions" | "knowledge">>
  ) => Promise<void>;
  onApproveCandidate: (candidateId: string) => Promise<void>;
  onRejectCandidate: (candidateId: string) => Promise<void>;
};

const formatTimestamp = (value: number): string => {
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }
  return new Date(value).toLocaleString();
};

export function InspectorPanel(props: Props) {
  const {
    requestRaw,
    responseRaw,
    memory,
    effectiveMemoryBlock,
    errorText,
    isStreaming,
    onOpenFullScreenRequest,
    onOpenFullScreenResponse,
    onSaveWorking,
    onSaveLongTerm,
    onApproveCandidate,
    onRejectCandidate,
  } = props;

  const [activeTab, setActiveTab] = useState<TabKey>("request");
  const [isWorkingSaving, setIsWorkingSaving] = useState(false);
  const [isLongTermSaving, setIsLongTermSaving] = useState(false);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);

  const [workingDraft, setWorkingDraft] = useState({
    goal: memory.working.goal,
    constraints: memory.working.constraints,
    status: memory.working.status,
    nextSteps: memory.working.nextSteps,
  });

  const [longTermDraft, setLongTermDraft] = useState({
    profile: memory.longTerm.profile,
    preferences: memory.longTerm.preferences,
    decisions: memory.longTerm.decisions,
    knowledge: memory.longTerm.knowledge,
  });

  useEffect(() => {
    setWorkingDraft({
      goal: memory.working.goal,
      constraints: memory.working.constraints,
      status: memory.working.status,
      nextSteps: memory.working.nextSteps,
    });
  }, [memory.working.goal, memory.working.constraints, memory.working.status, memory.working.nextSteps]);

  useEffect(() => {
    setLongTermDraft({
      profile: memory.longTerm.profile,
      preferences: memory.longTerm.preferences,
      decisions: memory.longTerm.decisions,
      knowledge: memory.longTerm.knowledge,
    });
  }, [memory.longTerm.profile, memory.longTerm.preferences, memory.longTerm.decisions, memory.longTerm.knowledge]);

  const pendingCount = memory.pendingCandidates.length;
  const tabLabel = useMemo(
    () => ({
      request: "Request",
      response: "Response",
      memory: pendingCount > 0 ? `Memory (${pendingCount})` : "Memory",
    }),
    [pendingCount]
  );

  const handleSaveWorking = async () => {
    setIsWorkingSaving(true);
    try {
      await onSaveWorking(workingDraft);
    } finally {
      setIsWorkingSaving(false);
    }
  };

  const handleSaveLongTerm = async () => {
    setIsLongTermSaving(true);
    try {
      await onSaveLongTerm(longTermDraft);
    } finally {
      setIsLongTermSaving(false);
    }
  };

  const handleApprove = async (candidateId: string) => {
    setBusyCandidateId(candidateId);
    try {
      await onApproveCandidate(candidateId);
    } finally {
      setBusyCandidateId(null);
    }
  };

  const handleReject = async (candidateId: string) => {
    setBusyCandidateId(candidateId);
    try {
      await onRejectCandidate(candidateId);
    } finally {
      setBusyCandidateId(null);
    }
  };

  return (
    <aside className="sidebar right-col inspector-tabs-layout">
      <section className="inspector-tab-header">
        <div className="inspector-tabs">
          <button
            className={`inspector-tab-btn ${activeTab === "request" ? "is-active" : ""}`}
            type="button"
            onClick={() => setActiveTab("request")}
          >
            {tabLabel.request}
          </button>
          <button
            className={`inspector-tab-btn ${activeTab === "response" ? "is-active" : ""}`}
            type="button"
            onClick={() => setActiveTab("response")}
          >
            {tabLabel.response}
          </button>
          <button
            className={`inspector-tab-btn ${activeTab === "memory" ? "is-active" : ""}`}
            type="button"
            onClick={() => setActiveTab("memory")}
          >
            {tabLabel.memory}
          </button>
        </div>
      </section>

      {activeTab === "request" ? (
        <section className="side-section raw-section is-open">
          <PanelHeader
            as="h3"
            variant="section"
            title="Request"
            actions={
              <UiButton size="sm" className="section-action" onClick={onOpenFullScreenRequest}>
                Full screen
              </UiButton>
            }
          />
          <pre>{requestRaw || "Will appear after send"}</pre>
        </section>
      ) : null}

      {activeTab === "response" ? (
        <section className="side-section raw-section is-open">
          <PanelHeader
            as="h3"
            variant="section"
            title="Response"
            actions={
              <UiButton size="sm" className="section-action" onClick={onOpenFullScreenResponse}>
                Full screen
              </UiButton>
            }
          />
          <pre>{responseRaw || "Will appear after completion"}</pre>
        </section>
      ) : null}

      {activeTab === "memory" ? (
        <section className="side-section memory-tab-content">
          <div className="memory-card">
            <h4>Short-term</h4>
            <p className="hint"><strong>Updated:</strong> {formatTimestamp(memory.shortTerm.updatedAt)}</p>
            <pre>{memory.shortTerm.rollingSummary || "(empty)"}</pre>
          </div>

          <div className="memory-card">
            <h4>Working</h4>
            <p className="hint"><strong>Updated:</strong> {formatTimestamp(memory.working.updatedAt)}</p>
            <label className="memory-field-label" htmlFor="working-goal">goal</label>
            <textarea
              id="working-goal"
              rows={2}
              value={workingDraft.goal}
              onChange={(event) => setWorkingDraft((prev) => ({ ...prev, goal: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="working-constraints">constraints</label>
            <textarea
              id="working-constraints"
              rows={2}
              value={workingDraft.constraints}
              onChange={(event) => setWorkingDraft((prev) => ({ ...prev, constraints: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="working-status">status</label>
            <textarea
              id="working-status"
              rows={2}
              value={workingDraft.status}
              onChange={(event) => setWorkingDraft((prev) => ({ ...prev, status: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="working-next-steps">next_steps</label>
            <textarea
              id="working-next-steps"
              rows={2}
              value={workingDraft.nextSteps}
              onChange={(event) => setWorkingDraft((prev) => ({ ...prev, nextSteps: event.target.value }))}
            />
            <UiButton
              size="sm"
              onClick={() => void handleSaveWorking()}
              disabled={isStreaming || isWorkingSaving}
            >
              {isWorkingSaving ? "Saving..." : "Save working"}
            </UiButton>
          </div>

          <div className="memory-card">
            <h4>Long-term</h4>
            <p className="hint"><strong>Updated:</strong> {formatTimestamp(memory.longTerm.updatedAt)}</p>
            <label className="memory-field-label" htmlFor="long-profile">profile</label>
            <textarea
              id="long-profile"
              rows={2}
              value={longTermDraft.profile}
              onChange={(event) => setLongTermDraft((prev) => ({ ...prev, profile: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="long-preferences">preferences</label>
            <textarea
              id="long-preferences"
              rows={2}
              value={longTermDraft.preferences}
              onChange={(event) => setLongTermDraft((prev) => ({ ...prev, preferences: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="long-decisions">decisions</label>
            <textarea
              id="long-decisions"
              rows={2}
              value={longTermDraft.decisions}
              onChange={(event) => setLongTermDraft((prev) => ({ ...prev, decisions: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="long-knowledge">knowledge</label>
            <textarea
              id="long-knowledge"
              rows={2}
              value={longTermDraft.knowledge}
              onChange={(event) => setLongTermDraft((prev) => ({ ...prev, knowledge: event.target.value }))}
            />
            <UiButton
              size="sm"
              onClick={() => void handleSaveLongTerm()}
              disabled={isStreaming || isLongTermSaving}
            >
              {isLongTermSaving ? "Saving..." : "Save long-term"}
            </UiButton>
          </div>

          <div className="memory-card">
            <h4>Pending long-term candidates</h4>
            {memory.pendingCandidates.length === 0 ? <p className="hint">No pending candidates.</p> : null}
            <div className="candidate-list">
              {memory.pendingCandidates.map((candidate) => (
                <article className="candidate-item" key={candidate.id}>
                  <p><strong>{candidate.targetField}</strong></p>
                  <p>{candidate.value}</p>
                  {candidate.reason ? <p className="hint">Reason: {candidate.reason}</p> : null}
                  <div className="candidate-actions">
                    <UiButton
                      size="sm"
                      onClick={() => void handleApprove(candidate.id)}
                      disabled={busyCandidateId === candidate.id}
                    >
                      Approve
                    </UiButton>
                    <UiButton
                      size="sm"
                      variant="subtle"
                      onClick={() => void handleReject(candidate.id)}
                      disabled={busyCandidateId === candidate.id}
                    >
                      Reject
                    </UiButton>
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="memory-card">
            <h4>Effective memory block</h4>
            <pre>{effectiveMemoryBlock || "Will appear after send"}</pre>
          </div>
        </section>
      ) : null}

      {errorText ? <p className="error">{errorText}</p> : null}
    </aside>
  );
}
