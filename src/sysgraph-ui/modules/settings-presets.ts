import type { SettingsShape } from './settings.js';
import { createDefaultSettings, settings } from './settings.js';

const STORAGE_KEY = 'sysgraph:settings-presets';
const STORAGE_VERSION = 1;

export type SettingsSnapshot = SettingsShape;
export type PresetSource = 'predefined' | 'user';

export interface PresetEntry {
    name: string;
    source: PresetSource;
}

interface SettingsPresetStore {
    version: number;
    presets: Record<string, unknown>;
}

/**
 * Predefined (built-in) presets. Keys are preset names, values are partial
 * overrides applied on top of {@link createDefaultSettings}.
 */
const PREDEFINED_PRESETS: [string, Partial<SettingsSnapshot>][] = [
    ['default', {}],
    ['simple', {
        nodeLabelMode: 'expression',
        nodeLabelExpression: '(properties.name || properties.label) || (type + " " + id)',
    }],
];

function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function createEmptyStore(): SettingsPresetStore {
    return {
        version: STORAGE_VERSION,
        presets: {},
    };
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
    return value != null && typeof value === 'object' && !Array.isArray(value);
}

function readPresetStore(): SettingsPresetStore {
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) {
            return createEmptyStore();
        }

        const parsed: unknown = JSON.parse(raw);
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

function writePresetStore(store: SettingsPresetStore): void {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: STORAGE_VERSION,
        presets: store.presets,
    }));
}

function snapshotSettings(): SettingsSnapshot {
    return cloneJsonValue(settings);
}

function applyObjectInPlace(
    target: Record<string, unknown>,
    source: Record<string, unknown>,
    deleteMissingKeys: boolean,
): void {
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

export function listSettingsPresetNames(): string[] {
    return Object.keys(readPresetStore().presets).sort((left, right) => {
        return left.localeCompare(right);
    });
}

/**
 * Returns all presets (predefined + user) as an ordered list.
 * Predefined presets come first (in definition order), then user presets
 * sorted alphabetically.
 */
export function listAllPresets(): PresetEntry[] {
    const entries: PresetEntry[] = [];

    for (const [name] of PREDEFINED_PRESETS) {
        entries.push({ name, source: 'predefined' });
    }

    const userNames = listSettingsPresetNames();
    for (const name of userNames) {
        entries.push({ name, source: 'user' });
    }

    return entries;
}

export function saveSettingsPreset(name: string): void {
    const store = readPresetStore();
    store.presets[name] = snapshotSettings();
    writePresetStore(store);
}

export function deleteSettingsPreset(name: string): void {
    const store = readPresetStore();
    if (!(name in store.presets)) {
        throw new Error(`Preset not found: ${name}`);
    }

    delete store.presets[name];
    writePresetStore(store);
}

export function getSettingsPreset(name: string): SettingsSnapshot | null {
    const store = readPresetStore();
    const preset = store.presets[name];
    return preset ? cloneJsonValue(preset as SettingsSnapshot) : null;
}

/**
 * Builds a full settings snapshot for a predefined preset by applying its
 * partial overrides on top of freshly-created default settings.
 */
export function getPredefinedPreset(name: string): SettingsSnapshot | null {
    const entry = PREDEFINED_PRESETS.find(([n]) => n === name);
    if (!entry) {
        return null;
    }

    const base = createDefaultSettings();
    Object.assign(base, cloneJsonValue(entry[1]));
    return base;
}

export function applySettingsPreset(name: string, source: PresetSource): void {
    const preset = source === 'predefined'
        ? getPredefinedPreset(name)
        : getSettingsPreset(name);

    if (!preset) {
        throw new Error(`Preset not found: ${name} (${source})`);
    }

    applyObjectInPlace(settings as unknown as Record<string, unknown>, preset as unknown as Record<string, unknown>, false);
}

export function resetSettingsToDefaults(): void {
    applyObjectInPlace(
        settings as unknown as Record<string, unknown>,
        createDefaultSettings() as unknown as Record<string, unknown>,
        true,
    );
}
