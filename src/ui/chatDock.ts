// Left chat dock, under the main menu: talk to the patient while working
// the menu. Text chat always works (TalkClient.send, the same path as
// before). The mic is push-to-talk through the server transcribe proxy;
// when the mic or the route is unavailable the dock says so and text keeps
// working. Player and patient words stay verbatim here, never reworded.
// After CHAT_FADE_AFTER_MS with no communication the dock fades to a
// low-opacity prompt; any message or click brings it back. The patient
// also speaks up on his own every UNPROMPTED_GAP_S sim-seconds of quiet.

import type { Sim } from "../sim/engine";
import { TalkClient, canSpeakUnprompted } from "./talk";

/** Idle fade delay. UI timing only, 8 real seconds, inside the 5-10 window. */
export const CHAT_FADE_AFTER_MS = 8000;

/** Quiet gap between unprompted patient lines, in sim-seconds. */
export const UNPROMPTED_GAP_S = 45;

export function shouldFade(lastActiveMs: number, nowMs: number): boolean {
  return nowMs - lastActiveMs >= CHAT_FADE_AFTER_MS;
}

const DRAFT_KEPT_NOTE = "The patient is talking - your draft is kept. Press Ask again in a moment.";

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

export class ChatDock {
  private readonly root = el("chat-dock");
  private readonly head = document.createElement("div");
  private readonly log = document.createElement("div");
  private readonly row = document.createElement("div");
  private readonly input = document.createElement("input");
  private readonly send = document.createElement("button");
  private readonly mic = document.createElement("button");
  private readonly status = document.createElement("div");
  private talk: TalkClient | null = null;
  private sim: Sim | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private stream: MediaStream | null = null;
  private busy = false;
  private lastActiveMs = Date.now();

