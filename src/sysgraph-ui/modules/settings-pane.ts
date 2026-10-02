import type { FpsGraphBladeApi } from '@tweakpane/plugin-essentials';
import * as EssentialsPlugin from '@tweakpane/plugin-essentials';
import type { FolderApi } from 'tweakpane';
import { Pane } from 'tweakpane';
import {
    EVT_COLORS_UPDATED,EVT_FILTERS_UPDATED,
    EVT_GPU_PARAMS_CHANGED, EVT_NODE_SIZING_UPDATED, EVT_RENDER_OPTIONS_CHANGED, EVT_SETTINGS_UPDATED,
    EVT_WIDTHS_UPDATED,
    PANEL_SETTINGS,
} from './constants.js';
import { emit } from './event-bus.js';
import { createExpressionEditTrigger } from './expression-editor.js';
import type { ExpressionField } from './expression-fields.js';
import {
    edgeFilterField,
    linkDistanceField,
    nodeFilterField,
    nodeLabelField,
    nodeSizingField,
    setExpressionPaneRefresh,
} from './expression-fields.js';
import type { GraphDisplay } from './graph.js';
import {
    GRAPH_DISPLAY_MODES,
    type GraphDisplayMode,
    getGraphDisplayMode,
    setGraphDisplayMode,
} from './graph-display.js';
import { GraphViewInstance, refreshGraphColors } from './graph-ui.js';
import {
    validateEdgeFilterExpression,
    validateLinkDistanceExpression,
    validateNodeFilterExpression,
} from './graph-ui-appearance.js';
import { registerPanel } from './layout.js';
import { setFrameHooks } from './render-hooks.js';
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
    applyEmbeddedDisplaySettings,
    applySettingsPreset,
    deleteSettingsPreset,
    exportSettingsToJson,
    importSettingsFromJson,
    listAllPresets,
    resetSettingsToDefaults,
    saveSettingsPreset,
    snapshotCurrentSettings,
} from './settings-presets.js';
import { clearPhysicsOverride, getGraph, setGraphDirty, setHighlight, state } from './state.js';
import { showActionToast, showError, showInfoToast } from './util.js';

function getRequiredElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!(element instanceof HTMLElement)) {
        throw new Error(`Missing element: ${id}`);
    }
    return element;
}

// adds the rich-editor launch icon to a tweakpane expression binding row; it
// rides the binding's element so it auto-hides when the row is hidden. The
// factory is resolved on click so the editor binds the current value + props
function attachExpressionEditor(
    binding: { element: HTMLElement },
    makeField: () => ExpressionField,
): void {
    binding.element.classList.add('sg-expr-binding');
    binding.element.appendChild(createExpressionEditTrigger(makeField));
}

const settingsPaneElement = getRequiredElement('settingsPane');

const pane = new Pane({
    container: settingsPaneElement,
});

pane.registerPlugin(EssentialsPlugin);

// register the settings pane with the dock layout so it docks alongside the
// other panels instead of floating over the canvas
registerPanel({
    id: PANEL_SETTINGS,
    component: PANEL_SETTINGS,
    title: 'Settings',
    element: settingsPaneElement,
});


// re-reads the current settings object into the pane widgets; used when a
// setting is changed outside the pane (e.g. the floating physics toggle) so the
// corresponding control stays in sync
export function syncSettingsPane(): void {
    updateLayoutVisibility();
    pane.refresh();
}

// let the expression editor push committed values back into the pane's inputs
setExpressionPaneRefresh(syncSettingsPane);

// tags a folder's root element with a category class so it can be visually
// color-coded via CSS (left accent stripe + tinted title bar)
function tagFolder(folder: FolderApi, category: string): FolderApi {
    folder.element.classList.add('sg-folder', `sg-folder-${category}`);
    return folder;
}

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

