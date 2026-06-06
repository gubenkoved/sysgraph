import type { FpsGraphBladeApi } from '@tweakpane/plugin-essentials';
import * as EssentialsPlugin from '@tweakpane/plugin-essentials';
import type { FolderApi } from 'tweakpane';
import { Pane } from 'tweakpane';
import {
    EVT_COLORS_UPDATED, EVT_CURVATURE_UPDATED,
    EVT_D3_PARAMS_CHANGED, EVT_FILTERS_UPDATED,EVT_SETTINGS_UPDATED,
} from './constants.js';
import { emit } from './event-bus.js';
import { ForceGraphInstance, pinNode, unpinNode } from './graph-ui.js';
import { setFrameHooks } from './render-hooks.js';
import type { SettingsShape } from './settings.js';
import {
    getEdgeColor,
    getEdgeWidth,
    getNodeColor,
    settings,
    sortEdgeTypes,
    sortNodeTypes,
} from './settings.js';
import type { PresetEntry, PresetSource } from './settings-presets.js';
import {
    applySettingsPreset,
    deleteSettingsPreset,
    listAllPresets,
    resetSettingsToDefaults,
    saveSettingsPreset,
} from './settings-presets.js';
import { getGraph } from './state.js';
import { showError } from './util.js';

function getRequiredElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing element: ${id}`);
    }
    return element;
}

const settingsPaneElement = getRequiredElement('settingsPane');

const pane = new Pane({
    title: 'parameters',
    container: settingsPaneElement,
});

pane.registerPlugin(EssentialsPlugin);

const presetUiState = {
    selectedPresetKey: '' as string,
};

function makePresetKey(entry: PresetEntry): string {
    return `${entry.source}:${entry.name}`;
}

function parsePresetKey(key: string): { name: string; source: PresetSource } {
    const colonIndex = key.indexOf(':');
    return {
        source: key.slice(0, colonIndex) as PresetSource,
        name: key.slice(colonIndex + 1),
    };
}

function getErrorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

// --- d3 simulation parameters (data-driven) ---
const d3RenderingSettingsFolder = pane.addFolder({ title: 'd3 forces settings', expanded: false });

const d3Params: { key: keyof SettingsShape; label: string; min: number; max: number; step: number }[] = [
    { key: 'd3Charge', label: 'charge force', min: -800, max: 100, step: 10 },
    { key: 'd3LinkDistance', label: 'link distance', min: 40, max: 500, step: 5 },
    { key: 'd3LinkStrength', label: 'link strength', min: 0.0, max: 1.0, step: 0.01 },
    { key: 'd3CollisionMultiplier', label: 'collision', min: 0.5, max: 2.0, step: 0.05 },
    { key: 'd3AlphaTarget', label: 'alpha target', min: 0.0, max: 0.5, step: 0.01 },
    { key: 'd3VelocityDecay', label: 'velocity decay', min: 0.01, max: 0.99, step: 0.01 },
    { key: 'd3ForceXYStrength', label: 'XY centering', min: 0.00, max: 0.99, step: 0.01 },
];

d3RenderingSettingsFolder.addBinding(settings as unknown as Record<string, unknown>, 'd3EnablePhysics', { label: 'enable physics' }).on('change', () => {
    emit(EVT_D3_PARAMS_CHANGED, null);
});

for (const p of d3Params) {
    d3RenderingSettingsFolder.addBinding(
        settings as unknown as Record<string, unknown>,
        p.key,
        { label: p.label, min: p.min, max: p.max, step: p.step },
    ).on('change', () => {
        emit(EVT_D3_PARAMS_CHANGED, null);
    });
}

d3RenderingSettingsFolder.addBinding(settings as unknown as Record<string, unknown>, 'd3CenterForce', { label: 'center force' }).on('change', () => {
    emit(EVT_D3_PARAMS_CHANGED, null);
});

const fpsGraph = d3RenderingSettingsFolder.addBlade({
    view: 'fpsgraph',
    label: 'fps',
    rows: 2,
    min: 0,
    max: 144,
}) as unknown as FpsGraphBladeApi;

setFrameHooks(() => fpsGraph.begin(), () => fpsGraph.end());

// --- graph display settings ---
const displayOptionsFolder = pane.addFolder({ title: 'display options', expanded: false });

displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'showIsolated', { label: 'show isolated' }).on('change', () => {
    emit(EVT_SETTINGS_UPDATED, null);
});

displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'showGrid', { label: 'show grid' }).on('change', () => {
    emit(EVT_SETTINGS_UPDATED, null);
});

displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'curvatureStep', { label: 'curvature step', min: 0.0, max: 0.200, step: 0.001 }).on('change', () => {
    emit(EVT_CURVATURE_UPDATED, null);
});

// --- label settings ---
displayOptionsFolder.addBlade({ view: 'separator' });

const nodeLabelModeBinding = displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'nodeLabelMode', {
    label: 'node label',
    view: 'list',
    options: [
        { text: 'none', value: 'none' },
        { text: 'type', value: 'type' },
        { text: 'id', value: 'id' },
        { text: 'expression', value: 'expression' },
    ],
});

const nodeLabelExpressionBinding = displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'nodeLabelExpression', {
    label: 'label expr',
});

function updateExpressionVisibility(): void {
    nodeLabelExpressionBinding.hidden = settings.nodeLabelMode !== 'expression';
}
updateExpressionVisibility();

nodeLabelModeBinding.on('change', () => {
    updateExpressionVisibility();
});

nodeLabelExpressionBinding.on('change', () => {
    // expression changes are applied live on next render
});

// --- node sizing settings ---
displayOptionsFolder.addBlade({ view: 'separator' });

const nodeSizingModeBinding = displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'nodeSizingMode', {
    label: 'node sizing',
    view: 'list',
    options: [
        { text: 'degree', value: 'degree' },
        { text: 'constant', value: 'constant' },
        { text: 'expression', value: 'expression' },
    ],
});

const nodeSizingConstantBinding = displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'nodeSizingConstant', {
    label: 'size',
    min: 1,
    max: 10,
    step: 0.5,
});

const nodeSizingExpressionBinding = displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'nodeSizingExpression', {
    label: 'size expr',
});

function updateSizingVisibility(): void {
    nodeSizingConstantBinding.hidden = settings.nodeSizingMode !== 'constant';
    nodeSizingExpressionBinding.hidden = settings.nodeSizingMode !== 'expression';
}
updateSizingVisibility();

nodeSizingModeBinding.on('change', () => {
    updateSizingVisibility();
    emit(EVT_SETTINGS_UPDATED, null);
});

nodeSizingConstantBinding.on('change', () => {
    emit(EVT_SETTINGS_UPDATED, null);
});

nodeSizingExpressionBinding.on('change', () => {
    emit(EVT_SETTINGS_UPDATED, null);
});

function syncStaticSettingsPane(): void {
    updateExpressionVisibility();
    updateSizingVisibility();
    pane.refresh();
}

const actionsFolder = pane.addFolder({ title: 'actions', expanded: true });

actionsFolder.addButton({ title: 'pin all' }).on('click', () => {
    const graphData = ForceGraphInstance.graphData();
    for (const node of graphData.nodes) {
        pinNode(node);
    }
});

actionsFolder.addButton({ title: 'unpin all' }).on('click', () => {
    const graphData = ForceGraphInstance.graphData();
    for (const node of graphData.nodes) {
        unpinNode(node);
    }
});

// --- filter panes ---
let nodeFiltersFolder: FolderApi = pane.addFolder({ title: 'node filters', expanded: false });
let edgeFiltersFolder: FolderApi = pane.addFolder({ title: 'edge filters', expanded: false });

// --- color panes ---
let nodeColorsFolder: FolderApi = pane.addFolder({ title: 'node colors', expanded: true });
let edgeColorsFolder: FolderApi = pane.addFolder({ title: 'edge colors', expanded: true });

// --- edge width pane ---
let edgeWidthsFolder: FolderApi = pane.addFolder({ title: 'edge widths', expanded: false });

// --- presets pane ---
let presetsFolder: FolderApi = pane.addFolder({ title: 'presets', expanded: true });

function updateSelectedPresetKey(keys: string[]): void {
    if (keys.length === 0) {
        presetUiState.selectedPresetKey = '';
        return;
    }

    if (!keys.includes(presetUiState.selectedPresetKey)) {
        presetUiState.selectedPresetKey = keys[0]!;
    }
}

function rebuildPresetsFolder(): void {
    const expanded = presetsFolder.expanded;
    const allPresets = listAllPresets();

    const dropdownOptions = allPresets.map((entry) => ({
        text: entry.source === 'predefined' ? `${entry.name} *` : entry.name,
        value: makePresetKey(entry),
    }));

    const allKeys = dropdownOptions.map((opt) => opt.value);
    updateSelectedPresetKey(allKeys);

    presetsFolder.dispose();
    presetsFolder = pane.addFolder({ title: 'presets', expanded });

    presetsFolder.addButton({ title: 'save' }).on('click', () => {
        const rawName = window.prompt('Preset name');
        const presetName = rawName ? rawName.trim() : '';

        if (!presetName) return;

        try {
            saveSettingsPreset(presetName);
            presetUiState.selectedPresetKey = makePresetKey({ name: presetName, source: 'user' });
            rebuildPresetsFolder();
        } catch (err) {
            console.error('save preset failed:', err);
            showError(`Save preset failed: ${getErrorMessage(err)}`);
        }
    });

    presetsFolder.addBlade({ view: 'separator' });

    if (dropdownOptions.length > 0) {
        presetsFolder.addBinding(presetUiState as unknown as Record<string, unknown>, 'selectedPresetKey', {
            label: 'name',
            view: 'list',
            options: dropdownOptions,
        }).on('change', () => {
            updatePresetButtonState();
        });
    }

    const loadBtn = presetsFolder.addButton({ title: 'load' });
    const deleteBtn = presetsFolder.addButton({ title: 'delete' });

    function updatePresetButtonState(): void {
        const isEmpty = !presetUiState.selectedPresetKey;
        const isPredefined = !isEmpty && parsePresetKey(presetUiState.selectedPresetKey).source === 'predefined';
        loadBtn.disabled = isEmpty;
        deleteBtn.disabled = isEmpty || isPredefined;
    }
    updatePresetButtonState();

    loadBtn.on('click', () => {
        try {
            const { name, source } = parsePresetKey(presetUiState.selectedPresetKey);
            applySettingsPreset(name, source);
            updateDynamicGraphPanes();
            syncStaticSettingsPane();
            emit(EVT_D3_PARAMS_CHANGED, null);
            emit(EVT_SETTINGS_UPDATED, null);
        } catch (err) {
            console.error('load preset failed:', err);
            showError(`Load preset failed: ${getErrorMessage(err)}`);
        }
    });

    deleteBtn.on('click', () => {
        const { name } = parsePresetKey(presetUiState.selectedPresetKey);

        const shouldDelete = window.confirm(`Delete "${name}"?`);
        if (!shouldDelete) return;

        try {
            deleteSettingsPreset(name);
            rebuildPresetsFolder();
        } catch (err) {
            console.error('delete preset failed:', err);
            showError(`Delete preset failed: ${getErrorMessage(err)}`);
        }
    });

    presetsFolder.addButton({ title: 'reset' }).on('click', () => {
        try {
            resetSettingsToDefaults();
            updateDynamicGraphPanes();
            syncStaticSettingsPane();
            emit(EVT_D3_PARAMS_CHANGED, null);
            emit(EVT_SETTINGS_UPDATED, null);
        } catch (err) {
            console.error('reset settings failed:', err);
            showError(`Reset settings failed: ${getErrorMessage(err)}`);
        }
    });
}

rebuildPresetsFolder();

/**
 * Attaches Plotly-style "double-click to isolate" behaviour to a filter toggle.
 * Double-clicking enables ONLY this type (disabling all others in the group);
 * double-clicking again when already isolated re-enables all types.
 */
function attachIsolateOnDoubleClick(
    binding: { element: HTMLElement },
    filters: Record<string, boolean>,
    allKeys: Iterable<string>,
    key: string,
): void {
    const element = binding.element;
    element.addEventListener('dblclick', () => {
        const keys = [...allKeys];
        const isIsolated = keys.every((k) => (k === key ? filters[k] !== false : filters[k] === false));
        for (const k of keys) {
            filters[k] = isIsolated ? true : k === key;
        }
        pane.refresh();
        emit(EVT_FILTERS_UPDATED, null);
    });
}

/** Counts occurrences of each type name, preserving first-seen order. */
function countByType(types: Iterable<string>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const type of types) {
        counts.set(type, (counts.get(type) ?? 0) + 1);
    }
    return counts;
}

/**
 * Injects a right-aligned count badge into a Tweakpane filter row, rendered as
 * a subtle pill next to the toggle rather than inline in the label text.
 */
function attachCountBadge(binding: { element: HTMLElement }, count: number): void {
    binding.element.classList.add('has-count-badge');
    const badge = document.createElement('span');
    badge.className = 'type-count-badge';
    badge.textContent = count.toLocaleString();
    binding.element.appendChild(badge);
}

/**
 * Rebuilds the dynamic filter and colour panes in the settings UI based on the
 * current graph's node/edge types.
 */
export function updateDynamicGraphPanes(): void {
    const nfExpanded = nodeFiltersFolder.expanded;
    const efExpanded = edgeFiltersFolder.expanded;
    const ncExpanded = nodeColorsFolder.expanded;
    const ecExpanded = edgeColorsFolder.expanded;
    const ewExpanded = edgeWidthsFolder.expanded;

    nodeFiltersFolder.dispose();
    edgeFiltersFolder.dispose();
    nodeColorsFolder.dispose();
    edgeColorsFolder.dispose();
    edgeWidthsFolder.dispose();

    nodeFiltersFolder = pane.addFolder({ title: 'node filters', expanded: nfExpanded });
    edgeFiltersFolder = pane.addFolder({ title: 'edge filters', expanded: efExpanded });
    nodeColorsFolder = pane.addFolder({ title: 'node colors', expanded: ncExpanded });
    edgeColorsFolder = pane.addFolder({ title: 'edge colors', expanded: ecExpanded });
    edgeWidthsFolder = pane.addFolder({ title: 'edge widths', expanded: ewExpanded });

    const graph = getGraph();
    const nodeFilters = settings.nodeFilters;
    const edgeFilters = settings.edgeFilters;
    const nodeColors = settings.nodeColors;
    const edgeColors = settings.edgeColors;
    const edgeWidths = settings.edgeWidths;

    const nodeTypeCounts = countByType(graph.getNodes().map((node) => node.type));
    const edgeTypeCounts = countByType(graph.getEdges().map((edge) => edge.type));

    const nodeTypes = sortNodeTypes(nodeTypeCounts.keys());
    const edgeTypes = sortEdgeTypes(edgeTypeCounts.keys());

    for (const key of nodeTypes) {
        if (!(key in nodeFilters)) {
            nodeFilters[key] = true;
        }
        const binding = nodeFiltersFolder.addBinding(nodeFilters as unknown as Record<string, unknown>, key);
        binding.on('change', () => {
            emit(EVT_FILTERS_UPDATED, null);
        });
        attachCountBadge(binding, nodeTypeCounts.get(key) ?? 0);
        attachIsolateOnDoubleClick(binding, nodeFilters, nodeTypes, key);
    }

    for (const key of edgeTypes) {
        if (!(key in edgeFilters)) {
            edgeFilters[key] = true;
        }
        const binding = edgeFiltersFolder.addBinding(edgeFilters as unknown as Record<string, unknown>, key);
        binding.on('change', () => {
            emit(EVT_FILTERS_UPDATED, null);
        });
        attachCountBadge(binding, edgeTypeCounts.get(key) ?? 0);
        attachIsolateOnDoubleClick(binding, edgeFilters, edgeTypes, key);
    }

    for (const key of nodeTypes) {
        if (!(key in nodeColors)) {
            nodeColors[key] = structuredClone(getNodeColor(key));
        }
        nodeColorsFolder.addBinding(nodeColors as unknown as Record<string, unknown>, key).on('change', () => {
            emit(EVT_COLORS_UPDATED, null);
        });
    }

    for (const key of edgeTypes) {
        if (!(key in edgeColors)) {
            edgeColors[key] = structuredClone(getEdgeColor(key));
        }
        edgeColorsFolder.addBinding(edgeColors as unknown as Record<string, unknown>, key).on('change', () => {
            emit(EVT_COLORS_UPDATED, null);
        });
    }

    for (const key of edgeTypes) {
        if (!(key in edgeWidths)) {
            edgeWidths[key] = getEdgeWidth(key);
        }
        edgeWidthsFolder.addBinding(edgeWidths as unknown as Record<string, unknown>, key, {
            min: 0.5, max: 5, step: 0.5,
        });
    }

    rebuildPresetsFolder();
    syncStaticSettingsPane();
}
