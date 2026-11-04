// Group chat dock, bottom left, redesigned from scratch Nov 3. One thread
// for every voice on scene: the player, the patient, the bystander, and
// the partner, plus partner hints. Color-coded speech bubbles, one color
// per speaker, with simple shape avatars, so the speaker reads at a
// glance. Player lines go to the patient through the existing talk path;
// bystander and partner lines mirror exact engine log lines and L1 hints,
// never invented dialogue. Text chat always works. The mic is push-to-talk
// through the server transcribe proxy; when the mic or the route is
// unavailable the dock says exactly why and text keeps working. Chat
// history stays verbatim here, never reworded. After CHAT_FADE_AFTER_MS
// with no communication the dock fades to a low-opacity prompt; any
// message or click brings it back. The patient also speaks up on his own
// every UNPROMPTED_GAP_S sim-seconds of quiet.

import type { Sim } from "../sim/engine";
import { TalkClient, canSpeakUnprompted } from "./talk";
import { sayLine } from "./wording";

/** Idle fade delay. UI timing only, 8 real seconds, inside the 5-10 window. */
export const CHAT_FADE_AFTER_MS = 8000;

/** Quiet gap between unprompted patient lines, in sim-seconds. */
export const UNPROMPTED_GAP_S = 45;

/** Thread rows kept on screen. */
export const CHAT_ROWS = 12;

export function shouldFade(lastActiveMs: number, nowMs: number): boolean {
  return nowMs - lastActiveMs >= CHAT_FADE_AFTER_MS;
}

const DRAFT_KEPT_NOTE = "The patient is talking - your draft is kept. Press Ask again in a moment.";

export type ChatSpeaker = "player" | "patient" | "bystander" | "partner";

export interface GroupTurn {
  speaker: ChatSpeaker;
  /** Hints render quieter than spoken lines. */
  kind: "say" | "hint";
  text: string;
}

/**
 * Mirror one engine log line into the group thread, or null when the line
 * belongs to the Action Log only. Bystander lines mirror verbatim; partner
 * fetch and trip lines mirror verbatim. Exact log text, never rephrased.
 */
export function mirrorLogLine(kind: string, text: string): GroupTurn | null {
  if (kind === "talk") return null;
  if (/bystander/i.test(text)) return { speaker: "bystander", kind: "say", text };
  if (kind === "fetch") return { speaker: "partner", kind: "say", text };
  if (/partner (holds|trip|staged|brings|joins)|joins the partner trip|staged at the patient/i.test(text)) {
    return { speaker: "partner", kind: "say", text };
  }
  return null;
}

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (node === null) throw new Error(`missing #${id} in index.html`);
  return node as T;
}