// ── automatic placement ─────────────────────────────────────
const layoutFolder = tagFolder(pane.addFolder({ title: 'automatic layout', expanded: true }), 'forces');
const layoutSettings = settings as unknown as Record<string, unknown>;
let layoutChangeTimer = 0;
const layoutChange = (): void => {
    clearTimeout(layoutChangeTimer);
    layoutChangeTimer = window.setTimeout(() => emit(EVT_GPU_PARAMS_CHANGED, null), 120);
};
const layoutChangeNow = (): void => {
    clearTimeout(layoutChangeTimer);
    emit(EVT_GPU_PARAMS_CHANGED, null);
};
const layoutModeBinding = layoutFolder.addBinding(layoutSettings, 'layoutMode', {
    label: 'algorithm', view: 'list', options: [
        { text: 'GPU force', value: 'force' },
        { text: 'layered flow', value: 'layered' },
        { text: 'radial distance', value: 'radial' },
        { text: 'circular', value: 'circular' },
        { text: 'degree rings', value: 'concentric' },
        { text: 'grid', value: 'grid' },
    ],
});
const layoutSpacingBinding = layoutFolder.addBinding(layoutSettings, 'layoutSpacing', {
    label: 'node spacing', min: 30, max: 300, step: 10,
}).on('change', layoutChange);
const layoutRankSpacingBinding = layoutFolder.addBinding(layoutSettings, 'layoutRankSpacing', {
    label: 'level spacing', min: 40, max: 400, step: 10,
}).on('change', layoutChange);
const layoutDirectionBinding = layoutFolder.addBinding(layoutSettings, 'layoutDirection', {
    label: 'direction', view: 'list', options: [
        { text: 'top to bottom', value: 'TB' }, { text: 'bottom to top', value: 'BT' },
        { text: 'left to right', value: 'LR' }, { text: 'right to left', value: 'RL' },
    ],
}).on('change', layoutChangeNow);
const layoutRootBinding = layoutFolder.addBinding(layoutSettings, 'layoutRootId', {
    label: 'root node ID',
}).on('change', layoutChange);
const selectedRootButton = layoutFolder.addButton({ title: 'use selected node as root' }).on('click', () => {
    const selected = state.selection.selectedNodeIds.values().next().value;
    if (!selected) {
        showInfoToast('Select a node first to make it the layout root.');
        return;
    }
    settings.layoutRootId = selected;
    pane.refresh();
    layoutChangeNow();
});
layoutFolder.addButton({ title: 'reapply layout' }).on('click', () => GraphViewInstance.reapplyLayout());
function updateLayoutVisibility(): void {
    const mode = settings.layoutMode;
    layoutSpacingBinding.hidden = mode === 'force';
    layoutRankSpacingBinding.hidden = mode !== 'layered' && mode !== 'radial' && mode !== 'concentric';
    layoutDirectionBinding.hidden = mode !== 'layered';
    layoutRootBinding.hidden = mode !== 'radial' && mode !== 'circular';
    selectedRootButton.hidden = layoutRootBinding.hidden;
}
layoutModeBinding.on('change', () => { updateLayoutVisibility(); layoutChangeNow(); });
updateLayoutVisibility();

