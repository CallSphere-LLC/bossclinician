import { LiveProtocol, closeLivePeer } from "./live-protocol";
import { createLivePeer, exchangeLiveOffer } from "./connect";
import type { ConciergeTool } from "../contract";

/**
 * live-session.client.ts — the whole "SDK", written locally.
 *
 * There is no `@openai/agents` dependency in this app and there is not going to
 * be one: this file IS the agent/session/transport layer, sitting directly on
 * `LiveProtocol`. The class names are the historical ones from the site this was
 * ported from, kept on purpose so the two implementations stay diffable when the
 * provider's wire format moves.
 *
 * Nothing here runs at import time. The RTCPeerConnection, the AudioContext and
 * the audio element are all created inside `connect`, so this module is safe to
 * pull into a server render even though it would be useless there.
 */

type LiveEvent = Record<string, unknown> & { type?: string };

class Events {
  private listeners = new Map<string, Array<(...args: never[]) => void>>();
  on(name: string, fn: (...args: never[]) => void) {
    this.listeners.set(name, [...(this.listeners.get(name) || []), fn]);
    return this;
  }
  emit(name: string, ...args: unknown[]) {
    for (const fn of this.listeners.get(name) || []) (fn as (...a: unknown[]) => void)(...args);
  }
}

/**
 * The `tool()` the tools slice is handed. It is the identity function because a
 * tool is already exactly what both transports need — a descriptor with a local
 * `execute` — and wrapping it in anything provider-shaped is precisely what
 * would stop the text chatbot from reusing the same registry.
 */
export function tool(options: unknown): unknown {
  return options;
}

export class RealtimeAgent {
  name: string;
  instructions: string;
  tools: ConciergeTool[];
  voice: string;
  constructor(config: { name: string; instructions: string; tools?: ConciergeTool[]; voice: string }) {
    this.name = config.name;
    this.instructions = config.instructions;
    this.tools = config.tools || [];
    this.voice = config.voice;
  }
}

/** Historical export names keep the tool/UI interface stable. No Realtime SDK is used. */
export class OpenAIRealtimeWebRTC extends Events {
  status = "disconnected";
  connectionState: { peerConnection?: RTCPeerConnection } = {};
  protocol?: LiveProtocol;
  constructor(public options: { mediaStream: MediaStream; audioElement: HTMLAudioElement }) {
    super();
  }
  sendEvent(event: LiveEvent) {
    this.protocol?.send(event);
  }
}

export class RealtimeSession extends Events {
  transport: OpenAIRealtimeWebRTC;
  private dc: RTCDataChannel | null = null;
  private closed = false;
  private queue = Promise.resolve();
  private audioContext?: AudioContext;
  private meterTimer?: ReturnType<typeof setInterval>;
  constructor(
    public agent: RealtimeAgent,
    public options: { transport: OpenAIRealtimeWebRTC },
  ) {
    super();
    this.transport = options.transport;
  }

