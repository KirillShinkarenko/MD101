import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChatMemorySnapshot,
  LongTermMemory,
  TaskArtifactDraftStatus,
  TaskContext,
  WorkingMemory,
} from "../domain/chat";
import { PanelHeader } from "./ui/PanelHeader";
import { UiButton } from "./ui/UiButton";

type TabKey = "task" | "request" | "response" | "memory";

type Props = {
  requestRaw: string;
  responseRaw: string;
  taskContext: TaskContext;
  taskDraftStatus: TaskArtifactDraftStatus;
  taskDraftError: string;
  isTaskCommandPending: boolean;
  memory: ChatMemorySnapshot;
  shortTermEnabled: boolean;
  workingEnabled: boolean;
  longTermEnabled: boolean;
  effectiveMemoryBlock: string;
  errorText: string;
  isStreaming: boolean;
  onOpenFullScreenRequest: () => void;
  onOpenFullScreenResponse: () => void;
  onPauseTask: () => void;
  onResumeTask: () => void;
  onApprovePlan: (artifactText: string, isEdited: boolean) => void;
  onCompleteStep: (artifactText: string, isEdited: boolean) => void;
  onApproveValidation: (artifactText: string, isEdited: boolean) => void;
  onRequestReplan: () => void;
  onRequestRework: () => void;
  onSaveWorking: (body: Partial<Pick<WorkingMemory, "goal" | "constraints" | "status" | "nextSteps">>) => Promise<void>;
  onSaveLongTerm: (
    body: Partial<Pick<LongTermMemory, "profile" | "preferences" | "decisions" | "knowledge">>
  ) => Promise<void>;
  onApproveCandidate: (candidateId: string) => Promise<void>;
  onRejectCandidate: (candidateId: string) => Promise<void>;
};

const STAGE_LABEL: Record<TaskContext["state"], string> = {
  planning: "Planning",
  execution: "Execution",
  validation: "Validation",
  done: "Done",
};

