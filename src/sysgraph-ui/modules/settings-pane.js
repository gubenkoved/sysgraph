import { settings, getNodeColor, getEdgeColor, getEdgeWidth } from './settings.js';
import {
    listSettingsPresetNames,
    saveSettingsPreset,
    deleteSettingsPreset,
    applySettingsPreset,
    resetSettingsToDefaults,
} from './settings-presets.js';
import { getGraph } from './state.js';
import { ForceGraphInstance, pinNode, unpinNode } from './graph-ui.js';
import { emit, handle } from './event-bus.js';
import { showError } from './util.js';
import {
    EVT_D3_PARAMS_CHANGED, EVT_SETTINGS_UPDATED, EVT_CURVATURE_UPDATED,
    EVT_CLEAR_CLICKED, EVT_FILTERS_UPDATED,
    CMD_RELOAD, CMD_EXPORT, CMD_IMPORT,
} from './constants.js';

import { Pane } from 'tweakpane';

/**
 * @param {string} id
 * @returns {HTMLElement}
 */
function getRequiredElement(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing element: ${id}`);
    }
    return element;
}

/**
 * @param {string} id
 * @returns {HTMLInputElement}
 */
function getRequiredInputElement(id) {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLInputElement)) {
        throw new Error(`Missing input element: ${id}`);
    }
    return element;
}

const settingsPaneElement = getRequiredElement('settingsPane');
const importFileInput = getRequiredInputElement('importFile');

/** @type {any} */
const pane = new Pane({
    title: 'parameters',
    container: settingsPaneElement,
});

const presetUiState = {
    selectedPresetName: '',
};

/**
 * @param {unknown} err
 * @returns {string}
 */
function getErrorMessage(err) {
    return err instanceof Error ? err.message : String(err);
}

// --- d3 simulation parameters (data-driven) ---
const d3RenderingSettingsFolder = pane.addFolder({ title: "d3 forces settings", expanded: false });

const d3Params = [
    { key: 'd3Charge', min: -800, max: 100, step: 10 },
    { key: 'd3LinkDistance', min: 40, max: 300, step: 5 },
    { key: 'd3LinkStrength', min: 0.0, max: 1.0, step: 0.01 },
    { key: 'd3CollisionMultiplier', min: 0.5, max: 2.0, step: 0.05 },
    { key: 'd3AlphaTarget', min: 0.0, max: 0.5, step: 0.01 },
    { key: 'd3VelocityDecay', min: 0.01, max: 0.99, step: 0.01 },
    { key: 'd3ForceXYStrength', min: 0.00, max: 0.99, step: 0.01 },
];

for (const p of d3Params) {
    d3RenderingSettingsFolder.addBinding(settings, p.key, p).on('change', () => {
        emit(EVT_D3_PARAMS_CHANGED, null);
    });
}

d3RenderingSettingsFolder.addBinding(settings, 'd3CenterForce').on('change', () => {
    emit(EVT_D3_PARAMS_CHANGED, null);
});

// --- graph display settings ---
const displayOptionsFolder = pane.addFolder({ title: "display options", expanded: false });

displayOptionsFolder.addBinding(settings, 'showIsolated').on('change', () => {
    emit(EVT_SETTINGS_UPDATED, null);
});

displayOptionsFolder.addBinding(settings, 'showGrid').on('change', () => {
    emit(EVT_SETTINGS_UPDATED, null);
});

displayOptionsFolder.addBinding(settings, 'curvatureStep', { min: 0.0, max: 0.200, step: 0.001 }).on('change', () => {
    emit(EVT_CURVATURE_UPDATED, null);
});

// --- label settings ---
displayOptionsFolder.addBlade({ view: 'separator' });

const nodeLabelModeBinding = displayOptionsFolder.addBinding(settings, 'nodeLabelMode', {
    label: 'node label',
    view: 'list',
    options: [
        { text: 'default', value: 'default' },
        { text: 'type', value: 'type' },
        { text: 'id', value: 'id' },
        { text: 'expression', value: 'expression' },
    ],
});

const nodeLabelExpressionBinding = displayOptionsFolder.addBinding(settings, 'nodeLabelExpression', {
    label: 'label expr',
});

// show/hide expression input based on mode
function updateExpressionVisibility() {
    nodeLabelExpressionBinding.hidden = settings.nodeLabelMode !== 'expression';
}
updateExpressionVisibility();

nodeLabelModeBinding.on('change', () => {
    updateExpressionVisibility();
    // emit("graph-ui-settings-updated", null);
});

nodeLabelExpressionBinding.on('change', () => {
    // emit("graph-ui-settings-updated", null);
});

// --- node sizing settings ---
displayOptionsFolder.addBlade({ view: 'separator' });

const nodeSizingModeBinding = displayOptionsFolder.addBinding(settings, 'nodeSizingMode', {
    label: 'node sizing',
    view: 'list',
    options: [
        { text: 'degree', value: 'degree' },
        { text: 'constant', value: 'constant' },
        { text: 'expression', value: 'expression' },
    ],
});

const nodeSizingConstantBinding = displayOptionsFolder.addBinding(settings, 'nodeSizingConstant', {
    label: 'size',
    min: 1,
    max: 10,
    step: 0.5,
});

const nodeSizingExpressionBinding = displayOptionsFolder.addBinding(settings, 'nodeSizingExpression', {
    label: 'size expr',
});

function updateSizingVisibility() {
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

function syncStaticSettingsPane() {
    updateExpressionVisibility();
    updateSizingVisibility();
    pane.refresh();
}

const actionsFolder = pane.addFolder({ title: "actions", expanded: true });

// --- refresh button ---
actionsFolder.addButton({ title: 'reload sysgraph' }).on('click', async () => {
    try {
        await handle(CMD_RELOAD);
    } catch (err) {
        console.error('reload failed:', err);
        showError(`Reload failed: ${getErrorMessage(err)}`);
    }
});

actionsFolder.addBlade({ view: 'separator' });

// --- pin / unpin ---
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

actionsFolder.addBlade({ view: 'separator' });

// --- clear / export / import ---
actionsFolder.addButton({ title: 'clear' }).on('click', async () => {
    emit(EVT_CLEAR_CLICKED, null);
});

actionsFolder.addButton({ title: 'export data' }).on('click', () => {
    const blob = handle(CMD_EXPORT);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${timestamp}_graph.json`;
    a.click();
    URL.revokeObjectURL(url);
});

