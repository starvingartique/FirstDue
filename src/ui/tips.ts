// Coach tips: one short teaching line per menu section, shown when Tips are
// on. They explain WHY a step matters, never which option is right in this
// call (the traps stay traps). Written in medical language; Plain mode
// rewrites them through the terminology layer like everything else.
//
// Keys are "<tab>:<section title, lowercase>". Numbers here only repeat
// values the game already uses; nothing clinical is new in this file.

export const TIPS: Record<string, string> = {
  "examine:examine": "Find the life threat first. In trauma that usually means the bleeding before anything else (MARCH: Massive hemorrhage, Airway, Respirations, Circulation, Hypothermia).",
  "examine:whole patient": "Taking over from a bystander means a moment with no pressure on the wound. Have your tourniquet or packing ready before they let go.",

  "airway:airway status": "A patient who is talking in full sentences has an open airway right now. Reassess after every drop in alertness.",
  "airway:opa / npa": "OPA only without a gag reflex. NPA is tolerated by awake patients but avoid it with midface or skull base trauma.",
  "airway:supraglottic": "A supraglottic sits above the vocal cords. Faster than intubation, but it does not fully protect against aspiration.",
  "airway:intubation": "Confirm every tube with waveform EtCO2. No waveform means the tube is not in the trachea until proven otherwise.",
  "airway:suction (max 10-15 s per pass)": "Suction pauses ventilation. Keep passes short and re-oxygenate between them.",

  "breathing:oxygen": "Match the device to the need: a non-rebreather needs its reservoir full before it goes on the face.",
  "breathing:bvm (1 breath every 6 s, 500-600 mL)": "Overventilating raises chest pressure, cuts blood return to the heart, and fills the stomach. Squeeze gently and slowly.",

  "circulation:hemorrhage status": "Reassess bleeding control after every move or roll. Tourniquets and packing can loosen.",
  "circulation:tourniquet (cat)": "Pull the strap tight before cranking. Crank until the bleeding stops AND the distal pulse is gone. A tourniquet that only squeezes the veins makes bleeding worse.",
  "circulation:second tourniquet": "If one tourniquet does not stop it, add a second right above the first, side by side. Do not loosen the first to do it.",
  "circulation:packing + 3 min pressure": "Pack the gauze INTO the wound onto the bleeding source, then hold firm pressure for the full time. Peeking breaks the clot.",
  "circulation:direct pressure": "Direct pressure is a bridge while you get a tourniquet or packing ready. It fades as the holder tires.",
  "circulation:pressure dressing": "A pressure dressing holds packing in place. Over an open arterial bleed on its own, it will not be enough.",
  "circulation:trap + reassessment": "Look for things bystanders did that make it worse, like a belt cinched too loosely.",
  "circulation:kit: jump bag is at the patient": "Send your partner to the truck so your hands stay on the patient. One trip can carry several items.",

  "meds:drug box: pick, prep, push": "Check the vial strength, do the math, and confirm the route before you push. Read the label twice.",
  "meds:on board": "Track what is on board and when it peaks before giving more.",

  "lines:lines": "In shock, veins collapse. An IO gets access fast when an IV is hard to get.",
  "lines:start iv (75s)": "Bigger catheter, faster flow. Trauma lines go in a large vein like the inner elbow.",
  "lines:start io (30s, 95 percent)": "Awake patients feel IO infusion. Numb it first if you can.",
  "lines:fluids (explicit volumes)": "Bleeding patients lose blood, not salt water. Blood replaces what was lost; large crystalloid volumes thin it out.",

  "monitor:live monitor": "A monitor reading is only as good as the probe. Cold, shocky fingers give poor SpO2 readings.",
  "monitor:manual vitals": "Count breaths without telling the patient. People breathe differently when they know they are watched.",

  "talk:talk to josh (v)": "Ask what happened, where it hurts, allergies, meds, history, last meal. Talking also tells you his airway and alertness."
};

export function tipFor(tab: string, section: string): string | undefined {
  return TIPS[`${tab}:${section.toLowerCase()}`];
}
