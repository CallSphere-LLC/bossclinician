import { voiceFetch } from "@/voice/kernel/api-client";
import type { ConciergeChatRequest, ConciergeChatResponse } from "@/voice/contract";

/** Authenticated streaming uses the same token refresh and cookies as every tool. */
export async function streamConciergeChat(
  request: ConciergeChatRequest,
  onDelta: (text: string) => void,
  onSession?: (session: Pick<ConciergeChatResponse, "sessionId" | "surface">) => void,
): Promise<ConciergeChatResponse> {
  const response = await voiceFetch("/voice/chat", {
    method: "POST",
    headers: { Accept: "text/event-stream", "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }, request.surface);
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    return response.json() as Promise<ConciergeChatResponse>;
  }
  return readChatStream(response, onDelta, onSession);
}

/** The terminal event is required: a broken stream must never execute partial tools. */
export async function readChatStream(
  response: Response,
  onDelta: (text: string) => void,
  onSession?: (session: Pick<ConciergeChatResponse, "sessionId" | "surface">) => void,
): Promise<ConciergeChatResponse> {
  if (!response.body) throw new Error("The assistant returned an empty stream.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: ConciergeChatResponse | null = null;
  const consume = (frame: string) => {
    const lines = frame.split(/\r?\n/);
    const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
    const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
    if (!data) return;
    const value = JSON.parse(data);
    if (event === "error") throw new Error(value.error || "The reply was interrupted.");
    if (event === "delta" && typeof value.text === "string") onDelta(value.text);
    if (event === "session") onSession?.(value);
    if (event === "done") result = value as ConciergeChatResponse;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const frames = buffer.split(/\r?\n\r?\n/);
      buffer = frames.pop() ?? "";
      for (const frame of frames) consume(frame);
      if (done) break;
    }
    if (buffer.trim()) consume(buffer);
    if (!result) throw new Error("The reply ended before it was finished. Please try again.");
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