  /**
   * `backendModel` and `voice` are the SERVER's values, echoed rather than
   * chosen. The broker names both when it mints the admission, and this session
   * re-registers the delegation config a moment later to install the browser's
   * tools — so if this file held its own model name, the two would disagree and
   * the brain behind the voice would silently change mid-handshake.
   */
  async connect(input: { admission: string; backendModel: string; voice: string }) {
    const transport = this.transport;
    const { pc, dc } = createLivePeer(transport.options.mediaStream);
    transport.connectionState = { peerConnection: pc };
    this.dc = dc;
    const wire = (event: LiveEvent) => {
      if (dc.readyState === "open") dc.send(JSON.stringify(event));
    };
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("GPT-Live startup timed out")), 30000);
      transport.protocol = new LiveProtocol(wire, (event: LiveEvent) => {
        if (event.type === "session.started") {
          // The browser owns the tool list, because the tools run in the
          // browser. The broker cannot name them: it does not know which
          // surface's policy this visitor got until they are standing on it.
          wire({
            type: "session.update",
            session: {
              delegation: {
                type: "responses",
                responses: {
                  model: input.backendModel,
                  instructions: this.agent.instructions,
                  tools: this.agent.tools.map(({ name, description, parameters, strict }) => ({
                    type: "function",
                    name,
                    description,
                    parameters,
                    strict: strict ?? false,
                  })),
                  parallel_tool_calls: false,
                },
              },
            },
          });
          wire({
            type: "session.instructions.append",
            delegation_id: null,
            content: `You are ${this.agent.name}. Delegate business facts and every available action to your backend. Follow the caller's language and the application's conversation-mode updates.`,
          });
          clearTimeout(timeout);
          transport.status = "connected";
          transport.emit("connection_change", "connected");
          resolve();
        }
        if (event.type === "session.closed") this.finish();
        if (event.type === "error") {
          this.emit("error", event);
          if (!transport.protocol?.started) {
            clearTimeout(timeout);
            const detail = (event.error as { message?: string } | undefined)?.message;
            reject(new Error(detail || "GPT-Live startup failed"));
          }
        }
        this.emit("transport_event", event);
        if (event.type === "response.function_call_arguments.done") {
          // Serialised on purpose. Two tools that both navigate would race, and
          // the model's next turn would describe a page nobody is looking at.
          this.queue = this.queue.then(async () => {
            if (this.closed) return;
            const call = event as unknown as { name: string; arguments?: string; call_id: string };
            let output: unknown;
            try {
              const fn = this.agent.tools.find((candidate) => candidate.name === call.name);
              if (!fn) throw new Error("Tool is unavailable in this session");
              output = await fn.execute(JSON.parse(call.arguments || "{}"));
            } catch (error) {
              // A failed tool still has to answer, or the model waits forever
              // for an output that is never coming and the call goes silent.
              output = { error: error instanceof Error ? error.message : "Tool failed" };
            }
            transport.sendEvent({
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: call.call_id,
                output: typeof output === "string" ? output : JSON.stringify(output),
              },
            });
            transport.sendEvent({ type: "response.create" });
          });
        }
      });
      dc.onmessage = (e) => {
        try {
          transport.protocol!.receive(JSON.parse(e.data));
        } catch (error) {
          this.emit("error", error);
        }
      };
      dc.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Live event channel failed"));
      };
    });
    // Attach a rejection handler before the HTTP handshake can fail.
    void ready.catch(() => {});
    pc.ontrack = (event) => {
      const stream = event.streams[0] || new MediaStream([event.track]);
      transport.options.audioElement.srcObject = stream;
      void transport.options.audioElement.play().catch((error) => this.emit("error", error));
      this.measurePlayback(stream);
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState)) {
        transport.status = "disconnected";
        transport.emit("connection_change", "disconnected");
      }
    };
    try {
      await exchangeLiveOffer({ pc, admission: input.admission, voice: input.voice });
      await ready;
    } catch (error) {
      this.finish();
      throw error;
    }
  }

  /**
   * Speaking state from the media waveform rather than from the data channel.
   *
   * The agent's audio travels on the remote media track, not as deltas on the
   * events channel, so the waveform is the only source that is right for both
   * the orb and the caption clock at the moment the voice actually starts and
   * stops.
   */
  private measurePlayback(stream: MediaStream) {
    this.audioContext = new AudioContext();
    void this.audioContext.resume();
    const analyser = this.audioContext.createAnalyser();
    analyser.fftSize = 256;
    this.audioContext.createMediaStreamSource(stream).connect(analyser);
    const bytes = new Uint8Array(256);
    let speaking = false;
    let lastAudio = 0;
    this.meterTimer = setInterval(() => {
      analyser.getByteTimeDomainData(bytes);
      const level = Math.sqrt(
        bytes.reduce((sum, b) => sum + ((b - 128) / 128) ** 2, 0) / bytes.length,
      );
      if (level > 0.008 && !this.transport.options.audioElement.paused) lastAudio = Date.now();
      const next = Date.now() - lastAudio < 250;
      if (next !== speaking) {
        speaking = next;
        this.emit(next ? "audio_start" : "audio_stopped");
      }
    }, 80);
  }

  mute(muted: boolean) {
    this.transport.options.mediaStream.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  /** Inject a turn as though the person had said it, and let the agent answer. */
  sendMessage(message: string) {
    this.transport.sendEvent({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: message }] },
    });
    this.transport.sendEvent({ type: "response.create" });
  }

  /** Stop the agent mid-sentence when the person talks over it. */
  interrupt() {
    this.transport.options.audioElement.muted = true;
    this.transport.sendEvent({ type: "response.cancel" });
    setTimeout(() => {
      if (!this.closed) this.transport.options.audioElement.muted = false;
    }, 600);
  }

  close() {
    this.transport.protocol?.flush();
    return closeLivePeer(this.transport.connectionState.peerConnection || null, this.dc, () =>
      this.finish(),
    );
  }

  private finish() {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.meterTimer);
    void this.audioContext?.close();
    this.dc?.close();
    this.transport.connectionState.peerConnection?.close();
    this.transport.options.mediaStream.getTracks().forEach((track) => track.stop());
    this.transport.options.audioElement.srcObject = null;
    this.transport.status = "disconnected";
    this.transport.emit("connection_change", "disconnected");
  }
}