actionsFolder.addButton({ title: 'import data' }).on('click', () => {
    importFileInput.click();
});

importFileInput.addEventListener('change', async (event) => {
    const file = importFileInput.files && importFileInput.files[0];
    if (!file) return;

    try {
        const text = await file.text();
        await handle(CMD_IMPORT, text);
    } catch (err) {
        console.error('import failed:', err);
        showError(`Import failed: ${getErrorMessage(err)}`);
    }

    importFileInput.value = '';
});

// --- filter panes ---
let nodeFiltersFolder = pane.addFolder({ title: "node filters", expanded: false });
let edgeFiltersFolder = pane.addFolder({ title: "edge filters", expanded: false });

// --- color panes ---
let nodeColorsFolder = pane.addFolder({ title: "node colors", expanded: true });
let edgeColorsFolder = pane.addFolder({ title: "edge colors", expanded: true });

// --- edge width pane ---
let edgeWidthsFolder = pane.addFolder({ title: "edge widths", expanded: false });

// --- presets pane ---
let presetsFolder = pane.addFolder({ title: "presets", expanded: true });

/**
 * @param {string[]} names
 */
function updateSelectedPresetName(names) {
    if (names.length === 0) {
        presetUiState.selectedPresetName = '';
        return;
    }

    if (!names.includes(presetUiState.selectedPresetName)) {
        presetUiState.selectedPresetName = names[0];
    }
}

