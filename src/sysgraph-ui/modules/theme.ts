import { EVT_THEME_CHANGED } from './constants.js';
import { emit } from './event-bus.js';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'sysgraph:theme';
const DEFAULT_THEME: Theme = 'light';

let currentTheme: Theme = DEFAULT_THEME;

function readStoredTheme(): Theme {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        return raw === 'dark' || raw === 'light' ? raw : DEFAULT_THEME;
    } catch (error) {
        console.warn('failed to read theme from localStorage:', error);
        return DEFAULT_THEME;
    }
}

function persistTheme(theme: Theme): void {
    try {
        window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {
        console.warn('failed to persist theme to localStorage:', error);
    }
}

function applyTheme(theme: Theme): void {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
}

/** Returns the currently active theme. */
export function getTheme(): Theme {
    return currentTheme;
}

/**
 * Sets the active theme, applies it to the document, persists the choice and
 * notifies listeners via EVT_THEME_CHANGED.
 */
export function setTheme(theme: Theme): void {
    currentTheme = theme;
    applyTheme(theme);
    persistTheme(theme);
    emit(EVT_THEME_CHANGED, theme);
}

/** Toggles between light and dark themes. */
export function toggleTheme(): Theme {
    const next: Theme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    return next;
}

/**
 * Reads the persisted theme and applies it to the document without emitting an
 * event. Call once at startup before the UI is wired up.
 */
export function initTheme(): void {
    currentTheme = readStoredTheme();
    applyTheme(currentTheme);
}
