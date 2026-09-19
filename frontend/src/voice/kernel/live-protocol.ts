/**
 * live-protocol.ts — the application's compatibility boundary for GPT-Live.
 *
 * Ported near-verbatim from the CallSphere site, deliberately. This is provider
 * contract code: the event names, the 480-byte append cap and the order the
 * lifecycle events arrive in are OpenAI's, not ours, and the moment it is
 * "tidied" into this codebase's house shape it stops being diffable against the
 * one implementation that is known to hold a live call up.
 *
 * Only documented Live commands leave this class. Legacy names in emitted UI
 * events are local projections, not provider events. Transcript groups are
 * display/persistence fragments, never authoritative turn completion or
 * evidence that speech was played.
 *
 * SSR-safe: nothing here touches the DOM at import time. `observeLivePlayback`
 * constructs an AudioContext, but only when a live call calls it.
 */

export function liveAppendChunks(text: string): string[] {
  const chunks: string[] = []; let chunk = "", bytes = 0;
  for (const char of text) {
    const size = new TextEncoder().encode(char).length;
    if (bytes + size > 480) { chunks.push(chunk); chunk = ""; bytes = 0; }
    chunk += char; bytes += size;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}
export class LiveProtocol {
  started = false;
  closed = false;
  closing = false;
  usageSeconds: number | null = null;
  private pending = new Set<string>();
  private completed = new Set<string>();
  private calls: any[] = [];
  private active = false;
  private continuation = false;
  private greeted = false;
  private queuedInput = false;
  private wire: (event: any) => void;
  private emit: (event: any) => void;
  private emittedCalls = new Set<string>();
  private seq = 0;
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private captions = new Map<string, { text: string; id: string; start_ms: number; end_ms: number }>();
  constructor(wire: (event: any) => void, emit: (event: any) => void) { this.wire = wire; this.emit = emit; }
  private append(type: string, content: string) {
    // Appends are capped at 500 tokens. Small Unicode chunks bound even languages
    // with multiple tokens per character; backend instructions stay unsplit.
    for (const chunk of liveAppendChunks(content)) this.wire({ type, delegation_id: null, content: chunk });
  }
  send(event: any) {
    if (!this.started || this.closed || this.closing) return;
    if (event.type === "session.update" && event.session?.type === "realtime") {
      const instructions = event.session.instructions;
      if (instructions) {
        this.wire({ type: "session.update", session: { delegation: { type: "responses", responses: { instructions } } } });
        // A mid-call instruction change is a tone or mode switch spoken to the
        // voice layer; the surface's real business instructions stay in the
        // backend's own instruction field, which this never rewrites.
        this.append("session.instructions.append", "Follow the latest application conversation mode. " + instructions.slice(-700));
      }
      return;
    }
    if (event.type === "conversation.item.create") {
      const item = event.item;
      if (item?.type === "function_call_output") {
        if (!this.pending.has(item.call_id) || this.completed.has(item.call_id)) return;
        this.wire({ type: "response.item.create", item });
        this.completed.add(item.call_id); this.pending.delete(item.call_id);
        this.continueBackend();
      } else {
        this.queuedInput = true;
        const content = (item?.content || []).map((p: any) => p.text || "").join("\n");
        this.append("session.thinking.append", content);
        this.wire({ type: "response.item.create", item });
      }
      return;
    }
    if (event.type === "response.create") {
      if (event.response?.instructions) { this.append("session.instructions.append", event.response.instructions); return; }
      if (!this.greeted && !this.active && !this.calls.length) {
        this.greeted = true; this.queuedInput = false;
        this.append("session.instructions.append", "Greet immediately in English without waiting for the caller, following the application greeting. Then pause and listen. The application has already played the recording notice.");
        return;
      }
      if (this.active && !this.queuedInput) return;
      this.continuation = true; this.continueBackend(); return;
    }
    if (["response.cancel", "output_audio_buffer.clear", "conversation.item.truncate", "input_audio_buffer.clear", "input_audio_buffer.commit"].includes(event.type)) {
      if (event.type !== "input_audio_buffer.commit") this.append("session.instructions.append", "Stop the current spoken explanation and listen to the caller's latest correction.");
      return;
    }
    if (event.type === "response.item.create" && event.item?.type === "message") this.queuedInput = true;
    this.wire(event);
  }
  private continueBackend() {
    if (this.continuation && !this.active && this.pending.size === 0 && !this.closed && !this.closing) {
      this.continuation = false; this.queuedInput = false; this.active = true; this.calls = [];
      this.wire({ type: "response.create" });
    }
  }
  receive(event: any) {
    if (event.type === "session.started") { this.started = true; this.emit(event); return; }
    if (event.type === "session.closed") { this.closed = true; this.usageSeconds = event.usage?.seconds ?? null; this.flush(); this.emit(event); return; }
    if (event.type === "session.usage.updated") this.usageSeconds = event.usage?.seconds ?? null;
    if (event.type === "response.event") {
      if (this.closing || this.closed) {
        // Preserve final usage/lifecycle evidence without dispatching another tool.
        this.emit({ type: "live.backend_event", envelope: event });
        return;
      }
      const inner = event.event;
      if (inner?.type === "response.created") { this.active = true; this.calls = []; this.emit({ ...inner, delegation_id: event.delegation_id }); }
      if (inner?.type === "response.output_item.done" && inner.item?.type === "function_call") {
        const item = inner.item;
        if (!this.pending.has(item.call_id) && !this.completed.has(item.call_id)) { this.calls.push(item); this.pending.add(item.call_id); }
      }
      if (["response.completed", "response.failed", "response.incomplete", "response.cancelled"].includes(inner?.type)) {
        this.active = false;
        // Lifecycle snapshots intentionally have output: []; completed items
        // collected above are the authoritative calls, even for multiple tools.
        const calls = this.calls.filter(call => !this.emittedCalls.has(call.call_id));
        calls.forEach(call => this.emittedCalls.add(call.call_id));
        this.emit({ type: "response.done", live: true, delegation_id: event.delegation_id, response: { ...inner.response, output: calls } });
        for (const call of calls) this.emit({ live: true, ...call, type: "response.function_call_arguments.done" });
        this.continueBackend();
      }
      this.emit({ type: "live.backend_event", envelope: event }); return;
    }
    if (["session.input_transcript.delta", "session.output_transcript.delta"].includes(event.type)) {
      const role = event.type === "session.input_transcript.delta" ? "user" : "assistant";
      let row = this.captions.get(role);
      if (!row) { row = { text: "", id: `live_fragment_${role}_${++this.seq}`, start_ms: event.start_ms, end_ms: event.end_ms }; this.captions.set(role, row); }
      row.text += event.delta || ""; row.end_ms = event.end_ms;
      this.emit({ ...event, type: role === "user" ? "conversation.item.input_audio_transcription.delta" : "response.output_audio_transcript.delta", item_id: row.id, live: true });
      clearTimeout(this.timers.get(role));
      this.timers.set(role, setTimeout(() => this.flushRole(role), 1200));
      return;
    }
    this.emit(event);
  }
  private flushRole(role: string) {
    const row = this.captions.get(role); if (!row) return;
    clearTimeout(this.timers.get(role)); this.timers.delete(role); this.captions.delete(role);
    this.emit({ type: role === "user" ? "conversation.item.input_audio_transcription.completed" : "response.output_audio_transcript.done", live: true, item_id: row.id, event_id: row.id, transcript: row.text, start_ms: row.start_ms, end_ms: row.end_ms, fragment: true });
  }
  flush() { for (const role of this.captions.keys()) this.flushRole(role); }
}

/** Resolve startup only after the provider confirms the Live session. */
export function waitForLiveStarted(dc: RTCDataChannel): Promise<void> {
  const result = new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      dc.removeEventListener("message", listener);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const listener = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "session.started") finish();
        if (data.type === "error") finish(new Error(data.error?.message || "GPT-Live startup failed"));
      } catch { /* Ignore non-JSON media/control messages. */ }
    };
    const timer = setTimeout(() => finish(new Error("GPT-Live startup timed out")), 30000);
    dc.addEventListener("message", listener);
  });
  void result.catch(() => {});
  return result;
}

