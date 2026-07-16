import type { InterviewToolResponse, SessionView } from "../shared/api";
import { reportRealtimeFirstResponse, requestJson } from "./api";

export type RealtimeInterviewState =
  | "idle"
  | "requesting_microphone"
  | "connecting"
  | "ready"
  | "listening"
  | "thinking"
  | "speaking"
  | "saving"
  | "reconnecting"
  | "error"
  | "complete";

export interface RealtimeFunctionCall {
  callId: string;
  name: string;
  arguments: string;
}

interface RealtimeControllerOptions {
  sessionVersion: number;
  onStateChange: (state: RealtimeInterviewState) => void;
  onAssistantText: (text: string) => void;
  onSessionView: (view: SessionView) => void;
  onError: (message: string | null) => void;
}

interface RealtimeEvent {
  type?: string;
  delta?: string;
  transcript?: string;
  response?: {
    status?: string;
    output?: unknown[];
  };
  error?: {
    message?: string;
  };
}

const MAX_RECONNECT_ATTEMPTS = 3;

const USER_TURN_REQUIRED_TOOLS = new Set([
  "save_answers",
  "mark_unknown_or_skipped",
  "remember_answer",
  "confirm_memory_claim"
]);

export class RealtimeUserTurnGuard {
  private speechInProgress = false;
  private completedTurnAvailable = false;

  reset(): void {
    this.speechInProgress = false;
    this.completedTurnAvailable = false;
  }

  speechStarted(): void {
    this.speechInProgress = true;
    this.completedTurnAvailable = false;
  }

  speechStopped(): void {
    if (!this.speechInProgress) return;
    this.speechInProgress = false;
    this.completedTurnAvailable = true;
  }

  tryConsumeForTool(name: string): boolean {
    if (!realtimeToolRequiresUserTurn(name)) return true;
    if (!this.completedTurnAvailable) return false;
    this.completedTurnAvailable = false;
    return true;
  }
}

export function realtimeToolRequiresUserTurn(name: string): boolean {
  return USER_TURN_REQUIRED_TOOLS.has(name);
}

export class RealtimeInterviewController {
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private localStream: MediaStream | null = null;
  private readonly audio: HTMLAudioElement;
  private readonly handledCallIds = new Set<string>();
  private readonly userTurnGuard = new RealtimeUserTurnGuard();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionVersion: number;
  private stopped = true;
  private connectGeneration = 0;
  private reconnectAttempts = 0;
  private transcript = "";
  private completionPending = false;
  private firstResponseStartedAt: number | null = null;
  private firstResponseRecorded = false;

  constructor(private readonly options: RealtimeControllerOptions) {
    this.sessionVersion = options.sessionVersion;
    this.audio = document.createElement("audio");
    this.audio.autoplay = true;
    this.audio.setAttribute("playsinline", "");
  }

  static isSupported(): boolean {
    return typeof window !== "undefined"
      && "RTCPeerConnection" in window
      && typeof navigator.mediaDevices?.getUserMedia === "function";
  }

  updateSessionVersion(version: number): void {
    this.sessionVersion = Math.max(this.sessionVersion, version);
  }

  async start(): Promise<void> {
    if (!RealtimeInterviewController.isSupported()) {
      this.fail("Voice conversations are not supported in this browser. You can type instead.");
      return;
    }
    this.stopTransport();
    this.stopped = false;
    this.reconnectAttempts = 0;
    this.handledCallIds.clear();
    this.userTurnGuard.reset();
    this.transcript = "";
    this.completionPending = false;
    this.firstResponseStartedAt = performance.now();
    this.firstResponseRecorded = false;
    this.options.onAssistantText("");
    this.options.onError(null);
    await this.connect(false);
  }

  stop(): void {
    this.stopped = true;
    this.connectGeneration += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopTransport();
    this.releaseMedia();
    this.userTurnGuard.reset();
    this.completionPending = false;
    this.options.onStateChange("idle");
    this.options.onError(null);
  }

