import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  AmbientLight,
  HemisphereLight,
  DirectionalLight,
  Mesh,
  PlaneGeometry,
  ShadowMaterial,
  Group,
  NeutralToneMapping,
  SRGBColorSpace,
  NotEqualStencilFunc
} from 'three';
// Inline replacement for three/addons' XRButton.createButton(): unlike bare
// 'three' that helper isn't externalized to a CDN in this build, so its
// insecure-context fallback link, offerSession quick-start prompt and
// VR/AR-specific chrome this game never shows all get bundled for real. This
// keeps only what RenderingManager needs: feature-detect AR-then-VR, one
// button, start/stop.
function xrButton(renderer: WebGLRenderer, sessionInit: XRSessionInit): HTMLElement {
  const btn = document.createElement('button');
  btn.textContent = 'START XR';
  btn.disabled = true;
  Object.assign(btn.style, {
    position: 'absolute', bottom: '20px', left: 'calc(50% - 50px)', width: '100px',
    padding: '12px 6px', border: '1px solid #fff', borderRadius: '4px',
    background: 'rgba(0,0,0,0.1)', color: '#fff', font: 'normal 13px sans-serif', cursor: 'auto'
  });

  (async () => {
    let mode: XRSessionMode | undefined;
    try {
      if (await navigator.xr?.isSessionSupported('immersive-ar')) mode = 'immersive-ar';
      else if (await navigator.xr?.isSessionSupported('immersive-vr')) mode = 'immersive-vr';
    } catch { /* rejected support check: treated as unsupported below */ }
    if (!mode) { btn.textContent = 'XR NOT SUPPORTED'; return; }

    // XRButton.js quietly adds these three to whatever optionalFeatures you pass
    // it before requesting a session — three's WebXRManager.setSession() does a
    // session.requestReferenceSpace('local-floor') internally and that rejects
    // (silently, if unawaited) without 'local-floor' having been negotiated.
    const sessionOptions: XRSessionInit = {
      ...sessionInit,
      optionalFeatures: ['local-floor', 'bounded-floor', 'layers', ...(sessionInit.optionalFeatures ?? [])]
    };
    let session: XRSession | null = null;
    btn.disabled = false;
    btn.style.cursor = 'pointer';
    btn.onclick = () => {
      if (session) { session.end(); return; }
      navigator.xr!.requestSession(mode!, sessionOptions).then(async (s) => {
        session = s;
        s.addEventListener('end', () => { session = null; btn.textContent = 'START XR'; });
        await renderer.xr.setSession(s);
        btn.textContent = 'STOP XR';
      }).catch((err) => { console.warn(err); session = null; });
    };
  })();

  return btn;
}

export class RenderingManager {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  anchor: Group; // extra node useful for XR placement
  hudAnchor: Group; // child of camera, fixed position/orientation relative to the viewer, for camera-facing text
  timerAnchor: Group; // child of anchor: pinned to the placed surface, not the camera; VoxelTextEngine still billboards it to face the viewer
  scoreAnchor: Group; // child of anchor: upper-left of the rainbow, world-space
  hiAnchor: Group;    // child of anchor: upper-right — the persistent "HI ####"


