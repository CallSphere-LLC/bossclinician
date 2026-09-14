import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { api } from "@/lib/api";
import { chatSessionId } from "@/lib/chatSession";
import { runAssistantTool } from "@/lib/siteNavigation";

export type VoiceStatus = "idle" | "connecting" | "live" | "error";

export interface VoiceTranscriptLine {
  role: "user" | "assistant";
  text: string;
}

const SDP_ENDPOINT = "https://api.openai.com/v1/realtime/calls";

interface SessionCredential {
  clientSecret: string;
  model: string;
}

/**
 * Speech-to-speech session against the OpenAI Realtime API.
 *
 * Audio goes browser <-> OpenAI directly over WebRTC; our server only mints the
 * short-lived credential. That keeps latency at conversational levels — routing
 * audio through our own backend would add a round trip to every packet — and
 * keeps the API key server-side.
 *
 * Barge-in is handled by the service's own server-side voice-activity
 * detection: when the visitor starts talking the model stops, which is why the
 * remote track plays through a single long-lived <audio> element rather than
 * per-utterance clips.
 */
export function useVoiceAgent() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [transcript, setTranscript] = useState<VoiceTranscriptLine[]>([]);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // navigate() identity changes on every route change; a ref keeps the data
  // channel handler from being torn down and re-bound mid-conversation.
  const navRef = useRef(navigate);
  navRef.current = navigate;

  // Because the audio never passes through our server, nothing about a spoken
  // conversation would reach the database on its own — and the admin inbox
  // would show only the visitors who typed. Completed lines queue here and are
  // posted a turn at a time, under the widget's own session id so a
  // conversation held both ways reads back as one transcript.
  const pendingRef = useRef<VoiceTranscriptLine[]>([]);

  const flushTranscript = useCallback(() => {
    const lines = pendingRef.current;
    if (lines.length === 0) return;
    // Cleared before the request, not after: a failed flush must not queue the
    // same turn up again behind the next one.
    pendingRef.current = [];
    void api
      .chatTranscript(
        chatSessionId(),
        lines.map((line) => ({ role: line.role, content: line.text })),
      )
      // Persistence is bookkeeping. It must never surface in, or interrupt,
      // the conversation the visitor is actually having.
      .catch(() => undefined);
  }, []);

  const stop = useCallback(() => {
    // A turn the visitor ended mid-answer still happened; flush before the
    // channel goes away.
    flushTranscript();
    dcRef.current?.close();
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    micRef.current?.getTracks().forEach((t) => t.stop());
    audioRef.current?.remove();
    dcRef.current = null;
    pcRef.current = null;
    micRef.current = null;
    audioRef.current = null;
    setStatus("idle");
    setSpeaking(false);
  }, [flushTranscript]);

  useEffect(() => stop, [stop]);

  const send = (payload: unknown) => {
    const dc = dcRef.current;
    if (dc?.readyState === "open") dc.send(JSON.stringify(payload));
  };

  const handleEvent = useCallback((raw: MessageEvent<string>) => {
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(raw.data) as Record<string, unknown>;
    } catch {
      return;
    }
    const type = String(evt.type ?? "");

    // Tool call: run it locally, hand the result back, then let the model speak.
    if (type === "response.function_call_arguments.done") {
      const name = String(evt.name ?? "");
      const callId = String(evt.call_id ?? "");
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(String(evt.arguments ?? "{}")) as Record<string, unknown>;
      } catch {
        /* malformed args fall through to the tool's own validation */
      }
      const result = runAssistantTool(name, args, (path) => navRef.current(path));
      send({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: result.message },
      });
      send({ type: "response.create" });
      return;
    }

    if (type === "response.audio.delta" || type === "response.output_audio.delta") {
      setSpeaking(true);
      return;
    }
    if (type === "response.done") {
      setSpeaking(false);
      return;
    }
    // Visitor's own words, once the service has transcribed them.
    if (type === "conversation.item.input_audio_transcription.completed") {
      const text = String(evt.transcript ?? "").trim();
      if (text) {
        setTranscript((t) => [...t, { role: "user", text }]);
        pendingRef.current.push({ role: "user", text });
      }
      return;
    }
    if (type === "response.output_audio_transcript.done" || type === "response.audio_transcript.done") {
      const text = String(evt.transcript ?? "").trim();
      if (text) {
        setTranscript((t) => [...t, { role: "assistant", text }]);
        pendingRef.current.push({ role: "assistant", text });
      }
      // The answer closes the turn, so the question and the answer travel
      // together and land in the transcript in the order they were spoken.
      flushTranscript();
      return;
    }
    if (type === "error") {
      const message =
        (evt.error as { message?: string } | undefined)?.message ?? "The voice session hit an error.";
      setError(message);
    }
  }, [flushTranscript]);

  const start = useCallback(async () => {
    if (status === "connecting" || status === "live") return;
    setError(null);
    setStatus("connecting");

    try {
      const res = await fetch("/api/realtime/session", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        throw new Error(body?.message ?? "Voice is unavailable right now.");
      }
      const cred = (await res.json()) as SessionCredential;

      // Ask for the mic before building the peer connection: a denied prompt
      // should fail fast with a clear message, not leave a half-open session.
      let mic: MediaStream;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        throw new Error("Microphone access was blocked. Allow it in your browser to use voice.");
      }
      micRef.current = mic;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      const audio = document.createElement("audio");
      audio.autoplay = true;
      audioRef.current = audio;
      pc.ontrack = (e) => {
        audio.srcObject = e.streams[0];
      };

      mic.getTracks().forEach((track) => pc.addTrack(track, mic));

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.addEventListener("message", handleEvent);

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const sdpRes = await fetch(`${SDP_ENDPOINT}?model=${encodeURIComponent(cred.model)}`, {
        method: "POST",
        body: offer.sdp ?? "",
        headers: {
          Authorization: `Bearer ${cred.clientSecret}`,
          "Content-Type": "application/sdp",
        },
      });
      if (!sdpRes.ok) {
        throw new Error(`Could not open the voice channel (${sdpRes.status}).`);
      }
      await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });

      setStatus("live");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Voice is unavailable right now.");
      setStatus("error");
      stop();
    }
  }, [handleEvent, status, stop]);

  const toggleMute = useCallback(() => {
    const track = micRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  return { status, error, muted, speaking, transcript, start, stop, toggleMute };
}