// ── WebGPU rendering and layout ─────────────────────────────
const engineFolder = tagFolder(pane.addFolder({ title: 'WebGPU engine', expanded: false }), 'forces');
const engineChange = () => emit(EVT_GPU_PARAMS_CHANGED, null);
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuEnablePhysics', { label: 'force physics' }).on('change', () => {
    clearPhysicsOverride(); engineChange();
});
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuLayoutRate', {
    label: 'layout ticks / sec', min: 1, max: 60, step: 1,
}).on('change', engineChange);
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuWarmupMs', {
    label: 'warmup (ms)', min: 0, max: 2500, step: 100,
}).on('change', engineChange);
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuCharge', {
    label: 'repulsion', min: -1000, max: 0, step: 10,
}).on('change', engineChange);
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuLinkStrength', {
    label: 'link strength', min: 0, max: 2, step: 0.05,
}).on('change', engineChange);
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuCollisionMultiplier', {
    label: 'collision', min: 0, max: 3, step: 0.1,
}).on('change', engineChange);
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuVelocityDecay', {
    label: 'velocity decay', min: 0, max: 0.95, step: 0.05,
}).on('change', engineChange);
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuForceXYStrength', {
    label: 'centering', min: 0, max: 1, step: 0.01,
}).on('change', engineChange);
const linkDistanceModeBinding = engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuLinkDistanceMode', {
    label: 'link distance mode', view: 'list',
    options: [{ text: 'constant', value: 'constant' }, { text: 'expression', value: 'expression' }],
});
const linkDistanceConstantBinding = engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuLinkDistance', {
    label: 'link distance', min: 40, max: 500, step: 5,
});
const linkDistanceExpressionBinding = engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuLinkDistanceExpression', {
    label: 'link distance',
});
attachExpressionEditor(linkDistanceExpressionBinding, linkDistanceField);
function updateLinkDistanceVisibility(): void {
    const expression = settings.gpuLinkDistanceMode === 'expression';
    linkDistanceConstantBinding.hidden = expression;
    linkDistanceExpressionBinding.hidden = !expression;
}
function updateLinkDistanceValidity(): void {
    const error = settings.gpuLinkDistanceMode === 'expression'
        ? validateLinkDistanceExpression(settings.gpuLinkDistanceExpression) : null;
    linkDistanceExpressionBinding.element.classList.toggle('sg-binding-invalid', error !== null);
}
updateLinkDistanceVisibility(); updateLinkDistanceValidity();
linkDistanceModeBinding.on('change', () => { updateLinkDistanceVisibility(); updateLinkDistanceValidity(); engineChange(); });
linkDistanceConstantBinding.on('change', engineChange);
linkDistanceExpressionBinding.on('change', () => { updateLinkDistanceValidity(); engineChange(); });
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuEdgeStyle', {
    label: 'edge rendering', view: 'list',
    options: [{ text: 'smooth', value: 'smooth' }, { text: 'thin', value: 'thin' }],
}).on('change', () => emit(EVT_RENDER_OPTIONS_CHANGED, null));
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuEdgeWidth', {
    label: 'edge stroke', min: 0.8, max: 4, step: 0.1,
}).on('change', () => emit(EVT_RENDER_OPTIONS_CHANGED, null));
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuShowNodes', { label: 'show nodes' })
    .on('change', () => emit(EVT_RENDER_OPTIONS_CHANGED, null));
engineFolder.addBinding(settings as unknown as Record<string, unknown>, 'gpuNodeOutline', {
    label: 'node outline', min: 0, max: 3.5, step: 0.1,
}).on('change', () => emit(EVT_RENDER_OPTIONS_CHANGED, null));
const fpsGraph = engineFolder.addBlade({ view: 'fpsgraph', label: 'fps', rows: 2, min: 0, max: 144 }) as unknown as FpsGraphBladeApi;
setFrameHooks(() => fpsGraph.begin(), () => fpsGraph.end());

// ── graph display settings ──────────────────────────────────
const displayOptionsFolder = tagFolder(pane.addFolder({ title: 'display options', expanded: false }), 'display');

displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'showIsolated', { label: 'show isolated' }).on('change', () => {
    emit(EVT_SETTINGS_UPDATED, null);
});

displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'highlightOnHover', { label: 'highlight on hover' }).on('change', () => {
    if (!settings.highlightOnHover) {
        setHighlight(null);
        refreshGraphColors();
    }
    emit(EVT_RENDER_OPTIONS_CHANGED, null);
});

displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'globalEdgeAlphaOffset', { label: 'edge alpha offset', min: -1, max: 1, step: 0.01 }).on('change', () => {
    emit(EVT_COLORS_UPDATED, null);
});

displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'globalEdgeWidthMultiplier', { label: 'edge width mult', min: 0.1, max: 5, step: 0.1 }).on('change', () => {
    emit(EVT_WIDTHS_UPDATED, null);
});

// ── label settings ──────────────────────────────────────────
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
attachExpressionEditor(nodeLabelExpressionBinding, nodeLabelField);

function updateExpressionVisibility(): void {
    nodeLabelExpressionBinding.hidden = settings.nodeLabelMode !== 'expression';
}
updateExpressionVisibility();

nodeLabelModeBinding.on('change', () => {
    updateExpressionVisibility();
    // rebuild labels: 2D redraws live, but the 3D label sprites are cached and
    // only regenerated on a graph refresh
    emit(EVT_SETTINGS_UPDATED, null);
});

nodeLabelExpressionBinding.on('change', () => {
    emit(EVT_SETTINGS_UPDATED, null);
});

displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'labelDensity', {
    label: 'label density',
    view: 'list',
    options: [
        { text: 'auto (declutter)', value: 'auto' },
        { text: 'focus', value: 'focus' },
    ],
}).on('change', () => {
    emit(EVT_SETTINGS_UPDATED, null);
});

