import { settings, createDefaultSettings } from './settings.js';

const STORAGE_KEY = 'sysgraph:settings-presets';
const STORAGE_VERSION = 1;

/** @typedef {typeof settings} SettingsSnapshot */
/** @typedef {{ version: number, presets: Record<string, unknown> }} SettingsPresetStore */

/**
 * @param {unknown} value
 * @returns {any}
 */
function cloneJsonValue(value) {
    return JSON.parse(JSON.stringify(value));
}

/** @returns {SettingsPresetStore} */
function createEmptyStore() {
    return {
        version: STORAGE_VERSION,
        presets: {},
    };
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObjectRecord(value) {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** @returns {SettingsPresetStore} */
function readPresetStore() {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return createEmptyStore();
        }

        const parsed = JSON.parse(raw);
        if (!isObjectRecord(parsed) || !isObjectRecord(parsed.presets)) {
            return createEmptyStore();
        }

        return {
            version: STORAGE_VERSION,
            presets: parsed.presets,
        };
    } catch (error) {
        console.warn('failed to read settings presets from localStorage:', error);
        return createEmptyStore();
    }
}

/**
 * @param {SettingsPresetStore} store
 */
function writePresetStore(store) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        presets: store.presets,
    }));
}

/** @returns {SettingsSnapshot} */
function snapshotSettings() {
    return cloneJsonValue(settings);
}

/**
 * @param {any} target
 * @param {any} source
 * @param {boolean} deleteMissingKeys
 */
function applyObjectInPlace(target, source, deleteMissingKeys) {
    if (deleteMissingKeys) {
        for (const key of Object.keys(target)) {
            if (!(key in source)) {
                delete target[key];
            }
        }
    }

    for (const [key, value] of Object.entries(source)) {
        const currentValue = target[key];

        if (isObjectRecord(currentValue) && isObjectRecord(value)) {
            applyObjectInPlace(currentValue, value, true);
            continue;
        }

        target[key] = cloneJsonValue(value);
    }
}

export function listSettingsPresetNames() {
    return Object.keys(readPresetStore().presets).sort((left, right) => {
        return left.localeCompare(right);
    });
}

/**
 * @param {string} name
 */
export function saveSettingsPreset(name) {
    const store = readPresetStore();
    store.presets[name] = snapshotSettings();
    writePresetStore(store);
}

/**
 * @param {string} name
 */
export function deleteSettingsPreset(name) {
    const store = readPresetStore();
    if (!(name in store.presets)) {
        throw new Error(`Preset not found: ${name}`);
    }

    delete store.presets[name];
    writePresetStore(store);
}

/**
 * @param {string} name
 * @returns {SettingsSnapshot | null}
 */
export function getSettingsPreset(name) {
    const store = readPresetStore();
    const preset = store.presets[name];
    return preset ? cloneJsonValue(preset) : null;
}

/**
 * @param {string} name
 */
export function applySettingsPreset(name) {
    const preset = getSettingsPreset(name);
    if (!preset) {
        throw new Error(`Preset not found: ${name}`);
    }

    applyObjectInPlace(settings, preset, false);
}

export function resetSettingsToDefaults() {
    applyObjectInPlace(settings, createDefaultSettings(), true);
}