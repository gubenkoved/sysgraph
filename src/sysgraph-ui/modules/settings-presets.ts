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

/**
 * Returns a deep clone of the current settings (the full settings snapshot).
 * Used both for presets and for embedding display settings into a graph.
 */
export function snapshotCurrentSettings(): SettingsSnapshot {
    return snapshotSettings();
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

/**
 * Applies a graph-embedded display block onto a fresh set of default
 * settings, then commits the result. Starting from defaults (rather than the
 * current settings) makes applying a graph's display predictable: the outcome
 * depends only on the defaults and the graph's overrides, never on whatever
 * the user had configured before. Nested maps the block provides (e.g.
 * nodeColors) replace the corresponding default map.
 */
export function applyEmbeddedDisplaySettings(
    display: Record<string, unknown>,
): void {
    // start from defaults so the result is independent of current settings
    const base = createDefaultSettings() as unknown as Record<string, unknown>;
    applyObjectInPlace(base, display, false);
    applyObjectInPlace(
        settings as unknown as Record<string, unknown>,
        base,
        true,
    );
}

/**
 * Serializes the current settings snapshot to a pretty-printed JSON string.
 * The shape matches a preset value (and a graph's embedded display block), so
 * exported files interoperate with both.
 */
export function exportSettingsToJson(): string {
    return JSON.stringify(snapshotSettings(), null, 2);
}

/**
 * Parses a settings JSON file and applies it onto the current settings as a
 * partial override (so partial files are tolerated). Throws on invalid JSON or
 * a non-object payload.
 */
export function importSettingsFromJson(text: string): void {
    const parsed: unknown = JSON.parse(text);
    if (!isObjectRecord(parsed)) {
        throw new Error('settings file must contain a JSON object');
    }
    applyObjectInPlace(
        settings as unknown as Record<string, unknown>,
        parsed,
        false,
    );
}
