# PROJECT BRIEF v2 — "First Due"
**First-person, ACM-depth paramedic simulator with AI-generated 911 calls · Meta Global AI Developer Hackathon 2026 (Indie track)**

Read this whole file before writing code. It is the source of truth. When this file and your instincts disagree, this file wins.

---

## 0. MISSION & SCOPE DECISION

Build a first-person EMS sim with an **Arma 3 ACM Extended–style medical kit** (full depth, nothing locked, the game never tells you what to use) and an **AI Dispatch Engine** that generates endless realistic calls by combining components from a database of real-world call types.

**The scope rule:** go deep on medicine and AI, stay shallow on world-building. One scene type is rendered well. Depth lives in data and menus, not 3D.

| IN (ship by Nov 4) | PARKED (after Nov 4) |
|---|---|
| Fixed-position first-person scene (kneeling at the patient, mouse look) | Free walking, Rapier physics |
| Full ACM-style kit and drug box (all 104 drugs, all gear) | Ambulance interior, driving, moving-rig transport |
| Physiology engine with compensation curve | Cert-level 3–5 *grading* (the items still exist) |
| Talking patient (voice), bystander, radio report, FTO debrief | Multi-patient / MCI |
| AI Dispatch Engine + call component database | Hand-built 3D scenes per location |
| Hand-authored "Bike down" call as the fixed demo seed | Pulse engine integration |
| Cert levels 1–2 graded, with the identical kit at both | |

**Deadline:** submission closes **Wed Nov 4, 2026, 9:00 PM ET** (Nov 5 02:00 UTC, per the Cerebral Valley page). **Internal target: submit by noon Nov 4. No building in the last 3 hours.**

**Judging:** Impact 30% · Meta AI Tooling 25% · Demo 25% · Technical Depth 20%. Prioritize anything visible in the demo video that uses Muse.

---

## 1. PRIME DIRECTIVES

1. **You do not invent medicine.** All clinical values live in `/data/medical/*.json`. `drugs.json` is provided (104 drugs, AHA 2025 / NASEMSO / TCCC); use it as-is. Missing values → `"TODO_CLINICAL"` + tell Carlos. Effect magnitudes you tune are tagged `"TUNE"`.
2. **The physiology engine is the single source of truth.** No LLM ever decides vitals, outcomes, or whether a treatment worked. LLMs voice people, write narrative, and generate calls only from IDs that exist in the data.
3. **Hidden truth vs. observed findings.** The player learns only what they assess. True state is visible only in the debug overlay (`F1`).
4. **Deterministic and seedable.** Every call has a seed. Every action and state change goes to a timestamped event log. Scoring and debrief read the log.
5. **Always playable.** `npm run build` works after every milestone.
6. **Validate every LLM output** against a JSON Schema. If it's invalid, retry once, then fall back to a cached/handmade call. The game never hard-depends on a live LLM response to function.
7. TypeScript strict. Small modules. Comment the *why* on anything clinical.

---

## 2. TECH STACK

- **Front-end:** Three.js + TypeScript + Vite. Browser game: judges play from a link.
- **Camera:** fixed kneeling position at the patient with mouse look and raycast clicks on body regions. A few preset camera spots (patient, kit bags, bystander). **No Rapier.**
- **UI:** HTML/CSS overlay (Preact allowed) for the ACM medical menu, monitor, and drug prep.
- **Server:** small Node server (Hono). All Meta API calls go through it. **The API key never touches the client.**
- **AI:** Meta Model API — base URL `https://api.meta.ai/v1`, model `muse-spark-1.3` (verify both against dev.meta.ai docs on first run). Muse Voice Transcribe for push-to-talk. TTS: whatever the Meta API offers, fallback browser SpeechSynthesis.
- **Assets:** CC0 (Kenney, Quaternius, Poly Pizza, Sketchfab CC0). Muse Image for non-graphic textures/UI. Wounds are procedural (see §10).
- **Deploy:** Vercel/Netlify/Cloudflare (static + functions).

