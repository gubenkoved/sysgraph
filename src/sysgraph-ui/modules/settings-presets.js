import { settings, createDefaultSettings } from './settings.js';

const STORAGE_KEY = 'sysgraph:settings-presets';
const STORAGE_VERSION = 1;

/** @typedef {typeof settings} SettingsSnapshot */
/** @typedef {{ version: number, presets: Record<string, unknown> }} SettingsPresetStore */
/** @typedef {'predefined' | 'user'} PresetSource */
/** @typedef {{ name: string, source: PresetSource }} PresetEntry */

/**
 * Predefined (built-in) presets. Keys are preset names, values are partial
 * overrides applied on top of {@link createDefaultSettings}.
 *
 * @type {[string, Partial<SettingsSnapshot>][]}
 */
const PREDEFINED_PRESETS = [
    ['default', {}],
    ['simple', {
        nodeLabelMode: 'expression',
        nodeLabelExpression: '(properties.name || properties.label) || (type + " " + id)',
    }],
];

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
 * Returns all presets (predefined + user) as an ordered list.
 * Predefined presets come first (in definition order), then user presets
 * sorted alphabetically.
 *
 * @returns {PresetEntry[]}
 */
export function listAllPresets() {
    /** @type {PresetEntry[]} */
    const entries = [];

    for (const [name] of PREDEFINED_PRESETS) {
        entries.push({ name, source: 'predefined' });
    }

    const userNames = listSettingsPresetNames();
    for (const name of userNames) {
        entries.push({ name, source: 'user' });
    }

    return entries;
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
 * Builds a full settings snapshot for a predefined preset by applying its
 * partial overrides on top of freshly-created default settings.
 *
 * @param {string} name
 * @returns {SettingsSnapshot | null}
 */
export function getPredefinedPreset(name) {
    const entry = PREDEFINED_PRESETS.find(([n]) => n === name);
    if (!entry) {
        return null;
    }

    const base = createDefaultSettings();
    Object.assign(base, cloneJsonValue(entry[1]));
    return base;
}

/**
 * @param {string} name
 * @param {PresetSource} source
 */
export function applySettingsPreset(name, source) {
    const preset = source === 'predefined'
        ? getPredefinedPreset(name)
        : getSettingsPreset(name);

    if (!preset) {
        throw new Error(`Preset not found: ${name} (${source})`);
    }

    applyObjectInPlace(settings, preset, false);
}

export function resetSettingsToDefaults() {
    applyObjectInPlace(settings, createDefaultSettings(), true);
}