// ── node sizing settings ────────────────────────────────────
displayOptionsFolder.addBlade({ view: 'separator' });

const nodeSizingModeBinding = displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'nodeSizingMode', {
    label: 'node sizing mode',
    view: 'list',
    options: [
        { text: 'degree', value: 'degree' },
        { text: 'constant', value: 'constant' },
        { text: 'expression', value: 'expression' },
    ],
});

const nodeSizeScaleBinding = displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'nodeSizeScale', {
    label: 'size multiplier',
    min: 0.1,
    max: 8,
    step: 0.1,
}).on('change', () => emit(EVT_NODE_SIZING_UPDATED, null));
nodeSizeScaleBinding.element.title = 'Scale node sizes in constant, degree, or expression mode without changing their relative sizes.';

const nodeSizingConstantBinding = displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'nodeSizingConstant', {
    label: 'node size',
    min: 0.1,
    max: 24,
    step: 0.1,
});
nodeSizingConstantBinding.element.title = '0.1 makes nodes almost point-sized; 24 makes them large. Zoom also scales their size.';

const nodeSizingExpressionBinding = displayOptionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'nodeSizingExpression', {
    label: 'node size',
});
attachExpressionEditor(nodeSizingExpressionBinding, nodeSizingField);

function updateSizingVisibility(): void {
    nodeSizingConstantBinding.hidden = settings.nodeSizingMode !== 'constant';
    nodeSizingExpressionBinding.hidden = settings.nodeSizingMode !== 'expression';
}
updateSizingVisibility();

nodeSizingModeBinding.on('change', () => {
    updateSizingVisibility();
    emit(EVT_NODE_SIZING_UPDATED, null);
});

nodeSizingConstantBinding.on('change', () => {
    emit(EVT_NODE_SIZING_UPDATED, null);
});

nodeSizingExpressionBinding.on('change', () => {
    emit(EVT_NODE_SIZING_UPDATED, null);
});

function syncStaticSettingsPane(): void {
    updateLayoutVisibility();
    updateExpressionVisibility();
    updateSizingVisibility();
    updateLinkDistanceVisibility();
    updateLinkDistanceValidity();
    updateFilterExpressionValidity();
    pane.refresh();
}

/**
 * Fully refreshes the settings pane and graph rendering after the settings
 * object was mutated wholesale (preset load, embedded display, file import).
 */
function refreshAfterSettingsChange(): void {
    updateDynamicGraphPanes();
    syncStaticSettingsPane();
    emit(EVT_GPU_PARAMS_CHANGED, null);
    emit(EVT_SETTINGS_UPDATED, null);
    emit(EVT_COLORS_UPDATED, null);
    emit(EVT_WIDTHS_UPDATED, null);
}

/**
 * Applies a graph-embedded display block onto the current settings and fully
 * refreshes the settings pane and graph rendering (mirrors the preset-load
 * refresh flow).
 */
export function applyGraphDisplayAndRefresh(display: GraphDisplay): void {
    applyEmbeddedDisplaySettings(display);
    refreshAfterSettingsChange();
}

/**
 * Resets settings back to defaults and fully refreshes the pane and rendering.
 * Used when a loaded graph carries no display block so it renders in its
 * canonical look instead of inheriting the previous graph's tweaks.
 */
function resetGraphDisplayAndRefresh(): void {
    resetSettingsToDefaults();
    refreshAfterSettingsChange();
}

/**
 * Reconciles a loaded graph with the user's settings according to the
 * persisted graph-display mode (apply / ask / ignore).
 *
 * A graph "drives" the display: when it carries a display block we apply it,
 * and when it does NOT we reset to defaults so the graph renders in its
 * canonical look instead of inheriting the previous graph's tweaks. The mode
 * gates this: 'apply' acts automatically, 'ask' prompts, 'ignore' never
 * touches settings.
 */