```
/src
  /engine      game loop, input, camera, raycasts
  /sim         physiology tick, conditions, interventions, pharmacokinetics, lines
  /patient     body regions, findings generator
  /kit         ACM inventory, drug prep, monitor
  /dispatch    call instantiation from generated call JSON
  /ui          medical menu, monitor screen, HUD, debrief
  /ai          voice capture, dialogue client
  /scoring     event log -> score + debrief payload
/server
  /prompts     patient, bystander, dispatch, radio, fto, callgen
  /routes      /chat, /transcribe, /tts, /generate-call, /debrief
/data
  /medical     drugs.json (provided), physiology.json, conditions.json, interventions.json, equipment.json
  /calls       components/*.json (call database), fixed/*.json (hand-authored), cache/*.json
  /difficulty  level1.json … level5.json
```

---

## 3. CORE LOOP (slice)

1. **Dispatch:** radio tone, AI dispatcher voice + CAD text (nature, address, age/sex, updates).
2. **Arrival:** short cinematic, then scene size-up (scene safety, PPE, mechanism, number of patients, request resources).
3. **Patient care:** the ACM medical menu plus the talking patient. The physiology engine ticks the whole time and the patient deteriorates in real time.
4. **Package for transport:** choose a destination (trauma / STEMI / stroke / nearest ED), then "load and go" ends the on-scene phase. Transport is simulated off-screen as a time skip with the engine still ticking.
5. **Radio report** by voice to the AI ED charge nurse, who asks follow-ups if the report is incomplete.
6. **Debrief:** AI FTO grades the call from the event log.

Win = patient alive and meeting transport criteria at handoff. Lose = arrest or death on your watch (realistic-outcome mode can kill a perfectly treated patient).

---

## 4. DIFFICULTY — SAME BOX, DIFFERENT HELP

The kit is **identical at every level.** Difficulty changes only help, information, and pace.

| Level | Role graded against | Help & information |
|---|---|---|
| 1 | First Responder | Vitals auto-display. Partner gives hints ("check for bleeding"). Slow deterioration. |
| 2 | EMT | Manual vitals (cuff, count RR, palpate pulse, SpO2 probe, glucometer, pupils, skin). No hints. Real deterioration. |
| 3 | AEMT | (grading parked) |
| 4 | Paramedic | (grading parked) Unlabeled rhythm strips, partner needs direction. |
| 5 | Critical Care | (grading parked) Nothing automated. |

**Custom dials:** information clarity (shown / measured / measured with artifact), deterioration speed, patient complexity (comorbidities, masking home meds), hints on/off, outcome realism, gore level.

**Scope of practice is logged, never enforced.** An EMT can push amiodarone. The drug acts pharmacologically and the debrief flags a scope violation.

---

## 5. PHYSIOLOGY ENGINE (`/src/sim`)

1 sim-second tick. Lightweight TS model, tuned toward Pulse Physiology Engine behavior.

**State:** bloodVolume_mL (70 mL/kg), HR, SBP/DBP/MAP, RR, tidalVolume, SpO2, EtCO2, GCS {E,V,M}, pupils, glucose, coreTemp, rhythm (enum), skin {color,temp,moisture}, capRefill, painScore, airwayPatency, pleuralPressure {L,R}, potassium, pH (simplified), coagulation (0–1), activeDrugs[], lines[].

**Baseline adult:** HR 60–100 · RR 12–20 · SBP 100–140 · SpO2 94–100 · EtCO2 35–45 · GCS 15 · glucose 70–140 · temp 36.5–37.5 °C · cap refill <2 s.

**Compensation (must exist):** as blood volume falls, HR rises first, then RR, pulse pressure narrows, skin goes pale/cool/diaphoretic, mental status declines, and **BP drops late**. Anchor to ATLS classes I–IV (<15 / 15–30 / 30–40 / >40% loss). Shock index >1.0 flagged. Masking meds (beta-blockers) and age modify the curve.

**Conditions** (`conditions.json`): per-tick effects, progression stages, findings per assessment action, resolvedBy / reducedBy interventions, compatible complaints, and onset delay (for late complications).

