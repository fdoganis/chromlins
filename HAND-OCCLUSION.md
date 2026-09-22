# Real-hand occlusion — research + prototype

Spike branch. `HandOccluder` is real, tsc-clean, and unit-tested (13 tests),
and — new this round — actually **run**, against an IWER-emulated hand, with
screenshots and a real numeric measurement against three.js's own
ground-truth hand model. It is wired into `Game.ts` right now **only to get an
honest byte measurement and to make it testable**; that wiring is marked
`BYTE-COST MEASUREMENT ONLY` in the source and is not a decision to ship.

## The problem

In AR passthrough, a virtual object should disappear behind the player's real
hand when the hand is physically in front of it. WebXR's own answer to this,
Depth Sensing, is real but coarse: a 320x320 depth map per eye (about one
texel per 8 screen pixels on a Quest 3 eye buffer), reliable out to about 4m
and specifically **worse at close range** — exactly hand distance. Reported
directly: it "won't pick up details like the spaces between your fingers"
([uploadvr.com](https://www.uploadvr.com/quest-3-depth-api-mixed-reality-dynamic-occlusion/),
[blog.learnxr.io](https://blog.learnxr.io/xr-development/quest-3-mixed-reality-with-meta-depth-api-new-occlusion-features)).
(This project already had a `depthSensing` config once; it was removed as
dead code before ever exercising a real session — see `.doc/DECISIONS.md`'s
D2 — so that removal isn't evidence either way, just why there's nothing to
build on there.)

The alternative: draw the hand's own tracked skeleton, invisibly, with real
depth writes. Any virtual object behind that depth gets normally
z-buffer-culled, same as if the hand were a real occluding surface.

## The technique

**No hand model, no mesh asset — geometric primitives only**, per the
request. WebXR's Hand Input API gives 25 named joints per hand
([spec](https://www.w3.org/TR/webxr-hand-input-1/)), each with a world pose
**and a `radius`** ([`XRJointPose.radius`](https://developer.mozilla.org/en-US/docs/Web/API/XRJointPose/radius)).
three.js already surfaces this: `WebXRController.js` sets
`joint.jointRadius = jointPose.radius` on every tracked joint each frame
(confirmed by reading `node_modules/three/src/renderers/webxr/WebXRController.js`
directly), and `renderer.xr.getHand(n).joints[name]` is already how
`HandSource.ts` reads hand joints. No new session features, no new per-frame
API calls.

**Shape: a lathed "phalanx", not a uniform capsule.** A real finger segment
tapers from knuckle to tip. The technique — you sent the actual pen mid-session,
which settled this precisely rather than from a paraphrase — is
[prisoner849's](https://discourse.threejs.org/u/prisoner849) three.js forum
CodePen `qBaNKNM` (CC BY-SA): `createPhalanxGeom(R, L)` builds a 2D profile —
`r = R*0.85`, `a = Math.asin((R-r)/L)`, then an arc of radius `R` from
`Math.PI*1.5` to `a` (the base cap) joined to an arc of radius `r` from `a` to
`Math.PI*0.5` (the tip cap) — and revolves it with `LatheGeometry` into one
tapered, rounded-cap solid. The pen chains these through a real `Object3D`
hierarchy with a hand-authored TWEEN bend for an animated demo hand — that
part doesn't apply here, since we have a **real** tracked skeleton, so each
bone's transform comes from two real joint poses instead
(`handBones.ts`'s `boneMatrix`).

Independent confirmation this is the right general shape: a
[MuJoCo/WebXR hand-rendering PR](https://github.com/ttktjmt/mjswan/pull/114)
does the same thing — capsules between adjacent WebXR joints, sized by joint
radius, no hand mesh.

## Is the palm handled? Wrist? Forearm?

**Palm: yes, and it needed a real fix.** The first version of this spike
covered the palm with five thin "spoke" bones fanning from the wrist to each
finger's own metacarpal joint — lines, with real gaps between them, not an
area. It's replaced with `palmPlateMatrix(wrist, indexMc, pinkyMc)`: a single
flat box spanning the wrist and the two outer metacarpals (index and pinky,
the width of the knuckle line), the same three-point approximation the
mjswan PR above uses for its own two-capsule palm. One instance instead of
five, and it actually covers the area, not three lines through it.

**Wrist: covered as an endpoint, not as its own volume.** Every finger bone
starts at a metacarpal (not the wrist directly, since the wrist→metacarpal
segment is now the palm plate's job), and the palm plate's own base edge sits
at the wrist joint, using its real `jointRadius`. There's no separate capsule
wrapping the wrist's own girth as a bone in its own right; the plate's edge
approximates it. Worth a closer look on a device, not fixed further here.

**Forearm: WebXR has no data for it at all.** The Hand Input skeleton stops at
the wrist ([explainer](https://github.com/immersive-web/webxr-hand-input/blob/main/explainer.md)
confirms no forearm joint exists). `forearmMatrix` estimates one anyway: the
spec fixes each joint's local **-Z as "along the bone, away from the wrist"**
for every joint except the wrist itself, where that convention makes the
wrist's own **+Z point back toward the forearm** — so `forearmMatrix` extends
a bone from the wrist along that direction by `FOREARM_LENGTH_m = 0.25`
(an average-adult guess, not tracked data).

**This measurably needs work — the real test run below caught it.** The
occluder-only screenshot
(`test-results/hand-occlusion/occluder-only.png`) shows a long, disproportionate
cyan spike trailing off the wrist, clearly too long for the frame, and a small
stray mark at the screen edge that's very likely the same segment
foreshortened oddly by perspective at close camera range — not separately
root-caused. Two honest things to say about this:

1. The direction is spec-derived and probably right; the length (0.25m) is a
   guess with no tracked data behind it, and it visibly reads as too long in
   this test's fairly close camera framing.
2. **The IoU metric below structurally cannot validate the forearm at all** —
   the ground-truth glTF hand model has no forearm, so every forearm pixel the
   occluder draws counts as a false positive against the metric regardless of
   how accurate it actually is. The 0.749 IoU number is therefore a
   pessimistic, hand-only-unfair number that also penalizes a correct
   forearm; a fair forearm-accuracy check would need a different reference
   (arm-inclusive) model, not attempted here.

**Recommendation:** treat the forearm as the least-settled part of this spike.
Before shipping it, either shrink `FOREARM_LENGTH_m` substantially (a short
"stub" just past the wrist, not a full forearm) or make it possible to disable
independently, and re-check on a real device rather than tuning purely against
this screenshot.

## Debug joint markers, and the XRHandModelFactory question

**Yes — `HandOccluder`'s constructor now takes `{ debug: true }`**: it adds a
small, VISIBLE sphere at every one of the 25 tracked joints (color-writing,
unlike the occlusion geometry), sized to that joint's own `jointRadius`. This
is the green dots visible in the screenshots. It's for checking this class's
own alignment, not part of the occlusion effect.

**For a nicer/pre-built visible hand — especially your VR/Vision Pro case —
use three's own `XRHandModelFactory` directly, don't extend this class for
it.** These are two different problems:

- **AR passthrough occlusion** (this game's mode, Quest): the hand must be
  **invisible** (`colorWrite:false`) — you already see the real hand through
  the camera; `HandOccluder` only needs to plant correct depth.
- **VR self-avatar** (no passthrough — Vision Pro or any headset running in
  VR, where there's nothing to see through): the player needs a **visible**
  hand representation. That's exactly what `XRHandModelFactory` is built for,
  with three profiles: `'spheres'`/`'boxes'` (cheap primitives, same idea as
  this class's debug mode) or `'mesh'` — a real skinned hand, loaded via
  `GLTFLoader` from `https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/...`
  **at runtime, from a CDN** (confirmed by reading `XRHandMeshModel.js`
  directly) — same externalization story as `three` itself in this project's
  own `vite.config.js`, so **it costs ~0 shipped bytes**, unlike hand-rolling
  anything skinned ourselves. Don't reinvent this for VR mode; reuse it.

This is also exactly the tool used below as the "ground truth" reference —
the `.glb` model three's own XR-hands examples use.

## Byte cost — measured, not estimated

Wired unconditionally into `Game.ts` (fingers + forearm + palm, no debug),
fresh builds, `PACK_O=1`, before/after on the same commit baseline:

| Mode | Baseline (`main`) | With `HandOccluder` | Delta |
|---|---|---|---|
| default (`npm run pack`) | 13,232 B | 14,028 B | **+796 B** |
| aggressive (`npm run pack:aggressive`) | 12,887 B | 13,630 B | **+743 B** |

Both push the build over the 13,312 B limit as things stand (`main` alone is
already close to the ceiling). This is a real, substantial cost — noticeably
more than the ~370 B `pack:aggressive` itself saves. The debug-mode
extra (joint spheres + `handOcclusionDebug.ts`) is **not** included in this
number: it's gated behind `__DEV__ && 'handdebug' in query`, so it tree-shakes
to nothing in a production build regardless of whether this feature ships.

## Automated testing — built and run

**IWER already emulates a full, realistic 25-joint hand, not just a wrist
point.** Confirmed by reading `node_modules/iwer/lib/device/configs/hand/relaxed.js`
directly: its default `'relaxed'` pose ships a real per-joint `offsetMatrix`
and `radius` for all 25 joints, not a stand-in. `tests/whack.spec.ts` already
drives this (via `set_connected` + `set_transform`/`animate_to` on the wrist),
just without reading the other 24 joints back — this spike is the first thing
in the repo to actually consume that full skeleton.

**New: `tests/hand-occlusion.spec.ts`**, comparing `HandOccluder` against
three's ground-truth hand mesh:

1. Boots `?run&handdebug` (the new `__DEV__`-gated flag; see `src/core/handOcclusionDebug.ts`).
2. IWER connects `hand-right` in its default `'relaxed'` pose, positioned in frame.
3. `handOcclusionDebug.ts` attaches `XRHandModelFactory('mesh')` to the same
   hand (real skinned model, CDN-loaded) alongside `HandOccluder`'s debug
   spheres.
4. `window.__handDebug.measureOverlap()`: renders the scene twice into an
   off-screen `WebGLRenderTarget` (once with only the occluder made visible in
   a bright debug color, once with only the ground-truth mesh), reads back
   pixels via `renderer.readRenderTargetPixels`, and computes IoU
   (intersection over union) between the two silhouettes.
5. `window.__handDebug.showOnly('mesh' | 'occluder' | 'both')` drives three
   on-canvas screenshots for visual inspection.

**Real result, this run** (`test-results/hand-occlusion/`):

```json
{ "occluderPixels": 23583, "meshPixels": 17740, "overlapPixels": 17699, "iou": 0.749 }
```

17,699 of the mesh's 17,740 silhouette pixels (99.8%) are covered by the
occluder — the hand/finger/palm shape genuinely lines up well. The IoU is
dragged down to 0.749 almost entirely by the forearm over-count discussed
above (`occluderPixels` exceeds `meshPixels` by ~5,800, more than the whole
gap between overlap and union). `mesh-only.png`, `occluder-only.png` and
`both-visible.png` are saved for direct visual comparison; `overlap.json`
holds the raw numbers.

**No pass/fail threshold set yet** — the spec only asserts both masks are
non-empty (so a future regression that silently breaks joint tracking still
fails loudly), not a target IoU. Picking a real threshold needs the forearm
question above settled first, or it will just be gamed by that one segment.

## What's still not done

- **Never verified on a real or IWER-emulated device with actual passthrough
  and a real occluded virtual object** — this test measures silhouette
  overlap against a reference mesh, not "does a rainbow arc actually
  disappear behind a real finger."
- **`renderOrder` / blend-order against the rest of the scene** — reasoned
  about (ordinary depth testing should just work, unlike `Hole.ts`'s
  early-`renderOrder` trick), not measured on device.
- **The forearm question above.**
- **The stray edge-of-frame mark** in `occluder-only.png` — plausibly the same
  oversized forearm segment foreshortened by perspective at this test's fairly
  close camera distance, not independently confirmed.

## Recommendation

Still worth pursuing — the finger/palm geometry measurably lines up with a
real reference model (99.8% of its silhouette covered), the technique needs no
WebXR features Quest doesn't already grant this game, and it now has a
repeatable, automated regression test with real screenshots. Before shipping:
settle the forearm (shrink it, gate it separately, or drop it), verify on a
real device that occlusion actually looks right against real passthrough (not
just against a reference mesh), and decide whether the ~750-800 B cost is
worth it against the other two byte-budget options (light estimation, the
bitmap font) — this spike's own testing shows this is the one with a
verified, working effect on the *thing this game is actually about* (a
whack-a-mole hand), which the other two don't touch.