function rebuildPresetsFolder() {
    const expanded = presetsFolder.expanded;
    const presetNames = listSettingsPresetNames();

    updateSelectedPresetName(presetNames);
    presetsFolder.dispose();
    presetsFolder = pane.addFolder({ title: "presets", expanded });

    presetsFolder.addButton({ title: 'save' }).on('click', () => {
        const rawName = window.prompt('Preset name');
        const presetName = rawName ? rawName.trim() : '';

        if (!presetName) {
            return;
        }

        try {
            saveSettingsPreset(presetName);
            presetUiState.selectedPresetName = presetName;
            rebuildPresetsFolder();
        } catch (err) {
            console.error('save preset failed:', err);
            showError(`Save preset failed: ${getErrorMessage(err)}`);
        }
    });

    presetsFolder.addBlade({ view: 'separator' });

    if (presetNames.length > 0) {
        presetsFolder.addBinding(presetUiState, 'selectedPresetName', {
            label: 'name',
            view: 'list',
            options: presetNames.map((name) => ({ text: name, value: name })),
        });
    }

    presetsFolder.addButton({ title: 'load' }).on('click', () => {
        if (!presetUiState.selectedPresetName) {
            showError('No saved presets available.');
            return;
        }

        try {
            applySettingsPreset(presetUiState.selectedPresetName);
            updateDynamicGraphPanes();
            syncStaticSettingsPane();
            emit(EVT_D3_PARAMS_CHANGED, null);
            emit(EVT_SETTINGS_UPDATED, null);
        } catch (err) {
            console.error('load preset failed:', err);
            showError(`Load preset failed: ${getErrorMessage(err)}`);
        }
    });

    presetsFolder.addButton({ title: 'delete' }).on('click', () => {
        if (!presetUiState.selectedPresetName) {
            showError('No saved presets available.');
            return;
        }

        const shouldDelete = window.confirm(`Delete "${presetUiState.selectedPresetName}"?`);
        if (!shouldDelete) {
            return;
        }

        try {
            deleteSettingsPreset(presetUiState.selectedPresetName);
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
 * Rebuilds the dynamic filter and colour panes in the settings UI based on the
 * current graph's node/edge types.
 */
export function updateDynamicGraphPanes() {
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

    nodeFiltersFolder = pane.addFolder({ title: "node filters", expanded: nfExpanded });
    edgeFiltersFolder = pane.addFolder({ title: "edge filters", expanded: efExpanded });
    nodeColorsFolder = pane.addFolder({ title: "node colors", expanded: ncExpanded });
    edgeColorsFolder = pane.addFolder({ title: "edge colors", expanded: ecExpanded });
    edgeWidthsFolder = pane.addFolder({ title: "edge widths", expanded: ewExpanded });

    const graph = getGraph();
    const nodeFilters = settings.nodeFilters;
    const edgeFilters = settings.edgeFilters;
    const nodeColors = settings.nodeColors;
    const edgeColors = settings.edgeColors;
    const edgeWidths = settings.edgeWidths;

    const nodeTypes = new Set(graph.getNodes().map((node) => node.type));
    const edgeTypes = new Set(graph.getEdges().map((edge) => edge.type));

    for (const key of nodeTypes) {
        if (!(key in nodeFilters)) {
            nodeFilters[key] = true;
        }
        nodeFiltersFolder.addBinding(nodeFilters, key).on('change', () => {
            emit(EVT_FILTERS_UPDATED, null);
        });
    }

    for (const key of edgeTypes) {
        if (!(key in edgeFilters)) {
            edgeFilters[key] = true;
        }
        edgeFiltersFolder.addBinding(edgeFilters, key).on('change', () => {
            emit(EVT_FILTERS_UPDATED, null);
        });
    }

    // initialize colors and edge widths in settings
    for (const key of nodeTypes) {
        if (!(key in nodeColors)) {
            nodeColors[key] = structuredClone(getNodeColor(key));
        }
        nodeColorsFolder.addBinding(nodeColors, key);
    }

    for (const key of edgeTypes) {
        if (!(key in edgeColors)) {
            edgeColors[key] = structuredClone(getEdgeColor(key));
        }
        edgeColorsFolder.addBinding(edgeColors, key);
    }

    for (const key of edgeTypes) {
        if (!(key in edgeWidths)) {
            edgeWidths[key] = getEdgeWidth(key);
        }
        edgeWidthsFolder.addBinding(edgeWidths, key, {
            min: 0.5, max: 5, step: 0.5,
        });
    }

    rebuildPresetsFolder();
    syncStaticSettingsPane();
}