  constructor() {
    this.head.className = "chat-head";
    this.log.className = "talk-log";
    this.row.className = "talk-row";
    this.input.id = "talk-input";
    this.input.type = "text";
    this.input.maxLength = 300;
    this.input.placeholder = "Talk to the patient...";
    this.input.autocomplete = "off";
    this.send.type = "button";
    this.send.className = "talk-send";
    this.send.textContent = "Ask";
    this.mic.type = "button";
    this.mic.className = "talk-mic";
    this.mic.textContent = "Hold to talk";
    this.mic.title = "Push to talk: hold, speak, release to transcribe";
    this.status.className = "chat-status";
    this.status.hidden = true;
    this.send.addEventListener("click", () => this.submit());
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.submit();
      }
      event.stopPropagation();
    });
    this.mic.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      void this.startMic();
    });
    this.mic.addEventListener("pointerup", () => this.stopMic());
    this.mic.addEventListener("pointerleave", () => this.stopMic());
    if (!micSupported()) {
      this.mic.disabled = true;
      this.setStatus("Mic unavailable in this browser - type instead.");
    }
    this.row.append(this.input, this.send, this.mic);
    this.root.append(this.head, this.log, this.row, this.status);
    this.root.addEventListener("click", () => this.notifyActivity());
    window.setInterval(() => this.applyFade(), 1000);
  }

  /** Bind to a fresh sim on dispatch accept. Null hides the dock. */
  bind(sim: Sim | null): void {
    this.sim = sim;
    this.talk = sim === null ? null : new TalkClient(sim);
    if (this.talk !== null) this.talk.onTurn = () => this.notifyActivity();
    this.notifyActivity();
    this.setVisible(sim !== null);
    this.refresh();
  }

  /** Any communication or click: full opacity, fade clock restarts. */
  private notifyActivity(): void {
    this.lastActiveMs = Date.now();
    this.root.classList.remove("chat-faded");
  }

  private applyFade(): void {
    if (this.root.hidden || this.talk === null) {
      this.root.classList.remove("chat-faded");
      return;
    }
    this.root.classList.toggle("chat-faded", shouldFade(this.lastActiveMs, Date.now()));
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible || this.talk === null;
  }

  focus(): void {
    if (!this.root.hidden) this.input.focus();
  }

  /**
   * Called every sim tick when the phase allows it: one unprompted line
   * after UNPROMPTED_GAP_S sim-seconds of quiet. Never fires over a player
   * draft, never fires while a reply is in flight, and the patient gate
   * stills it as GCS, breathing, or shock worsen.
   */
  tickUnprompted(allowed: boolean): void {
    const talk = this.talk;
    const sim = this.sim;
    if (!allowed || talk === null || sim === null || this.root.hidden) return;
    if (this.input.value.trim() !== "") return;
    if (!talk.unpromptedDue(sim.t_s, UNPROMPTED_GAP_S)) return;
    if (!canSpeakUnprompted(sim)) return;
    void talk.speakUp().then(() => this.refresh());
  }

  /** Called every sim tick: cheap turn-list refresh. */
  refresh(): void {
    const talk = this.talk;
    const sim = this.sim;
    if (talk === null || sim === null || this.root.hidden) return;
    this.applyFade();
    this.head.textContent = `Talk to ${sim.patientName} (V)`;
    this.log.innerHTML = "";
    if (talk.turns.length === 0) {
      const empty = document.createElement("div");
      empty.className = "talk-empty";
      empty.textContent = "The patient is watching you work. Say something.";
      this.log.appendChild(empty);
    }
    for (const turn of talk.turns.slice(-10)) {
      const div = document.createElement("div");
      div.className = turn.from === "player" ? "talk-player" : "talk-josh";
      div.textContent = `${turn.from === "player" ? "You" : sim.patientName}: ${turn.text}`;
      this.log.appendChild(div);
    }
    if (talk.sending) {
      const typing = document.createElement("div");
      typing.className = "talk-josh talk-typing";
      typing.textContent = `${sim.patientName}: ...`;
      this.log.appendChild(typing);
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  private submit(): void {
    const talk = this.talk;
    if (talk === null) return;
    const text = this.input.value;
    if (text.trim() === "") return;
    if (talk.sending) {
      // A reply or unprompted line is in flight: keep the draft, say so.
      this.setStatus(DRAFT_KEPT_NOTE);
      return;
    }
    this.input.value = "";
    if (this.status.textContent === DRAFT_KEPT_NOTE) this.setStatus(null);
    void talk.send(text).then(() => this.refresh());
    this.refresh();
  }

  private setStatus(text: string | null): void {
    this.status.hidden = text === null;
    if (text !== null) this.status.textContent = text;
  }

  private async startMic(): Promise<void> {
    const talk = this.talk;
    if (talk === null || this.busy || this.recorder !== null) return;
    if (!micSupported()) {
      this.setStatus("Mic unavailable in this browser - type instead.");
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      this.setStatus("Mic blocked or missing - type instead.");
      return;
    }
    const mime = ["audio/webm", "audio/mp4"].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
    try {
      this.recorder = mime === "" ? new MediaRecorder(this.stream) : new MediaRecorder(this.stream, { mimeType: mime });
    } catch {
      this.stopTracks();
      this.setStatus("Mic unavailable in this browser - type instead.");
      return;
    }
    this.chunks = [];
    this.recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) this.chunks.push(event.data);
    };
    this.recorder.start();
    this.mic.textContent = "Recording... release to send";
    this.setStatus("Recording - release the mic button to send.");
  }

  private stopMic(): void {
    if (this.recorder === null || this.recorder.state === "inactive") return;
    this.busy = true;
    this.mic.disabled = true;
    const recorder = this.recorder;
    recorder.onstop = () => {
      this.recorder = null;
      this.stopTracks();
      void this.transcribe(new Blob(this.chunks, { type: recorder.mimeType || "audio/webm" }));
    };
    recorder.stop();
    this.mic.textContent = "Hold to talk";
  }

  private stopTracks(): void {
    if (this.stream !== null) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
  }

  private async transcribe(blob: Blob): Promise<void> {
    const talk = this.talk;
    this.setStatus("Transcribing...");
    try {
      if (talk === null || blob.size === 0) throw new Error("nothing recorded");
      const form = new FormData();
      form.append("audio", blob, "talk.webm");
      const response = await fetch("/api/transcribe", { method: "POST", body: form });
      if (!response.ok) throw new Error(`transcribe route ${response.status}`);
      const data = (await response.json()) as { text?: unknown };
      if (typeof data.text !== "string" || data.text.trim() === "") throw new Error("empty transcript");
      this.setStatus(null);
      this.input.value = data.text.slice(0, 300);
      this.submit();
    } catch {
      this.setStatus("Mic transcript failed - type instead.");
    } finally {
      this.busy = false;
      this.mic.disabled = false;
      this.refresh();
    }
  }
}

function micSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}
