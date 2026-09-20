// Test-only harness for tests/audio-loudness.spec.ts. Loaded via
// page.addScriptTag({ type: 'module', url: ... }) so Vite's dev server
// resolves the bare 'three' specifier the normal way — a raw
// page.evaluate(() => import('three')) bypasses Vite's import rewriting
// entirely and fails, real <script type="module"> tags don't.
import { PerspectiveCamera, Object3D } from 'three';
import { AudioManager } from '../../src/audio/AudioManager';

declare global {
  interface Window {
    // Exercises the real, live AudioManager.attach() (not a copy of it), so
    // a future change to panningModel or SFX_BOOST is caught by
    // tests/audio-loudness.spec.ts automatically.
    __audioAttach?: () => { panningModel: PanningModelType; gain: number };
    // True if playBGM ever parents anything onto the board's origin (what a
    // PositionalAudio node would do) — the direct, behavioral way to check
    // "is BGM positional", instead of grepping AudioManager.ts's source
    // text for 'PositionalAudio'.
    __bgmIsPositional?: () => boolean;
  }
}

const origin = new Object3D();
const manager = new AudioManager(new PerspectiveCamera(), origin);

window.__audioAttach = () => {
  const pa = manager.attach(new Object3D());
  return { panningModel: pa.panner.panningModel, gain: pa.gain.gain.value };
};

window.__bgmIsPositional = () => {
  const before = origin.children.length;
  manager.playBGM('music');
  const positional = origin.children.length > before;
  manager.stopBGM();
  return positional;
};