  constructor() {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true, stencil: true }); // stencil: Hole.ts uses it to cut the shadow-catcher out of each pit mouth
    this.renderer.toneMapping = NeutralToneMapping; // Khronos PBR Neutral — compresses only out-of-gamut highlights, keeps hue + saturation
    this.renderer.outputColorSpace = SRGBColorSpace;

    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.xr.enabled = true;
    document.body.appendChild(this.renderer.domElement);
    // TODO: CHECK if the following line is important, and if it should rather be written in HTML / CSS
    //this.renderer.domElement.style.touchAction = 'none'; // stop the browser's own pinch/scroll competing with taps

    // hit-test is optional, not required: a device with no AR support falls
    // back to immersive-vr (XRButton's own behavior), and requiring hit-test
    // would make that fallback session request fail outright — immersive-vr
    // sessions don't support it. AnchorState already floor-places the board
    // when no hit-test source ever shows up.
    const sessionInit: XRSessionInit = {
      optionalFeatures: ['hit-test', 'hand-tracking'],
      depthSensing: { usagePreference: ['gpu-optimized'], dataFormatPreference: [] }
    };
    const btn = xrButton(this.renderer, sessionInit);
    btn.style.backgroundColor = 'skyblue';
    document.body.appendChild(btn);

    this.scene = new Scene();
    this.anchor = new Group();
    this.scene.add(this.anchor);
    this.camera = new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 10);
    this.camera.position.set(0, 1.6, 3); // NOTE: Once in XR setting the camera is pointless: your head / smartphone screen drives the camera

    this.hudAnchor = new Group();
    this.hudAnchor.position.set(0, 0.18, -1); // 1m ahead of the viewer, lifted above eye-line so it clears the board
    this.camera.add(this.hudAnchor);

    this.timerAnchor = new Group();
    this.timerAnchor.position.set(0, 0.42, -0.16); // up by the rainbow's crown
    this.anchor.add(this.timerAnchor);

    this.scoreAnchor = new Group();
    this.scoreAnchor.position.set(-0.52, 0.42, -0.15); // upper-left, outside the arc
    this.anchor.add(this.scoreAnchor);

    this.hiAnchor = new Group();
    this.hiAnchor.position.set(0.52, 0.42, -0.15); // upper-right, mirror of the score
    this.anchor.add(this.hiAnchor);

    this.renderer.shadowMap.enabled = true;

    // Low, near-neutral ambient — enough that shadowed voxel faces don't crush to
    // black, low enough that the raking key still carves visible form.
    const hemi = new HemisphereLight(0xffffff, 0xffffff, 0.45);
    hemi.position.set(0, 3, 0);
    this.scene.add(hemi);

    // Parented to anchor, not scene, so the light and its shadow follow the
    // placed board. Raked in from front-right-above (not straight down): each
    // voxel cube then shows a bright top, a mid front and a dark side — that
    // value step across faces is what makes the text legible in passthrough.
    const sun = new DirectionalLight(0xffffff, 4);
    sun.position.set(1.3, 2.2, 1.0);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); // small play area — re-renders every frame, keep it cheap
    sun.shadow.camera.top = 1.4; sun.shadow.camera.bottom = -1.4;
    sun.shadow.camera.right = 1.4; sun.shadow.camera.left = -1.4;
    sun.shadow.camera.near = 0.1; sun.shadow.camera.far = 6; // angled light sits further from the play area
    this.anchor.add(sun, sun.target);

    // Dim neutral front fill — lifts the key's shadow side a little without
    // flattening it, and stays white so it doesn't tint the voxel colors.
    const foreLight = new DirectionalLight(0xffffff, 0.8);
    foreLight.position.set(2, 2, 4);
    this.anchor.add(foreLight, foreLight.target);

    // The only rim: a faint cool light from behind/below to peel the text
    // silhouette off a dark passthrough background.
    const backLight = new DirectionalLight(0xffffff, 0.6);
    backLight.color.setHSL(0.58, 0.35, 0.6);
    backLight.position.set(-1, -1, -2);
    this.anchor.add(backLight, backLight.target);

    // Invisible: only its shadow renders, so virtual objects appear to cast a shadow
    // onto the real (passthrough) floor. Sized to comfortably cover the spawn disc.
    const catcher = new Mesh(new PlaneGeometry(2, 2), new ShadowMaterial({ opacity: 0.5 }));
    catcher.rotation.x = -Math.PI / 2;
    catcher.receiveShadow = true;
    // The catcher doesn't know holes exist, and being nearer than the deep pit
    // geometry it would otherwise always win the depth test and cap a hole's
    // opening with a translucent disc wherever a shadow crosses it (looks like
    // glass). Hole.ts marks each true opening's footprint in the stencil
    // buffer; skip drawing the catcher there. Untouched everywhere else — the
    // brim ring around a hole still shows shadows normally.
    catcher.material.stencilWrite = true;
    catcher.material.stencilFunc = NotEqualStencilFunc;
    catcher.material.stencilRef = 1;
    this.anchor.add(catcher);

    this.renderer.xr.addEventListener('sessionstart', this.#onXRStart);
    this.renderer.xr.addEventListener('sessionend', this.#onXREnd);
    window.addEventListener('resize', this.#onResize);
  }

  #depthMeshAdded = false;

  render() {
    if (!this.#depthMeshAdded) {
      const depthMesh = this.renderer.xr.getDepthSensingMesh();
      if (depthMesh) { this.scene.add(depthMesh); this.#depthMeshAdded = true; }
    }
    this.renderer.render(this.scene, this.camera);
  }

  #onXRStart = () => {
  };

  #onXREnd = () => {
  };

  #onResize = () => {
    if (this.renderer.xr.isPresenting) { return; }

    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  };

  dispose() {
    this.renderer.xr.removeEventListener('sessionstart', this.#onXRStart);
    this.renderer.xr.removeEventListener('sessionend', this.#onXREnd);
    window.removeEventListener('resize', this.#onResize);
    this.renderer.dispose();
  }
}