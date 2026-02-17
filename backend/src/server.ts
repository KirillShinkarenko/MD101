import Fastify from "fastify";
import cors from "@fastify/cors";
import dotenv from "dotenv";

dotenv.config({ path: "../.env" });
dotenv.config();

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
});

type ChatBody = {
  sessionId?: string;
  systemPrompt?: string;
  userPrompt?: string;
  model?: string;
};

type ResetSessionBody = {
  sessionId?: string;
};

type SessionState = {
  systemPrompt: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  updatedAt: number;
};

const extractCompletedText = (response: any): string => {
  if (!response || typeof response !== "object") {
    return "";
  }

  const output = Array.isArray(response.output) ? response.output : [];
  const chunks: string[] = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part?.text === "string") {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join("");
};

const extractFinalDebug = (response: any): Record<string, unknown> => {
  return {
    id: typeof response?.id === "string" ? response.id : undefined,
    status: typeof response?.status === "string" ? response.status : undefined,
    output_text: extractCompletedText(response),
    usage: response?.usage,
  };
};

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = process.env.OPENAI_MODEL ?? "gpt-5-mini";
const sessions = new Map<string, SessionState>();

if (!OPENAI_API_KEY) {
  app.log.warn("OPENAI_API_KEY is not set. Requests will fail until it is configured.");
}

app.get("/health", async () => ({ ok: true }));

app.post<{ Body: ResetSessionBody }>("/api/chat/session/reset", async (request, reply) => {
  const sessionId = request.body?.sessionId?.trim() ?? "";
  if (!sessionId) {
    reply.code(400);
    return { error: "sessionId is required" };
  }

  sessions.delete(sessionId);
  return { ok: true };
});

app.post<{ Body: ChatBody }>("/api/chat/stream", async (request, reply) => {
  if (!OPENAI_API_KEY) {
    reply.code(500);
    return { error: "OPENAI_API_KEY is not configured" };
  }

  const sessionId = request.body?.sessionId?.trim() ?? "";
  const systemPrompt = request.body?.systemPrompt?.trim() ?? "";
  const userPrompt = request.body?.userPrompt?.trim() ?? "";
  const model = request.body?.model?.trim() || DEFAULT_MODEL;

  if (!userPrompt) {
    reply.code(400);
    return { error: "userPrompt is required" };
  }

  if (!sessionId) {
    reply.code(400);
    return { error: "sessionId is required" };
  }

  const existingSession = sessions.get(sessionId);
  const shouldResetHistory = !existingSession || existingSession.systemPrompt !== systemPrompt;
  const baseHistory = shouldResetHistory ? [] : existingSession.history;
  const requestHistory = [...baseHistory, { role: "user" as const, content: userPrompt }];
  const inputTranscript = requestHistory
    .map((item) => `${item.role === "user" ? "User" : "Assistant"}: ${item.content}`)
    .join("\n\n");

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
  });

  const abortController = new AbortController();
  request.raw.on("aborted", () => {
    abortController.abort();
  });
  reply.raw.on("close", () => {
    if (!reply.raw.writableEnded) {
      abortController.abort();
    }
  });
  reply.raw.on("error", () => {
    abortController.abort();
  });

  const sendSse = (event: string, data: unknown): void => {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const openaiRequestBody: Record<string, unknown> = {
      model,
      stream: true,
      instructions: systemPrompt || undefined,
      input: inputTranscript,
    };

    sendSse("debug_request", {
      target: "openai.responses.create",
      body: openaiRequestBody,
    });

    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      signal: abortController.signal,
      body: JSON.stringify(openaiRequestBody),
    });

    if (!upstream.ok || !upstream.body) {
      const message = await upstream.text();
      sendSse("error", {
        message: `OpenAI error (${upstream.status}): ${message}`,
      });
      reply.raw.end();
      return;
    }

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let hasSentDelta = false;
    let assistantText = "";
    let completedResponseId: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r/g, "");
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const block of parts) {
        const lines = block.split("\n").map((line) => line.trim());
        let upstreamEvent = "";
        const dataLines: string[] = [];

        for (const line of lines) {
          if (line.startsWith("event:")) {
            upstreamEvent = line.slice(6).trim();
          }
          if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }

        if (dataLines.length === 0) {
          continue;
        }

        const data = dataLines.join("\n");
        if (data === "[DONE]") {
          sendSse("done", { reason: "completed" });
          reply.raw.end();
          return;
        }

        let payload: any;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }

        const eventType = upstreamEvent || payload.type;

        if (eventType === "response.output_text.delta" && typeof payload.delta === "string") {
          hasSentDelta = true;
          assistantText += payload.delta;
          sendSse("delta", { text: payload.delta });
          continue;
        }

        if (eventType === "response.error") {
          sendSse("error", { message: payload.error?.message ?? "Unknown response error" });
          reply.raw.end();
          return;
        }

        if (eventType === "response.completed") {
          const finalText = extractCompletedText(payload.response);
          if (typeof payload.response?.id === "string") {
            completedResponseId = payload.response.id;
          }
          if (!hasSentDelta && finalText) {
            assistantText = finalText;
            sendSse("delta", { text: finalText });
          }
          sessions.set(sessionId, {
            systemPrompt,
            history: [...requestHistory, { role: "assistant", content: assistantText }],
            updatedAt: Date.now(),
          });
          sendSse("debug_response_final", {
            body: extractFinalDebug(payload.response),
          });
          sendSse("done", { reason: payload.response?.status ?? "completed" });
          reply.raw.end();
          return;
        }
      }
    }

    sessions.set(sessionId, {
      systemPrompt,
      history: [...requestHistory, { role: "assistant", content: assistantText }],
      updatedAt: Date.now(),
    });
    sendSse("done", { reason: "stream_closed" });
    reply.raw.end();
  } catch (error: any) {
    const isAborted = abortController.signal.aborted;
    if (isAborted) {
      sendSse("done", { reason: "aborted" });
      reply.raw.end();
      return;
    }

    sendSse("error", { message: error?.message ?? "Unexpected server error" });
    reply.raw.end();
  } finally {
    if (sessions.size > 500) {
      const sortedSessions = Array.from(sessions.entries()).sort((a, b) => a[1].updatedAt - b[1].updatedAt);
      const staleCount = Math.max(0, sessions.size - 300);
      for (let i = 0; i < staleCount; i += 1) {
        sessions.delete(sortedSessions[i][0]);
      }
    }
  }
});

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

app.listen({ port, host }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