### 5.4b INFECTION, SEPSIS & COMPLEX TRAUMA (`conditions.json` — provided, DRAFT)
- **Infection is an engine system**, not flavor text: source + organism profile + bacterial load + growth/hr × host factors. It drives the sepsis stages (SIRS → organ dysfunction → septic shock: vasodilation, lactate, DIC, ARDS).
- **Antibiotics have spectrum** (`drugs.json` `coverage`, 0–3 per organism class). Wrong spectrum ≈ no effect. Time-to-first-antibiotic is logged. Allergies on the history card cause reactions. Abscess/empyema/fecal contamination need **source control** (surgery): antibiotics only slow them.
- **Asepsis is tracked:** skipped gloves, no skin prep, or a dirty IO site seeds line/wound infections.
- **Complex trauma:** sternal fracture → blunt cardiac injury; flail chest; penetrating thoracoabdominal wound; **diaphragmatic rupture with stomach/colon herniated into the chest** (bowel sounds in the chest, tension gastrothorax; the fix is an OG tube; **needle decompression into the stomach = iatrogenic gastric perforation**); **herniated viscus perforation with gastric or fecal contamination of the pleura** (feculent empyema); Boerhaave esophageal rupture → mediastinitis.
- **Outcome projection:** infections develop over hours, longer than a call lasts. After handoff, the engine fast-forwards a coarse 0–72 h hospital course from the event log (deterministic), and the FTO narrates it ("feculent empyema at 18 h; your ertapenem at 14 min cut septic-shock risk").
- Equipment additions: OG/NG tubes, POC lactate meter, chlorhexidine, droplet/contact PPE, chest tube kit (CC).
- **Slice scope:** all of this is data-complete now. The engine implements the infection/sepsis core + outcome projection on Nov 2 if ahead of schedule; otherwise it's the first post-hackathon feature. The complex trauma conditions are `generatorReady:false` until medic review.

### 5.4c TRAUMA LIBRARY + MARCH-PAWS (provided, DRAFT)
- **`/data/medical/trauma_library.json`** (84 injuries): hemorrhage, penetrating (GSW by region, stabbing, impalement, evisceration), chest, abdominal, ortho, crush, head/face/eye, spine, burns, blast, plus the odd ones (ring avulsion, open/closed degloving incl. Morel-Lavallée, scalp avulsion, high-pressure injection, fight bite, dog bite, lawnmower, fireworks, fishhook, commotio cordis, diving). Each has its MARCH step, bleed class, findings by assessment action, **spawns (hidden associated injuries with probabilities)**, correct fixes, traps, and infection seeds. Entries with `ref` point into `conditions.json`; entries with `stub:true` need full modeling before the generator uses them.
- **`/data/calls/components/mechanisms.json`**: mechanism weights from the ACS NTDB (falls 44%, MVT 26%, struck-by 6.5%, firearm 4.2%, cut/pierce 4.1%…) → subtypes → injury patterns (e.g. lap belt → bowel injury + Chance fracture; fall onto heels → check the lumbar spine; elderly ground-level fall → hip fracture + subdural if anticoagulated + "why did they fall?"). The Dispatch Engine samples from this.
- **`/data/medical/march_paws.json`**: the trauma assessment framework and its scoring: **S**cene → **M**assive hemorrhage → **A**irway → **R**espiration → **C**irculation → **H**ypothermia/Head → **P**ain → **A**ntibiotics → **W**ounds → **S**plinting → MIST handoff. Per-step checks, interventions, graded errors, time targets, and mandatory reassessment after any movement. L1 shows the checklist; L2+ grades silently.
- Bike down must exercise M (tourniquet), R (expose + check the back), C (radial pulse, shock trend), H (hypothermia wrap at night) and P (pain management) at minimum.

**Pharmacokinetics:** onset→peak→duration curves. Doses **stack**. Max doses are tracked. Toxicity, interactions, and incompatibilities are modeled (see `drugs.json` `dangers`).

---

## 6. ACM-STYLE KIT (`/src/kit`, `/data/medical/equipment.json`)

Modeled on Arma 3 ACM Extended: a full open kit, no indication hints, and consequences instead of locks.

**Rules**
- Every item is present at every difficulty. Nothing is greyed out.
- Items show only what the real item shows (name, size, concentration/volume).
- **Sizes matter:** wrong OPA/NPA/i-gel/ETT/catheter/cuff size has effects (an OPA that's too big obstructs, a cuff that's too small reads high).
- Every action costs realistic sim-time.