const AVATAR_SHAPE: Record<ChatSpeaker, string> = {
  player: "avatar-circle",
  patient: "avatar-square",
  bystander: "avatar-triangle",
  partner: "avatar-diamond"
};

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
  private readonly thread: GroupTurn[] = [];
  private talkSeen = 0;
  private logSeen = 0;
  private lastHint: string | null = null;

  constructor(private readonly hooks: { onPlayerLine?: (text: string) => void } = {}) {
    this.root.dataset["noWord"] = "1";
    this.head.className = "chat-head";
    this.log.className = "talk-log";
    this.log.setAttribute("aria-label", "Group chat thread");
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
    this.mic.textContent = sayLine("Hold to talk");
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
    this.thread.length = 0;
    this.talkSeen = 0;
    this.logSeen = 0;
    this.lastHint = null;
    if (sim !== null) {
      // Scene-start lines (bystander pressure, belt trap) land in the
      // thread on arrival, verbatim from the engine log.
      this.mirrorNewLog(sim);
    }
    this.notifyActivity();
    this.setVisible(sim !== null);
    this.refresh();
  }

  /**
   * Partner hint for the thread. Called every sim tick; a changed hint
   * posts once as a quiet line. Worded at post time, exactly as the old
   * top bar showed it; history stays as posted when the mode changes.
   */
  setPartnerHint(hint: string | null): void {
    if (hint === this.lastHint) return;
    this.lastHint = hint;
    if (hint === null) return;
    this.thread.push(partnerChatLine(hint));
    this.notifyActivity();
  }

  /** One-shot partner tip (tab tips). Posted once by the caller. */
  postPartnerTip(tip: string): void {
    this.thread.push(partnerChatLine(tip));
    this.notifyActivity();
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

  private mirrorNewLog(sim: Sim): void {
    while (this.logSeen < sim.log.length) {
      const event = sim.log[this.logSeen];
      this.logSeen += 1;
      if (event === undefined) continue;
      const turn = mirrorLogLine(event.kind, event.text);
      if (turn !== null) {
        this.thread.push(turn);
        this.notifyActivity();
      }
    }
  }

  private mirrorNewTalk(talk: TalkClient): void {
    while (this.talkSeen < talk.turns.length) {
      const turn = talk.turns[this.talkSeen];
      this.talkSeen += 1;
      if (turn === undefined) continue;
      this.thread.push({
        speaker: turn.from === "player" ? "player" : "patient",
        kind: "say",
        text: turn.text
      });
      this.notifyActivity();
    }
  }

  /** Called every sim tick: mirror new lines, then render the thread. */
  refresh(): void {
    const talk = this.talk;
    const sim = this.sim;
    if (talk === null || sim === null || this.root.hidden) return;
    this.applyFade();
    this.mirrorNewTalk(talk);
    this.mirrorNewLog(sim);
    this.head.textContent = `Group chat - talk to ${sim.patientName} (V)`;
    this.log.innerHTML = "";
    if (this.thread.length === 0) {
      const empty = document.createElement("div");
      empty.className = "talk-empty";
      empty.textContent = "The patient is watching you work. Say something.";
      this.log.appendChild(empty);
    }
    for (const turn of this.thread.slice(-CHAT_ROWS)) {
      this.log.appendChild(this.renderTurn(sim.patientName, turn));
    }
    if (talk.sending) {
      const typing = document.createElement("div");
      typing.className = "talk-row-patient";
      typing.appendChild(this.avatar("patient", sim.patientName));
      const bubble = document.createElement("div");
      bubble.className = "talk-bubble talk-patient talk-typing";
      bubble.textContent = "...";
      typing.appendChild(bubble);
      this.log.appendChild(typing);
    }
    this.log.scrollTop = this.log.scrollHeight;
  }

  private renderTurn(patientName: string, turn: GroupTurn): HTMLElement {
    const row = document.createElement("div");
    row.className = `talk-row-${turn.speaker}`;
    const speakerName =
      turn.speaker === "player"
        ? "You"
        : turn.speaker === "patient"
          ? patientName
          : turn.speaker === "bystander"
            ? "Bystander"
            : "Partner";
    row.appendChild(this.avatar(turn.speaker, speakerName));
    const bubble = document.createElement("div");
    bubble.className = `talk-bubble talk-${turn.speaker}${turn.kind === "hint" ? " talk-hint" : ""}`;
    const who = document.createElement("span");
    who.className = "talk-who";
    who.textContent = turn.kind === "hint" ? `${speakerName} hint` : speakerName;
    const said = document.createElement("span");
    said.className = "talk-said";
    said.textContent = turn.text;
    bubble.append(who, said);
    row.appendChild(bubble);
    return row;
  }

  private avatar(speaker: ChatSpeaker, name: string): HTMLElement {
    const dot = document.createElement("div");
    dot.className = `avatar ${AVATAR_SHAPE[speaker]}`;
    dot.textContent = (name.charAt(0) || "?").toUpperCase();
    dot.setAttribute("aria-hidden", "true");
    return dot;
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
    this.hooks.onPlayerLine?.(text);
    void talk.send(text).then(() => this.refresh());
    this.refresh();
  }

  private setStatus(text: string | null): void {
    this.status.hidden = text === null;
    if (text !== null) this.status.textContent = sayLine(text);
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
    } catch (error) {
      const name = error instanceof DOMException ? error.name : "";
      this.setStatus(micDeniedStatus(name));
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
    this.mic.textContent = sayLine("Recording... release to send");
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
    this.mic.textContent = sayLine("Hold to talk");
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
      let response: Response;
      try {
        response = await fetch("/api/transcribe", { method: "POST", body: form });
      } catch {
        this.setStatus("Voice server unreachable - type instead.");
        return;
      }
      if (!response.ok) {
        let detail = "";
        try {
          const body = (await response.json()) as { error?: unknown };
          if (typeof body.error === "string") detail = body.error;
        } catch {
          // No JSON body: fall back to the status-only line.
        }
        this.setStatus(transcribeStatus(response.status, detail));
        return;
      }
      const data = (await response.json()) as { text?: unknown };
      if (typeof data.text !== "string" || data.text.trim() === "") {
        this.setStatus("Mic heard nothing usable - type instead.");
        return;
      }
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

/**
 * Partner hint or tip as a chat line. Pure, tested headless. The text is
 * worded at post time so each mode shows what the old top displays
 * showed; dedup still keys on the raw hint in setPartnerHint.
 */
export function partnerChatLine(hint: string): GroupTurn {
  return { speaker: "partner", kind: "hint", text: sayLine(hint) };
}

function micSupported(): boolean {
  return (
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined"
  );
}

/** Mic capture failure to a player-facing step. Pure, tested headless. */
export function micDeniedStatus(name: string): string {
  if (name === "NotAllowedError" || name === "SecurityError") {
    return "Mic blocked - allow the mic or type instead.";
  }
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "NotReadableError") {
    return "No mic found - type instead.";
  }
  return "Mic blocked or missing - type instead.";
}

/**
 * Transcribe HTTP failure to a player-facing step. Pure, tested headless.
 * The no-key 500 names the setup step, never the key: the key never
 * touches the client, and this message carries no part of it.
 */
export function transcribeStatus(status: number, error: string): string {
  if (status === 500 && /MODEL_API_KEY|missing/i.test(error)) {
    return "Voice key not set on the server - type instead.";
  }
  if (status === 500) return "Mic transcript failed (server error) - type instead.";
  if (status === 502) return "Voice service failed - type instead.";
  if (status === 400) return "Mic clip rejected by the server - type instead.";
  return `Mic transcript failed (server ${status}) - type instead.`;
}
