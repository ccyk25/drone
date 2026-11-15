# GEMA: progress summary for the demo (updated 12.55)

**GEMA is a search map for disaster drones that hears survivors and admits what it might have missed.**

> *"Other systems tell you where people are. GEMA also tells you where silence doesn't mean safe."*

**Live:** https://gema-drone.vercel.app · **Repo:** https://github.com/ccyk25/drone

---

## The problem
After a flood or collapse, drone teams search blind. Thermal cameras can't see under roofs, rubble or water, and an area flown over with no detection gets treated as "clear." Survivors in noisy or hidden places get missed.

## How GEMA works
1. **Ears:** microphones (phones stand in for a drone's microphone array) pick out screams and muffled calls through flood and rain noise.
2. **Direction:** comparing loudness across the microphones tells the drone which way to turn.
3. **Eyes:** a camera confirms people at close range.
4. **Heat:** thermal as one more evidence layer, with its blind spots modelled honestly (simulated: no thermal hardware).
5. **Trust map:** every area holds a probability that someone is there. Silence only clears an area when listening conditions were good. **In noise, it stays amber: "NOT CLEARED."**
6. **Where to look next:** the drone flies to the most likely area it hasn't checked properly. Families can mark "last seen here."

---

## What works, with evidence

| Feature | Evidence |
|---|---|
| **Hearing through flood noise** | **16/16** real-recording scenarios pass (`/lab.html`): flooded river, heavy rain, downpour, real screams, a muffled "help" |
| No false alarms from water noise | River, heavy rain, downpour, and river and rain together: **0 false alarms** |
| Screams through floods | Detected even **6 dB quieter than the flood** |
| Muffled voices behind rubble | Detected in a quiet room, through a flooded river, and through rain at +6 dB |
| Direction finding | A scream near the left phone gives **−32°**; unit-tested |
| Camera eyes | Real flood photos: people found at **77–99%**, no false alarm on a satellite image |
| Phones to screen in real time | Supabase realtime tested end to end; live on Vercel |
| Calibration, muffled-voice mode, simulate buttons | Built |
| **Trust map engine** (built) | Every sensor has its own detection probability by distance, noise and cover (roof/open/trees/water); silence in noise or under roofs stays NOT CLEARED |
| **Thermal (simulated)** | Modelled with its real blind spots: roofs, water, hot afternoons |
| **Simulation evidence** (`/lab.html`) | 200 runs per strategy: thermal drone **74%** found → ears + thermal **99%** → GEMA guided **99.9%**, first survivor **3× faster** (31 s vs 105 s). Thermal alone: all its misses were in areas it flew over; the trust map flagged **94%** of them NOT CLEARED |
| Code quality | **42 unit tests** pass |

## Honest limits (say these, because judges reward honesty)
- A scream **12 dB quieter** than the flood is missed. A muffled call through **heavy rain at equal loudness** is missed. **That's exactly what the "NOT CLEARED" cells are for.**
- Camera: misses people **from drone height**. So: **"Ears find, eyes confirm."** Next step: an aerial-trained model (YOLO on drone datasets; experiment running).
- **Simulated:** the drone, the thermal sensor, and the phones standing in for a microphone array. 1 m in the room = 25 m on the map.
- Not yet tested: real phones (microphone and camera) on the day.

## Still in progress (as of 12.50)

| Item | Owner | Status |
|---|---|---|
| Control screen: map, drone, pins | P2 | Pushing at 1.00pm |
| Trust-map engine and thermal layer | P1 (Claude) | ✅ Done (P2 wires it to the map: HANDOVER section 18) |
| Simulation chart: thermal-only vs GEMA | P1 (Claude) | ✅ Done (`/lab.html`) |
| YOLO person detector (aerial) | Background experiment | Running |
| Real-phone test (2–3 phones) | Team | To do |
| Turn off Vercel auto-deploy before 2.55pm | Vercel account owner | To do |

---

## Demo script (5 minutes)

| Time | Beat |
|---|---|
| 0:00 | **Hook:** Taman Sri Muda, 2021. Families searching online for relatives whose phones had died |
| 0:40 | **Insight:** "No detection is not the same as clear." Show the sensor table (thermal vs mic) |
| 1:10 | **Live demo:** (1) a judge screams near the left phone and the drone turns left; (2) play the flood recording: no false alarm, and cells stay amber; (3) a muffled "help" under a box is heard; (4) the camera confirms a person; (5) **"Reveal ground truth"**: the missed survivor sits in an amber cell |
| 3:10 | **How it works:** learned background plus pitch, the trust map, and the hearing lab results (16/16) |
| 3:50 | **Evidence:** simulation: 74% → 99% found, first find 3× faster, and misses flagged as NOT CLEARED; then the stakeholders (Bomba, APM, NADMA, families) |
| 4:30 | **Close:** "We built the brain. Fraunhofer built the ears. Bomba has the drones." |

## Pages

| Page | For |
|---|---|
| `/` | Control screen (P2) |
| `/ear.html` | Phone ears (scan the QR codes) |
| `/debug.html` | Ears console: QR codes, calibration, live direction, simulate buttons |
| `/lab.html` | Evidence: hearing lab (16/16) and camera lab |
