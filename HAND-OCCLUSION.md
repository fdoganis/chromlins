# Real-hand occlusion — research + prototype

Spike branch. `HandOccluder` is a real, tsc-clean, unit-tested class, but it
is **not wired into `Game.ts`/`InputManager`** and has never run in a real or
emulated XR session. This is a feasibility prototype, not a shipped feature.

## The problem

In AR passthrough, a virtual object should disappear behind the player's real
hand when the hand is physically in front of it. WebXR's own answer to this,
Depth Sensing, is real but coarse: a 320x320 depth map per eye (about one
texel per 8 screen pixels on a Quest 3 eye buffer), reliable out to about 4m
and specifically **worse at close range** — exactly hand distance. Reported
directly: it "won't pick up details like the spaces between your fingers"
([uploadvr.com](https://www.uploadvr.com/quest-3-depth-api-mixed-reality-dynamic-occlusion/),
[blog.learnxr.io](https://blog.learnxr.io/xr-development/quest-3-mixed-reality-with-meta-depth-api-new-occlusion-features)).
This matches the premise for this spike: depth sensing alone won't cleanly
hide a virtual object behind moving fingers. (This project already had a
`depthSensing` config once; it was removed as dead code before ever
exercising a real session — see `.doc/DECISIONS.md`'s D2 — so that removal is
not itself evidence either way, just why there's nothing to build on there.)

The alternative: don't rely on the environment's depth at all. Draw the
hand's own tracked skeleton, invisibly, with real depth writes. Any virtual
object behind that depth gets normally z-buffer-culled, same as if the hand
were a real occluding surface, because as far as the GPU is concerned it now
is one.

## The technique

**No hand model, no mesh asset — geometric primitives only**, per the
request. WebXR's Hand Input API gives 25 named joints per hand
([spec](https://www.w3.org/TR/webxr-hand-input-1/)), each with a world pose
**and a `radius`** — literally "how thick is the hand here", meant for exactly
this ([`XRJointPose.radius`](https://developer.mozilla.org/en-US/docs/Web/API/XRJointPose/radius)).
three.js already surfaces this without extra plumbing: `WebXRController.js`
sets `joint.jointRadius = jointPose.radius` on every tracked joint `Object3D`
each frame (confirmed by reading `node_modules/three/src/renderers/webxr/WebXRController.js`
directly), and `renderer.xr.getHand(n).joints[name]` is already how this
codebase reads hand joints (`HandSource.ts`). No new session features, no new
per-frame API calls: the occluder reads the exact same joints and radii three
is already populating for the existing whack-detector.

**Shape: a lathed "phalanx", not a uniform capsule.** A real finger segment
tapers from knuckle to tip; a uniform-radius `CapsuleGeometry` doesn't. The
technique (and its `absarc`/`absarc` two-arc profile math) is
[prisoner849's](https://discourse.threejs.org/u/prisoner849) three.js forum
CodePen, `https://codepen.io/prisoner849/pen/qBaNKNM` (CC BY-SA, per CodePen's
default license): build one small 2D profile — an arc of radius `R` at the
base, an arc of radius `r = R*0.85` at the tip, joined at the angle that makes
them meet smoothly — and revolve it with `LatheGeometry` into one tapered,
rounded-cap solid. The original pen also chains these through a real
`Object3D` parent hierarchy with hand-authored bend angles, for an animated
demo hand; that part doesn't apply here; we have a **real** tracked skeleton,
so each bone's transform comes from two real joint poses instead.

Independent confirmation this is the right general shape: a
[MuJoCo/WebXR hand-rendering PR](https://github.com/ttktjmt/mjswan/pull/114)
does the same thing — capsules between adjacent WebXR joints, sized by joint
radius, no hand mesh — for a physics-hand use case. Two unrelated projects
converging on "capsule/lathe segments between real joint poses, sized by
`jointRadius`" is a good sign it's the natural shape for this data, not just
one person's aesthetic choice.

## What's built (`src/world/HandOccluder.ts`, `src/world/handBones.ts`)

- `handBones.ts` — pure math, no InstancedPool/scene/session, so it's testable
  in plain Node (`tests/unit/hand-occluder.test.mjs`, 4 tests): `BONES`, the 24
  joint-pairs-per-hand list (4 segments each for the four fingers + 3 for the
  thumb + 5 wrist-to-metacarpal segments for palm coverage), and
  `boneMatrix(a, b, radiusA, radiusB)`, the instance matrix for one bone
  (midpoint position, local +Y aligned to the bone direction, non-uniform
  scale from length and average radius), or `null` for two coincident joints.
- `HandOccluder.ts` — the WebXR-facing class. One shared unit lathe geometry
  (`createPhalanxGeometry`), one `MeshBasicMaterial({ colorWrite: false })`
  (the exact convention `Hole.ts` already uses for the AR pit illusion), one
  `InstancedPool` (the same allocator Sparkles/VoxelTextEngine already use)
  sized to `hands.length * BONES.length` and allocated **once, for the
  occluder's lifetime** — a fixed, known instance count, never grown or
  shrunk per frame, matching this project's "at most N live objects, built
  once" convention. `update()` reads each bone's two joints; an untracked or
  invisible joint zero-scales that instance for the frame (`ZERO_SCALE_MATRIX`,
  the same pattern `InstancedPool.free()` already uses) rather than trying to
  hide/show instances.

## What's not done, on purpose

- **Not wired into `Game.ts`/`InputManager`/`RenderingManager`.** Nothing
  calls `new HandOccluder(...)` or its `update()` from the running game.
- **Never run in a session, real or emulated.** `boneMatrix`'s math is
  unit-tested; the class around it (`InstancedPool`, real `XRHandSpace`
  joints) is not, because that needs a live hand-tracking session (a real
  device, or IWER driving hand joints the way `tests/whack.spec.ts` already
  does for `HandSource` — the same harness could plausibly drive this too, not
  attempted here).
- **`renderOrder` and blending against the rest of the scene, unverified.**
  Unlike `Hole.ts`'s occluder (which needs an artificially early `renderOrder`
  to fake depth where there IS no real depth), a hand occluder represents
  *real* depth, so ordinary depth testing at default render order should be
  correct — but that's reasoning, not a measurement on a device with real
  passthrough and real virtual objects sharing the frame.
- **Byte cost unmeasured.** `LatheGeometry`, `Path`, and the new module are
  real shipped code if wired in; no pack/zip measurement has been done.
- **Doesn't need a solved iOS/Android story to be useful.** Unlike light
  estimation, this only makes sense where hand-tracking already exists (Quest
  today), so it doesn't inherit LIGHT-ESTIMATION.md's cross-platform question.

## Recommendation

Worth pursuing further: the technique is sound, sourced from working prior
art, needs no new WebXR features Quest doesn't already grant this game, and
reuses machinery already in the codebase (`InstancedPool`, the joint data
`HandSource` already reads). The concrete next steps, in order, before this is
a real feature: wire it in behind a flag, drive it with IWER the way
`tests/whack.spec.ts` does, verify visually with a real device (passthrough +
a virtual object placed to intersect a hand), then measure the packed byte
cost.