export function maybeApplyGraphDisplay(display: GraphDisplay | undefined): void {
    // loading any graph drops a transient physics override so the new graph's
    // persisted setting takes effect regardless of display mode
    clearPhysicsOverride();
    const mode = getGraphDisplayMode();
    if (mode === 'ignore') {
        return;
    }

    const hasDisplay = !!display && Object.keys(display).length > 0;

    if (mode === 'apply') {
        if (hasDisplay) {
            applyGraphDisplayAndRefresh(display as GraphDisplay);
            showInfoToast(
                'Your colors, filters and layout were overridden by this graph. Change this under "settings embedding".',
                {
                    id: 'graph-display-prompt',
                    title: 'Display settings applied',
                    icon: 'palette',
                },
            );
        } else {
            resetGraphDisplayAndRefresh();
            showInfoToast(
                'This graph has no embedded settings, so display was reset to defaults. Change this under "settings embedding".',
                {
                    id: 'graph-display-prompt',
                    title: 'Display settings reset',
                    icon: 'restart_alt',
                },
            );
        }
        return;
    }

    // mode === 'ask' → prompt with a prominent, sticky action toast
    if (hasDisplay) {
        showActionToast(
            'This graph carries its own colors, filters and layout. Apply them?',
            'Apply settings',
            () => applyGraphDisplayAndRefresh(display as GraphDisplay),
            {
                id: 'graph-display-prompt',
                title: 'Graph display settings available',
                icon: 'palette',
                durationMs: 0,
            },
        );
        return;
    }

    showActionToast(
        'This graph has no display settings. Reset to defaults so it renders in its canonical look?',
        'Reset to defaults',
        () => resetGraphDisplayAndRefresh(),
        {
            id: 'graph-display-prompt',
            title: 'No graph display settings',
            icon: 'restart_alt',
            durationMs: 0,
        },
    );
}

// ── filter panes ────────────────────────────────────────────
const filterExpressionsFolder = tagFolder(pane.addFolder({ title: 'filter expressions', expanded: false }), 'filters');

const nodeFilterExpressionBinding = filterExpressionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'nodeFilterExpression', {
    label: 'nodes filter',
});
attachExpressionEditor(nodeFilterExpressionBinding, nodeFilterField);

const edgeFilterExpressionBinding = filterExpressionsFolder.addBinding(settings as unknown as Record<string, unknown>, 'edgeFilterExpression', {
    label: 'edges filter',
});
attachExpressionEditor(edgeFilterExpressionBinding, edgeFilterField);

function updateFilterExpressionValidity(): void {
    const nodeError = settings.nodeFilterExpression.trim()
        ? validateNodeFilterExpression(settings.nodeFilterExpression)
        : null;
    nodeFilterExpressionBinding.element.classList.toggle('sg-binding-invalid', nodeError !== null);

    const edgeError = settings.edgeFilterExpression.trim()
        ? validateEdgeFilterExpression(settings.edgeFilterExpression)
        : null;
    edgeFilterExpressionBinding.element.classList.toggle('sg-binding-invalid', edgeError !== null);
}
updateFilterExpressionValidity();

nodeFilterExpressionBinding.on('change', () => {
    updateFilterExpressionValidity();
    emit(EVT_FILTERS_UPDATED, null);
});

edgeFilterExpressionBinding.on('change', () => {
    updateFilterExpressionValidity();
    emit(EVT_FILTERS_UPDATED, null);
});

let nodeFiltersFolder: FolderApi = tagFolder(pane.addFolder({ title: 'node filters', expanded: false }), 'filters');
let edgeFiltersFolder: FolderApi = tagFolder(pane.addFolder({ title: 'edge filters', expanded: false }), 'filters');

// ── color panes ─────────────────────────────────────────────
let nodeColorsFolder: FolderApi = tagFolder(pane.addFolder({ title: 'node colors', expanded: true }), 'colors');
let edgeColorsFolder: FolderApi = tagFolder(pane.addFolder({ title: 'edge colors', expanded: true }), 'colors');

// ── edge width pane ─────────────────────────────────────────
let edgeWidthsFolder: FolderApi = tagFolder(pane.addFolder({ title: 'edge widths', expanded: false }), 'colors');

