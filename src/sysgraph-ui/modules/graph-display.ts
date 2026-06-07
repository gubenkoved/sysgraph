/**
 * Persistence + reconciliation policy for graph-embedded display settings.
 *
 * A loaded graph may carry a top-level `display` block (a partial settings
 * override). This module records the user's preference for how such embedded
 * settings reconcile with their own settings:
 *   - 'apply'  → embedded display overrides current settings on every load
 *   - 'ask'    → prompt before applying (non-blocking toast with an action)
 *   - 'ignore' → never apply embedded display
 */

export type GraphDisplayMode = 'apply' | 'ask' | 'ignore';

export const GRAPH_DISPLAY_MODES: GraphDisplayMode[] = ['apply', 'ask', 'ignore'];

const STORAGE_KEY = 'sysgraph:graph-display-mode';
const DEFAULT_MODE: GraphDisplayMode = 'apply';

function isGraphDisplayMode(value: unknown): value is GraphDisplayMode {
    return value === 'apply' || value === 'ask' || value === 'ignore';
}

let currentMode: GraphDisplayMode = readStoredMode();

function readStoredMode(): GraphDisplayMode {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return isGraphDisplayMode(raw) ? raw : DEFAULT_MODE;
    } catch (error) {
        console.warn('failed to read graph-display mode from localStorage:', error);
        return DEFAULT_MODE;
    }
}

/** Returns the active reconciliation mode for graph-embedded display settings. */
export function getGraphDisplayMode(): GraphDisplayMode {
    return currentMode;
}

/** Sets and persists the reconciliation mode. */
export function setGraphDisplayMode(mode: GraphDisplayMode): void {
    currentMode = mode;
    try {
        window.localStorage.setItem(STORAGE_KEY, mode);
    } catch (error) {
        console.warn('failed to persist graph-display mode to localStorage:', error);
    }
}