**Medical menu tabs:** Examine · Airway · Breathing · Circulation · Medications · Lines/Fluids · Procedures · Monitor · Log. Opened by clicking a body region (region-specific actions) or the patient.

**Inventory (all present):**
- **Assessment:** stethoscope, manual BP cuff (adult/large/peds), penlight, glucometer, thermometer, trauma shears (expose).
- **Hemorrhage:** CAT tourniquet ×2, SOF-T, junctional tourniquet, hemostatic gauze, plain gauze packing, pressure (Israeli) bandage, elastic wrap, direct pressure.
- **Chest:** vented and non-vented chest seals, needle decompression 14g 3.25", finger thoracostomy (CC).
- **Ortho/spine:** pelvic binder, SAM splints, traction splint, c-collar, scoop stretcher, vacuum mattress.
- **Airway:** manual + powered suction, OPA and NPA (full size sets), i-gel and King LT (sizes), ETT 6.0–8.5 + laryngoscope/video laryngoscope + bougie, cric kit, BVM (adult/peds), PEEP valve, waveform EtCO2.
- **Breathing:** nasal cannula, non-rebreather, nebulizer, CPAP, transport ventilator (CC). O2 tank pressure is tracked and can run out.
- **Circulation:** IV catheters 14–24g, IO drill (tibial/humeral) + sternal IO, saline lock, macro/micro drip sets, pressure bag, fluid warmer, syringes 1/3/10/20 mL, flush, crystalloids, whole blood (cooler).
- **Monitor/defib:** 3-lead and 12-lead, SpO2 pleth, NIBP (auto cycle), EtCO2 waveform, defib pads, manual defib, synchronized cardioversion, transcutaneous pacing, AED mode.
- **Drug box:** all entries in `drugs.json` (104).

**Drug prep loop:** open box → pick vial (read label) → choose syringe → draw mL → choose line/route → push or infuse (rate). Dose = mL × concentration. A 10× concentration error behaves like a 10× overdose.

**Lines (ACM-style):** multiple IV/IO sites, each with its own line. Bags hang on a specific line with a flow rate. Pulling a line stops its bags. Same-line incompatibilities (bicarb + calcium) are modeled. An infiltrated line (realistic chance) stops delivering.

**Deadly traps that must exist:** nitro in RV infarct or after PDE5 inhibitors; 1 mg/mL epi IV in a perfusing patient; paralytic without sedation; paralytic without an airway; adenosine in irregular WCT/WPW; diltiazem in hypotension; NSAIDs in a bleeding trauma patient; routine bicarb in arrest; over-resuscitating trauma with crystalloid; naloxone over-dosing (withdrawal) or under-monitoring (re-sedation); venous tourniquet (too loose → worse bleeding).

---

## 7. AI DISPATCH ENGINE — generated calls from real call data

Endless, realistic, never-the-same calls. **The LLM composes calls from the database; it never invents medicine.** This is the headline Meta-AI feature.

### 7.1 Call component database (`/data/calls/components/`)
| File | Contents |
|---|---|
| `complaints.json` | Dispatch chief complaints (fall, MVC, chest pain, breathing problem, unconscious, overdose, seizure, diabetic, allergic reaction, cardiac arrest, assault, stabbing/GSW…) with **real-world frequency weights** |
| `mechanisms.json` | Per complaint: mechanisms/causes (motorcycle vs guardrail, fall from ladder, rollover…) with weights |
| `conditions_map.json` | Mechanism/cause → conditions with probabilities, co-occurrence and exclusion rules, onset delays (e.g. tension pneumo develops 6–8 min in) |
| `patients.json` | Age/sex/weight distributions per complaint |
| `comorbidities.json` | Common histories + home meds (beta-blocker, anticoagulant, insulin, PDE5 inhibitor) and how they modify physiology |
| `environments.json` | Locations (roadside, bathroom, bedroom, gym, restaurant, construction site), time of day, weather, hazards |
| `bystanders.json` | Archetypes (panicked spouse, lying roommate, helpful off-duty nurse, hostile crowd, language barrier) |
| `complications.json` | Mid-call twists (vomiting, combativeness, re-bleed, rhythm change, re-sedation) |

