// Talking patient client. Sends the player line plus an engine state snapshot
// (words, never vitals numbers) to the server patient route, which plays Josh
// through Muse Spark with the locked backstory. If the server or key is down,
// canned in-character lines keep the game playable (brief 1.6: the game never
// hard-depends on a live LLM response). No em-dashes anywhere.

import type { Sim } from "../sim/engine";

export interface TalkTurn {
  from: "player" | "josh";
  text: string;
}

function painWords(pain: number): string {
  if (pain >= 9) return "agony, worst pain of his life";
  if (pain >= 7) return "severe pain";
  if (pain >= 4) return "moderate pain, gritted teeth";
  if (pain >= 1) return "mild pain, mostly pressure";
  return "no pain right now";
}

/** Engine snapshot in plain words. No vitals numbers: Josh cannot know them. */
export function patientSnapshot(sim: Sim): string {
  const v = sim.vitals;
  const bits: string[] = [];
  bits.push(`Pain: ${painWords(v.pain_0_to_10)} (${v.pain_0_to_10}/10 if he names it).`);
  if (sim.tq.applied && sim.tq.occluded) {
    bits.push("A tourniquet is on his left thigh and tight. It hurts badly and he wants it off.");
  } else if (sim.tq.applied) {
    bits.push("A tourniquet is on his left thigh but loose or misplaced.");
  } else {
    bits.push("No tourniquet is on. His thigh wound is bleeding.");
  }
  if (sim.airway.ett !== null) {
    bits.push("He has a breathing tube in his windpipe and cannot talk. He squeezes a hand and looks scared.");
  } else if (sim.airway.vomited && sim.airway.soiled) {
    bits.push("He vomited and his mouth needs suctioning. He coughs between words.");
  } else if (v.rr_per_min >= 30 || v.spo2_pct < 90) {
    bits.push("He cannot breathe comfortably. He gasps between short phrases.");
  } else if (v.rr_per_min >= 22) {
    bits.push("He breathes fast but can still talk.");
  } else {
    bits.push("He breathes comfortably enough to talk.");
  }
  if (v.atlsClass === "IV" || v.gcs_total <= 8) {
    bits.push("He is confused and lethargic from blood loss. Answers are slow, slurred, one or two words.");
  } else if (v.atlsClass === "III" || v.gcs_total <= 13) {
    bits.push("He is getting confused from blood loss. He repeats himself and loses the thread.");
  } else if (v.atlsClass === "II") {
    bits.push("He is scared and shaky but answers clearly.");
  } else {
    bits.push("He is scared but alert and answers clearly.");
  }
  if (sim.vitals.rhythm === "pea" || sim.arrested) {
    bits.push("He is unconscious and does not respond at all.");
  }
  return bits.join(" ");
}

function cannedReply(sim: Sim, message: string): string {
  const lower = message.toLowerCase();
  if (sim.arrested) return "(He does not respond.)";
  if (sim.airway.ett !== null) return "(He cannot talk around the tube. He squeezes your hand.)";
  if (/(weight|weigh|pounds|heavy|how much)/.test(lower)) return "Uh - about 175 pounds, I think. Why?";
  if (/(name|who are you)/.test(lower)) return "Josh. My leg - God, my leg.";
  if (/(happen|what did|crash|accident|truck|how)/.test(lower)) {
    return "Some truck cut me off on the way home and I swerved - I just slammed into the guardrail.";
  }
  if (/(okay|ok|die|gonna|going to|fine|live)/.test(lower)) {
    return sim.vitals.atlsClass === "I" || sim.vitals.atlsClass === "II"
      ? "Am I gonna be okay? Please tell me straight."
      : "I feel - real bad. Am I - am I gonna be okay?";
  }
  if (/(pain|hurt|bad|much|scale|10)/.test(lower)) {
    if (sim.vitals.pain_0_to_10 >= 9) return "Ten. It is a ten, please do something.";
    if (sim.vitals.pain_0_to_10 >= 7) return "It is bad - real bad. My whole leg is on fire.";
    return "It aches, but I can deal with it right now.";
  }
  if (/(tourniquet|tight|loosen|leg band|band)/.test(lower)) {
    return sim.tq.applied && sim.tq.occluded
      ? "That thing on my leg is killing me - please, can you loosen it just a little?"
      : "My leg - do whatever you have to do.";
  }
  if (/(breathe|breath|air)/.test(lower)) {
    return sim.vitals.rr_per_min >= 30 ? "I - can not - catch my breath." : "I can breathe okay. It is my leg.";
  }
  if (sim.vitals.atlsClass === "IV" || sim.vitals.gcs_total <= 8) return "Huh? - Sorry - what? Cold - so cold.";
  if (sim.vitals.atlsClass === "III") return "Sorry - what did you - my leg, it - sorry, say again?";
  return "Okay - okay. Just - stay with me, alright?";
}

export class TalkClient {
  readonly turns: TalkTurn[] = [];
  sending = false;

  constructor(private readonly sim: Sim) {}

  async send(message: string): Promise<void> {
    const clean = message.trim().slice(0, 300);
    if (clean === "" || this.sending) return;
    this.sending = true;
    this.turns.push({ from: "player", text: clean });
    this.sim.recordTalk();
    this.sim.addLog("talk", `You: "${clean}"`);
    try {
      const response = await fetch("/api/patient", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: clean,
          state: patientSnapshot(this.sim),
          history: this.turns.slice(-8)
        })
      });
      if (!response.ok) throw new Error(`patient route ${response.status}`);
      const data = (await response.json()) as { text?: unknown };
      const text = typeof data.text === "string" && data.text !== "" ? data.text : cannedReply(this.sim, clean);
      this.pushJosh(text);
    } catch {
      // Offline fallback: canned in-character line, flagged in the log.
      this.sim.addLog("talk", "Live voice unreachable: canned reply.");
      this.pushJosh(cannedReply(this.sim, clean));
    } finally {
      this.sending = false;
    }
  }

  private pushJosh(text: string): void {
    // Belt and suspenders: the server strips em-dashes, the client too.
    const safe = text.replaceAll("\u2014", "-").replaceAll("\u2013", "-");
    this.turns.push({ from: "josh", text: safe });
    this.sim.addLog("talk", `Josh: "${safe}"`);
  }
}
