# First Due - Oct 29 Kit Depth + Patient Voice

First-person paramedic sim. Meta Global AI Developer Hackathon 2026, Indie track.
Source of truth: `MUSE_BRIEF_1.md` (Project Brief v2). When in doubt, the brief wins.
Clinical source of truth today: `OCT28_MEDICAL_ANSWERS` (sections 1-7 + item 8).
Values are textbook anchors (ATLS / TCCC / NREMT / PHTLS) and still need
sign-off from a certified medic before Nov 4.

This milestone, on top of Oct 28 (commit 6d1074c, untouched curve): Airway and
Breathing tabs with Josh-exact sizing and failure modes, IV/IO with explicit
fluid volumes, minimal drug prep loop over 26 of 104 drugs, L2 manual vitals
with listed times and errors, monitor with lagged SpO2 and waveform EtCO2,
and the talking patient (Josh) through the server proxy. F1 stays debug-only.
No Dispatch Engine, no FTO debrief, no destination/radio report, no
infection/sepsis, no second patient, no art pass, no driving.

## Oct 30 UI + QoL pass (branch claude/ui-qol-terms)

Presentation and bug fixes only. No clinical value changed.

- Wording toggle (top bar, or T): Medical keeps clinical terms with a hover
  tooltip giving the plain meaning; Plain rewrites them into everyday words.
  Glossary lives in `src/ui/terms.ts`. Remembered between sessions.
- Coach tips (Tips button, or H): one short "why" line under each section,
  in `src/ui/tips.ts`. Never says which option is right in this call.
- MARCH strip under the region title: tracks what the player has DONE
  (never hidden truth) and highlights the next priority.
- Sim speed: Pause / 1x / 2x in the top bar, P toggles pause.
- Tab hotkeys: E A B C M L N, V talk. Hotkeys no longer fire while typing
  (typing "1" in the drug amount used to switch the camera).
- Panel: fixed header (region, MARCH, tabs) and footer (status, progress
  bar, log); collapsible sections (remembered); body regions folded away.
- Full event log with filters, plus a Run report (time to first hands on,
  time bleeding controlled, loss at control, rebleeds, class changes, line
  and fluid times, traps the player sprang).
- Fixes: dropdown picks reset on every state change (now kept); Examine
  findings vanished the instant they appeared (now stay under their
  button); panel jumped to the top each change (scroll kept); talk draft
  wiped mid-typing (kept); hemorrhage status still said "VENOUS, bleed
  worse" after a second TQ fixed it.
- Defaults: CAT half-turns now defaults to 3 (protocol). Under 3 is still
  a pickable trap, but no longer the silent default.
- Engine: second CAT takes half-turns (under 3 does not clamp, same rule as
  the first). Partner truck runs are one trip: items added while the
  partner is still outbound ride along, later ones queue after the run.

Still open for Wyatt (TUNE, not changed here): untreated Josh reaches Class
IV around 2 min from contact in play, faster than the 4 min target, because
he starts at 1,100 mL lost and bleeds ~490 mL/min with the shirt held.

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

## Parked for Oct 30 (not built today)

- Bike down end-to-end flow: dispatch, destination choice, radio report.
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
