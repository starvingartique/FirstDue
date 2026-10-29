# First Due - Oct 28 Physiology + Hemorrhage

First-person paramedic sim. Meta Global AI Developer Hackathon 2026, Indie track.
Source of truth: `MUSE_BRIEF_1.md` (Project Brief v2). When in doubt, the brief wins.
Clinical source of truth today: `OCT28_MEDICAL_ANSWERS` (sections 1-6 + item 8).
Values are textbook anchors (ATLS / TCCC / NREMT / PHTLS) and still need
sign-off from a certified medic before Nov 4.

This milestone: 1-second physiology tick with shock interpolation, femoral
arterial bleed (700 mL/min at MAP 93, pressure-scaled), all five hemorrhage
interventions with traps, belt/jump/cabinet inventory with truck fetch, ACM
menu Examine + Circulation tabs, live F1 debug vitals, engine-driven blood
pool. No walking, no Rapier.

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

# 3. Headless engine acceptance tests (30 checks, fixed seeds, no browser)
npm.cmd run sim:test

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
# One live Muse Spark call through the server (needs the key + running server)
npm.cmd run server:test
# expect: model: muse-spark-1.3 / text: First Due server link OK.

# Server health without a key
curl http://localhost:8787/api/health
```

In the browser: drag to look, click a body region to highlight it, press 1/2/3
for camera spots (patient, kit bags, bystander), press F1 for LIVE engine
vitals. Use the Examine tab to inspect/expose/log-roll, the Circulation tab
for tourniquet / second TQ / packing / pressure / dressing and truck fetch.
Watch the clock: untreated Josh hits Class IV near 4 min, arrest window 5-6 min.

## Layout

```text
/src
  /data      types.ts, validate.ts, loaders.ts (JSON Schema mirrors + checks)
  /engine    scene.ts, camera.ts, input.ts, raycast.ts, loop.ts (1 Hz sim tick)
  /sim       rng.ts, types.ts, physiology.ts, engine.ts, scenario.ts (Oct 28)
  /patient   regions.ts, body.ts, highlight.ts
  /ui        hud.ts, debug.ts (live), medicalMenu.ts (Examine + Circulation)
  main.ts, style.css
/server
  /lib       config.ts, meta.ts, prompts.ts
  /routes    chat.ts, test.ts (transcribe/tts/generate-call/debrief land later)
  /prompts   patient.txt + TODO placeholders
/schemas     one JSON Schema per data file (draft 2020-12)
/data
  /medical     drugs.json (provided, 104, untouched) + DRAFT drops + Oct 28 files
  /calls       components/*, fixed/bike_down.json, cache/
  /difficulty  level1-5.json
/scripts     validate-data.ts, server-test.ts, sim-test.ts (Oct 28)
```

## API notes (verify on first run, brief section 2)

- Base URL `https://api.meta.ai/v1`, model `muse-spark-1.3` (Standard, never the
  contributor model). Override with `MODEL_ID` in `server/.env` if docs say otherwise.
- Patient calls send Reasoning Low (`reasoning_effort: "low"`), Temperature 0.7,
  Max tokens 2000. If the Meta API names the reasoning param differently, change
  it once in `server/lib/meta.ts`.

## TODO_CLINICAL for Carlos, in blocker order

`drugs.json` was present (104 drugs) and is used as-is. Nothing invented.
Oct 28 values below are textbook anchors (ATLS / TCCC / NREMT / PHTLS) from
`OCT28_MEDICAL_ANSWERS` and need sign-off from a certified medic before Nov 4.

1. `physiology.json` shock curve: confirm the interpolation anchors (HR/SBP/DBP/
   RR/GCS/cap-refill at 0/15/30/40/50/55+ percent), the 60 percent beta-blocker
   HR suppression (TUNE), and the arrest window (15 percent per-second-tick
   above 50 percent, forced at 58 percent, TUNE). Blocks nothing today (engine
   runs on the anchors) but blocks Nov 4 medical truth.
2. `physiology.json` bleed rates: confirm femoral 700 mL/min at MAP 93 with
   `rate = base x (currentMAP / 93)`, junctional 500, and the other class
   anchors. Untreated sim runs Class II 69s / III 139s / IV 193s / window 270s.
3. `interventions.json` Oct 28 set: confirm TQ half-turns to occlude (3, TUNE),
   single-CAT large-thigh failure 25 percent with 10-20 percent residual
   (TUNE), packing early-release rebleed 60 percent (TUNE), junctional packing
   success 80 percent (TUNE), pressure fatigue -5 percent/min after 3 min
   (TUNE).
4. `oct28_conditions.json`: confirm hypothermia slide -0.5 C per 10 min exposed
   and wet (TUNE) and the road_rash W-step include.
5. `bike_down.json`: scene-start fix is in (1,100 mL at contact, bystander
   shirt 50 percent, belt trap x1.3). Weight stays 80 kg, never shown in UI.
6. Oct 29 kit depth (READY in `OCT28_MEDICAL_ANSWERS` section 7, parked today):
   airway size sets (OPA/NPA/i-gel/King/ETT/BVM) with wrong-size effects,
   IV/IO + fluids, O2 delivery + tank math, manual-vitals procedures.
7. Oct 31 sampler data: complaints, conditions_map, patients, comorbidities,
   environments, bystanders, complications (WEIGHT_EST weights + triggers).

## Parked for Oct 29 (ready in the answers file, not built today)

- Talking patient voice (Oct 29 flagship). Weight line ("about 175 pounds")
  and TQ pain line sit in `bike_down.json` patientPrompt as data only.
- Airway tab, lines/fluids, manual vitals (answers section 7). Data is ready.
- Drug prep loop, monitor, breathing tab, Dispatch Engine, FTO debrief,
  infection/sepsis. All stay parked.

## Known Oct 28 limits

- Blanket wrap uses a standard blanket not yet in `equipment.json`; Oct 29 kit
  depth adds it as a tracked item.
- Loosened TQ slips to 35 percent flow until reassessed (engine rule); the
  answers file only says interventions "can loosen or fail" after movement.
- Decompensation segment (50-55 percent: HR 150 to 45, RR 40 to 6, GCS 8 to 3)
  is linear between the anchor rows; confirm shape with Carlos.
- Pre-existing DRAFT data files (`conditions.json`, `trauma_library.json`) and
  the brief still contain em-dashes; every file created or edited for Oct 28
  uses single hyphens only.