const ACTION_LABEL: Record<TaskContext["expectedAction"], string> = {
  approve_plan: "Approve plan",
  complete_step: "Complete step",
  approve_validation: "Approve validation",
  resume: "Resume",
  none: "No action",
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
    taskContext,
    taskDraftStatus,
    taskDraftError,
    isTaskCommandPending,
    memory,
    shortTermEnabled,
    workingEnabled,
    longTermEnabled,
    effectiveMemoryBlock,
    errorText,
    isStreaming,
    onOpenFullScreenRequest,
    onOpenFullScreenResponse,
    onPauseTask,
    onResumeTask,
    onApprovePlan,
    onCompleteStep,
    onApproveValidation,
    onRequestReplan,
    onRequestRework,
    onSaveWorking,
    onSaveLongTerm,
    onApproveCandidate,
    onRejectCandidate,
  } = props;

  const [activeTab, setActiveTab] = useState<TabKey>("task");
  const [isWorkingSaving, setIsWorkingSaving] = useState(false);
  const [isLongTermSaving, setIsLongTermSaving] = useState(false);
  const [busyCandidateId, setBusyCandidateId] = useState<string | null>(null);
  const [artifactDraft, setArtifactDraft] = useState("");
  const [artifactDraftEdited, setArtifactDraftEdited] = useState(false);
  const draftIdentityRef = useRef("");

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
    const nextIdentity = [
      taskContext.state,
      String(taskContext.step),
      taskContext.draftArtifactSourceMessageId || "-",
      String(taskContext.updatedAt),
    ].join(":");
    if (nextIdentity === draftIdentityRef.current) {
      return;
    }
    draftIdentityRef.current = nextIdentity;
    setArtifactDraft(taskContext.draftArtifactText || "");
    setArtifactDraftEdited(false);
  }, [
    taskContext.state,
    taskContext.step,
    taskContext.draftArtifactSourceMessageId,
    taskContext.draftArtifactText,
    taskContext.updatedAt,
  ]);

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
      task: "Task",
      request: "Request",
      response: "Response",
      memory: pendingCount > 0 ? `Memory (${pendingCount})` : "Memory",
    }),
    [pendingCount]
  );

  const requiresArtifact =
    !taskContext.paused &&
    (taskContext.expectedAction === "approve_plan" ||
      taskContext.expectedAction === "complete_step" ||
      taskContext.expectedAction === "approve_validation");

  const isDraftValid = taskDraftStatus === "valid";
  const isTaskActionBusy = isStreaming || isTaskCommandPending;
  const canRunExpectedAction =
    !isTaskActionBusy &&
    (!requiresArtifact || (isDraftValid && Boolean(artifactDraft.trim())));

  const draftWarningText =
    taskDraftStatus === "invalid"
      ? taskDraftError || "Latest assistant artifact does not match current state/step."
      : "Waiting for a valid artifact from assistant response.";

  const runExpectedAction = () => {
    const artifactText = artifactDraft.trim();
    if (taskContext.expectedAction === "approve_plan") {
      onApprovePlan(artifactText, artifactDraftEdited);
      return;
    }
    if (taskContext.expectedAction === "complete_step") {
      onCompleteStep(artifactText, artifactDraftEdited);
      return;
    }
    if (taskContext.expectedAction === "approve_validation") {
      onApproveValidation(artifactText, artifactDraftEdited);
    }
  };

  const handleSaveWorking = async () => {
    if (!workingEnabled) {
      return;
    }
    setIsWorkingSaving(true);
    try {
      await onSaveWorking(workingDraft);
    } finally {
      setIsWorkingSaving(false);
    }
  };

  const handleSaveLongTerm = async () => {
    if (!longTermEnabled) {
      return;
    }
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
            className={`inspector-tab-btn ${activeTab === "task" ? "is-active" : ""}`}
            type="button"
            onClick={() => setActiveTab("task")}
          >
            {tabLabel.task}
          </button>
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

      {activeTab === "task" ? (
        <section className="side-section task-tab-content">
          <div className="task-fsm-card">
            <p className="task-fsm-line">
              <strong>State:</strong> {STAGE_LABEL[taskContext.state]} {taskContext.paused ? "(paused)" : ""}
            </p>
            <p className="task-fsm-line">
              <strong>Step:</strong> {taskContext.step}/{taskContext.total}
            </p>
            <p className="task-fsm-line">
              <strong>Expected action:</strong> {ACTION_LABEL[taskContext.expectedAction]}
            </p>
            <p className="task-fsm-line">
              <strong>Current:</strong> {taskContext.current || "(empty)"}
            </p>

            {taskContext.plan.length > 0 ? (
              <div className="task-fsm-list-wrap">
                <p className="task-fsm-label">Plan</p>
                <ol className="task-fsm-list">
                  {taskContext.plan.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            {taskContext.done.length > 0 ? (
              <div className="task-fsm-list-wrap">
                <p className="task-fsm-label">Done</p>
                <ol className="task-fsm-list">
                  {taskContext.done.map((item, index) => (
                    <li key={`${item}-${index}`}>{item}</li>
                  ))}
                </ol>
              </div>
            ) : null}

            {requiresArtifact ? (
              <label className="task-fsm-field" htmlFor="task-artifact-draft">
                Artifact draft {isDraftValid ? "(synced from assistant)" : "(waiting for valid artifact)"}
                <textarea
                  id="task-artifact-draft"
                  rows={4}
                  value={artifactDraft}
                  onChange={(event) => {
                    setArtifactDraft(event.target.value);
                    setArtifactDraftEdited(true);
                  }}
                  placeholder="Artifact for current step"
                  disabled={isTaskActionBusy || taskContext.paused}
                />
              </label>
            ) : null}

            {requiresArtifact && !isDraftValid ? (
              <p className="task-fsm-warning">{draftWarningText}</p>
            ) : null}

            <div className="task-fsm-actions">
              {taskContext.paused ? (
                <UiButton onClick={onResumeTask} disabled={isTaskActionBusy}>
                  Resume
                </UiButton>
              ) : (
                <UiButton onClick={onPauseTask} disabled={isTaskActionBusy || taskContext.state === "done"}>
                  Pause
                </UiButton>
              )}

              {taskContext.expectedAction !== "none" && taskContext.expectedAction !== "resume" ? (
                <UiButton onClick={runExpectedAction} disabled={!canRunExpectedAction}>
                  {ACTION_LABEL[taskContext.expectedAction]}
                </UiButton>
              ) : null}

              {!taskContext.paused && taskContext.state === "execution" ? (
                <UiButton
                  variant="subtle"
                  onClick={onRequestReplan}
                  disabled={isTaskActionBusy}
                >
                  Request replan
                </UiButton>
              ) : null}

              {!taskContext.paused && taskContext.state === "validation" ? (
                <UiButton
                  variant="subtle"
                  onClick={onRequestRework}
                  disabled={isTaskActionBusy}
                >
                  Request rework
                </UiButton>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

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
            {!shortTermEnabled ? <p className="hint">Short-term memory is disabled.</p> : null}
          </div>

          <div className="memory-card">
            <h4>Working</h4>
            <p className="hint"><strong>Updated:</strong> {formatTimestamp(memory.working.updatedAt)}</p>
            <label className="memory-field-label" htmlFor="working-goal">goal</label>
            <textarea
              id="working-goal"
              rows={2}
              value={workingDraft.goal}
              disabled={!workingEnabled}
              onChange={(event) => setWorkingDraft((prev) => ({ ...prev, goal: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="working-constraints">constraints</label>
            <textarea
              id="working-constraints"
              rows={2}
              value={workingDraft.constraints}
              disabled={!workingEnabled}
              onChange={(event) => setWorkingDraft((prev) => ({ ...prev, constraints: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="working-status">status</label>
            <textarea
              id="working-status"
              rows={2}
              value={workingDraft.status}
              disabled={!workingEnabled}
              onChange={(event) => setWorkingDraft((prev) => ({ ...prev, status: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="working-next-steps">next_steps</label>
            <textarea
              id="working-next-steps"
              rows={2}
              value={workingDraft.nextSteps}
              disabled={!workingEnabled}
              onChange={(event) => setWorkingDraft((prev) => ({ ...prev, nextSteps: event.target.value }))}
            />
            <UiButton
              size="sm"
              onClick={() => void handleSaveWorking()}
              disabled={!workingEnabled || isStreaming || isWorkingSaving}
            >
              {isWorkingSaving ? "Saving..." : "Save working"}
            </UiButton>
            {!workingEnabled ? <p className="hint">Working memory is disabled.</p> : null}
          </div>

          <div className="memory-card">
            <h4>Long-term</h4>
            <p className="hint"><strong>Updated:</strong> {formatTimestamp(memory.longTerm.updatedAt)}</p>
            <label className="memory-field-label" htmlFor="long-profile">profile</label>
            <textarea
              id="long-profile"
              rows={2}
              value={longTermDraft.profile}
              disabled={!longTermEnabled}
              onChange={(event) => setLongTermDraft((prev) => ({ ...prev, profile: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="long-preferences">preferences</label>
            <textarea
              id="long-preferences"
              rows={2}
              value={longTermDraft.preferences}
              disabled={!longTermEnabled}
              onChange={(event) => setLongTermDraft((prev) => ({ ...prev, preferences: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="long-decisions">decisions</label>
            <textarea
              id="long-decisions"
              rows={2}
              value={longTermDraft.decisions}
              disabled={!longTermEnabled}
              onChange={(event) => setLongTermDraft((prev) => ({ ...prev, decisions: event.target.value }))}
            />
            <label className="memory-field-label" htmlFor="long-knowledge">knowledge</label>
            <textarea
              id="long-knowledge"
              rows={2}
              value={longTermDraft.knowledge}
              disabled={!longTermEnabled}
              onChange={(event) => setLongTermDraft((prev) => ({ ...prev, knowledge: event.target.value }))}
            />
            <UiButton
              size="sm"
              onClick={() => void handleSaveLongTerm()}
              disabled={!longTermEnabled || isStreaming || isLongTermSaving}
            >
              {isLongTermSaving ? "Saving..." : "Save long-term"}
            </UiButton>
            {!longTermEnabled ? <p className="hint">Long-term memory is disabled.</p> : null}
          </div>

          <div className="memory-card">
            <h4>Pending long-term candidates</h4>
            {!longTermEnabled ? <p className="hint">Long-term memory is disabled.</p> : null}
            {longTermEnabled ? (
              <>
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
              </>
            ) : null}
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