**Data source:** frequency weights from the **NEMSIS Public-Release Research Dataset** (national US EMS records: dispatch complaints, primary impressions, procedures, meds). Access is by request at nemsis.org and may not arrive in time, so **seed the weights with estimates tagged `"WEIGHT_EST"`** and swap them for NEMSIS data later. Each component carries a `sourceNote`.

### 7.2 Generation pipeline (`/server/routes/generate-call`)
1. **Seeded sampler (code, not LLM):** weighted draw → complaint → mechanism → conditions (applying co-occurrence/exclusion rules) → patient → comorbidities/meds → environment → bystanders → 0–1 complication. Output: a **call skeleton** containing only valid IDs. Difficulty filters which complexity components can appear.
2. **Muse Spark fleshes it out** (strict JSON schema): dispatcher script + CAD text (what the 911 caller *would* report, including wrong or partial info), scene description, patient persona + hidden **history card** (SAMPLE/OPQRST answers consistent with the skeleton, plus secrets), bystander personalities and lines, and the expected care pathway (for the FTO).
3. **Validator (code):** every ID exists, history is consistent with conditions and meds, no clinical numbers in LLM output. Invalid → retry once → fall back to a cached call.
4. **Engine instantiates:** the physiology engine builds the true state from conditions + patient + meds. Vitals always come from the engine, never the LLM.
5. **Cache** valid generated calls in `/data/calls/cache/` so demos and judges always have instant calls. Add a "Daily Call" shared seed.

**Fixed seed:** `/data/calls/fixed/bike_down.json` — 28M, motorcycle vs guardrail, night, left femoral arterial bleed (tourniquet in ~3 min or he arrests). Hand-authored, used for the demo.

**Generator v1 condition set** (each must be fully modeled in `conditions.json` before the generator can use it): femoral/extremity arterial bleed, hemorrhagic shock (derived), opioid overdose, hypoglycemia, anaphylaxis, stable SVT, symptomatic bradycardia, inferior STEMI with RV involvement (nitro trap), asthma exacerbation, VF arrest. The generator can only use conditions flagged `"generatorReady": true`. New conditions = more possible calls, with no code changes.

---

## 8. INTERACTION

- Fixed kneel camera at the patient + mouse look. Click a body region → region menu: Inspect / Palpate / Auscultate / Expose / Apply [item] / Procedure.
- Regions: head, face, neck, chest L/R, abdomen (4 quadrants), pelvis, each arm, each leg, back (log roll with partner).
- **Skill minigames (short):** tourniquet windlass (crank until bleeding stops; too loose = venous tourniquet), BP cuff (inflate, listen, read needle), count RR (watch chest rise for 15/30 s), CPR rhythm bar (100–120/min, depth), BVM squeeze timing (1 breath every 6 s; overventilation penalized), IV site + catheter size + flash.
- **Partner (AI):** voice or menu commands ("get vitals", "hold c-spine", "set up suction"), each with realistic time cost.
- On-screen clock: time since patient contact.

---

## 9. AI FEATURES (all through `/server`)

1. **Talking patient (flagship):** push-to-talk `V` → Muse Voice Transcribe → Muse Spark plays the patient → TTS. Speech is **gated by engine state**: GCS, hypoxia, pain, intoxication, shock (answers degrade as BP drops). History card facts are revealed only when the right questions are asked. The LLM cannot change state. Short replies (1–2 sentences), streamed.
2. **Bystanders:** archetype-driven; they can help, obstruct, or lie.
3. **Dispatcher** voice and updates.
4. **Radio report:** the player's voiced report is graded for MIST/SBAR elements; the AI charge nurse asks for what's missing.
5. **AI FTO debrief:** event log + final state + expected pathway → timeline of key moments, what went right, misses, time-to-critical-intervention, traps triggered, scope violations, grade. Tone: direct, experienced field training officer.
6. **Dispatch Engine** (§7).

Every prompt template lives in `/server/prompts/` and receives an engine **state snapshot** it must stay consistent with.

---

## 10. GORE / VISUALS