// ── presets pane ────────────────────────────────────────────
let presetsFolder: FolderApi = tagFolder(pane.addFolder({ title: 'presets', expanded: true }), 'presets');

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
    presetsFolder = tagFolder(pane.addFolder({ title: 'presets', expanded }), 'presets');

    if (dropdownOptions.length > 0) {
        presetsFolder.addBinding(presetUiState as unknown as Record<string, unknown>, 'selectedPresetKey', {
            label: 'name',
            view: 'list',
            options: dropdownOptions,
        }).on('change', () => {
            updatePresetButtonState();
        });
    }

    const loadBtn = presetsFolder.addButton({ title: 'load from browser' });

    presetsFolder.addButton({ title: 'save to browser' }).on('click', () => {
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
            emit(EVT_GPU_PARAMS_CHANGED, null);
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

    presetsFolder.addBlade({ view: 'separator' });

    presetsFolder.addButton({ title: 'reset' }).on('click', () => {
        try {
            resetSettingsToDefaults();
            updateDynamicGraphPanes();
            syncStaticSettingsPane();
            emit(EVT_GPU_PARAMS_CHANGED, null);
            emit(EVT_SETTINGS_UPDATED, null);
        } catch (err) {
            console.error('reset settings failed:', err);
            showError(`Reset settings failed: ${getErrorMessage(err)}`);
        }
    });

    presetsFolder.addBlade({ view: 'separator' });

    presetsFolder.addButton({ title: 'export to file' }).on('click', () => {
        try {
            exportSettingsToFile();
        } catch (err) {
            console.error('export settings failed:', err);
            showError(`Export settings failed: ${getErrorMessage(err)}`);
        }
    });

    presetsFolder.addButton({ title: 'import from file' }).on('click', () => {
        settingsImportInput.click();
    });
}

// ── settings file import/export ─────────────────────────────
// dedicated hidden input so it never clashes with the graph import input
const settingsImportInput = document.createElement('input');
settingsImportInput.type = 'file';
settingsImportInput.accept = '.json,application/json';
settingsImportInput.style.display = 'none';
document.body.appendChild(settingsImportInput);

settingsImportInput.addEventListener('change', async () => {
    const file = settingsImportInput.files?.[0];
    if (!file) return;
    try {
        importSettingsFromJson(await file.text());
        refreshAfterSettingsChange();
    } catch (err) {
        console.error('import settings failed:', err);
        showError(`Import settings failed: ${getErrorMessage(err)}`);
    } finally {
        // reset so selecting the same file again re-triggers change
        settingsImportInput.value = '';
    }
});

/** Serializes current display settings and triggers a file download. */
function exportSettingsToFile(): void {
    const blob = new Blob([exportSettingsToJson()], { type: 'application/json' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${timestamp}_display-settings.json`;
    a.click();
    URL.revokeObjectURL(url);
}

rebuildPresetsFolder();

// ── graph display pane (embedded-display reconciliation + authoring) ─
const graphDisplayFolder = tagFolder(pane.addFolder({ title: 'settings embedding', expanded: false, index: 0 }), 'embed');

const graphDisplayUiState = {
    mode: getGraphDisplayMode() as GraphDisplayMode,
};

graphDisplayFolder.addBinding(graphDisplayUiState, 'mode', {
    label: 'on graph load',
    view: 'list',
    options: GRAPH_DISPLAY_MODES.map((mode) => ({ text: mode, value: mode })),
}).on('change', () => {
    setGraphDisplayMode(graphDisplayUiState.mode);
});

graphDisplayFolder.addButton({ title: 'embed into graph' }).on('click', () => {
    const graph = getGraph();
    graph.display = snapshotCurrentSettings() as unknown as GraphDisplay;
    setGraphDirty(true);
});

graphDisplayFolder.addButton({ title: 'clear embedded settings' }).on('click', () => {
    const graph = getGraph();
    if (graph.display) {
        graph.display = undefined;
        setGraphDirty(true);
    }
});

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

    nodeFiltersFolder = tagFolder(pane.addFolder({ title: 'node filters', expanded: nfExpanded }), 'filters');
    edgeFiltersFolder = tagFolder(pane.addFolder({ title: 'edge filters', expanded: efExpanded }), 'filters');
    nodeColorsFolder = tagFolder(pane.addFolder({ title: 'node colors', expanded: ncExpanded }), 'colors');
    edgeColorsFolder = tagFolder(pane.addFolder({ title: 'edge colors', expanded: ecExpanded }), 'colors');
    edgeWidthsFolder = tagFolder(pane.addFolder({ title: 'edge widths', expanded: ewExpanded }), 'colors');

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
        }).on('change', () => {
            emit(EVT_WIDTHS_UPDATED, null);
        });
    }

    rebuildPresetsFolder();
    syncStaticSettingsPane();
}
