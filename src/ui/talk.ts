// Talking patient client. Sends the player line plus an engine state snapshot
// (words, never vitals numbers) to the server patient route. Bike down plays
// Josh through the locked backstory; a generated call sends its own persona
// and history instead, never Josh. If the server or key is down, canned
// in-character lines keep the game playable (brief 1.6: the game never
// hard-depends on a live LLM response). No em-dashes anywhere.

import type { Sim } from "../sim/engine";

export interface TalkTurn {
  from: "player" | "patient";
  text: string;
}

function painWords(pain: number): string {
  if (pain >= 9) return "agony, worst pain of his life";
  if (pain >= 7) return "severe pain";
  if (pain >= 4) return "moderate pain, gritted teeth";
  if (pain >= 1) return "mild pain, mostly pressure";
  return "no pain right now";
}

/** Engine snapshot in plain words. No vitals numbers: the patient cannot know them. */
export function patientSnapshot(sim: Sim): string {
  return sim.persona === null ? joshSnapshot(sim) : generatedSnapshot(sim);
}

function joshSnapshot(sim: Sim): string {
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

function generatedSnapshot(sim: Sim): string {
  const v = sim.vitals;
  const first = sim.patientName.split(" ")[0] ?? sim.patientName;
  const bits: string[] = [];
  bits.push(`Pain: ${plainPain(v.pain_0_to_10)} (${v.pain_0_to_10}/10 if asked).`);
  if (sim.tq.applied && sim.tq.occluded) {
    bits.push(`A tourniquet is on the thigh and tight. It hurts badly and ${first} wants it off.`);
  } else if (sim.tq.applied) {
    bits.push("A tourniquet is on the thigh but loose or misplaced.");
  } else if (sim.woundPresent) {
    bits.push("No tourniquet is on. The thigh wound is bleeding.");
  } else {
    bits.push("There is no bleeding wound.");
  }
  if (sim.airway.ett !== null) {
    bits.push(`${first} has a breathing tube in the windpipe and cannot talk. A hand squeezes, eyes scared.`);
  } else if (sim.airway.vomited && sim.airway.soiled) {
    bits.push(`${first} vomited and the mouth needs suctioning. Coughs between words.`);
  } else if (v.rr_per_min >= 30 || v.spo2_pct < 90) {
    bits.push(`${first} cannot breathe comfortably. Gasps between short phrases.`);
  } else if (v.rr_per_min >= 22) {
    bits.push(`${first} breathes fast but can still talk.`);
  } else {
    bits.push(`${first} breathes comfortably enough to talk.`);
  }
  if (v.atlsClass === "IV" || v.gcs_total <= 8) {
    bits.push(`${first} is confused and lethargic from blood loss. Answers are slow, slurred, one or two words.`);
  } else if (v.atlsClass === "III" || v.gcs_total <= 13) {
    bits.push(`${first} is getting confused from blood loss. Repeats and loses the thread.`);
  } else if (v.atlsClass === "II") {
    bits.push(`${first} is scared and shaky but answers clearly.`);
  } else {
    bits.push(`${first} is scared but alert and answers clearly.`);
  }
  if (sim.vitals.rhythm === "pea" || sim.arrested) {
    bits.push(`${first} is unconscious and does not respond at all.`);
  }
  return bits.join(" ");
}

function plainPain(pain: number): string {
  if (pain >= 9) return "agony, worst pain of this life";
  if (pain >= 7) return "severe pain";
  if (pain >= 4) return "moderate pain, gritted teeth";
  if (pain >= 1) return "mild pain, mostly pressure";
  return "no pain right now";
}

export function cannedReply(sim: Sim, message: string): string {
  return sim.persona === null ? joshReply(sim, message) : generatedReply(sim, message);
}

function joshReply(sim: Sim, message: string): string {
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

/**
 * Generated-call fallback: name-aware, complaint-neutral, never Josh and
 * never a leg bleed. The live voice carries the full persona and history;
 * these lines only keep an offline call playable without inventing facts.
 */
function generatedReply(sim: Sim, message: string): string {
  const lower = message.toLowerCase();
  const first = sim.patientName.split(" ")[0] ?? sim.patientName;
  if (sim.arrested) return "(There is no response.)";
  if (sim.airway.ett !== null) return "(No answer: a breathing tube is in place. A hand squeezes back.)";
  if (/(weight|weigh|pounds|heavy|how much)/.test(lower)) return "I - do not know right now. Sorry.";
  if (/(name|who are you)/.test(lower)) return `I'm ${first}. Please - what is happening?`;
  if (/(happen|what did|crash|accident|truck|how)/.test(lower)) {
    return "I do not remember much. It happened fast - tell me what you see.";
  }
  if (/(okay|ok|die|gonna|going to|fine|live)/.test(lower)) {
    return sim.vitals.atlsClass === "I" || sim.vitals.atlsClass === "II"
      ? "Am I gonna be okay? Please tell me straight."
      : "I feel - real bad. Am I - am I gonna be okay?";
  }
  if (/(pain|hurt|bad|much|scale|10)/.test(lower)) {
    if (sim.vitals.pain_0_to_10 >= 9) return "Ten. It is a ten, please do something.";
    if (sim.vitals.pain_0_to_10 >= 7) return "It is bad - real bad. Please do something.";
    return "It aches, but I can deal with it right now.";
  }
  if (/(tourniquet|tight|loosen|leg band|band)/.test(lower)) {
    return sim.tq.applied && sim.tq.occluded
      ? "That band is too tight - please, can you loosen it just a little?"
      : "Do whatever you have to do.";
  }
  if (/(breathe|breath|air)/.test(lower)) {
    return sim.vitals.rr_per_min >= 30 ? "I - can not - catch my breath." : "I can breathe okay.";
  }
  if (sim.vitals.atlsClass === "IV" || sim.vitals.gcs_total <= 8) return "Huh? - Sorry - what? Cold - so cold.";
  if (sim.vitals.atlsClass === "III") return "Sorry - what did you - sorry, say again?";
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
          history: this.turns.slice(-8),
          ...(this.sim.persona === null ? {} : { persona: this.sim.persona })
        })
      });
      if (!response.ok) throw new Error(`patient route ${response.status}`);
      const data = (await response.json()) as { text?: unknown };
      const text = typeof data.text === "string" && data.text !== "" ? data.text : cannedReply(this.sim, clean);
      this.pushPatient(text);
    } catch {
      // Offline fallback: canned in-character line, flagged in the log.
      this.sim.addLog("talk", "Live voice unreachable: canned reply.");
      this.pushPatient(cannedReply(this.sim, clean));
    } finally {
      this.sending = false;
    }
  }

  private pushPatient(text: string): void {
    // Belt and suspenders: the server strips em-dashes, the client too.
    const safe = text.replaceAll("\u2014", "-").replaceAll("\u2013", "-");
    this.turns.push({ from: "patient", text: safe });
    this.sim.addLog("talk", `${this.sim.patientName}: "${safe}"`);
  }
}
