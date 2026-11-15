# GEMA: Final Build Handover (v2)

**STC Mini Hackathon 2026 · Theme: Disaster Recovery · Team of 3, each using Claude Code**
**Submit by 2.45pm · last push 2.55pm · code freeze 3.00pm (any change after that disqualifies us)**

This is the single source of truth for every person and agent. Read sections 1–6 before writing code, then do **only your own module** (section 9). If you need something from another module, use the interfaces in section 8.

---

## 1. Decision record: what we build and why

We assessed three versions against our framework (full scoring in section 4):

| Version | Score | Verdict |
|---|---|---|
| FirstLook (vision only: YOLO and image slicing on drone imagery) | ≈ 62 | Drop. Detection like this is a common hackathon topic, the Python backend is heavy, and it can't run live on the organisers' laptop |
| Eyes and ears combined (vision plus audio feeding one trust map) | ≈ 74 | Too much for 3 people in about 3.5 hours. Build quality would suffer, and that's 30% of the score |
| **GEMA (ears, plus FirstLook's trust map and measured calibration)** | **≈ 79–82** | **Build this** |

**What we take from FirstLook:**
- the trust map (how sure we are about each area)
- POD (probability of detection) and the Bayesian "look here next" update
- a **measured calibration step**, so the trust map is based on real tests rather than assumed
- a real satellite basemap for context
- honest metrics, and labelling what is simulated

**What we leave out:** the Python YOLO and slicing backend, the flight-height planner and datasets. Vision returns only as stretch goal S1.

---

## 2. The product in one paragraph

GEMA is a search map for disaster drones that **listens for survivors and admits what it might have missed.**

A virtual drone flies over a real satellite map of Taman Sri Muda, Shah Alam. Three phones under the screen act as the drone's ears. When someone screams, the phones work out roughly which direction it came from, and the drone turns and flies toward it.

Every grid cell holds a **probability that a survivor is there**. When the drone passes over a cell and hears nothing, that probability drops, but only as much as the **measured** probability of detection allows. That probability depends on distance and on the real noise level the phones hear. In noise, silence clears almost nothing, and the cell stays amber with "NOT CLEARED."

The drone always flies to the most likely spot it hasn't checked properly yet.

**Pitch line:** *"Other systems tell you where people are. GEMA also tells you where silence doesn't mean safe."*

---

## 3. Problem statement

> **Drone search teams** in the first hours after a flood or collapse have to decide where to search next across a large area with limited battery,
> because **drones search blind**: thermal cameras show heat, not who is calling for help, and an area flown over with no detection gets treated as "clear,"
> which leads to **survivors in noisy, cluttered or poorly scanned areas being missed or reached too late.**
> Today teams **follow a fixed grid pattern and their own judgement**, which fails because nothing records *how well* each area was actually checked.
> **How might we direct a drone toward survivors, and show coordinators where "no detection" still means "not cleared"?**

**Evidence:**
- **Taman Sri Muda, 2021:** families posted search pleas online because relatives' phones had died ([Malay Mail](https://www.malaymail.com/news/malaysia/2021/12/19/as-night-falls-families-and-friends-desperately-search-for-loved-ones-stran/2029698)). Volunteers launched 50+ boats before official help arrived ([The Malaysian Insight](https://www.themalaysianinsight.com/s/357610)).
- **Bomba already flies thermal drones** for search and rescue ([The Star, 2023](https://thestar.com.my/news/nation/2023/07/05/water-surge-tragedy-bomba-using-high-capacity-drone-to-help-sar-ops)).
- **POD and probability-based search planning** are established concepts in search theory, which is why we measure POD rather than invent it.

---

## 4. Assessment (strict, using our 13-criterion framework)

### Gates

| Gate | Result |
|---|---|
| G1 Theme fit | ✅ Response · natural disaster · rapid response (and community support through family reports) |
| G2 Real pain | ✅ The Malaysian flood evidence above |
| G3 One feature | ✅ One engine: a map that listens and updates its trust in each area |
| G4 30-second demo | ✅ A judge screams and the drone turns; noise turns cells amber |
| G5 Buildable | ✅ Runs entirely in the browser with no backend. Main risk: the phone-to-screen connection |
| G6 Wow statement | ✅ *"Silence isn't safety, and GEMA shows you where."* |

### Score

| Pillar | Sub-criterion | 1–5 | Points | Reason |
|---|---|---|---|---|
| **Originality 29.4/35** | Unclaimed | 4 | 9.6 | Drones are popular, but the audio-plus-trust angle is not |
| | Gap | 3 | 4.8 | LUCY, SARUAV and Police Scotland's drones each do part of it. The combination wasn't found |
| | ⭐ Insight | 5 | 15 | "No detection does not mean clear" is true and surprising |
| **Build 20.4/30** | Depth | 4 | 9.6 | One engine with clear modules |
| | Risk | 3 | 6 | Phone-to-screen connection and mic permissions; fallbacks planned |
| | Polish | 3 | 4.8 | Tight for 3 people |
| **Impact 16/20** | Severity | 5 | 7 | Lives |
| | Reach | 3 | 4.2 | Major disasters only |
| | Local | 4 | 4.8 | Taman Sri Muda, Bomba, NADMA |
| **Pitch 12.8/15** | Relatability | 3 | 2.4 | Judges haven't searched for anyone, but the flood stories land |
| | Hook | 5 | 3 | |
| | ⭐ Demo | 5 | 5 | The live scream turn |
| | Tone | 4 | 2.4 | Screaming on stage is fun |
| | **Total** | | **≈ 79** | **Can reach about 82** if the measured calibration and simulation chart are done (Depth and Polish go up) |

### Wow tests

| Test | Result |
|---|---|
| Gasp | "The drone flew right over them and called it clear" |
| Screenshot | The amber "NOT CLEARED" map |
| Retell | "A drone that hears screams and knows when it can't be sure" |
| Own-input | A judge screams, or scans the QR code and becomes an ear |

### Comparison scores (summary)

- **FirstLook (vision only): about 62.** Originality 24 · Build 14.4 · Impact 14.8 (US hurricane imagery, low local relevance) · Pitch 9.
- **Eyes and ears combined: about 74.** Originality 31 · Build 14.4 · Impact 16 · Pitch 12.8.

---

## 5. Scope

### In scope (must work by 1.15pm)

1. **Map:** a real satellite basemap (Esri World Imagery, credited) over Taman Sri Muda, with a 12 × 8 search grid on top. Cells are coloured by trust: grey = unsearched, amber = uncertain, green = cleared. A toggle shows the probability heatmap.
2. **Virtual drone:** follows the engine's next waypoint, turns at a limited rate, and shows a trail and its hearing radius.
3. **Phone ears:** 3 phones join by QR code (L, C, R). Each phone measures loudness, background noise and pitch, and detects screams, sending results to the screen in real time.
4. **Direction finding:** the screen compares how loudly each phone heard the scream, works out a bearing, and the drone turns toward it and drops a pin with a confidence score.
5. **Bayesian trust engine:**
   - a "nothing heard" pass lowers a cell's probability by its POD
   - a detection raises the cells along the bearing
   - a family report ("last seen here") raises the prior for that cell
   - the drone always picks the next waypoint from the result
6. **Real noise:** a "Rotor noise" toggle **plays synthetic rotor noise through the laptop speakers.** The phones genuinely hear it, their noise floor rises, POD falls, and cells stay amber. This is real cause and effect, not a fake slider.
7. **Measured calibration:** we stage screams at set room distances, with and without noise, and record the detection rate. Those results set the POD curve in `config.js` and appear on slide 6.
8. **Fallbacks:**
   - "Simulate scream L/C/R" buttons
   - a single-device mode using the laptop's own mic
   - the connection falls back to talking between browser tabs on one machine
9. **Simulation chart:** 500 simulated runs comparing GEMA's guided search with a standard grid pattern (median time to find), with numbers reported honestly.
10. **People on the map (the visual layer):** 5–8 simulated survivors placed on real rooftops and streets in Taman Sri Muda. Each is labelled "simulated." **They are hidden from the drone and the engine.**
    - In the live demo, each survivor occasionally "calls out." Its position feeds `applyDetection` as if a phone heard it.
    - A person icon appears **only when found**, either by a detection pin within 50 m or by the drone flying within 30 m in quiet conditions.
    - At the end, a **"Reveal ground truth"** toggle shows everyone: found = green, missed = red. Missed survivors should sit in amber "NOT CLEARED" cells, which visually proves the core point.
    - The drone is a top-down sprite with a spinning-rotor animation, a drop shadow, a trail and a hearing-radius circle. **No 3D.**

### Stretch (only after the 1.15 checkpoint passes; in order)

- **S1. Eyes:** the FirstLook idea at small scale, entirely in the browser.
  - Load one real drone-resolution aerial image (OpenAerialMap; check its licence) with teammates photographed top-down (with consent) plus decoys.
  - Run TF.js COCO-SSD person detection on 3 × 3 tiles.
  - Candidate cards with Confirm / Reject. A confirmed card counts as a high-confidence detection.
- **S2.** The YAMNet sound model on the phones as a second opinion on screams.
- **S3.** A recorded-mission replay mode for preliminary judging.

### Out of scope (say so in the pitch)

| Out of scope | Why |
|---|---|
| Real drone flight and live video | No hardware, no CAAM permit |
| Rotor-noise filtering and a real mic array | Hardware and signal-processing problem; Fraunhofer's LUCY shows it's solvable |
| Python YOLO and image-slicing backend | Can't run on the organisers' laptop; too heavy for 3.5 hours |
| Face recognition | Privacy (PDPA biometrics) and accuracy from overhead angles |
| Thermal fusion, autonomous flight control | Next steps |
| Storing any audio or personal data | Phones send numbers only (dB, scores). No recordings |

### Assumptions

- The phones and the presenting laptop both have internet. If not, use single-device mode plus the simulate buttons.
- **Distance scaling:** 1 m in the room stands for 25 m on the map. State this openly on the calibration slide.
- Taman Sri Muda's coordinates in the config are approximate. Verify them on the map at setup.

### Success criteria (acceptance tests before recording at 2.00pm)

1. A sustained scream near phone L makes the drone turn left (bearing below −20°) within 2 seconds. A clap does nothing.
2. Rotor noise ON measurably raises the noise floor on all phones, and cells passed during it stay amber.
3. A family-report click visibly reprioritises the next waypoint.
4. Probabilities always add up to 1. The cleared % increases while flying in quiet conditions.
5. The calibration table holds at least 5 trials × 3 distances × 2 noise conditions.
6. The simulation chart renders in under 5 seconds.
7. The link opens with no login on a fresh browser, and the fallback buttons work with no phones connected.

---

## 6. Stakeholders

| Group | Stakeholder | What they need | How GEMA serves them | Influence / Interest |
|---|---|---|---|---|
| **Primary users** | Drone operators: Bomba (JBPM drone unit / PTK2Dron), civil defence (APM), the MOSTI drone squad | Where to fly next before the battery runs out | Guided waypoints and direction from screams | High / High: **manage closely** |
| | Search coordinator or incident commander | Which areas are truly cleared, and where to send ground teams | The trust map, the cleared %, pins with confidence | High / High: **manage closely** |
| | Volunteer and NGO drone pilots | The same, with less training | A simple map with colour meanings | Low / High: keep informed |
| **Beneficiaries** | Trapped survivors, especially those with dead phones, the elderly, or children who can only shout | To be heard and reached | Direction from screams; noisy areas are never written off | Low / High: keep informed (the emotional core) |
| | Families of the missing | A way to feed in what they know, and updates | "Last seen here" reports raise priority | Low / High: keep informed |
| **Decision-makers / buyers** | NADMA, JBPM, APM, state disaster committees, MOSTI | Faster, accountable searches | An audit trail of what was checked and how well | High / Medium: keep satisfied |
| **Regulators** | CAAM (drone flight permits, including flying beyond line of sight) | Safe, legal flights | A human approves routes; it's a decision aid, not autonomous flight | High / Low: keep satisfied |
| | Personal Data Protection Commissioner | No unlawful personal data | No face recognition, no audio stored, only numbers sent | Medium / Low: monitor |
| **Enablers** | Drone makers and operators (Aerodyne, DJI) and microphone-array researchers (Fraunhofer FKIE) | Software that adds value to their hardware | GEMA is the decision layer on top of their sensors | Medium / Medium: partner later |
| **Affected / concerned** | Public, bystanders, privacy groups | No surveillance creep | Audio-only, numbers-only, nothing stored | Low / Low: monitor |
| **On the day** | Judges | Originality, a working build, honesty | A live demo, measured calibration, an honesty slide | High / High |

**Pitch personas:**
- **Hafiz, a Bomba drone pilot**, at night in a flood, with one battery to cover the area.
- **Aina, a student**, whose grandmother in Taman Sri Muda isn't answering her phone.

---

## 7. Architecture

```
 PHONES  ear.html?room=ABCD&ear=L|C|R          LAPTOP / PROJECTOR  index.html?room=ABCD
 ┌────────────────────────────┐                ┌──────────────────────────────────────────┐
 │ mic → frame → dB, floor,   │  realtime msgs │ fusion.js  ear msgs → detection (bearing)│
 │ bandRatio → scream detector│ ─────────────► │ search.js  Bayesian grid, POD, next cell │
 │ calibration gain           │  Supabase      │ drone.js   heading, motion               │
 └────────────────────────────┘  Broadcast, or │ map.js     Esri basemap, grid, pins      │
                                 BroadcastChan │ noise.js   synthetic rotor noise (audio) │
                                 for 1-machine │ sim.js     500-run comparison            │
                                 testing       │ ui.js      log, QR, buttons, metrics     │
                                               └──────────────────────────────────────────┘
```

**Stack:**
- Vite with plain JavaScript (ES modules)
- Leaflet, with the Esri World Imagery basemap (credit: "Tiles © Esri") and OpenStreetMap as a fallback layer
- `@supabase/supabase-js` Realtime Broadcast: no tables, nothing stored
- `qrcode` for the join codes
- Web Audio API for the microphones and the noise
- Vercel static hosting (HTTPS, needed for the microphones)

**Why no backend:** finalists present from the organisers' laptop, so everything must run from one hosted URL in their browser.

### File ownership

```
/index.html, /ear.html               (P2 / P1)
/src/shared/config.js                (P3 owns numbers; others propose changes)
/src/shared/protocol.js              (P1)
/src/realtime/channel.js             (P1)
/src/ear/audio.js, detector.js, calibrate.js, main.js   (P1)
/src/control/fusion.js               (P1)
/src/control/map.js, drone.js, noise.js, ui.js, main.js (P2)
/src/control/search.js, sim.js       (P3)
/calibration/results.csv             (P3, with P1 helping to stage it)
/README.md                           (P3)
```

---

## 8. Interfaces (the contract)

### 8.1 `config.js`

```js
export const CONFIG = {
  map: { center: [3.0190, 101.5370], zoom: 17 },       // Taman Sri Muda (approximate, verify)
  grid: { cols: 12, rows: 8, cellMeters: 50 },
  roomToMapScale: 25,                                  // 1 m in the room = 25 m on the map
  ears: { L: -45, C: 0, R: 45 },                       // degrees, relative to drone heading
  audio: { frameSize: 2048, bandLowHz: 1000, bandHighHz: 4000 },
  scream: { minAboveFloorDb: 15, minBandRatio: 0.45, minDurationMs: 300, cooldownMs: 1500 },
  fusion: { windowMs: 600 },
  pod: { max: 0.9, hearingRadiusM: 150, falloffM: 60, noiseRefDb: -50, noisePenaltyPerDb: 0.03 }, // REPLACE with the measured fit
  search: { detectionBoost: 6, bearingSpreadDeg: 25, familyReportBoost: 4 },
  drone: { speedMps: 15, turnRateDegPerS: 90, tickMs: 100 },
  trust: { clearedAt: 0.8, uncertainAt: 0.3 }
};
```

### 8.2 Messages (channel `gema-room-${ROOM}`)

| type | direction | payload |
|---|---|---|
| `hello` | ear → control | `{ ear, label }` |
| `level` | ear → control, 10 Hz | `{ ear, t, db, floorDb, bandRatio, screamScore }` |
| `scream` | ear → control, on detection | `{ ear, t, peakDb, durationMs, confidence }` |
| `calibrate` | control → ears | `{ phase: 'start'\|'clap'\|'done', gains? }` |

| `calibration` | ear → control, after the clap phase | `{ ear, floorDb, clapPeakDb }` |

`protocol.js` exports `validate(msg)`, `EARS`, `MSG`, `channelName(room)` and `makeRoomCode()`. Every receiver drops invalid messages.

> **✅ P1 is built** (in the repo). The notes P2 needs:
> - `joinRoom(room, { onMessage, onStatus })` from `src/realtime/channel.js`. The status can also be `'error'`.
> - `createFusion(CONFIG, { onDetection })` from `src/control/fusion.js`. Call `fusion.ingest(msg)` for **every** realtime message.
> - It also offers `fusion.connectedEars()` (for ear status), `fusion.setGains(computeGains(clapPeaks))` (for calibration), and `computeGains`, exported from the same file.
> - Each `calibration` reply carries one ear's `clapPeakDb`. Collect them, compute the gains, call `setGains`, then send `{ type: 'calibrate', phase: 'done', gains }`.
> - `/debug.html` is a working reference for QR codes, calibration and simulate buttons, so copy patterns from `src/debug/main.js`.
> - Direction uses a `sharpness` exponent (`CONFIG.fusion.sharpness = 3`), so the loudest ear dominates.

### 8.3 Functions

- `channel.js`
  ```js
  joinRoom(room, { onMessage }) → { send, close, status }
  ```
  Uses Supabase when its env vars are set, otherwise BroadcastChannel.
- `fusion.js`
  ```js
  createFusion(config, { onDetection }) → { ingest }
  // emits { type: 'detection', t, relBearingDeg, confidence, ears }
  ```
  - bearing = the angles of the phones that heard the scream, weighted by each phone's linear amplitude
  - confidence = max ear confidence × clamp(gap in dB between the loudest and second-loudest phone ÷ 10, 0.3, 1)
  - with only one ear connected: bearing 0, confidence halved
- `search.js` (pure functions, unit-tested):
  ```js
  createGrid(config)
  cellCenter(grid, i)
  podFor(distanceM, noiseDb, config)
  applyNegativeScan(grid, droneXY, noiseDb, config)          // p *= (1 - pod); cumPod accumulates; renormalise
  applyDetection(grid, droneXY, absBearingDeg, confidence, config)
  applyFamilyReport(grid, i, config)
  nextWaypoint(grid, droneXY)                                // argmax p / (1 + distance/300)
  trustClass(grid, i, config)                                // 'cleared' | 'uncertain' | 'unsearched'
  ```
- `drone.js`
  ```js
  createDrone(config) → { state: { x, y, headingDeg, mode }, setTarget(xy, mode), tick(dtMs) }
  ```
  Absolute bearing = headingDeg + relBearingDeg.
- `noise.js`
  ```js
  startRotorNoise() / stopRotorNoise()
  ```
  Web Audio: two detuned sawtooth tones around 110–180 Hz plus filtered noise, at a volume set by a slider.

---

## 9. Team split (3 people; each runs Claude Code on their own module only)

### P1: Ears (phone page, realtime, fusion)

- [ ] `ear.html`:
  - a "Tap to start listening" button
  - Wake Lock to keep the screen on
  - per-frame dB, noise floor (rolling 20th percentile) and bandRatio
  - a scream detector that ignores claps and talking
  - big L/C/R label, level bar, red flash on a scream, connection dot
- [ ] `channel.js` with the BroadcastChannel fallback, `protocol.js`, and `fusion.js` with unit tests (louder on L gives a negative bearing; equal gives about 0; one ear gives 0 at half confidence).
- [ ] Calibration, step by step:
  1. 3 seconds measuring the noise floor
  2. a clap at the centre
  3. compute gains so all phones read the clap equally
- **Done when:** 3 phones on the Vercel URL stream live levels, and a scream near L gives a bearing below −20°.

### P2: Control screen (map, drone, noise, UI)

- [ ] Esri basemap and grid overlay coloured by `trustClass`, with a heatmap toggle.
- [ ] The drone icon, its rotation and trail, and a hearing-radius circle. Pins for detections.
- [ ] Panels:
  - event log
  - QR code per ear
  - ear status
  - Calibrate button
  - legend
  - metrics (cleared %, time to first detection)
  - "Family report" click mode
- [ ] Buttons: "Simulate scream L/C/R" and "Rotor noise ON/OFF" (via `noise.js`).
- [ ] **The people layer (scope item 10):**
  - Survivors come from `src/shared/scenario.js` (`[{ id, lat, lng, label }]`).
  - Hidden until found.
  - A "Reveal ground truth" toggle shows everyone.
  - The drone sprite has a rotor animation and a shadow.
  - Build this **after** the core loop works, not before.
- [ ] Main loop, every `tickMs`:
  1. `drone.tick`
  2. `applyNegativeScan` (noise = the average of the phones' `floorDb`)
  3. on arrival at the target, call `nextWaypoint`
  4. redraw
- **Done when:** with no phones connected, the simulate buttons make the drone turn, fly and pin, and cells change colour as it flies.

### P3: Engine, evidence, delivery

- [ ] `search.js` with unit tests:
  - probabilities stay normalised
  - "nothing heard" in noise lowers p less than in quiet
  - a detection raises the cells along the bearing
  - `nextWaypoint` picks the best cell
- [ ] `sim.js`: 500 simulated runs with one hidden survivor who makes a sound 30% of the time, each second. Compare GEMA's guided search with a standard grid pattern by median time to find, and the share found within 10 minutes.
- [ ] **Calibration session** (12.45–1.10, with P1):
  - screams at 1, 3 and 6 m (which stand for 25, 75 and 150 m on the map)
  - with rotor noise off and on, 5 trials each
  - record in `calibration/results.csv`
  - fit `pod.max`, `pod.falloffM` and `noisePenaltyPerDb`, and update `config.js`
- [ ] README (run steps, live URL, credits: Leaflet, Esri, OpenStreetMap, Supabase, qrcode; honesty notes), the 8-slide deck, and video editing.
- **Done when:** the tests pass, the simulation chart renders, the calibration table and fitted curve are in the deck, and the README is complete.

### Human-only setup (whoever is free first; agents must not create accounts)

1. GitHub repo created **today**.
2. Supabase project created, with its URL and anon key set as Vercel env vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
3. Deployed to Vercel. **Turn off auto-deploy, or stop pushing, by 2.55pm.**

---

## 10. Timeline

| Time | Milestone |
|---|---|
| **Now to +20 min** | Repo, Vite with 2 pages, `config.js` and `protocol.js` committed, stubs for every module; Supabase and Vercel set up |
| **12.30** | Core loop working on **one machine**: tabs talking to each other, simulate buttons, drone, grid, engine |
| **12.45–1.10** | Calibration session; fit the POD curve |
| **1.15** | **Checkpoint:** 3 phones on the Vercel URL, a scream makes the drone turn. **If it fails:** demo with single-device mode plus the simulate buttons, and drop all stretch goals |
| **1.15–1.45** | Polish, the simulation chart, stretch S1 only if everything is green |
| **1.45** | Feature freeze |
| **2.00** | Record the video (stage setup with 3 phones) |
| **2.15** | Deck PDF final |
| **2.30** | Submit a rough version on the form; test the link in incognito |
| **2.45** | Final submission |
| **2.55** | Last push |

---

## 11. Demo script (5-minute final pitch)

| Time | Beat |
|---|---|
| 0:00–0:40 | **Hook:** Taman Sri Muda, 2021. Families searching online for relatives whose phones had died. "The drones flew over. Did they check, or just pass?" |
| 0:40–1:10 | **Problem and insight:** "No detection is not the same as clear." |
| 1:10–3:10 | **Live demo:** (1) the drone searches and cells turn green; (2) **a judge screams on the left, the drone turns left and pins it**; (3) rotor noise ON, cells stay amber, "NOT CLEARED"; (4) a family-report click and the drone reprioritises; (5) **"Reveal ground truth"**: found people in green, the missed one in red, sitting in an amber cell. "That's who a normal drone would have written off." |
| 3:10–3:50 | **How it works:** phones as ears, direction finding, the Bayesian grid, **the measured calibration table**, the honesty box |
| 3:50–4:30 | **Evidence and impact:** the simulation chart; stakeholders Bomba, APM, NADMA, families |
| 4:30–5:00 | **Next steps and close:** "We built the brain. Fraunhofer built the ears. Bomba has the drones." |

## 12. Deck (8 slides, PDF)

1. Hook (Taman Sri Muda)
2. Problem
3. **Insight: silence isn't safety.** Include the "which sensor works where" table from section 14
4. GEMA in one picture: **ears (mic) and eyes (camera) feeding one trust map**
5. Demo screenshots
6. How it works, plus the calibration table and honesty box
7. Simulation evidence and stakeholders
8. Next steps: real mic array (like LUCY), **thermal as a third evidence layer**, CAAM approval. Team

---

## 14. Why microphones? (slide 3 and Q&A prep)

Judges and mentors **will** ask: *"Why not thermal or lidar? Won't noise ruin a mic?"*

### The 15-second answer (practise it)

> *"We don't replace thermal; we cover where it's blind. Thermal and lidar need line of sight. A survivor under a roof, under rubble or in floodwater is hidden, but can still be heard. That's why rescue teams already carry listening devices like the Delsar Life Detector. And yes, noise is hard. That's exactly why GEMA never calls a noisy area 'clear.' Our engine works with any sensor: today it's ears and eyes, tomorrow thermal."*

### Which sensor works where (slide 3)

| Situation | Thermal camera | Lidar | Normal camera | **Microphone** |
|---|---|---|---|---|
| Open ground, daytime | ✅ | ❌ (it maps shapes, not who is alive) | ✅ | ✅ |
| Under a roof or rubble | ❌ no line of sight | ❌ | ❌ | ✅ **sound travels through gaps** |
| In or near floodwater | ❌ (water hides body heat) | ❌ | ⚠️ | ✅ |
| Hot Malaysian afternoon | ⚠️ (warm surfaces wash people out) | ❌ | ✅ | ✅ |
| Night, smoke, haze | ✅ | ⚠️ | ❌ | ✅ |
| Rain | ⚠️ | ⚠️ | ⚠️ | ⚠️ noise rises, and **GEMA flags it as NOT CLEARED** |
| Tells you someone is **alive and calling** | ❌ | ❌ | ❌ | ✅ |

### Why microphones win as the first sensor

- **Weatherproof and rugged:** MEMS microphones (the tiny ones in every phone) already ship in IP67/IP68 water-resistant phones. A drone mic array can be sealed behind waterproof acoustic membranes. Rain adds noise, but it doesn't kill the sensor.
- **Cheap and light:** a MEMS mic costs a few ringgit, while a drone thermal camera costs thousands. Lighter payload means **more flight time**, which experts name as a top limit of rescue drones ([MarketScale](https://www.marketscale.com/industries/sciences/solving-thermal-limitations-for-emergency-and-first-response-uavs)).
- **Works without line of sight:** around corners, through debris gaps, under roofs.
- **Hears life, not just heat:** a voice or knock means *alive and responsive*.
- **Already trusted on the ground:** rescue teams use seismic/acoustic listening devices to find live victims in collapsed structures ([Firehouse: Delsar Life Detector](https://www.firehouse.com/rescue/technical-rescue/structural-collapse/product/10181928/con-space-communications-delsar-life-detector), [Safeware: Delsar USAR kit](https://www.safewareinc.com/product/delsar-usar-kit-con-6020-01-016)). **GEMA puts that in the air.**
- **Noise is handled honestly:** rotor-noise filtering exists ([Fraunhofer LUCY](https://www.fraunhofer.de/content/dam/zv/en/press-media/2023/december/fkie-a-drone-with-ears.pdf)). Whatever noise is left lowers POD, and the cell stays amber.

### Thermal limits (for Q&A)

- UK fire-service guidance lists thermal's limits: people in water, people with hypothermia, and people hidden under dense cover ([NFCC](https://nfcc.org.uk/?p=13226)).
- Hot surfaces can wash a person out of the thermal image ([Commercial UAV News](https://commercialuavnews.com/public-safety/clearer-radiometric-thermal-imagery-can-make-a-major-difference-in-drone-public-safety-missions-and-industrial-inspections)).
- **Be honest:** thermal is excellent in the open and at night. We **combine** sensors; we don't dismiss them.

### Eyes as well as ears (now built)

- The phone page has an optional **📷 camera "eyes"** mode. It runs in-browser person detection (COCO-SSD), and a person in view sends a `sighting` that the trust engine treats as strong evidence.
- **Demo line:** *"Ears find people you can't see. Eyes confirm the people you can. One trust map for both."*

## 13. Honesty rules

- **Say clearly:** the drone is simulated; the phones stand in for a microphone array; 1 m in the room = 25 m on the map; the POD curve is fitted from our room tests, not from real rotor conditions.
- **Prior art to acknowledge:**
  - Fraunhofer LUCY (an acoustic drone prototype)
  - SARUAV (person detection in drone photos, offline, about 4 hours to a result)
  - Police Scotland's recognition drones
  - Bomba's thermal drones
- **Our claim:** *"We found no system that combines real-time listening, family reports and a trust map that refuses to call silence 'clear'."* Never say "none exists."
- No recordings stored, no faces, no real victim imagery. Teammates appear only with their consent.
- Report the simulation and calibration numbers as they come out, even if they're modest.

---

## 15. Hearing in a flood, and the drop-ear (built and design)

### What the ear now does (built, tested with synthetic signals)

| Sound | How GEMA tells | Result |
|---|---|---|
| **Rushing water, rain, wind, rotor wash** | Broadband, so **spectral flatness is high** and there's no repeating pitch | Rejected. It only raises the noise floor, so POD drops and cells stay amber |
| **Clear scream** | Loud (15 dB or more above the floor), bright (1–4 kHz), not flat | `kind: 'scream'`, high confidence |
| **Muffled voice behind rubble or walls** | High frequencies are lost, but the voice is still **periodic** (autocorrelation pitch 120–1000 Hz), 8 dB or more above the floor, not flat | `kind: 'muffled'`, **lower confidence** (weaker evidence) |
| **Voice over moderate water noise** | Pitch still detectable through the noise | Detected as a muffled voice |

- The phone shows live what it's hearing: *quiet / noise (water, rain, wind, rotor) / voice-like with its pitch*. Use this to tune on the day.
- **Muffled-voice mode is OFF by default.** Normal talking near a phone would trigger it during the pitch. Turn it on for the demo moment: put a phone under a box or cushion ("rubble") and have someone call out from behind. The log shows `MUFFLED VOICE`.
- **Next step (honest):** a trained sound classifier (YAMNet's AudioSet classes include Screaming, Shout, Crying, and Water, Rain and Stream) as a second opinion, plus a **knocking/tapping pattern detector**, because trapped survivors are taught to tap.

### The drop-ear (pulley/tether) concept, and how it avoids hitting rubble

**Why lower the mic at all? It's the strongest argument.** Rotor noise falls off with distance. A mic lowered several metres below the drone hears **much less rotor noise** and is **closer to the survivor**, so the signal-to-noise ratio improves on both counts. That raises POD exactly where it matters.

**How it avoids rubble** (design, not built):

1. **Listen high, drop low only at hotspots.** The drone listens from a safe height. It lowers the ear only over a cell that is likely but uncertain (high probability, amber trust), and only into a visible opening. The trust map tells you **where it's worth the risk**.
2. **A caged pod.** The mic sits inside a round protective cage with a foam bumper, like collision-tolerant inspection drones use. A round cage rolls off edges instead of snagging.
3. **A down-facing range sensor on the pod** (small ultrasonic or time-of-flight). The winch stops about 1 m above any surface. **This is where lidar fits:** for navigating the probe, not for finding people.
4. **A winch with tension sensing.** Slack means it touched something; a sudden spike means it's snagged. Either way: stop, raise slowly, and try a different opening.
5. **A breakaway weak link.** If the tether snags hard, the link breaks and the drone flies free. You lose a cheap pod, not the drone.
6. **Slow descent and hover control** to limit swinging. A short tether (around 5–10 m) keeps it manageable.
7. **Waterproof pod** (IP67 MEMS mics behind acoustic membranes), so it can hang just above floodwater.

**Software hook (optional, P2/P3, only if there's time):** a "🔽 Lower ear here" button on the control screen. The drone hovers, and for that cell POD gets a bonus with less noise penalty. The trust map visibly firms up: amber turns to green, or a detection appears.

### Slide 6 / Q&A lines

- *"Flood noise is broadband. Voices have pitch. GEMA hears the difference, and when it can't, it says so."*
- *"Muffled voices lose their brightness but keep their rhythm. We listen for the rhythm."*
- *"We don't fly into rubble. We listen from above, and lower a caged ear only where the map says someone is probably there."*

---

## 16. Hearing lab results and gap audit (13.10)

### Hearing validated on REAL recordings: `/lab.html`, 16/16 pass

The recordings are a flooded river, heavy rain, a summer downpour, two real screams, and a spoken "help" muffled through simulated rubble (low-pass filtered to 600 Hz). All come from Wikimedia Commons; credits are in `public/sounds/ATTRIBUTION.md`.

| Scenario | Result |
|---|---|
| River / heavy rain / downpour / river+rain, loud, no person | **No false alarms** |
| Scream over flooded river at +6, 0, **−6 dB** (quieter than the flood) | **Detected** |
| Scream over heavy rain at 0 dB | **Detected** |
| Muffled "help" ×3, quiet room / over river +6 dB / over river 0 dB / over heavy rain +6 dB | **Detected** (as muffled) |
| **Limits (honest):** scream 12 dB *below* the flood; muffled call through *heavy rain* at 0 dB | Not detected. This is exactly what the trust map's "NOT CLEARED" exists for |

**What changed, and why (both lessons came from real data):**
1. Real flood and rain noise is *not* spectrally flat, so the flatness idea failed. The phone now **learns the background spectrum** and measures sound rising **above it** in the scream band (1–4 kHz) and the voice band (250–3500 Hz).
2. A loud flood raises the overall floor, so "15 dB above the floor" missed screams. A band-by-band rise fixed it.
3. Everything human must have a **pitch**. Water and rain never exceed a pitch clarity of about 0.45; real screams reach 0.9–1.0. Pre-emphasis stops the river's rumble from looking pitched.
4. Muffled calls are short syllables, so the detector counts voiced time and needs **at least 2 separate calls**. A single gurgle in the river recording used to trigger it; survivors call repeatedly.

**For P3's POD curve:** the lab is real calibration data. Detection is reliable from **−6 dB SNR upward** and fails around **−12 dB**. Use the phones' measured noise floor to estimate SNR, then map: SNR ≥ 0 → POD high; −6 → medium; ≤ −12 → near 0.

### Gap audit against the problem statement

> *Problem: drone teams search blind, and "no detection" gets treated as "clear," so survivors in noisy or poorly scanned areas are missed.*

| What the problem statement needs | Status | Owner |
|---|---|---|
| Hear survivors through flood noise | ✅ Built, validated on real recordings (limits above) | P1 |
| Hear muffled survivors | ✅ Built, validated (mode toggle) | P1 |
| Direction to the survivor (turn the drone) | ✅ Built: fusion and bearing (unit-tested; **not yet tested on real phones**) | P1 |
| Camera "eyes" as a second sensor | ✅ Built (**not yet tested on a real phone**) | P1 |
| **Trust map: POD, the "NOT CLEARED" cells, the Bayesian update**. This *is* the problem statement | ❌ **Not built.** `search.js` is still a stub | **P3** |
| **Control screen: map, drone flying and turning, pins** | ❌ **Not built.** `map.js`, `drone.js` and `main.js` are still stubs | **P2** |
| "Where to look next" (next waypoint) | ❌ Not built | P3 |
| Family "last seen here" reports | ❌ Not built | P2/P3 |
| Simulation evidence (GEMA vs grid search) | ❌ Not built | P3 |
| Real-phone test with 2–3 phones | ❌ Not done | P1 + team |
| Turn off Vercel auto-deploy before 2.55pm | ❌ Pending | Vercel account owner |

**Bottom line:** the sensing works. **The part that answers the problem statement (the trust map on a screen) does not exist yet.** It must be running by about 2.00pm to record the video.

---

## 17. Camera results and the P2 link (12.55)

### Camera eyes on real photos (`/lab.html`, the second section)

This is the same detector the phones run (COCO-SSD lite, in the browser).

| Photo | Result |
|---|---|
| Woman trapped on a car roof in a flash flood | ✅ Found, 77% |
| Flood rescue scene | ✅ Found, 99% |
| Rescuer carrying a boy (Katrina) | ✅ Found, 99% |
| Satellite flood image, no people | ✅ No false alarm |
| Helicopter rescue seen from a distance | ❌ Missed (also with 3×3 and 4×4 tiles) |
| Drone's-eye view, small people | ❌ Missed. 4×4 tiles found 1 of several at 64%, and took 3.8 s |

**What this means (put it in the pitch):** a general-purpose camera model finds people **up close** but **not from drone height**. So:
- **Ears find, eyes confirm.** The microphones locate survivors from altitude, and the camera confirms at close range, for example a camera on the lowered **drop-ear pod**.
- **Next step:** retrain the camera model on aerial search-and-rescue datasets (HERIDAL, SARD) for drone-height detection.
- **Practical:** the model is about 5 MB. It took **about 25 s** to load the first time on laptop Wi-Fi; after that it's cached. **Tap "📷 Add eyes" on the demo phone a minute before you present.**

### P2: connect the phones in a few lines (`src/control/ears.js`)

```js
import { connectEars } from './ears.js';
const ears = connectEars({
  onDetection: (d) => {
    const abs = drone.state.headingDeg + d.relBearingDeg;   // absolute direction
    // turn the drone toward abs, drop a pin with d.confidence, then
    // search.applyDetection(grid, droneXY, abs, d.confidence)
  },
  onEarStatus: (connected) => showEars(connected),          // e.g. ['L','C','R']
  onLog: (line) => addToLog(line)
});
// ears.room → show on screen · ears.earUrl('L') → QR code (the qrcode package is installed)
// ears.noiseFloorDb() → feed into POD so noisy areas stay amber
// ears.calibrate.start() / .clap() / .apply() → Calibrate button
// ears.simulateScream('L') / ears.simulateSighting('C') → demo fallback buttons
```

It's tested: a simulated scream near L gives a direction below −20°, and a sighting gives a camera detection.
