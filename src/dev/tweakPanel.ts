// DEV-only live-tuning panel. Reached with `?tweak` (see Game.#buildStateMachine),
// which also drops the board in front of the camera and starts a round, like
// `?run`. Everything here is behind `if (__DEV__)` at the single import site, and
// lil-gui is a dynamic import — so this file, its imports of the knob objects,
// and lil-gui all tree-shake out of a production build (verified: `grep -c
// tweakPanel dist/index.html` → 0).
//
// The panel binds lil-gui controllers straight to the exported `*Knobs` objects
// in unicorn.ts / ghostEyes.ts / VoxelTextEngine.ts and to the live light
// objects on RenderingManager. Spring / per-frame knobs take effect immediately;
// geometry-time knobs (segment count, root offsets, eye/cheek/horn placement)
// need a respawn, wired to onFinishChange. "copy JSON" dumps the current values
// so a good set can be pasted back into the source defaults.
import type { Ctx } from '../core/Ctx';
import { maneKnobs, hornKnobs, uniFaceKnobs, rebuildHornGeo, rebuildManeGeo } from '../world/unicorn';
import { ghostEyeKnobs } from '../world/ghostEyes';
import { textKnobs } from '../text/engines/voxel/VoxelTextEngine';
import { RAINBOW } from '../core/palette';
import { devFlags } from './flags';

type Light = { color: { getHexString(): string; set(v: string): void }; intensity: number; position: { x: number; y: number; z: number } };

const CUES = ['spawn', 'hit', 'unicorn', 'win', 'over', 'tick', 'music'];
const UNICORN_HEX = '#f3ead7';

