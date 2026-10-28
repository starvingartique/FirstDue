# First Due - Oct 27 Skeleton

First-person paramedic sim. Meta Global AI Developer Hackathon 2026, Indie track.
Source of truth: `MUSE_BRIEF_1.md` (Project Brief v2). When in doubt, the brief wins.

This milestone: Vite + Three.js scene, fixed kneel camera, raycast body regions,
data loaders + schemas, Hono server proxy, F1 debug vitals. No walking, no Rapier,
no medical menu yet (Oct 28).

## Prereqs

- Node.js 20 or newer (`node --version` to check)
- A Meta API key (server side only, never in client code)

## Run it

The commands below work the same on Windows (PowerShell) and Mac (Terminal).
Run them from the repo root.

```sh
# 1. Install
npm install

# 2. Validate every data file through the shared loaders
npm run validate-data

# 3. Put the Meta key in the server env (gitignored, never committed)
cp server/.env.example server/.env
# then paste the real key as MODEL_API_KEY in server/.env

# 4. Start the server (terminal 1)
npm run dev:server
# expect: First Due server on http://localhost:8787

# 5. Start the client (terminal 2)
npm run dev
# expect: Local: http://localhost:5173/
```

Open http://localhost:5173/ in a browser.

Production build check: `npm run build`, then `npm run preview`.

## Acceptance probes

```sh
# One live Muse Spark call through the server (needs the key + running server)
npm run server:test
# expect: model: muse-spark-1.3 / text: First Due server link OK.

# Server health without a key
curl http://localhost:8787/api/health
```

In the browser: drag to look, click a body region to highlight it, press 1/2/3
for camera spots (patient, kit bags, bystander), press F1 for debug vitals.

## Layout

```text
/src
  /data      types.ts, validate.ts, loaders.ts (JSON Schema mirrors + checks)
  /engine    scene.ts, camera.ts, input.ts, raycast.ts, loop.ts
  /patient   regions.ts, body.ts, highlight.ts
  /ui        hud.ts, debug.ts
  main.ts, style.css
/server
  /lib       config.ts, meta.ts, prompts.ts
  /routes    chat.ts, test.ts (transcribe/tts/generate-call/debrief land later)
  /prompts   patient.txt + TODO placeholders
/schemas     one JSON Schema per data file (draft 2020-12)
/data
  /medical     drugs.json (provided, 104, untouched) + DRAFT drops + skeleton files
  /calls       components/*, fixed/bike_down.json, cache/
  /difficulty  level1-5.json
/scripts     validate-data.ts, server-test.ts
```

## API notes (verify on first run, brief section 2)

- Base URL `https://api.meta.ai/v1`, model `muse-spark-1.3` (Standard, never the
  contributor model). Override with `MODEL_ID` in `server/.env` if docs say otherwise.
- Patient calls send Reasoning Low (`reasoning_effort: "low"`), Temperature 0.7,
  Max tokens 2000. If the Meta API names the reasoning param differently, change
  it once in `server/lib/meta.ts`.

## TODO_CLINICAL for Carlos, in blocker order

drugs.json was present (104 drugs) and is used as-is. Nothing invented.

1. `physiology.json` baselines: HR, RR, SBP/DBP, SpO2, EtCO2, GCS, glucose,
   temp, cap refill, blood volume mL/kg, tidal volume. Blocks the Oct 28 tick.
2. `physiology.json` shockClasses: ATLS I-IV signs, compensation order, shock
   index flag. Blocks the Oct 28 compensation curve.
3. `bike_down.json` weight_kg (currently a scenario estimate, 80). Drives blood
   volume and weight-based dosing.
4. `interventions.json` Oct 28 set: high-and-tight tourniquet, second
   tourniquet, hemostatic packing + 3 min pressure, direct pressure, pressure
   dressing. Need time costs, what each fixes, and failure modes (venous TQ,
   TQ over the knee, dressing-only on arterial).
5. `equipment.json` hemorrhage kit: CAT x2, SOF-T, junctional TQ, hemostatic
   gauze, plain gauze, pressure bandage, elastic wrap. Need quantities and bag
   locations.
6. TUNE confirmations: bleed-rate anchors (trauma_library suggests arterial
   major 400 mL/min) and the drug effect-token map (+/++/+++ to numbers).
7. Oct 29 kit depth: airway size sets (OPA/NPA/i-gel/ETT) with wrong-size
   effects, line/fluid equipment, manual-vitals procedures.
8. Oct 28 core conditions: per the addendum, build these separately from the
   brief + trauma_library (femoral bleed behavior, hemorrhagic shock derived).
   The DRAFT `conditions.json` stays unused for Bike down.
9. Oct 31 sampler data: complaints, conditions_map, patients, comorbidities,
   environments, bystanders, complications (WEIGHT_EST weights + triggers).

## Known skeleton limits

- Debug vitals are fake placeholders with a label. Live engine feed lands Oct 28.
- The back region is selectable from the chips but not raycast-visible while the
  patient is supine. Log roll lands after Oct 27.
- Blood pool size is fixed. Engine-driven size from real mL lost lands Oct 28.
- No medical menu yet. Region clicks show a placeholder panel.
