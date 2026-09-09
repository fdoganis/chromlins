// Unicorn groom studio — a standalone dev page, NOT imported by src/ (zero
// bundle impact; `chain` stays DCE'd in a spring build). Run: `npm run groom`.
//
// Design the S-curve mane here: orbit the model, drag any Unicorn.tune value,
// press "copy Unicorn.tune JSON" and paste the result back into the defaults in
// src/world/Unicorn.ts. The wireframe capsule is the volume the mane must stay
// out of (Unicorn.tune.mane.margin).
import {
  Scene, Color, PerspectiveCamera, WebGLRenderer, HemisphereLight,
  DirectionalLight, Mesh, CapsuleGeometry, MeshBasicMaterial, Vector3, Clock,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import { Unicorn } from '../../src/world/Unicorn';

const scene = new Scene();
scene.background = new Color(0x1a1c22);
scene.scale.setScalar(3); // the model is ~0.2 m — blow it up for close inspection

const camera = new PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 20);
camera.position.set(0.35, 0.18, 0.7);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

scene.add(new HemisphereLight(0xffffff, 0xffffff, 0.5));
const key = new DirectionalLight(0xffffff, 3);
key.position.set(1.3, 2.2, 1.0);
scene.add(key);
const fill = new DirectionalLight(0xffffff, 0.7);
fill.position.set(2, 2, 4);
scene.add(fill);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.target.set(0, 0.03, 0);
orbit.update();

// the capsule the mane must not enter (BODY_R_m 0.045, BODY_LEN_m 0.11)
scene.add(new Mesh(
  new CapsuleGeometry(0.045, 0.11, 4, 16),
  new MeshBasicMaterial({ color: 0x556677, wireframe: true }),
));

let uni: Unicorn;
function rebuild() {
  if (uni) scene.remove(uni.mesh);
  Unicorn.rebuildGeo();
  uni = new Unicorn(scene);
  uni.mesh.visible = true;
  uni.mesh.position.set(0, 0, 0);
  uni.recolor('#f3ead7');
}
rebuild();

const gui = new GUI({ title: 'unicorn groom' });
const sim = { ySpeed: 0, faceCamera: false };
const sf = gui.addFolder('sim');
sf.add(sim, 'ySpeed', -3, 3, 0.1).name('rise/sink kick');
sf.add(sim, 'faceCamera').name('face camera');
sf.add({ copy: () => navigator.clipboard?.writeText(JSON.stringify(Unicorn.tune, null, 2)) }, 'copy').name('copy Unicorn.tune JSON');

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
  uni.animate(dt, sim.ySpeed, camPos);
  if (!sim.faceCamera) uni.mesh.rotation.y = 0; // animate() yaws to camPos — pin it so you can orbit to the back
  orbit.update();
  renderer.render(scene, camera);
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
