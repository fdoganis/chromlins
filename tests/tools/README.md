# Hand-whack calibration

`HandSource`'s whack detector (`src/input/HandSource.ts`) fires on a downward
palm strike near the placed surface. Its thresholds — `SPEED_MIN_mps`,
`BAND_LOW_m` / `BAND_HIGH_m`, `COOLDOWN_ms`, `WHACK_REACH_m` — are educated
guesses until they're checked against **real Quest hand-tracking data**. This
folder is how you capture that.

Two ways, same output (a JSON of per-frame joint poses on the Mac):

| | what | where |
|---|---|---|
| **`?calib`** | guided scene in the game — target cubes, HUD directions, auto-send | `src/states/CalibState.ts` (dev-only, folds out of prod) |
| **`xr-hand-recorder.html`** | bare page — records continuously, no scene, manual send | this folder |

Use `?calib` unless it won't start.

---

## Setup (once)

- `brew install cloudflared` — anonymous HTTPS tunnel, no account. WebXR needs a
  secure context, so a plain `http://<mac-ip>:5173` from the headset won't work.
- Quest: **Settings → Movement Tracking → Hand and Body Tracking → On**. (No
  Space Setup / furniture scan needed — `?calib` places the board from your
  hand, not hit-test.)

## Run `?calib`

1. Mac, terminal 1: `npm run dev`
2. Mac, terminal 2: `npm run cloud` → copy the `https://<words>.trycloudflare.com` line
3. Quest Browser → `https://<words>.trycloudflare.com/?calib` → **START XR**
4. **Place the board:** HUD reads `HAND ON TABLE - PINCH`. Rest your hand flat
   on the tabletop and pinch — the board snaps to that height. (Don't pinch
   within ~12 s and it just keeps the default height.)
5. **Phase 1 — 12 whacks.** A green cube rises from a hole; slap it down onto
   the surface → it bursts, HUD `WHACK 1`, next cube. Vary it: hard/fast,
   slower-deliberate; flat palm, a couple karate-chops, a couple fingers-first.
   **Rest your hand on the surface between whacks** — that rest is the data
   point the old detector choked on. Slow? it auto-advances every 2.5 s, just
   keep whacking on the beat.
6. **Phase 2 — ~15 s of non-whacks.** HUD `WAVE REACH REST - DO NOT HIT` +
   countdown. Glide the hand sideways at surface height, reach across, lower it
   slowly to rest. **Don't strike.** This is the false-positive data.
7. **Phase 3.** HUD `DONE - PINCH TO SAVE`. Pinch → it POSTs the capture to the
   dev server (`SAVED - EXIT XR`), then exit XR however you like. Exiting XR
   without pinching also saves (backstop). File: `tests/fixtures/calib-<ts>.json`
   (`[record-sink] saved …` in terminal 1).

Run it 2–3 times; one file gets us going. Each session is a new file.

## Fallback: `xr-hand-recorder.html`

Open `https://<tunnel>/tests/tools/xr-hand-recorder.html`, **Enter XR**, do the
same movements freehand (no cubes, no HUD — just remember the sequence), exit,
then **Send to Mac** (or **Download** → pull off the headset with Android File
Transfer). It also prints a per-strike summary (peak downward speed, palm Y,
lowest Y ≈ your surface).

## The file

`{ ua, started, frames: [{ t, hand, phase, m:[x,y,z], w:[…], i:[…], r, hit?:[x,y,z] }] }`
— `m`/`w`/`i` = metacarpal / wrist / index-tip world positions in `local-floor`
space; `phase` = `whack` | `idle` | `done`; `hit` present on frames where a
target was whacked. From it: the real peak downstroke speed, the palm height
where it stops, the deceleration time → set the `HandSource` consts to fit the
whacks while rejecting the phase-2 motion, and add a replay spec built from the
file.

## Troubleshooting

| symptom | fix |
|---|---|
| "XR not supported" / no START XR | you opened `http://…:5173`, not the `https://…trycloudflare.com` URL |
| START XR errors | hand tracking off in Settings, or the session prompt was denied |
| `npm run cloud`: command not found | `brew install cloudflared` |
| page won't load over the tunnel | the tunnel URL changed — use the newest `npm run cloud` line |
| nothing saved on the Mac | both terminals + tunnel still up? use `xr-hand-recorder.html` → Download |
| board is too low / high | you pinched with your hand not flat on the table — reload and redo the place step |

