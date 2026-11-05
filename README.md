# First Due: Paramedic Simulator

A training simulation for paramedic decision-making. For education, not for advice to real patients.

Indie developer track, Build for Your World.

Demo video: [Demo Video](https://youtu.be/1SkU-BTa65s)

## What it is

One call, one patient: Josh, 28, bike down with a left femoral bleed. Talk to him, follow MARCH, stop the bleed, package him, choose a destination, ride through transport, give the radio report, hand off, and debrief with the FTO. A full run takes 5 to 10 minutes.

## How to play

Dispatch, size-up, talk, care, package, destination, transport, radio, handoff, debrief.

## How to run it

Use branch clean-rebuild, not main: https://github.com/starvingartique/FirstDue

Two terminals from the repo root (PowerShell with `npm.cmd` on Windows):

```sh
# Terminal 1: the server proxy (holds the key, localhost only)
npm.cmd run dev:server
# expect: First Due server on http://127.0.0.1:8787

# Terminal 2: the game client
npm.cmd run dev
# expect: Local: http://127.0.0.1:5173/
```

Open http://127.0.0.1:5173/ in a browser. The client calls the server same-origin through the dev proxy, so the key never touches the browser.

Key setup: put your own Meta Model API key in server/.env only, as MODEL_API_KEY (see server/.env.example). Never commit server/.env; only server/.env.example is tracked. Without a key the sim still runs, but patient, radio, debrief, and mic answers fall back or say the key is missing.

Controls, as in this build:

- H opens and closes the ACM medical menu; Esc closes it. Opening never pauses the sim.
- With the menu open: 1-8 pick categories (Triage, Examine, Bleeding, Airway, Breathing, Meds, Lines, Monitor); W/A/S/D/Z/X pick body parts.
- With the menu closed: 1/2/3/4 switch camera spots (Patient, Bag, Bystander, Partner).
- V focuses chat to talk; G packages for transport; F1 shows live engine debug.
- Ctrl+H with the menu closed peeks a small status card (if the browser passes the keys through).
- Top bar: Pause/Play, 0.5x/1x/2x speed, Medical / Plain wording toggle, Settings.
- Paper doll (upper right): click a region to open it. Center progress bar: cancel stops the action. Chat (bottom left): type always works; the mic button is push-to-talk file upload with text fallback.

## How it uses Meta tools

- Muse Spark 1.3 Standard, via the server proxy, voices Josh (the patient), the radio charge nurse, and the FTO debrief. Transcription runs through muse-voice-transcribe-1.0 as file upload; realtime is not built. The key lives in server/.env only and never reaches the browser. The bystander is not LLM-voiced: his lines mirror engine log lines.
- Muse Code built the game, on the clean-rebuild history.
- The sim engine is plain code, not LLM: vitals tick, the bleed timer runs, and interventions change numbers in src/sim with no network calls. The LLM only voices people; it never decides vitals or outcomes.
- Dispatch Engine: seeded generated calls from component data with the persona fix (a generated patient uses its own persona, never Josh). Demo seeds in this build: 44 (overdose in a bathroom) and 143 (allergy at a picnic), both asserted in sim:test31. The demo runs the fixed Bike down call; generated calls are covered by headless tests with a cached-call fallback.

## Features

Only what is in this build:

- Physiology engine: bleed curve, shock classes, vitals tick, arrest window.
- ACM medical menu, kit actions, and drug prep/push over the 104-drug reference (missing fields show TODO_CLINICAL).
- Talking patient through the server proxy, with text fallback.
- Paper doll with engine-state markers, Medical / Plain wording toggle, speed controls, MARCH strip, group chat, blood sweep.
- Kit depth: blood lines with Y tubing and warmer, sternal IO, truck boxes, kit refund rule.
- FTO debrief from the run report, with a code-built fallback.
- Dispatch Engine with seeded generation and persona fix.

Not claimed: AED analysis and shock were never implemented in the clean codebase; mic realtime is not built (file-upload transcribe with text fallback); sound effects from the SFX checklist are not wired.

## What's next

Planned after the hackathon, not built yet:

- Publish First Due after the hackathon, as a training simulation for paramedic decision-making, for education, not for advice to real patients.
- Finish the features left for after submission: AED analysis and shock, mic realtime, sound effects from the First Due SFX checklist.
- Grow the Dispatch Engine past its current floor, with more generated conditions, and keep the floor at 3 conditions minimum, with medic review before any new condition is flipped to ready.
- Get certified medic sign-off on all drug values and effect magnitudes, which are currently textbook anchors from ATLS, TCCC, NREMT, and PHTLS, tagged TUNE or TODO_CLINICAL where they still need review.
- Keep the game solo indie, one patient and one short run at its core, and add depth in medicine and AI first, before any new scene, driving, or multi-patient work.

## Credits

Thank you to Carlos for medical knowledge help and playtesting.

Shina is the sole participant and Representative, indie track.

## Changelog

Patch notes below are history, not a current feature list. See Features above for what is in the submitted build.

## Nov 2 small pass on clean: paper doll + wording toggle

- Paper doll body view at the top of the Examine tab: front-view outline,
  all 15 regions clickable (back is a button), opens the same region menu
  as the scene and chips. Dots and rings mirror engine state only: TQ,
  packing and dressing on the left thigh (the 3D wound side), sternal on
  the chest, limb lines on the right by convention (no laterality is
  tracked), Y set as a dashed ring, warmer as an orange ring.
- Medical / Plain toggle in the top bar now rewords tabs, chips, region
  panel, vitals pill, tips bubble, kit labels, menu, doll names, and the
  end report (fresh build per toggle, both directions). Persists in
  localStorage (fd.wording). Wording only, nothing clinical changes. Log
  history, MARCH letters, and talk lines stay verbatim.
- Tests: `npm.cmd run sim:ui` (doll coverage, markers, plain pairs,
  second-sweep safety).

## Nov 2 kit pass on clean: blood, IO, boxes (Phases 1-3; Phase 4 cut)

- Kit actions that fail after taking stock now refund the item instead of
  using it up. Blood counts read "here N, truck M".
- Sternal IO (FAST1-style): one attempt, 30 s, 95 percent, humeral-range
  pressure flow (all TUNE, needs medic sign-off), with lidocaine option.
- Y tubing blood lines: 45 s prime with NS through the warmer, 1-2 units,
  4-unit/4 h cap (TUNE), LR refused on blood lines, NS 250 with NS 1 L
  fallback. Warmer rides the Y set. Drip sets stay on the line; rehangs
  take 20 s.
- Truck boxes staged by one 50 s partner trip: Narc, cooler, blood kit,
  RSI, critical care, OB, CBRN. Narc/RSI/CC drugs gated until staged.
- Stock table rebuilt to ALS levels; belt CAT stays 1 but 5 land at the
  patient. Pelvic binder, needle decompression, cric, LifeFlow have no
  action yet. Phase 4 diagram/Body view work cut: clean-rebuild has no
  diagram or Body view.
- Tests: `npm.cmd run sim:kit` (refund, sternal, Y set, drip reuse,
  box gates, staging, fetch landing).

## Nov 2 pass on clean: FTO debrief + feedback fixes

- FTO debrief after handoff, from the run report: timeline, what went
  right, misses, time to critical intervention, traps, reassessment,
  destination and radio as logged. Spark FTO through the existing server
  setup; code-built fallback from the same facts when Spark fails, never
  blank, never a made-up grade. Destination and the four open clinical
  questions stay logged and open. Screen carries the sim-only framing.
- Pulse ox vitals pill: HR plus lagged monitor SpO2 stays in the top bar
  while the probe or defib pads are on, across all menu tabs. Engine
  numbers only. Pads are monitor display only, no shock modeled.
- Chat dock bottom middle: text the patient while working the menu, with
  push-to-talk mic through the server transcribe proxy
  (muse-voice-transcribe-1.0, file upload; realtime left for later). Text
  always works, including when the mic is unavailable.
- Blood sweep: one 12-second whole-patient look for immediate wounds,
  bleeding and tenderness, from engine state only. Logged and reported;
  changes nothing clinical; says a full region exam is still needed.
- Tests: `npm.cmd run sim:nov02` (sweep, pads, fallback debrief).

## Oct 31 Dispatch Engine v1 (clean rebuild, Nov 2)

Seeded call generator beside the fixed Bike down card. Dispatch shows Bike
down first with a Generate New Call panel (seed blank for random, or type
one). Component database, seeded sampler, Muse fleshing with a strict
schema, validator with retry then cached fallback, engine instantiation,
and a cache with 3 generated calls. A malformed accept falls back to Bike
down; an unreachable server falls back to a bundled cached call. Dispatch
never strands the player.

- New files: src/dispatch/sampler.ts, validate.ts, instantiate.ts,
  types.ts, cache.ts, server/routes/generate-call.ts,
  scripts/oct31-test.ts (`npm.cmd run sim:test31`).
- L1 stays simple (L1 complaint pool, no mid-call complication). Demo
  seeds: 44 overdose in a bathroom, 22 chest pain at a restaurant,
  143 allergy at a picnic.
- Presence knobs default present, so Bike down replays exactly; mid-call
  complications (vomiting, re-bleed) fire from the skeleton on generated
  calls only.
- Patient voice fix (Nov 1 bug): a generated patient uses its own
  generated persona and history, never Josh, never a leg bleed unless the
  generated condition includes one. Covered by scripts/persona-test.ts
  (`npm.cmd run sim:persona`).

GeneratorReady audit, Nov 2 (target 5, floor 3): 4 ready, all in
oct28_conditions.json and fully modeled by the engine -
femoral_arterial_bleed (bleed curve plus TQ, packing, pressure, dressing),
hypothermia_trauma (temp slide plus wrap), crash_stress_offset (stress
vitals offset), road_rash (ooze plus clot). The 11 conditions.json entries
are unreviewed stubs and stay generatorReady false. No flag flipped. Floor
met, target not met.

## Oct 30 bag labels and hands (clean rebuild, Nov 2)

Labels are small HTML pills anchored to the staged kit items, visible only
in the kit spot. Clicking an item or its label opens that item's existing
menu tab and shows a static preview card (label, visual-only description,
jump-to-section button). No motion: the card appears and dismisses
instantly. First-person gloved hands appear while a procedure runs,
holding a clone of that procedure's kit item. Labels follow the Medical /
Plain wording toggle through src/ui/wording.ts.

- New files: src/ui/kitLabels.ts, src/engine/hands.ts. Kit items carry a
  kitItem tag plus world-space label anchors; picking walks up from the
  hit mesh so tagged children resolve.
- Hands angle fix included: palms face the item, fingers forward and down,
  thumbs on the inner edge, wrists trailing back toward the viewer.
- Menu navigation reimplemented for the links: setTab plus openKitAction
  with an instant jump and a static section highlight.

## Oct 30 Bike down end-to-end (clean rebuild, Nov 2)

Wiring only, no clinical value changed. Full run: level select (L1/L2) ->
dispatch (fixed Bike down CAD text) -> size-up checklist -> care (the Oct
28 + Oct 29 loop) -> package + destination (trauma / STEMI / stroke /
nearest ED, logged not graded) -> 300 s transport skip with the engine
ticking -> text radio report to the AI charge nurse (MIST follow-ups, same
model and settings as the talking patient) -> handoff. Win = alive + bleed
under 30 mL/min + airway patent at handoff; lose = arrest anywhere on your
watch. The end screen shows transport criteria plus a run report with
Level / Destination / Outcome rows. G or the Package button ends scene care.

- L1: vitals auto-display, partner hints, deterioration x0.5 (named dial
  L1_DETERIORATION_SCALE, open TUNE flag). L2: manual vitals, no hints,
  x1.0 exactly.
- New files: src/ui/flow.ts, src/flow.css, src/ui/wording.ts,
  server/routes/radio.ts, server/prompts/radio.txt, scripts/oct30-test.ts
  (`npm.cmd run sim:test30`).
- Wording toggle (Wording button in the top bar): Medical shows strings as
  authored; Plain swaps known clinical words for everyday ones through
  Shina's own small table in src/ui/wording.ts. Remembered between
  sessions. Reimplemented in the clean rebuild; no tooltips.
- No Dispatch Engine (Oct 31), no FTO debrief (Nov 1), no second patient,
  no driving, no ambulance interior, no art pass.

Open clinical questions (TUNE, not settled here), in blocker order:

1. Handoff airway bar (patency 0.8+, no esophageal tube) - invented Oct 30.
2. Transport skip 300 s - scenario param, decides who survives transport.
3. L1 deterioration x0.5 - the brief gives slow/real with no number.
4. Destination correctness for a femoral bleed - not graded, needs a rule.

# First Due - Oct 29 Kit Depth + Patient Voice

First-person paramedic sim. Meta Global AI Developer Hackathon 2026, Indie track.
Source of truth: `MUSE_BRIEF_1.md` (Project Brief v2). When in doubt, the brief wins.
Clinical source of truth today: `OCT28_MEDICAL_ANSWERS` (sections 1-7 + item 8).
Values are textbook anchors (ATLS / TCCC / NREMT / PHTLS) and still need
sign-off from a certified medic before Nov 4.
Thank you to Carlos for medical knowledge help and playtesting.

This milestone, on top of Oct 28 (commit 6d1074c, untouched curve): Airway and
Breathing tabs with Josh-exact sizing and failure modes, IV/IO with explicit
fluid volumes, minimal drug prep loop over 26 of 104 drugs, L2 manual vitals
with listed times and errors, monitor with lagged SpO2 and waveform EtCO2,
and the talking patient (Josh) through the server proxy. F1 stays debug-only.
No Dispatch Engine, no FTO debrief, no destination/radio report, no
infection/sepsis, no second patient, no art pass, no driving.

## Prereqs

- Node.js 20 or newer (`node --version` to check)
- A Meta API key (server side only, never in client code)

## Run it

Run from the repo root. On Windows use PowerShell with `npm.cmd`; on Mac use
`npm` in Terminal.

```sh
# 1. Install
npm.cmd install

# 2. Validate every data file through the shared loaders
npm.cmd run validate-data

# 3. Headless engine acceptance tests (fixed seeds, no browser)
npm.cmd run sim:test
npm.cmd run sim:test29
npm.cmd run sim:test30

# 4. Put the Meta key in the server env (gitignored, never committed)
cp server/.env.example server/.env
# then paste the real key as MODEL_API_KEY in server/.env

# 5. Start the server (terminal 1)
npm.cmd run dev:server
# expect: First Due server on http://localhost:8787

# 6. Start the client (terminal 2)
npm.cmd run dev
# expect: Local: http://localhost:5173/
```

Open http://localhost:5173/ in a browser.

Production build check: `npm.cmd run build`, then `npm.cmd run preview`.

## Acceptance probes

```sh
# Live Muse Spark calls through the server (needs the key + running server)
npm.cmd run server:test
# expect: model: muse-spark-1.3 / text: First Due server link OK.
# then a patient reply in character as Josh (locked backstory, no em-dashes).

# Server health without a key
curl http://localhost:8787/api/health
```

In the browser: drag to look, click a body region to highlight it, press 1/2/3
for camera spots (patient, kit bags, bystander), press F1 for LIVE engine
vitals, press V to talk to Josh. Tabs: Examine (inspect/expose/log-roll),
Airway (OPA/NPA/i-gel/King/ETT/suction), Breathing (O2 devices + tank, BVM),
Circulation (tourniquet / second TQ / packing / pressure / dressing, truck
fetch), Meds (drug prep loop), Lines (IV/IO/fluids), Monitor (L2 manual
vitals + NIBP/SpO2/EtCO2), Talk (patient voice). Watch the clock: untreated
Josh hits Class IV near 4 min, arrest window 5-6 min.

## Layout

```text
/src
  /data      types.ts, validate.ts, loaders.ts (JSON Schema mirrors + checks)
  /engine    scene.ts, camera.ts, input.ts, raycast.ts, loop.ts (1 Hz sim tick)
  /sim       rng.ts, types.ts, physiology.ts, engine.ts, scenario.ts (Oct 28)
             airway.ts, lines.ts, drugs.ts, exams.ts (Oct 29 kit depth)
  /patient   regions.ts, body.ts, highlight.ts
  /ui        hud.ts, debug.ts (live), medicalMenu.ts (8 tabs), talk.ts
  main.ts, style.css
/server
  /lib       config.ts, meta.ts, prompts.ts
  /routes    chat.ts, test.ts, patient.ts (transcribe/tts/generate-call/debrief land later)
  /prompts   patient.txt (Josh locked) + TODO placeholders
/schemas     one JSON Schema per data file (draft 2020-12)
/data
  /medical     drugs.json (provided, 104, untouched) + DRAFT drops + Oct 28/29 files
  /calls       components/*, fixed/bike_down.json, cache/
  /difficulty  level1-5.json
/scripts     validate-data.ts, server-test.ts (+patient probe), sim-test.ts, oct29-test.ts
```

## API notes (verify on first run, brief section 2)

- Base URL `https://api.meta.ai/v1`, model `muse-spark-1.3` (Standard, never the
  contributor model). Override with `MODEL_ID` in `server/.env` if docs say otherwise.
- Patient calls send Reasoning Low (`reasoning_effort: "low"`), Temperature 0.7,
  Max tokens 2000. If the Meta API names the reasoning param differently, change
  it once in `server/lib/meta.ts`.

## TODO_CLINICAL for Carlos, in blocker order

`drugs.json` (104 drugs) is used as-is. Nothing invented. All values below
are textbook anchors (ATLS / TCCC / NREMT / PHTLS) from
`OCT28_MEDICAL_ANSWERS` and need sign-off from a certified medic before Nov 4.

1. Oct 29 airway sizing (`oct29_airway.json`): OPA 100 (90 ok), NPA 30-32,
   i-gel #4, King #4, ETT 7.5-8.0 at 22-23 cm, BVM mask large, with the
   listed wrong-size failures. Blocks airway truth.
2. Oct 29 `engineCoupling_TUNE`: patency/FiO2 to vitals coupling the answers
   file does not give (SpO2 20 per patency lost, FiO2 bonus 25, aspiration
   -8, mainstem -1 per 10 s, cuff leak -2, BVM assist +5, overvent SBP -2 per
   excess breath doubled past 30 percent loss). Blocks Nov 4 medical truth.
3. Oct 29 lines/fluids (`oct29_lines.json`): catheter flows, IV success
   modifiers (shock -30, dark -10, big-gauge-small-vein -10 TUNE),
   infiltration 5 percent/hr + 5 percent/move (TUNE), IO flows and the
   40 mg lido rule, crystalloid decay to 250 mL at 60 min, blood at 90
   percent. Blocks fluids truth.
4. Oct 29 manual vitals (`oct29_vitals.json`): listed times and errors, plus
   engine cutoffs (shock artifacts past 30 percent loss, temporal -0.5-1.0
   TUNE, RR +4 within 120 s of talking). Blocks L2 grading truth.
5. Drug prep loop rules: standard dose = first dosing entry with a single
   numeric mass dose; token map = bare tokens on the 8 mapped keys only
   (conditionals and ranges skipped, never guessed); 26 usable, 78 unusable
   (listed below, shown in the Meds tab as a count). Above 2x, dangers apply
   as flags only. Needs scope/trap review (nitro, epi 1 mg/mL IV, paralytic
   without sedation/airway, NSAID in bleeding trauma are NOT modeled yet).
6. `physiology.json` shock curve (Oct 28, unchanged): anchors, 60 percent
   beta-blocker suppression (TUNE), arrest window 15 percent/tick past 50
   percent, forced at 58 percent (TUNE). Untreated: II 69s / III 139s /
   IV 193s / window 270s.
7. `interventions.json` hemorrhage set (Oct 28, unchanged): TQ half-turns 3
   (TUNE), single-CAT failure 25 percent with 10-20 percent residual (TUNE),
   packing rebleed 60 percent (TUNE), junctional success 80 percent (TUNE),
   fatigue -5 percent/min past 3 min (TUNE). Second TQ is player-triggered
   (confirmed, not auto-applied); the 25 percent roll is Wyatt's TUNE flag.
8. `oct28_conditions.json`: hypothermia slide -0.5 C per 10 min exposed and
   wet (TUNE). Blanket is now a tracked item (jump 1, cabinet 2, placeholder
   counts for Wyatt).
9. `bike_down.json`: scene-start fix (1,100 mL, shirt 50 percent, belt x1.3).
   Weight stays 80 kg, never shown in UI. Josh says "about 175 pounds".
10. Oct 29 kit quantities in `equipment.json` are logistical placeholders
    for Wyatt sign-off, not clinical values.
11. Oct 31 sampler data: complaints, conditions_map, patients, comorbidities,
    environments, bystanders, complications (WEIGHT_EST weights + triggers).

Unusable drugs in this build (no single standard dose, 55): lidocaine,
dopamine, norepinephrine, vasopressin, verapamil, procainamide,
magnesium_sulfate, sodium_bicarbonate, morphine, ketamine, rocuronium,
naloxone, dextrose_10, diphenhydramine, normal_saline, lactated_ringers,
whole_blood, oxygen, dobutamine, phenylephrine, nitroglycerin_iv, labetalol,
nicardipine, heparin, tenecteplase, furosemide, digoxin_immune_fab,
hydromorphone, nitrous_oxide, diazepam, propofol, dexmedetomidine,
droperidol, haloperidol, olanzapine, racemic_epinephrine, dexamethasone,
activated_charcoal, duodote, pralidoxime, lipid_emulsion, methylene_blue,
prothrombin_complex, prochlorperazine, promethazine, tetracaine_ophthalmic,
ibuprofen, hypertonic_saline, mannitol, oxytocin, plasma, prbc, d5w,
vancomycin, tetanus_toxoid.

Unusable drugs in this build (no token mapping, 23): adenosine,
calcium_gluconate, aspirin, ondansetron, methylprednisolone,
tranexamic_acid, ticagrelor, sugammadex, flumazenil, thiamine, famotidine,
cefazolin, ertapenem, moxifloxacin, ceftriaxone, piperacillin_tazobactam,
metronidazole, cefepime, clindamycin, cefadroxil, cephalexin,
amoxicillin_clavulanate, levetiracetam.

## Parked for Oct 31 and Nov 1

- Oct 31: Dispatch Engine generator. Nov 1: AI FTO debrief.
- Dispatch Engine, FTO debrief, infection/sepsis.
- Drug infusions (push only today), same-line incompatibilities, max-dose
  tracking, scope-violation flags.
- Voice input (push-to-talk transcribe) and TTS; Talk is text today.
- Chest procedures (needle decompression, seals), spine/ortho, CPR.

## Known Oct 29 limits

- Loosened TQ slips to 35 percent flow until reassessed (engine rule, kept
  from Oct 28 per brief; TUNE flag for Wyatt, not retuned).
- Decompensation segment (50-55 percent) stays linear (kept from Oct 28;
  TUNE flag for Wyatt, not retuned).
- Unsecured ETT always dislodges on a move (answers file says "a chance"
  without a number; deterministic until Carlos gives a probability).
- Esophageal placement comes from a "blind attempt" game control (no first-
  pass probability in the answers file; deterministic until Carlos rules).
- Auscultated BP is inaudible at roadside per the answers file, so cuff-size
  errors only trigger off-roadside (covered by headless unit checks).
- CPAP drains the tank at a 10 L/min TUNE stand-in; PEEP has no vitals
  coupling yet. Pupils have no drug model (always 4 mm reactive).
- Pre-existing DRAFT data files (`conditions.json`, `trauma_library.json`,
  `mechanisms.json`, `march_paws.json`) and the brief still contain
  em-dashes; every file created or edited for Oct 28/29 uses single hyphens
  only. `drugs.json` (provided, must stay as-is) also contains em-dashes.