Clinically accurate, not horror. **Blood pool size and clothing saturation are driven by the engine's actual mL lost.** Arterial = bright, pulsatile, timed to HR. Venous = dark, steady. Skin color follows perfusion (pallor, cyanosis, mottling). Procedural wound shaders + CC0 decals (Muse Image will likely refuse graphic wounds). Gore setting: Clinical (default) / Realistic / Reduced.

---

## 11. SCORING (deterministic, from event log)

Time to critical interventions · primary survey completeness/order · correct vs. contraindicated vs. unnecessary interventions (overtreatment penalized) · dose accuracy · reassessment frequency · destination · report completeness · outcome weighted by difficulty. The FTO explains the score; code computes it.

---

## 12. AUDIO

Radio tones/squelch, monitor beeps synced to HR, SpO2 tone pitch tracking saturation, cuff inflation, O2 hiss, breathing that changes (stridor, gurgling, agonal), siren on arrival. CC0 sources.

---

## 13. MILESTONES

| Date | Milestone | Done when |
|---|---|---|
| Oct 26 (tonight) | Step 0 | Rules accepted, Discord joined, Meta API key in server `.env`, one Muse Spark call succeeds |
| Oct 27 | Skeleton | Vite + Three.js scene, fixed kneel cam, raycast body regions, data loaders + schemas, server proxy, F1 debug vitals |
| Oct 28 | Physiology + hemorrhage | Tick, compensation curve, femoral bleed, tourniquet/packing/pressure, ACM menu (Examine, Circulation), engine-driven blood pool |
| Oct 29 | Kit depth + patient voice | Drug prep loop, lines/fluids, monitor, airway/breathing tabs, manual vitals (L2), talking patient |
| Oct 30 | Bike down end-to-end | Dispatch → care → destination → radio report, L1 + L2. **Wyatt playtests for medical truth** |
| Oct 31 | Dispatch Engine v1 | Component DB seeded, sampler, Muse fleshing, validator, cache; ≥5 generatorReady conditions |
| Nov 1 | FTO debrief + fixes | Debrief from event log; all playtest medical errors fixed |
| Nov 2 | Depth + polish | Remaining v1 conditions, traps verified, audio, gore settings, main menu, difficulty menu |
| Nov 3 | Demo | Bug freeze evening. Record 2–3 min video, write-up, screenshots |
| Nov 4 | Ship | **Submit by noon ET.** Nothing new after that |

**If behind, cut in this order:** remaining generator conditions (keep ≥3) → bystander AI → CPR/BVM minigames (menu actions instead) → TTS (text patient replies) → radio voice (text report). **Never cut:** physiology engine, ACM kit + drug prep, talking patient, FTO debrief, Bike down L1/L2, Dispatch Engine with at least 3 conditions.

---

## 14. DEMO VIDEO (2–3 min)

1. Hook: "Every call is different. Every drug is in the box. Nothing tells you what to use."
2. Bike down at L1: hints, tourniquet, blood pool stops growing.
3. Same call at L2: manual vitals, the patient's answers degrade as BP drops.
4. Drug box: a 10× concentration error and its consequence.
5. Dispatch Engine: generate 3 new calls live (an overdose in a bathroom, a STEMI at a restaurant, anaphylaxis at a picnic) and show the skeleton → Muse → playable call.
6. Voice radio report, then the FTO debrief calling out a missed reassessment.

Pitch line: **"A paramedic sim where the body is a physiology model, the patient's voice is Muse, and every 911 call is generated from real EMS data."** Built by an EMT-track pre-med student; clinical content from AHA 2025, NASEMSO, TCCC, NREMT; medic-reviewed. Disclaimer: entertainment/education, not medical training.

---

## 15. FIRST TASK FOR YOU (Muse Code)

1. Scaffold the repo exactly as in §2.
2. Place the provided `drugs.json` in `/data/medical/`. Write JSON Schemas + loaders for it and for empty, schema-complete `physiology.json`, `conditions.json`, `interventions.json`, `equipment.json`, all `/data/calls/components/*.json`, and `/data/difficulty/level1–5.json` (`TODO_CLINICAL` / `WEIGHT_EST` placeholders).
3. Build the Oct 27 milestone.
4. Reply with: what you built, how to run it, and the `TODO_CLINICAL` fields Carlos must fill next, ordered by what blocks you first.
