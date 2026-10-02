// ── render mode (2D vs 3D) ──────────────────────────────────
// Tracks the WebGPU camera projection. The choice survives reloads.

export type RenderMode = '2d' | '3d';

const STORAGE_KEY = 'sysgraph:render-mode';
const DEFAULT_MODE: RenderMode = '2d';

let currentMode: RenderMode = readStoredMode();

function readStoredMode(): RenderMode {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw === '3d' || raw === '2d' ? raw : DEFAULT_MODE;
    } catch (error) {
        console.warn('failed to read render mode from localStorage:', error);
        return DEFAULT_MODE;
    }
}

/** Returns the currently active render mode. */
export function getRenderMode(): RenderMode {
    return currentMode;
}

/** Convenience predicate: true when the 3D camera projection is active. */
export function is3D(): boolean {
    return currentMode === '3d';
}

/**
 * Updates the in-memory projection mode and persists it.
 */
export function persistRenderMode(mode: RenderMode): void {
    currentMode = mode;
    try {
        window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (error) {
        console.warn('failed to persist render mode to localStorage:', error);
    }
}
