# Real-hand occlusion — research + prototype

Spike branch. `HandOccluder` is real, tsc-clean, unit-tested (31 tests), and
run against an IWER-emulated hand with screenshots and a real numeric
measurement against three.js's own ground-truth hand model. It is wired into
`Game.ts` right now **only to get an honest byte measurement and to make it
testable**; that wiring is marked `BYTE-COST MEASUREMENT ONLY` in the source
and is not a decision to ship.

**This doc went through one full round of ablation** (four isolated
one-change experiments, each measured for real packed size and re-run through
the same comparison test) after the first version shipped a lathe-profile
phalanx, a box palm plate, and a guessed forearm. All three of those
decisions turned out to be measurably wrong; see "Byte cost" and "Is the palm
handled?" below for what replaced them and by how much.

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

**Shape: capsule, not the tapered lathe profile prior art suggested — measured,
not assumed.** A real finger segment tapers from knuckle to tip, which is why
the first version of this spike used a tapered lathe profile instead of a
uniform capsule. You sent the actual technique mid-session — Prisoner849's
three.js forum CodePen `qBaNKNM` (CC BY-SA): `createPhalanxGeom(R, L)` builds
a 2D profile (`r = R*0.85`, two arcs joined at `a = Math.asin((R-r)/L)`) and
revolves it with `LatheGeometry` into one tapered, rounded-cap solid, then
chains these through a real `Object3D` hierarchy with a hand-authored TWEEN
bend for an animated demo hand. A separate line of prior art — a
[MuJoCo/WebXR hand-rendering PR](https://github.com/ttktjmt/mjswan/pull/114) —
instead uses plain capsules between adjacent WebXR joints, sized by joint
radius, no taper. Both are real, used techniques, so which one to use here
was an empirical question, not a style choice — see "Byte cost" below: the
plain capsule won on both size and measured accuracy, so that's what shipped.
Either way, no hand-authored bend animation applies here: we have a **real**
tracked skeleton, so each bone's transform comes from two real joint poses
(`handBones.ts`'s `boneMatrix`), not an authored bend.

## Is the palm handled? Wrist? Forearm?

**Palm: yes — and its shape went through two revisions.** The very first
version covered the palm with five thin "spoke" bones fanning from the wrist
to each finger's own metacarpal — lines, with real gaps between them, not an
area. That became a single flat box plate spanning the wrist and the two
outer metacarpals (index and pinky, the knuckle-line width), the same
three-point approximation the mjswan PR uses for its own palm. **Measured
against that box (see "Byte cost" below), a third option won**: two more
`boneMatrix` calls — wrist→index-metacarpal and wrist→pinky-metacarpal, the
mjswan PR's own actual two-capsule palm, not the box — reusing the exact same
pool, geometry and function the fingers already use. Same coverage, no
separate `BoxGeometry`, no separate `InstancedPool`, no bespoke basis-matrix
function (`palmPlateMatrix` is gone). This is what shipped.

**Wrist: covered as an endpoint, not as its own volume.** Every finger bone
starts at a metacarpal, and both palm spokes start at the wrist, using its
real `jointRadius`. There's no capsule wrapping the wrist's own girth as a
bone in its own right. Worth a closer look on a device, not fixed further
here.

**Forearm: dropped — WebXR has no data for it at all, and it measurably hurt
more than it helped.** The Hand Input skeleton stops at the wrist
([explainer](https://github.com/immersive-web/webxr-hand-input/blob/main/explainer.md)
confirms no forearm joint exists). A first attempt estimated one anyway: the
spec fixes each joint's local **-Z as "along the bone, away from the wrist"**
for every joint except the wrist itself, where that convention makes the
wrist's own **+Z point back toward the forearm** — so it extended a bone from
the wrist along that direction by a guessed 0.25 m (average adult forearm,
not tracked data). The comparison test caught the problem immediately: the
occluder-only screenshot showed a long, disproportionate spike trailing off
the wrist, and dropping the segment alone took IoU from 0.749 to 0.982 (see
"Byte cost" below) — the single largest swing of any change tried. Two honest
reasons that number is even worse than the shape alone deserves: the
0.25 m *length* is a pure guess with no tracked data behind it, and **the IoU
metric structurally cannot validate a forearm at all** — the ground-truth
glTF hand model has no forearm, so every forearm pixel the occluder draws
counts as a false positive regardless of how accurate it actually is. Given
that, and that it cost real bytes on top, it's simply not built anymore. If
you want it back later, the direction math above is still correct; start
with a much shorter guessed length, and accept that this metric can't tell
you if you got it right.

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

## Byte cost — measured, not estimated, and ablated

Wired unconditionally into `Game.ts` (no debug), fresh builds, `PACK_O=1`.
`main` alone (no `HandOccluder` at all): **13,232 B default / 12,887 B
aggressive.** Starting from the first working version (lathe phalanx + box
palm + guessed forearm) and changing exactly one thing at a time, re-running
`tests/hand-occlusion.spec.ts` after each change for its IoU against three's
ground-truth hand mesh:

| Variant | default zip | aggressive zip | IoU |
|---|---|---|---|
| Baseline: lathe + box palm + forearm | 14,038 B | 13,611 B | 0.749 |
| A: capsule instead of lathe | 13,987 B | 13,563 B | 0.872 |
| B: baseline, forearm dropped | 13,977 B | 13,564 B | 0.982 |
| C: B + spoke palm instead of box | 13,889 B | 13,429 B | 0.980 |
| D: A + B + C, all combined | 13,808 B | 13,390 B | 0.985 |
| **Shipped** (D + one more dedup, below) | **13,787 B** | **13,376 B** | 0.985 |

Every single change was a real, independent improvement — smaller **and**
better-fitting, never a trade-off between the two. The forearm alone
accounts for most of the swing (compare baseline to B). Adopting D then
turned up one more real duplicate while cleaning up: `HandOccluder`'s debug
markers and `Sparkles.ts` both already had their own identical "identity
quaternion, for something that never rotates" constant; moved to the shared
`text/engines/voxel/constants.ts` (which already held `UP` and
`ZERO_SCALE_MATRIX` for the same reason) so `Sparkles.ts` drops its own
`Quaternion` import entirely. `handBones.ts`'s own local `UP` constant stays
a duplicate on purpose — it's the one file in this feature that has to stay
plain-Node testable with zero extensionless imports, which is exactly what
broke (loudly, in the unit test suite) the one time this session tried
importing the shared one into it.

**Where this left the budget, at the time this feature alone was measured:**
64 B over the 13,312 B limit in aggressive mode (13,376 B), down from 318 B
for the original, un-ablated design. Since then, unrelated work (Hole.ts's own
occluder simplification) shipped and moved the total — see `.doc/SIZE-AUDIT.md`
for the current, authoritative number; don't trust either figure in this
section as still current. The debug-mode extra (joint spheres +
`handOcclusionDebug.ts`) is **not** included in any of these numbers: it's
gated behind `__DEV__ && 'handdebug' in query`, so it tree-shakes to nothing
in a production build regardless of whether this feature ships.

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

**Real result, shipped configuration** (`test-results/hand-occlusion/`):

```json
{ "occluderPixels": 18057, "meshPixels": 17812, "overlapPixels": 17800, "iou": 0.985 }
```

17,800 of the mesh's 17,812 silhouette pixels (99.9%) are covered, and
`occluderPixels` is now within 1.4% of `meshPixels` (was 33% larger with the
lathe+box+forearm baseline) — the shape doesn't just cover the real hand, it
barely over-covers it anymore. `mesh-only.png`, `occluder-only.png` and
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
- **`renderOrder`, RESOLVED, and the earlier reasoning here was wrong.**
  "Ordinary depth testing should just work" is false for a `colorWrite:false`
  occluder specifically: color and depth are separate buffers, and a draw
  that never writes color can only ever *prevent* a later draw from painting
  (by winning the depth test first), it can never undo a color a farther,
  earlier draw already committed. Confirmed by building a real object in
  front of a real decoy in the actual game scene: at the default renderOrder
  (tied with everything else, the original bug's exact condition) the decoy
  stayed fully visible, only forcing the occluder to draw first fixed it.
  Shipped as `HandOccluder.ts`'s `OCC_ORDER = -20` (strictly before
  `Hole.ts`'s own `-10`, since a real hand is the frontmost thing this game
  ever draws). See `tests/hand-occlusion-scene.spec.ts`,
  `tests/hand-occlusion-plain*.spec.ts`, and
  `tests/hand-occlusion-minimal.spec.ts` (the last one reproduces the bug and
  its fix on an empty scene with no XR at all, the clearest of the four).
- **No pass/fail threshold set** on the IoU, the spec only asserts both masks
  are non-empty, so a future regression that silently breaks joint tracking
  still fails loudly, but a smaller, real drop in quality would not. 0.985 on
  the default pose is a reasonable candidate floor, but see the next item,
  it's not the whole picture.
- **Curled poses visibly protrude past the real hand's silhouette, found,
  not yet fixed.** `tests/hand-occlusion-poses.spec.ts` measures IoU across
  `relaxed`/`pinch`/`point` (IWER's built-in poses): 0.985 / 0.987 / 0.982,
  barely moves, but the screenshots show real damage the aggregate number
  hides. `point` (fist + one extended finger) produces a chaotic, spiky
  cyan mass sticking out well past the real hand's curled fingers; `pinch`
  shows a clear rightward offset at the fingertips. Root cause: `boneMatrix()`
  scales ONE shared unit `CapsuleGeometry(1,1,2,6)` non-uniformly per
  instance by `(avgRadius, length, avgRadius)`. That stretches the rounded
  end caps along with the cylinder, since they're baked into the same mesh,
  not a separate part. Two adjacent segments at a sharp bend have different
  lengths, so their caps are stretched by different amounts and don't blend
  where they meet. More polygon segments (see the next bullet) only smooths
  the facets, not this stretch.
  - **Candidate fix, not yet built: uniformly-scaled spheres at internal
    joints.** One instanced sphere per joint (not just the existing
    `debug`-only markers, promoted to the real, always-invisible occlusion
    set), scaled uniformly by that joint's own radius so it doesn't inherit
    the stretch, sitting exactly where two bone capsules meet and covering
    the seam. Reuses the same `InstancedPool`/`SphereGeometry` machinery
    `debug` mode already has. Cost: one instance per covered joint per hand,
    real but small, not measured.
  - **Reconsider the lathe profile, the earlier ablation compared shapes,
    not smoothing quality.** The capsule won on size and on the one
    `relaxed`-pose IoU number (see "Byte cost"), but that comparison never
    exercised a curled pose. Worth another look now that this file has a
    real per-pose regression tool, not a reason to assume the original call
    was wrong.
- **`radialSegments`/`capSegments` are low (6/6), cosmetic only, but cheap
  to raise.** This is why the occluder looks faceted/"pointy" in every
  `debug`/`?occluder=visible` screenshot in this doc and in the test
  attachments. Doesn't affect real occlusion (invisible in production, and
  IoU is already high with this shape) or shipped bytes (procedural args,
  not baked vertex data), purely how it reads when made visible for
  debugging. Untouched so far because nobody asked for smoother debug
  visuals specifically.
- **Capsule radius could widen with joint velocity, proposed, not built.**
  The idea: a fast-moving hand's tracked position lags the real hand
  (tracking latency), so widening the occluder just as it accelerates would
  give a safety margin against the real hand "outrunning" its own occluder.
  `HandSource.poll()` already computes exactly this kind of velocity (a
  position delta over dt) for whack detection, so the math isn't new,
  only applying it per-joint here is. Needs a previous-position value per
  joint per hand to diff against each frame, a private array on
  `HandOccluder` (matching this file's existing `_a`/`_b` scratch-object
  convention) is the natural place, not `Object3D.userData` (that's
  per-object, and every bone shares one `InstancedMesh`, so there's no
  single object to hang per-instance state off of).
- **An interactive occluder editor, proposed, not built.** Finding the
  right occluder shape has taken a whole ablation table already (see "Byte
  cost") and is clearly not settled (see the two items above). A `__DEV__`
  dev route with live sliders for shape/segments/renderOrder/material,
  showing the real IoU number update as you drag, would make trying the
  next idea (or re-trying the lathe) a live experiment instead of a new
  round of hand-written scratch scripts. `lil-gui` is already an installed
  devDependency and currently unused (`knip` confirms zero live call sites),
  built for exactly this.
- **64 B still over budget** in aggressive mode (13,376 B), see "Byte cost"
  above and `.doc/SIZE-AUDIT.md` for the current, authoritative number (it
  moves as other work lands; don't trust the number in this file over that
  one).
- **TODO: make sure text never gets occluded.** `OCC_ORDER = -20` now makes
  the hand occluder draw before nearly everything else in the scene, winning
  the depth test against anything at the same or farther depth. Not checked:
  whether HUD/world text (score, timer, HI, the `+N` popups) can end up
  behind a real hand's depth and read as clipped or missing. Not built,
  not measured.

## Where else could more bytes come from?

Not chased further in this spike (out of scope for a hand-occlusion doc), but
worth naming since they're the obvious next places to look, roughly in order
of expected size: `pack:aggressive` itself already trims ~370 B by letting
Closure rename/delete our own dead code — if this ships, re-running
`npm run deadcode` (restored on `spike/deadcode-tool` after being tried,
reviewed, and quietly lost on an unmerged branch — see that branch's own
commit for the story) would be the natural next lever, followed by the same
kind of one-change ablation done here applied to the rest of the audio/state
code, not just this feature.

## Recommendation

Ship this shape if the feature ships at all: the ablation above is
unambiguous (every change was smaller **and** measurably more accurate, never
a trade-off), it needs no WebXR features Quest doesn't already grant this
game, and it now has a repeatable, automated regression test with real
screenshots. Before shipping: check the current budget against
`.doc/SIZE-AUDIT.md` (this feature's own 64 B gap has since moved, see "Byte
cost" above), verify on a real device that occlusion actually looks right against real
passthrough (not just against a reference mesh), and weigh it against the
other two byte-budget options (light estimation, the bitmap font) — this is
the one with a verified, working effect on the *thing this game is actually
about* (a whack-a-mole hand), which the other two don't touch.