  private async connect(isReconnect: boolean): Promise<void> {
    const generation = ++this.connectGeneration;
    this.userTurnGuard.reset();
    this.options.onStateChange(isReconnect ? "reconnecting" : "requesting_microphone");

    try {
      if (!this.localStream) {
        this.localStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            autoGainControl: true,
            echoCancellation: true,
            noiseSuppression: true
          }
        });
      }
      if (this.stopped || generation !== this.connectGeneration) return;

      this.options.onStateChange(isReconnect ? "reconnecting" : "connecting");
      this.stopTransport();
      const peer = new RTCPeerConnection();
      this.peer = peer;
      this.localStream.getTracks().forEach((track) => peer.addTrack(track, this.localStream as MediaStream));
      peer.ontrack = (event) => {
        const [stream] = event.streams;
        if (stream) this.audio.srcObject = stream;
      };

      const channel = peer.createDataChannel("oai-events");
      this.channel = channel;
      channel.onopen = () => {
        if (this.stopped || generation !== this.connectGeneration) return;
        this.reconnectAttempts = 0;
        this.options.onStateChange("ready");
        this.send({
          type: "response.create",
          response: {
            instructions: `Begin or resume the interview now. First call get_interview_context with sessionVersion ${this.sessionVersion}, handle any memory suggestions with explicit confirmation, then continue from the first unresolved applicable question.`
          }
        });
      };
      channel.onmessage = (event) => this.handleMessage(String(event.data));
      channel.onerror = () => this.scheduleReconnect("The voice connection was interrupted.");
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "failed" || peer.connectionState === "disconnected") {
          this.scheduleReconnect("The voice connection was interrupted.");
        }
      };

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const response = await fetch("/api/realtime/call", {
        method: "POST",
        headers: { "Content-Type": "application/sdp" },
        body: offer.sdp
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || "The voice interview could not connect.");
      }
      if (this.stopped || generation !== this.connectGeneration) return;
      await peer.setRemoteDescription({ type: "answer", sdp: await response.text() });
    } catch (error) {
      if (this.stopped || generation !== this.connectGeneration) return;
      const message = microphoneErrorMessage(error);
      if (isReconnect) this.scheduleReconnect(message);
      else this.fail(message);
    }
  }

  private handleMessage(raw: string): void {
    let event: RealtimeEvent;
    try {
      event = JSON.parse(raw) as RealtimeEvent;
    } catch {
      return;
    }

    switch (event.type) {
      case "input_audio_buffer.speech_started":
        this.userTurnGuard.speechStarted();
        this.options.onStateChange("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        this.userTurnGuard.speechStopped();
        this.options.onStateChange("thinking");
        break;
      case "response.created":
        this.transcript = "";
        this.options.onAssistantText("");
        this.options.onStateChange("thinking");
        break;
      case "response.output_audio.delta":
        this.recordFirstVoiceResponse();
        this.options.onStateChange("speaking");
        break;
      case "response.output_audio_transcript.delta":
        this.transcript += event.delta || "";
        this.options.onAssistantText(this.transcript);
        this.options.onStateChange("speaking");
        break;
      case "response.output_audio_transcript.done":
        if (event.transcript) {
          this.transcript = event.transcript;
          this.options.onAssistantText(this.transcript);
        }
        break;
      case "response.output_audio.done":
        this.options.onStateChange("listening");
        break;
      case "response.done":
        void this.handleCompletedResponse(event);
        break;
      case "error":
        this.fail(event.error?.message || "The voice conversation encountered an error.");
        break;
    }
  }

  private async handleCompletedResponse(event: RealtimeEvent): Promise<void> {
    if (event.response?.status !== "completed") {
      // Interrupted and cancelled responses must never run pending writes.
      this.options.onStateChange("listening");
      return;
    }
    const calls = extractFunctionCalls(event)
      .filter((call) => !this.handledCallIds.has(call.callId));
    if (calls.length === 0) {
      if (this.completionPending) {
        this.finishConversation();
        return;
      }
      this.options.onStateChange("listening");
      return;
    }

    this.options.onStateChange("saving");
    let interviewComplete = false;
    let userTurnRejected = false;
    for (const call of calls) {
      this.handledCallIds.add(call.callId);
      if (!this.userTurnGuard.tryConsumeForTool(call.name)) {
        userTurnRejected = true;
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.callId,
            output: JSON.stringify({
              ok: false,
              tool: call.name,
              sessionVersion: this.sessionVersion,
              error: {
                code: "user_turn_required",
                message: "No completed user audio turn is available. Ask the current question, end the response, and wait for the user to finish speaking before trying this write."
              }
            })
          }
        });
        continue;
      }
      try {
        const result = await this.executeToolWithRetry(call);
        this.sessionVersion = result.view.session.version;
        this.options.onSessionView(result.view);
        interviewComplete ||= call.name === "finish_interview" && result.output.canFinish === true;
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.callId,
            output: JSON.stringify(result.output)
          }
        });
      } catch {
        this.send({
          type: "conversation.item.create",
          item: {
            type: "function_call_output",
            call_id: call.callId,
            output: JSON.stringify({
              ok: false,
              tool: call.name,
              sessionVersion: this.sessionVersion,
              error: {
                code: "client_transport_error",
                message: "The tool result could not be confirmed. Refresh interview context before continuing."
              }
            })
          }
        });
      }
    }

    if (interviewComplete) {
      this.completionPending = true;
      this.transcript = "";
      this.options.onAssistantText("");
      this.options.onStateChange("thinking");
      this.send({
        type: "response.create",
        response: {
          instructions: "Briefly tell the user the interview is complete and that they can review the form now. Do not call another tool."
        }
      });
      return;
    }
    this.transcript = "";
    this.options.onAssistantText("");
    this.options.onStateChange("thinking");
    this.send(userTurnRejected ? {
      type: "response.create",
      response: {
        instructions: "No answer was saved because the user had not completed an audio turn. Ask the current question once, end your response, and wait silently for the user to finish speaking."
      }
    } : { type: "response.create" });
  }

  private async executeToolWithRetry(call: RealtimeFunctionCall): Promise<InterviewToolResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await requestJson<InterviewToolResponse>("/api/interview/tool", {
          method: "POST",
          body: JSON.stringify({
            callId: call.callId,
            name: call.name,
            arguments: call.arguments
          })
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }

  private send(event: Record<string, unknown>): void {
    if (this.channel?.readyState === "open") this.channel.send(JSON.stringify(event));
  }

  private scheduleReconnect(message: string): void {
    if (this.stopped || this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.fail(`${message} You can reconnect or continue by typing.`);
      return;
    }
    this.reconnectAttempts += 1;
    this.options.onError(null);
    this.options.onStateChange("reconnecting");
    const delay = 700 * this.reconnectAttempts;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect(true);
    }, delay);
  }

  private stopTransport(): void {
    this.channel?.close();
    this.channel = null;
    if (this.peer) {
      this.peer.onconnectionstatechange = null;
      this.peer.ontrack = null;
      this.peer.close();
    }
    this.peer = null;
  }

  private fail(message: string): void {
    this.stopped = true;
    this.connectGeneration += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopTransport();
    this.releaseMedia();
    this.options.onError(message);
    this.options.onStateChange("error");
  }

  private finishConversation(): void {
    this.stopped = true;
    this.connectGeneration += 1;
    this.stopTransport();
    this.releaseMedia();
    this.completionPending = false;
    this.options.onStateChange("complete");
  }

  private releaseMedia(): void {
    this.localStream?.getTracks().forEach((track) => track.stop());
    this.localStream = null;
    this.audio.srcObject = null;
  }

  private recordFirstVoiceResponse(): void {
    if (this.firstResponseRecorded || this.firstResponseStartedAt === null) return;
    this.firstResponseRecorded = true;
    reportRealtimeFirstResponse(firstResponseDuration(this.firstResponseStartedAt));
  }
}

export function firstResponseDuration(startedAt: number, endedAt = performance.now()): number {
  return Math.max(0, Math.round(endedAt - startedAt));
}

export function extractFunctionCalls(event: RealtimeEvent): RealtimeFunctionCall[] {
  if (event.type !== "response.done" || event.response?.status !== "completed") return [];
  if (!Array.isArray(event.response.output)) return [];
  return event.response.output.flatMap((item) => {
    if (!isRecord(item) || item.type !== "function_call") return [];
    if (typeof item.call_id !== "string" || typeof item.name !== "string") return [];
    return [{
      callId: item.call_id,
      name: item.name,
      arguments: typeof item.arguments === "string" ? item.arguments : "{}"
    }];
  });
}

function microphoneErrorMessage(error: unknown): string {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
    return "Microphone access is off. Allow it in your browser, or continue by typing.";
  }
  return error instanceof Error ? error.message : "The voice interview could not connect.";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
