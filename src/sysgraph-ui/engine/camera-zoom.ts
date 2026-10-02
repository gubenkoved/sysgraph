import type { CameraState } from './renderer.js';

// These bounds guard division and floating-point precision. The perspective
// range spans seven orders of magnitude, far beyond a useful graph view.
const MIN_DISTANCE_RATIO = 0.00001;
const MAX_DISTANCE_RATIO = 100;
const MIN_SCALE = 0.00001;
const MAX_SCALE = 100;

/** Magnification at the orbit pivot, shared by wheel, pinch, and zoom buttons. */
export function cameraMagnification(camera: CameraState): number {
    return camera.mode3d && camera.projection !== 'orthographic'
        ? camera.scale * camera.referenceDistance / camera.distance
        : camera.scale;
}

export function setCameraMagnification(camera: CameraState, requested: number): number {
    if (!Number.isFinite(requested) || requested <= 0) return cameraMagnification(camera);
    if (camera.mode3d && camera.projection !== 'orthographic') {
        const reference = Math.max(0.00001, camera.referenceDistance);
        camera.distance = Math.max(reference * MIN_DISTANCE_RATIO,
            Math.min(reference * MAX_DISTANCE_RATIO, camera.scale * reference / requested));
    } else {
        camera.scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, requested));
    }
    return cameraMagnification(camera);
}