/** Keep the connection alive until final usage arrives, bounded by 15 seconds. */
export function closeLivePeer(pc: RTCPeerConnection | null, dc: RTCDataChannel | null, cleanup: () => void) {
  if (!pc || !dc || dc.readyState !== "open") { cleanup(); return Promise.resolve(); }
  return new Promise<void>((resolve) => {
  let done = false;
  const finish = () => { if (done) return; done = true; clearTimeout(timer); dc.removeEventListener("message", listener); cleanup(); resolve(); };
  const listener = (event: MessageEvent) => { try { if (JSON.parse(event.data).type === "session.closed") finish(); } catch { /* Ignore non-JSON control frames. */ } };
  const timer = setTimeout(() => { console.warn("GPT-Live final usage unconfirmed: close timeout"); finish(); }, 15000);
  dc.addEventListener("message", listener);
  dc.send(JSON.stringify({ type: "session.close" }));
  });
}

/** Speaking state follows the actual media waveform, independently of transcripts. */
export function observeLivePlayback(stream: MediaStream, audio: HTMLAudioElement, changed: (speaking: boolean) => void) {
  const context = new AudioContext(); void context.resume();
  const analyser = context.createAnalyser(); analyser.fftSize = 256;
  context.createMediaStreamSource(stream).connect(analyser);
  const samples = new Uint8Array(256); let lastAudio = 0, speaking = false;
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(samples);
    const level = Math.sqrt(samples.reduce((sum, sample) => sum + ((sample - 128) / 128) ** 2, 0) / samples.length);
    if (level > .008 && !audio.paused && !audio.muted) lastAudio = Date.now();
    const next = Date.now() - lastAudio < 250;
    if (next !== speaking) { speaking = next; changed(next); }
  }, 80);
  return () => { clearInterval(timer); void context.close(); };
}
