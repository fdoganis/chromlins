// Unicorn groom studio — a standalone dev page, NOT imported by src/ (zero
// bundle impact; `chain` stays DCE'd in a spring build). Run: `npm run groom`.
//
// Design the S-curve mane here: orbit the model, drag any Unicorn.tune value,
// copy the result back into the defaults in src/world/Unicorn.ts. The light rig
// + tone mapping mirror src/rendering/RenderingManager.ts, and `view` has FOV
// presets — a wide lens close up spreads a yaw fan, so judge backFan/foreFan
// through the lens you'll ship on (the headset is ~100° H; see D11 / the
// gamma-webxr-fov memory).
//
// Default view is the whole floating body (design the full drape). `sim → in
// hole` is the reality check: the unicorn only PEEKS from a hole in the game,
// so most of the body — and the mane draping past the rim — is hidden in the
// pit. That toggle drops it to PEEK_Y_m inside a real Hole (same
// colorWrite:false occluder), so you see what actually shows in-game.
import {
  Scene, Color, PerspectiveCamera, WebGLRenderer, HemisphereLight,
  DirectionalLight, Mesh, CapsuleGeometry, MeshBasicMaterial, RingGeometry,
  DoubleSide, Vector3, Clock, Group, GridHelper, NeutralToneMapping, SRGBColorSpace,
} from 'three';
import { BODY_HALF_m, PEEK_Y_m } from '../../src/world/Actor';
import { Hole } from '../../src/world/Hole';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { Unicorn } from '../../src/world/Unicorn';

const scene = new Scene();
scene.background = new Color(0x1a1c22);
scene.scale.setScalar(3); // the model is ~0.2 m — blow it up for close inspection

const camera = new PerspectiveCamera(75, innerWidth / innerHeight, 0.01, 20); // 75 = the game's desktop-preview FOV; `view` folder has presets
camera.position.set(0.32, 0.16, 0.6);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = NeutralToneMapping;   // 1:1 with RenderingManager
renderer.outputColorSpace = SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// light rig — 1:1 with src/rendering/RenderingManager.ts
const hemi = new HemisphereLight(0xffffff, 0xffffff, 0.45);
hemi.position.set(0, 3, 0);
scene.add(hemi);
const key = new DirectionalLight(0xffffff, 4);
key.position.set(1.3, 2.2, 1.0);
scene.add(key);
const fill = new DirectionalLight(0xffffff, 0.8);
fill.position.set(2, 2, 4);
scene.add(fill);
const rim = new DirectionalLight(0xffffff, 0.6); // faint cool back rim
rim.color.setHSL(0.58, 0.35, 0.6);
rim.position.set(-1, -1, -2);
scene.add(rim);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.03, 0);
orbit.update();

// floor reference at the unicorn's "table" height (capsule bottom)
const grid = new GridHelper(0.5, 10, 0x445566, 0x223344);
grid.position.y = -BODY_HALF_m;
scene.add(grid);

// the peek view: a real Hole (dark pit + brim) PLUS a big colorWrite:false ring
// standing in for the game's continuous board sheet — in-game the 8 brims fuse
// into one occluder, so a strand draping past its own hole's edge is clipped.
// Without this, groom shows strands the game hides.
const holeGroup = new Group();
scene.add(holeGroup);
new Hole(holeGroup, 0, 0);
const boardOcc = new Mesh(
  new RingGeometry(0.056, 0.6, 48).rotateX(-Math.PI / 2),
  new MeshBasicMaterial({ colorWrite: false, side: DoubleSide }),
);
boardOcc.position.y = -0.002;
boardOcc.renderOrder = -10;
holeGroup.add(boardOcc);

// the capsule the mane must not enter (BODY_R_m 0.045, BODY_LEN_m 0.11) — off
// by default (the body mesh already shows the volume); on for a crisp boundary
const cage = new Mesh(
  new CapsuleGeometry(0.045, 0.11, 4, 16),
  new MeshBasicMaterial({ color: 0x556677, wireframe: true }),
);
cage.visible = false;
scene.add(cage);

