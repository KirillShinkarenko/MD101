import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const port = 9200 + Math.floor(Math.random() * 300);
const baseUrl = `http://127.0.0.1:${port}`;
const RUN_API_TESTS = process.env.RUN_API_TESTS === "1";

let serverProcess: ChildProcessWithoutNullStreams | null = null;

const waitForServer = async (): Promise<void> => {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      lastError = error;
    }
    await sleep(100);
  }
  throw new Error(`server did not start: ${String(lastError)}`);
};

const requestJson = async <T>(
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; payload: T }> => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const payload = (await response.json()) as T;
  return {
    status: response.status,
    payload,
  };
};

if (RUN_API_TESTS) {
  test.before(async () => {
    serverProcess = spawn("node", ["--import", "tsx", "src/server.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENAI_API_KEY: "test-key",
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: "pipe",
    });

    await waitForServer();
  });

  test.after(async () => {
    if (!serverProcess) {
      return;
    }
    serverProcess.kill("SIGTERM");
    await sleep(250);
    if (!serverProcess.killed) {
      serverProcess.kill("SIGKILL");
    }
  });
}

test("GET /task-state initializes default planning state", { skip: !RUN_API_TESTS }, async () => {
  const created = await requestJson<{ chat: { id: string } }>("/api/chats", {
    method: "POST",
    body: {},
  });
  assert.equal(created.status, 200);

  const taskResponse = await requestJson<{ task: { state: string; expectedAction: string } }>(
    `/api/chats/${created.payload.chat.id}/task-state`
  );

  assert.equal(taskResponse.status, 200);
  assert.equal(taskResponse.payload.task.state, "planning");
  assert.equal(taskResponse.payload.task.expectedAction, "approve_plan");
});

test("task command endpoint transitions and stream returns 409 when paused", { skip: !RUN_API_TESTS }, async () => {
  const created = await requestJson<{ chat: { id: string; model: string } }>("/api/chats", {
    method: "POST",
    body: {},
  });
  assert.equal(created.status, 200);

  const chatId = created.payload.chat.id;

  const approved = await requestJson<{ task: { state: string; step: number; total: number } }>(
    `/api/chats/${chatId}/task-state/command`,
    {
      method: "POST",
      body: {
        command: "approve_plan",
        plan: ["step one", "step two"],
      },
    }
  );
  assert.equal(approved.status, 200);
  assert.equal(approved.payload.task.state, "execution");
  assert.equal(approved.payload.task.step, 1);
  assert.equal(approved.payload.task.total, 2);

  const paused = await requestJson<{ task: { paused: boolean; expectedAction: string } }>(
    `/api/chats/${chatId}/task-state/command`,
    {
      method: "POST",
      body: {
        command: "pause",
      },
    }
  );
  assert.equal(paused.status, 200);
  assert.equal(paused.payload.task.paused, true);
  assert.equal(paused.payload.task.expectedAction, "resume");

  const stream = await requestJson<{ error: string; task: { paused: boolean } }>(
    `/api/chats/${chatId}/stream`,
    {
      method: "POST",
      body: {
        userPrompt: "continue",
        model: created.payload.chat.model,
      },
    }
  );

  assert.equal(stream.status, 409);
  assert.equal(stream.payload.error, "task is paused");
  assert.equal(stream.payload.task.paused, true);
});

test("task command returns 422 when approve_plan has no draft, no artifact and no plan", { skip: !RUN_API_TESTS }, async () => {
  const created = await requestJson<{ chat: { id: string } }>("/api/chats", {
    method: "POST",
    body: {},
  });
  assert.equal(created.status, 200);

  const approve = await requestJson<{ error: string }>(`/api/chats/${created.payload.chat.id}/task-state/command`, {
    method: "POST",
    body: {
      command: "approve_plan",
    },
  });

  assert.equal(approve.status, 422);
  assert.match(approve.payload.error, /artifact|plan/i);
});

test("invariants settings endpoint supports enabled + injectInSystemPrompt toggles", { skip: !RUN_API_TESTS }, async () => {
  const initial = await requestJson<{
    enabled: boolean;
    injectInSystemPrompt: boolean;
    updatedAt: number;
    invariants: unknown[];
  }>("/api/invariants");
  assert.equal(initial.status, 200);
  assert.equal(typeof initial.payload.enabled, "boolean");
  assert.equal(typeof initial.payload.injectInSystemPrompt, "boolean");

  const patched = await requestJson<{
    enabled: boolean;
    injectInSystemPrompt: boolean;
    updatedAt: number;
  }>("/api/invariants/settings", {
    method: "PATCH",
    body: {
      enabled: false,
      injectInSystemPrompt: false,
    },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.payload.enabled, false);
  assert.equal(patched.payload.injectInSystemPrompt, false);

  const after = await requestJson<{
    enabled: boolean;
    injectInSystemPrompt: boolean;
    invariants: unknown[];
  }>("/api/invariants");
  assert.equal(after.status, 200);
  assert.equal(after.payload.enabled, false);
  assert.equal(after.payload.injectInSystemPrompt, false);
});

test("invariants CRUD works and validates required fields", { skip: !RUN_API_TESTS }, async () => {
  const createBad = await requestJson<{ error: string }>("/api/invariants", {
    method: "POST",
    body: {
      name: "",
      ruleText: "",
    },
  });
  assert.equal(createBad.status, 400);
  assert.match(createBad.payload.error, /name|ruleText/i);

  const created = await requestJson<{
    invariant: {
      id: string;
      name: string;
      ruleText: string;
      sortOrder: number;
    };
  }>("/api/invariants", {
    method: "POST",
    body: {
      name: "No RxJava",
      ruleText: "Запрещено использовать RxJava.",
    },
  });
  assert.equal(created.status, 200);
  assert.equal(created.payload.invariant.name, "No RxJava");
  assert.equal(created.payload.invariant.ruleText, "Запрещено использовать RxJava.");

  const updated = await requestJson<{
    invariant: {
      id: string;
      name: string;
      ruleText: string;
    };
  }>(`/api/invariants/${created.payload.invariant.id}`, {
    method: "PATCH",
    body: {
      name: "No RxJava in answers",
      ruleText: "Запрещено использовать RxJava и любые ссылки на него.",
    },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.payload.invariant.name, "No RxJava in answers");
  assert.match(updated.payload.invariant.ruleText, /RxJava/i);

  const listed = await requestJson<{
    invariants: Array<{ id: string; name: string }>;
  }>("/api/invariants");
  assert.equal(listed.status, 200);
  assert.ok(listed.payload.invariants.some((item) => item.id === created.payload.invariant.id));

  const deleted = await requestJson<{ ok: boolean }>(`/api/invariants/${created.payload.invariant.id}`, {
    method: "DELETE",
  });
  assert.equal(deleted.status, 200);
  assert.equal(deleted.payload.ok, true);
});
