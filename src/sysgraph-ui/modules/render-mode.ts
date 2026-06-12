// ── render mode (2D vs 3D) ──────────────────────────────────
// Tracks whether the graph is rendered with the 2D canvas force-graph or the
// 3D (Three.js/WebGL) variant. The choice is persisted so it survives reloads.
// This module only owns the persisted value; graph-ui.ts owns the actual
// renderer (re)build, driven by setRenderMode().

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

/** Convenience predicate: true when the 3D renderer is active. */
export function is3D(): boolean {
    return currentMode === '3d';
}

/**
 * Updates the in-memory mode and persists it. Does NOT rebuild the renderer —
 * that is graph-ui.ts's responsibility (it calls this from setRenderMode()).
 */
export function persistRenderMode(mode: RenderMode): void {
    currentMode = mode;
    try {
        window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (error) {
        console.warn('failed to persist render mode to localStorage:', error);
    }
}
