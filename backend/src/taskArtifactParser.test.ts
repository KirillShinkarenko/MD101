import test from "node:test";
import assert from "node:assert/strict";
import { extractTaskArtifactEnvelope } from "./taskArtifactParser.js";

test("extracts valid planning artifact envelope", () => {
  const responseText = [
    "Plan draft",
    "[TASK_ARTIFACT_JSON]",
    '{"state":"planning","step":0,"artifact":"Plan summary","plan":["Step A","Step B"]}',
    "[/TASK_ARTIFACT_JSON]",
  ].join("\n");

  const parsed = extractTaskArtifactEnvelope(responseText, { state: "planning", step: 0 });
  assert.equal(parsed.status, "valid");
  assert.equal(parsed.artifactState, "planning");
  assert.equal(parsed.artifactStep, 0);
  assert.deepEqual(parsed.plan, ["Step A", "Step B"]);
});

test("extracts valid execution and validation envelopes", () => {
  const executionText = [
    "Execution update",
    "[TASK_ARTIFACT_JSON]",
    '{"state":"execution","step":2,"artifact":"Implemented token validation"}',
    "[/TASK_ARTIFACT_JSON]",
  ].join("\n");
  const validationText = [
    "Validation update",
    "[TASK_ARTIFACT_JSON]",
    '{"state":"validation","step":2,"artifact":"Tests passed"}',
    "[/TASK_ARTIFACT_JSON]",
  ].join("\n");

  const execution = extractTaskArtifactEnvelope(executionText, { state: "execution", step: 2 });
  const validation = extractTaskArtifactEnvelope(validationText, { state: "validation", step: 2 });

  assert.equal(execution.status, "valid");
  assert.equal(validation.status, "valid");
});

test("returns invalid for malformed json", () => {
  const responseText = [
    "Bad block",
    "[TASK_ARTIFACT_JSON]",
    '{"state":"execution","step":1,"artifact":"ok"',
    "[/TASK_ARTIFACT_JSON]",
  ].join("\n");
  const parsed = extractTaskArtifactEnvelope(responseText, { state: "execution", step: 1 });
  assert.equal(parsed.status, "invalid");
  assert.match(parsed.error ?? "", /valid json/i);
});

test("returns missing when block is absent", () => {
  const parsed = extractTaskArtifactEnvelope("No artifact block here", {
    state: "execution",
    step: 1,
  });
  assert.equal(parsed.status, "missing");
});

test("returns invalid when state/step mismatch current task", () => {
  const responseText = [
    "Mismatch",
    "[TASK_ARTIFACT_JSON]",
    '{"state":"execution","step":3,"artifact":"done"}',
    "[/TASK_ARTIFACT_JSON]",
  ].join("\n");
  const parsed = extractTaskArtifactEnvelope(responseText, { state: "execution", step: 2 });
  assert.equal(parsed.status, "invalid");
  assert.match(parsed.error ?? "", /does not match current step/i);
});