// a shared look: ?u=<base64 of Unicorn.tune> — merge it before the first build
const shared = new URLSearchParams(location.search).get('u');
if (shared) {
  try {
    const t = JSON.parse(atob(shared));
    for (const k of ['mane', 'horn', 'face'] as const) if (t[k]) Object.assign(Unicorn.tune[k], t[k]);
  } catch { /* bad param — ignore */ }
}

const sim = { inHole: false, ySpeed: 0, playback: false, hold: false, cage: false };

let uni: Unicorn;
function rebuild() {
  if (uni) scene.remove(uni.mesh);
  Unicorn.rebuildGeo();
  uni = new Unicorn(scene);
  uni.mesh.visible = true;
  uni.recolor('#f3ead7');
  placeUnicorn();
}
// in-hole = the game's peek: centre at PEEK_Y_m, the occluder hides the pit, and
// the camera drops to the game's ~30°-down look (the occlusion is angle-
// dependent). off = whole body floating, near-level, for full-drape design.
function placeUnicorn() {
  uni.mesh.position.set(0, sim.inHole ? PEEK_Y_m : 0, 0);
  holeGroup.visible = sim.inHole;
  grid.visible = !sim.inHole;
  if (sim.inHole) { camera.position.set(0, 0.5, 0.62); orbit.target.set(0, -0.02, 0); }
  else { camera.position.set(0.32, 0.16, 0.6); orbit.target.set(0, 0.03, 0); }
  orbit.update();
}
rebuild();

const shareURL = () => `${location.origin}${location.pathname}?u=${btoa(JSON.stringify(Unicorn.tune))}`;

const gui = new GUI({ title: 'unicorn groom' });

const view = gui.addFolder('view');
const fovC = view.add(camera, 'fov', 30, 110, 1).onChange(() => camera.updateProjectionMatrix());
for (const [label, v] of [['preview 55°', 55], ['game desktop 75°', 75], ['headset ~95°', 95]] as const)
  view.add({ [label]: () => fovC.setValue(v) }, label);

const sf = gui.addFolder('sim');
sf.add(sim, 'inHole').name('in hole (peek — check what shows in-game)').onChange(placeUnicorn);
sf.add(sim, 'playback').name('rise/sink playback'); // oscillates ySpeed so the spring mane cycles
sf.add(sim, 'ySpeed', -3, 3, 0.1).name('rise/sink kick (manual)');
sf.add(sim, 'hold').name('hold still (to orbit the back)'); // off = faces you, like in-game
sf.add(sim, 'cage').name('capsule cage').onChange((v: boolean) => { cage.visible = v; });
sf.add({ json: () => navigator.clipboard?.writeText(JSON.stringify(Unicorn.tune, null, 2)) }, 'json').name('copy tune JSON');
sf.add({ url: () => navigator.clipboard?.writeText(shareURL()) }, 'url').name('copy share URL'); // paste into groom, or the game as ?tweak&u=…
sf.add({ reset: () => { location.href = location.pathname; } }, 'reset').name('reset (reload, drops ?u=)');

const bind = (obj: Record<string, number>, name: string) => {
  const f = gui.addFolder(name);
  for (const k of Object.keys(obj)) f.add(obj, k).onFinishChange(rebuild);
};
bind(Unicorn.tune.mane as unknown as Record<string, number>, 'mane');
bind(Unicorn.tune.horn as unknown as Record<string, number>, 'horn');
bind(Unicorn.tune.face as unknown as Record<string, number>, 'face');

const clock = new Clock();
const camPos = new Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  camera.getWorldPosition(camPos);
  const ys = sim.playback ? Math.sin(clock.elapsedTime * 2.2) * 2.5 : sim.ySpeed;
  uni.animate(dt, ys, camPos);
  if (sim.hold) uni.mesh.rotation.y = 0; // animate() yaws to face camPos (like in-game); pin it to orbit the back
  orbit.update();
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// handles for tests/automation to drive the studio (dev page only)
Object.assign(window as unknown as Record<string, unknown>, { groom: { sim, camera, placeUnicorn, rebuild, get uni() { return uni; } } });