export async function openTweakPanel(ctx: Ctx): Promise<void> {
  const { render, world, audio } = ctx;
  const { default: GUI } = await import('lil-gui');
  const gui = new GUI({ title: 'gamma ?tweak' });
  const respawn = () => world.respawnActors();
  const rebuildHorn = () => { rebuildHornGeo(); respawn(); };
  const rebuildMane = () => { rebuildManeGeo(); respawn(); };

  // --- scene: orbit the camera, freeze the clock, force a body up -------------
  const scene = gui.addFolder('scene');
  const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
  const orbit = new OrbitControls(render.camera, render.renderer.domElement);
  orbit.target.set(0, 0, -0.6);
  orbit.update();
  scene.add(orbit, 'enabled').name('orbit controls');
  scene.add(devFlags, 'pauseTimer').name('pause timer');

  let uniId = -1;
  let ghostId = -1;
  const toggleBody = (id: number, spawn: (hole: number) => number): number => {
    if (id >= 0) { world.despawnActor(id); return -1; }
    const hole = world.freeHoles()[0];
    return hole == null ? -1 : spawn(hole);
  };
  scene.add({ 'toggle unicorn': () => { uniId = toggleBody(uniId, (h) => world.spawnAtHole(h, UNICORN_HEX, Infinity, -1, true)); } }, 'toggle unicorn');
  scene.add({ 'toggle ghost': () => { ghostId = toggleBody(ghostId, (h) => world.spawnAtHole(h, RAINBOW[(Math.random() * RAINBOW.length) | 0], Infinity, 0)); } }, 'toggle ghost');

  const sfx = gui.addFolder('audio');
  const cue = { bgm: 'music', sfx: 'hit' };
  sfx.add(cue, 'bgm', CUES).onChange((v: string) => audio.playBGM(v));
  sfx.add({ 'stop bgm': () => audio.stopBGM() }, 'stop bgm');
  sfx.add(cue, 'sfx', CUES);
  sfx.add({ 'play sfx': () => audio.playSFX(cue.sfx) }, 'play sfx');

  const mane = gui.addFolder('mane (spring)');
  mane.add(maneKnobs, 'stiff', 10, 300, 5);
  mane.add(maneKnobs, 'damp', 1, 30, 0.5);
  mane.add(maneKnobs, 'kick', 0, 4, 0.05);
  mane.add(maneKnobs, 'idle', 0, 0.2, 0.005);
  for (const key of ['backPitch', 'frontPitch', 'yawSplay', 'rollSplay'] as const)
    mane.add(maneKnobs, key, -1, 1, 0.02).onFinishChange(respawn);
  mane.add(maneKnobs, 'radius', 0.002, 0.016, 0.001).onFinishChange(rebuildMane);
  mane.add(maneKnobs, 'taper', 0, 1, 0.02).onFinishChange(rebuildMane);
  mane.add(maneKnobs, 'backCount', 0, 9, 1).onFinishChange(respawn);
  mane.add(maneKnobs, 'frontCount', 0, 9, 1).onFinishChange(respawn);
  mane.add(maneKnobs, 'rootY', -0.05, 0.05, 0.002).onFinishChange(respawn);
  mane.add(maneKnobs, 'rootZ', -0.06, 0.02, 0.002).onFinishChange(respawn);
  mane.add(maneKnobs, 'frontRootYFrac', 0.4, 1, 0.02).onFinishChange(respawn);
  mane.add(maneKnobs, 'frontRootZ', 0, 0.06, 0.002).onFinishChange(respawn);

  const horn = gui.addFolder('horn');
  horn.add(hornKnobs, 'turns', 0, 6, 0.1).onFinishChange(rebuildHorn);
  horn.add(hornKnobs, 'height', 0.03, 0.14, 0.005).onFinishChange(rebuildHorn);
  horn.add(hornKnobs, 'baseR', 0.008, 0.04, 0.001).onFinishChange(rebuildHorn);
  horn.add(hornKnobs, 'tiltX', -0.6, 0.8, 0.02).onFinishChange(respawn);
  horn.add(hornKnobs, 'posY', -0.05, 0.08, 0.005).onFinishChange(respawn);
  horn.add(hornKnobs, 'posZ', -0.03, 0.05, 0.005).onFinishChange(respawn);

  const face = gui.addFolder('unicorn face');
  for (const key of ['eyeX', 'eyeYFrac', 'eyeZ', 'cheekX', 'cheekYFrac', 'cheekZ', 'cheekFlat'] as const)
    face.add(uniFaceKnobs, key, -0.06, 0.08, 0.002).onFinishChange(respawn);

  const eyes = gui.addFolder('ghost eyes');
  eyes.add(ghostEyeKnobs, 'yawMax', 0, 1.6, 0.05);
  eyes.add(ghostEyeKnobs, 'range', 0, 0.02, 0.001);
  eyes.add(ghostEyeKnobs, 'spring', 20, 300, 5);
  eyes.add(ghostEyeKnobs, 'damp', 0.4, 0.98, 0.01);
  eyes.add(ghostEyeKnobs, 'kick', 0, 0.1, 0.005);
  eyes.add(ghostEyeKnobs, 'faceYFrac', 0, 1, 0.02).onFinishChange(respawn);
  eyes.add(ghostEyeKnobs, 'whiteX', 0, 0.03, 0.001).onFinishChange(respawn);
  eyes.add(ghostEyeKnobs, 'whiteZ', 0.02, 0.06, 0.001).onFinishChange(respawn);

  const text = gui.addFolder('text');
  text.add(textKnobs, 'fill', 0.3, 1, 0.02);
  text.add(textKnobs, 'floatHeight', 0, 0.2, 0.005);

  const lg = render.lights;
  if (lg) {
    const lights = gui.addFolder('lights');
    const addLight = (name: string, l: Light, maxI: number) => {
      const f = lights.addFolder(name);
      const proxy = { color: '#' + l.color.getHexString() };
      f.addColor(proxy, 'color').onChange((v: string) => l.color.set(v));
      f.add(l, 'intensity', 0, maxI, 0.05);
      return f;
    };
    addLight('hemi', lg.hemi as unknown as Light, 2);
    const sun = addLight('sun', lg.sun as unknown as Light, 8);
    sun.add(lg.sun.position, 'x', -4, 4, 0.1);
    sun.add(lg.sun.position, 'y', 0, 5, 0.1);
    sun.add(lg.sun.position, 'z', -4, 4, 0.1);
    addLight('fore', lg.fore as unknown as Light, 3);
    addLight('back', lg.back as unknown as Light, 3);
  }

  const dumpLight = (l: Light) => ({
    color: '#' + l.color.getHexString(),
    intensity: +l.intensity.toFixed(2),
    pos: [l.position.x, l.position.y, l.position.z].map((n) => +n.toFixed(2)),
  });
  gui.add({
    'copy JSON': () => {
      const all: Record<string, unknown> = { maneKnobs, hornKnobs, uniFaceKnobs, ghostEyeKnobs, textKnobs };
      if (lg) all.lights = {
        hemi: dumpLight(lg.hemi as unknown as Light), sun: dumpLight(lg.sun as unknown as Light),
        fore: dumpLight(lg.fore as unknown as Light), back: dumpLight(lg.back as unknown as Light),
      };
      navigator.clipboard?.writeText(JSON.stringify(all, null, 2));
    },
  }, 'copy JSON');
}