---

# Unicorn groom studio

`npm run groom` opens `groom.html` — a standalone page (never imported by
`src/`, so zero bundle weight) for designing the unicorn's mane, horn and face.
It renders one `Unicorn` scaled ~3×, a wireframe capsule cage (the volume
strands must stay out of), and a lil-gui panel bound to every `Unicorn.tune`
value.

## Navigate

- **Orbit** — drag to rotate, scroll to zoom. Turn to the back for the mane.
- `sim → face camera` — off by default so the model holds still while you orbit.
  On = it yaws toward you like in-game.
- `sim → rise/sink playback` — oscillates the rise/sink so the spring mane
  cycles like an in-game appearance; `rise/sink kick (manual)` is the by-hand
  version.
- `sim → capsule cage` — the wireframe no-go volume (off by default; the body
  mesh already shows it). `reset` reloads (and drops any `?u=`).
- `view` folder — FOV slider + `preview 55°` / `game desktop 75°` / `headset
  ~95°` presets. A wide lens close up spreads a yaw fan.
- Every field **rebuilds the geometry on release**. Type whole numbers for the
  `*Count` fields.

## `mane` knobs (metres / radians)

| knob | effect |
|---|---|
| `len` / `foreLen` | strand path length — back mane / forelock. Raise `len` for a long drape down the back. |
| `lift` | initial pitch off the root (rad, + = up). Negative = the hair falls straight away. |
| `drop` | total downward sweep by the tip. Higher = hangs straighter; lower = stays arched over the head. |
| `sBend` | the mid-strand undulation that makes it an S. `0` = plain arc. |
| `backFan` / `foreFan` | yaw spread across strands (rad). `0` = one plane; higher = wider fan around the head. |
| `backCrest` | `0` = back roots fan across the crown (topknot); `1` = roots march a ridge down the back of the head — a horse mane. `crestDrop` / `crestBack` size that ridge. Drop `backFan` toward 0 with it. |
| `xStep` | root spacing across the crown. |
| `radius` / `taper` | tube thickness at the root; `taper 1` = pointed tip, `0` = constant. |
| `margin` | clearance every sample is pushed off the body — raise if a strand clips the capsule in motion. |
| `backRootZ` | back-mane root Z (− = behind the horn). |
| `foreRootYFrac` / `foreRootZ` | forelock root — height as a fraction of the body half-height, and front offset. |
| `stiff` / `damp` / `kick` / `idle` | spring **motion**, not shape (stiffness, damping, rise/sink impulse, idle sway). |

`horn` and `face` folders work the same; the muzzle is `face → muzzleYFrac` /
`muzzleZ`.

## Save it back

1. `sim → copy tune JSON` — copies the whole `{ mane, horn, face }`.
2. In `src/world/Unicorn.ts`, replace the objects inside `static tune = { … }`.
3. `git diff src/world/Unicorn.ts` — only numbers should change.
4. Verify at true scale: `npm run dev`, open **`?uni`** — the unicorn peeks at
   hole 0 and holds, so you see exactly the in-game slice. `?tweak`'s `mane
   motion` folder has the live spring knobs; `?tweak&u=<share URL>` applies a
   groomed look without editing the source.

## Share a look

`sim → copy share URL` puts `…/groom.html?u=<base64 of Unicorn.tune>` on the
clipboard. Open that link and the groom studio loads with that look. The same
`?u=` param works on the **game** (`__DEV__` only, folds out of prod) — e.g.
`?tweak&u=…` or `?run&u=…` shows the shared look at true scale / in AR without
editing `Unicorn.tune`.

## FOV — judge the fan through the shipping lens

The light rig, tone mapping and default camera (75°) mirror the game's
desktop preview. But in an immersive WebXR session three.js **ignores
`camera.fov`** — the runtime supplies per-eye projection, ~100° H on Quest 3
(see `.doc/DECISIONS.md` D11 / the `gamma-webxr-fov` memory). A wide lens close
up visibly spreads a *yaw* fan, so set `view` to `headset ~95°`, `sim → hold
still` off (faces you, like in-game), and expect `backFan` / `foreFan` to read
wider on-device than in any narrow preview.
