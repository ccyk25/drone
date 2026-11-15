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

---

## 🎬 Live demo runbook: mission map rescue flow (built 13.15)

**Setup: 3 phones = the drone's camera and its two ears** (one drone, not a swarm: real acoustic drones carry the mic array on their frame)

```
        🎤 L phone            📷 C phone (camera)           🎤 R phone
        left mic        faces the person / audience        right mic
           ◄──────── ~1 m ────────►◄──────── ~1 m ────────►
                       💻 laptop speaker = drone speaker (behind the phones)
```

- **Laptop/projector:** `https://gema-drone.vercel.app/?room=ABCD` (any 4 letters). Volume up, because this is the drone speaker. Scenario **Flood** (heat sees people) or **Collapse** (heat blocked by rubble).
- On the mission map, open **Join ears** and scan:
  - **L · 🎤 left mic** with the left phone, then tap **"Tap to start listening"**
  - **R · 🎤 right mic** with the right phone, then tap **"Tap to start listening"**
  - **C · 📷 camera** with the middle phone (it opens eyes mode). Wait for **"Start eyes (ready)"**, then tap it. Open this one **early**: the detector takes 25 s or more to load the first time.
- **Calibrate:** only if L and R are **different phone models**, and do it during setup, not in the pitch (3 s of quiet, then one clap at the centre). Same-model phones → skip it.
- Then **▶ Start search**.

**The sequence (the banner on the map shows each phase):**

| Step | What you do | What GEMA does |
|---|---|---|
| 1 | A person stands in front of / to the side of the camera phone | 📷 **PERSON IN VIEW**: turns toward them and steps 15 m (re-steers on each sighting; never flies off forward) |
| 2 | The person steps out of view | After 5 s: 🌡 **HEAT CHECK** (simulated thermal). Flood: heat found. Collapse: blocked by rubble |
| 3 | The drone speaker says *"If you can hear me, shout for help"* | 👂 **LISTENING** |
| 4 | The person shouts **near the L or R phone** | 🔊 Turns left or right toward the voice and steps 25 m |
| 5 | (If needed) shout again | ✅ **PERSON CONFIRMED**. Speaker: *"Help is coming. Stay where you are."* 🚩 A flag shows details: on a roof or vehicle / under rubble, which sensors confirmed, direction, coordinates, time |
| 6 | Wait about 9 s | 🔍 Resumes searching. The next shout starts the same flow (voice → heat → confirm) |

**Rehearse without phones:**
- keys **Q / P / E** = person seen left / ahead / right
- the **L / C / R** buttons = a voice from the left / centre / right

**Honest notes:**
- Thermal is simulated, because we have no thermal hardware. Next step: an MLX90640 or FLIR Lepton.
- The drone is virtual. The phones stand in for its camera and microphone array.
