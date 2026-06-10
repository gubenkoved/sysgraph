/// <reference types="vite/client" />

/**
 * Build-time constant injected by Vite (`define` in vite.config.ts).
 * When true the UI runs in standalone mode and never contacts the backend.
 */
declare const __STANDALONE__: boolean;

/**
 * three.js ships no type declarations and `@types/three` is not installed, so
 * declare it as an untyped module. The 3D renderer uses it only for a few small
 * scene objects (e.g. the pinned-node spike marker) via runtime casts.
 */
declare module 'three';
