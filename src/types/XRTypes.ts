import type { ITransform } from './ITransform';
import type { Vector3 } from 'three';

// Three.js XR nodes satisfy IXRNode/IXRHandNode at runtime.
// Their compile-time types diverge, bridged explicitly here, once, isolated.

export type XRHandedness = 'none' | 'left' | 'right';

// Extra event names dispatched by WebXRManager at runtime
declare module 'three' {
  interface Object3DEventMap {
    connected: { data?: XRInputSource };
    disconnected: {};
    select: {};
    selectstart: {};
    selectend: {};
    squeeze: {};
    squeezestart: {};
    squeezeend: {};
    pinchstart: {};
    pinchend: {};
  }
}