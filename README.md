# GEMA: a search drone that listens

**STC Mini Hackathon 2026 · Theme: Disaster Recovery**

GEMA is a search map for disaster drones that **listens for survivors and admits what it might have missed.**

A virtual drone flies over a satellite map of Taman Sri Muda, Shah Alam. Phones placed under the screen act as its ears. A scream turns the drone toward the sound. Every grid cell tracks the probability that a survivor is there, and in noisy areas, silence never counts as "cleared."

The full plan, scope, stakeholders and module owners are in [HANDOVER.md](HANDOVER.md).

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm test             # unit tests (vitest)
npm run build
```

### Pages

| Page | What it is | Owner |
|---|---|---|
| `/` | Control screen: map, drone, trust grid | P2 |
| `/ear.html?room=ABCD&ear=L` | Phone ear (L, C or R) | P1 |
| `/debug.html` | Ears debug console: QR join, live levels, calibration, fused bearing, simulate buttons | P1 |

### Testing the ears

**Solo, on one laptop.** Open `/debug.html`, then open the three ear links in new tabs of the same browser. Without Supabase keys, the tabs talk to each other through `BroadcastChannel`. Use the **Simulate** buttons to test fusion without any microphone.

**With real phones:**
1. Phones need **HTTPS** to use the microphone, and the phones and the laptop must share a realtime channel. Put the Supabase keys in `.env`:
   ```
   VITE_SUPABASE_URL=https://xxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=...anon / publishable key...
   ```
   Only use the public anon key. **Never put the service_role key or the database password in this repo.**
2. Then either use the deployed Vercel URL, or run `npm run dev:https` and scan the QR codes on `/debug.html`. The QR codes point at your laptop's LAN address. Accept the self-signed certificate warning on the phone.

## How the ears work

- Each phone measures loudness (dBFS), a rolling noise floor (20th percentile over 5 s), and the share of energy between 1 and 4 kHz.
- **A sound counts as a scream** when it is 15 dB or more above the floor, high-pitched, and lasts at least 300 ms. Claps are too short; talking is too low-pitched.
- The browser's echo cancellation, noise suppression and auto gain are **switched off**. They would erase the loudness differences between phones that we use to find direction.
- **Fusion** groups screams that arrive within 600 ms of each other. It adjusts each phone's level by its calibration gain, then works out a direction weighted toward the loudest ear.
- **Calibration:** 3 seconds of quiet, then one clap at the centre. The gains then make every phone read that clap equally.
- Only numbers are sent. No audio is recorded or stored.

## Honesty notes

- The drone is simulated.
- The phones stand in for the microphone array a real drone would carry. Fraunhofer FKIE's LUCY prototype shows the hardware side, including rotor-noise filtering.
- 1 m in the room stands for 25 m on the map.
- The probability-of-detection curve comes from our own room tests (`calibration/results.csv`), not from real rotor conditions.
- Prior art we acknowledge: Fraunhofer LUCY, SARUAV, Police Scotland's recognition drones, and Bomba's thermal drones.

## Credits

- [Leaflet](https://leafletjs.com/), with map tiles © Esri (World Imagery) and © OpenStreetMap contributors
- [Supabase](https://supabase.com/) Realtime
- [qrcode](https://github.com/soldair/node-qrcode)
- [Vite](https://vitejs.dev/) and [Vitest](https://vitest.dev/)

Everything in this repository was built during the hackathon on 15 November 2026.
