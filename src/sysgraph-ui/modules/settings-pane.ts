import type { LabelRendering, LabelStyle } from '../engine/labels.js';
import {
    EVT_COLORS_UPDATED, EVT_FILTERS_UPDATED, EVT_GPU_PARAMS_CHANGED,
    EVT_NODE_SIZING_UPDATED, EVT_RENDER_OPTIONS_CHANGED, EVT_SETTINGS_UPDATED,
    EVT_WIDTHS_UPDATED, PANEL_SETTINGS,
} from './constants.js';
import { emit, on } from './event-bus.js';
import {
    edgeFilterField, linkDistanceField, nodeFilterField, nodeLabelField,
    nodeSizingField, setExpressionPaneRefresh,
} from './expression-fields.js';
import { createFpsMeter } from './fps-meter.js';
import type { GraphDisplay } from './graph.js';
import {
    GRAPH_DISPLAY_MODES, type GraphDisplayMode, getGraphDisplayMode,
    setGraphDisplayMode,
} from './graph-display.js';
import { GraphViewInstance, refreshGraphColors } from './graph-ui.js';
import {
    validateEdgeFilterExpression, validateLinkDistanceExpression,
    validateNodeFilterExpression,
} from './graph-ui-appearance.js';
import { registerPanel } from './layout.js';
import { setFrameHooks } from './render-hooks.js';
import type { SettingsShape } from './settings.js';
import {
    getEdgeColor, getEdgeWidth, getNodeColor, settings,
    sortEdgeTypes, sortNodeTypes,
} from './settings.js';
import { createColorControl } from './settings-color-control.js';
import { SettingsForm, type ValueBinding } from './settings-form.js';
import type { PresetEntry, PresetSource } from './settings-presets.js';
import {
    applyEmbeddedDisplaySettings, applySettingsPreset, deleteSettingsPreset,
    exportSettingsToJson, importSettingsFromJson, listAllPresets,
    resetSettingsToDefaults, saveSettingsPreset, snapshotCurrentSettings,
} from './settings-presets.js';
import { createSettingsTabScroller } from './settings-tab-scroll.js';
import { clearPhysicsOverride, getGraph, setGraphDirty, setHighlight, state } from './state.js';
import { showActionToast, showError, showInfoToast } from './util.js';

const settingsPaneElement = document.getElementById('settingsPane');
if (!(settingsPaneElement instanceof HTMLElement)) {
    throw new Error('Missing element: settingsPane');
}
const settingsPane = settingsPaneElement;
settingsPaneElement.classList.add('sg-settings');

registerPanel({
    id: PANEL_SETTINGS,
    component: PANEL_SETTINGS,
    title: 'Settings',
    element: settingsPaneElement,
});

const navigation = document.createElement('nav');
navigation.className = 'sg-settings-nav';
navigation.setAttribute('aria-label', 'Settings categories');
navigation.setAttribute('role', 'tablist');
const tabScroller = createSettingsTabScroller(navigation);
const content = document.createElement('div');
content.className = 'sg-settings-content';
settingsPaneElement.append(tabScroller.element, content);

interface Section {
    details: HTMLDetailsElement;
    form: SettingsForm;
}

function section(title: string, category: string, expanded = false): Section {
    const details = document.createElement('details');
    details.className = `sg-settings-section sg-folder-${category}`;
    details.open = expanded;
    const summary = document.createElement('summary');
    summary.textContent = title;
    const body = document.createElement('div');
    body.className = 'sg-settings-section-body';
    details.append(summary, body);
    return { details, form: new SettingsForm(body) };
}

function setting<T>(key: keyof SettingsShape, onChange: () => void): ValueBinding<T> {
    const values = settings as unknown as Record<string, unknown>;
    return {
        get: () => values[key] as T,
        set: (value: T) => { values[key] = value; },
        onChange,
    };
}

function message(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

const layout = section('Automatic layout', 'forces', true);
const engineSimulation = section('Simulation', 'forces');
const engineForces = section('Forces', 'forces');
const engineLinks = section('Links', 'forces');
const engineRendering = section('Rendering', 'forces');
const displayGeneral = section('General', 'display');
const displayRendering = section('Rendering', 'display');
const displayGrid = section('Spatial grid', 'display');
const displayLabels = section('Labels', 'display');
const displayNodeSize = section('Node size', 'display');
const filterExpressions = section('Filter expressions', 'filters');
const nodeFiltersSection = section('Node filters', 'filters');
const edgeFiltersSection = section('Edge filters', 'filters');
const nodeColorsSection = section('Node colors', 'colors');
const edgeColorsSection = section('Edge colors', 'colors');
const edgeWidthsSection = section('Edge widths', 'colors');
const savedPresets = section('Saved presets', 'presets');
const manageSettings = section('Import, export & reset', 'presets');
const embedding = section('Settings embedding', 'embed');
for (const group of [layout, engineSimulation, engineForces, engineLinks, engineRendering,
    displayGeneral, displayRendering, displayGrid, displayLabels, displayNodeSize,
    nodeFiltersSection, edgeFiltersSection,
    nodeColorsSection, edgeColorsSection, edgeWidthsSection]) {
    group.details.classList.add('sg-settings-grid-section');
}

const tabs = [
    { id: 'layout', label: 'Layout', sections: [layout] },
    { id: 'engine', label: 'Engine', sections: [engineSimulation, engineForces, engineLinks, engineRendering] },
    { id: 'display', label: 'Display', sections: [displayGeneral, displayRendering, displayGrid, displayLabels, displayNodeSize] },
    { id: 'filters', label: 'Filters', sections: [filterExpressions, nodeFiltersSection, edgeFiltersSection] },
    { id: 'colors', label: 'Colors', sections: [nodeColorsSection, edgeColorsSection, edgeWidthsSection] },
    { id: 'presets', label: 'Presets', sections: [savedPresets, manageSettings] },
    { id: 'embedding', label: 'Embedding', sections: [embedding] },
] as const;
type TabId = typeof tabs[number]['id'];
const tabButtons = new Map<TabId, HTMLButtonElement>();
const tabPanels = new Map<TabId, HTMLElement>();
const SETTINGS_TAB_KEY = 'sysgraph:settings-tab';
let activeTab: TabId = 'layout';
const visitedTabs = new Set<TabId>();
content.replaceChildren();

function revealSelectedTab(id: TabId): void {
    tabScroller.reveal(tabButtons.get(id)!);
}

function selectTab(id: TabId): void {
    activeTab = id;
    for (const tab of tabs) {
        const selected = tab.id === id;
        const button = tabButtons.get(tab.id)!;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        tabPanels.get(tab.id)!.hidden = !selected;
        if (selected && !visitedTabs.has(id) && !tab.sections.some(section => section.details.open)) {
            tab.sections[0].details.open = true;
        }
    }
    visitedTabs.add(id);
    settingsPane.scrollTop = 0;
    revealSelectedTab(id);
    try { localStorage.setItem(SETTINGS_TAB_KEY, id); } catch { /* optional */ }
}

for (const tab of tabs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = `sg-tab-${tab.id}`;
    button.textContent = tab.label;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `sg-panel-${tab.id}`);
    button.classList.add(`sg-tab-${tab.id}`);
    button.addEventListener('click', () => selectTab(tab.id));
    navigation.appendChild(button);
    tabButtons.set(tab.id, button);

    const panel = document.createElement('div');
    panel.id = `sg-panel-${tab.id}`;
    panel.className = `sg-settings-tab-panel sg-tab-${tab.id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    panel.tabIndex = 0;
    for (const section of tab.sections) panel.appendChild(section.details);
    content.appendChild(panel);
    tabPanels.set(tab.id, panel);
}

navigation.addEventListener('keydown', event => {
    const current = tabs.findIndex(tab => tabButtons.get(tab.id) === event.target);
    if (current < 0) return;
    let next = current;
    if (event.key === 'ArrowRight') next = (current + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (current + tabs.length - 1) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = tabs[next]!;
    selectTab(tab.id);
    tabButtons.get(tab.id)?.focus();
});

let savedTab: TabId = 'layout';
try {
    const stored = localStorage.getItem(SETTINGS_TAB_KEY);
    if (tabs.some(tab => tab.id === stored)) savedTab = stored as TabId;
} catch { /* optional */ }
selectTab(savedTab);

const updatePaneShape = (): void => {
    const width = settingsPane.clientWidth;
    const height = settingsPane.clientHeight;
    settingsPane.classList.toggle('sg-settings-wide', width >= 640 && width >= height * 1.6);
    tabScroller.update();
    revealSelectedTab(activeTab);
};
new ResizeObserver(updatePaneShape).observe(settingsPane);
updatePaneShape();

let layoutChangeTimer = 0;
const layoutChange = (): void => {
    window.clearTimeout(layoutChangeTimer);
    layoutChangeTimer = window.setTimeout(() => emit(EVT_GPU_PARAMS_CHANGED, null), 120);
};
const layoutChangeNow = (): void => {
    window.clearTimeout(layoutChangeTimer);
    emit(EVT_GPU_PARAMS_CHANGED, null);
};
const engineChange = (): void => emit(EVT_GPU_PARAMS_CHANGED, null);
const renderChange = (): void => emit(EVT_RENDER_OPTIONS_CHANGED, null);

layout.form.select('Algorithm', setting<string>('layoutMode', () => {
    updateLayoutVisibility();
    layoutChangeNow();
}), [
    { text: 'GPU force', value: 'force' },
    { text: 'Layered flow', value: 'layered' },
    { text: 'Radial distance', value: 'radial' },
    { text: 'Circular', value: 'circular' },
    { text: 'Degree rings', value: 'concentric' },
    { text: 'Grid', value: 'grid' },
]);
const nodeSpacing = layout.form.range('Node spacing', setting<number>('layoutSpacing', layoutChange), 30, 300, 10);
const levelSpacing = layout.form.range('Level spacing', setting<number>('layoutRankSpacing', layoutChange), 40, 400, 10);
const direction = layout.form.select('Direction', setting<string>('layoutDirection', layoutChangeNow), [
    { text: 'Top to bottom', value: 'TB' },
    { text: 'Bottom to top', value: 'BT' },
    { text: 'Left to right', value: 'LR' },
    { text: 'Right to left', value: 'RL' },
]);
const rootId = layout.form.text('Root node ID', setting<string>('layoutRootId', layoutChange));
const useSelectedRoot = layout.form.button('Use selected node as root', () => {
    const selected = state.selection.selectedNodeIds.values().next().value;
    if (!selected) {
        showInfoToast('Select a node first to make it the layout root.');
        return;
    }
    settings.layoutRootId = selected;
    rootId.sync();
    layoutChangeNow();
});
layout.form.button('Reapply layout', () => GraphViewInstance.reapplyLayout());

function updateLayoutVisibility(): void {
    const mode = settings.layoutMode;
    nodeSpacing.element.hidden = mode === 'force';
    levelSpacing.element.hidden = mode !== 'layered' && mode !== 'radial' && mode !== 'concentric';
    direction.element.hidden = mode !== 'layered';
    rootId.element.hidden = mode !== 'radial' && mode !== 'circular';
    useSelectedRoot.hidden = rootId.element.hidden;
}
updateLayoutVisibility();

const forcePhysics = engineSimulation.form.toggle('Force physics', setting<boolean>('gpuEnablePhysics', () => {
    clearPhysicsOverride();
    engineChange();
}));
forcePhysics.element.classList.add('sg-setting-span-full');
engineSimulation.form.range('Layout ticks / sec', setting<number>('gpuLayoutRate', engineChange), 1, 60, 1);
engineSimulation.form.range('Warmup (ms)', setting<number>('gpuWarmupMs', engineChange), 0, 2500, 100);
engineForces.form.range('Repulsion', setting<number>('gpuCharge', engineChange), -1000, 0, 10);
engineForces.form.range('Link strength', setting<number>('gpuLinkStrength', engineChange), 0, 2, 0.05);
engineForces.form.range('Collision', setting<number>('gpuCollisionMultiplier', engineChange), 0, 3, 0.1);
engineForces.form.range('Velocity decay', setting<number>('gpuVelocityDecay', engineChange), 0, 0.95, 0.05);
engineForces.form.range('Centering', setting<number>('gpuForceXYStrength', engineChange), 0, 1, 0.01);
engineLinks.form.select('Link distance mode', setting<string>('gpuLinkDistanceMode', () => {
    updateLinkDistanceVisibility();
    engineChange();
}), [
    { text: 'Constant', value: 'constant' },
    { text: 'Expression', value: 'expression' },
]);
const linkDistance = engineLinks.form.range('Link distance', setting<number>('gpuLinkDistance', engineChange), 40, 500, 5);
const linkDistanceExpression = engineLinks.form.expression(
    'Link distance expression',
    setting<string>('gpuLinkDistanceExpression', engineChange),
    linkDistanceField,
    value => settings.gpuLinkDistanceMode === 'expression' ? validateLinkDistanceExpression(value) : null,
);
function updateLinkDistanceVisibility(): void {
    const expression = settings.gpuLinkDistanceMode === 'expression';
    linkDistance.element.hidden = expression;
    linkDistanceExpression.element.hidden = !expression;
}
updateLinkDistanceVisibility();
engineRendering.form.select('Edge rendering', setting<string>('gpuEdgeStyle', renderChange), [
    { text: 'Smooth', value: 'smooth' },
    { text: 'Thin', value: 'thin' },
]);
engineRendering.form.range('Edge stroke', setting<number>('gpuEdgeWidth', renderChange), 0.8, 4, 0.1);
engineRendering.form.toggle('Show nodes', setting<boolean>('gpuShowNodes', renderChange));
engineRendering.form.range('Node outline', setting<number>('gpuNodeOutline', renderChange), 0, 3.5, 0.1);
const fpsMeter = createFpsMeter();
engineSimulation.form.element.prepend(fpsMeter.element);
engineSimulation.details.querySelector('summary')?.appendChild(fpsMeter.summaryValue);
setFrameHooks(timestamp => fpsMeter.frame(timestamp), null);

displayGeneral.form.toggle('Show isolated', setting<boolean>('showIsolated', () => emit(EVT_SETTINGS_UPDATED, null)));
displayRendering.form.select('3D projection', setting<string>('cameraProjection', renderChange), [
    { text: 'Perspective', value: 'perspective' },
    { text: 'Orthographic', value: 'orthographic' },
]);
displayRendering.form.select('3D node rendering', setting<string>('nodeRenderStyle', renderChange), [
    { text: 'Simple', value: 'simple' },
    { text: 'Solid (lit spheres)', value: 'solid' },
]);
displayRendering.form.range('Scene brightness', setting<number>('sceneBrightness', renderChange), 0.5, 2, 0.05,
    'Brighten or dim nodes and edges in 2D and 3D. Labels, grid and background keep their contrast.');
displayGrid.form.toggle('Show grid', setting<boolean>('showGrid', renderChange));
displayGrid.form.range('Grid spacing (world units)', setting<number>('gridStep', renderChange), 25, 500, 5,
    'Distance between grid lines in graph world units. In 3D, the grid lies on the XY plane at Z = 0.');
displayGeneral.form.toggle('Highlight on hover', setting<boolean>('highlightOnHover', () => {
    if (!settings.highlightOnHover) {
        setHighlight(null);
        refreshGraphColors();
    }
    renderChange();
}));
displayGeneral.form.range('Edge alpha offset', setting<number>('globalEdgeAlphaOffset', () => emit(EVT_COLORS_UPDATED, null)), -1, 1, 0.01);
displayGeneral.form.range('Edge width multiplier', setting<number>('globalEdgeWidthMultiplier', () => emit(EVT_WIDTHS_UPDATED, null)), 0.1, 5, 0.1);
displayLabels.form.select('Node label', setting<string>('nodeLabelMode', () => {
    updateExpressionVisibility();
    emit(EVT_SETTINGS_UPDATED, null);
}), [
    { text: 'None', value: 'none' },
    { text: 'Type', value: 'type' },
    { text: 'ID', value: 'id' },
    { text: 'Expression', value: 'expression' },
]);
const nodeLabelExpression = displayLabels.form.expression('Label expression',
    setting<string>('nodeLabelExpression', () => emit(EVT_SETTINGS_UPDATED, null)),
    nodeLabelField, () => null);
function updateExpressionVisibility(): void {
    nodeLabelExpression.element.hidden = settings.nodeLabelMode !== 'expression';
}
updateExpressionVisibility();
displayLabels.form.select('Label density', setting<string>('labelDensity', () => emit(EVT_SETTINGS_UPDATED, null)), [
    { text: 'Auto (declutter)', value: 'auto' },
    { text: 'Focus', value: 'focus' },
]);
displayLabels.form.select('Label style', setting<LabelStyle>('labelStyle', renderChange), [
    { text: 'Text', value: 'plain' },
    { text: 'Text with outline', value: 'outlined' },
    { text: 'Text with soft background', value: 'soft-background' },
    { text: 'Text with bordered background', value: 'plate' },
]);
displayLabels.form.select('Text rendering', setting<LabelRendering>('labelRendering', renderChange), [
    { text: 'Individual glyphs (legacy)', value: 'glyphs' },
    { text: 'Individual glyphs, filtered', value: 'glyphs-filtered' },
    { text: 'Whole label bitmap', value: 'whole' },
    { text: 'Whole label, pixel aligned', value: 'whole-snapped' },
]);
displayNodeSize.form.select('Node sizing mode', setting<string>('nodeSizingMode', () => {
    updateSizingVisibility();
    emit(EVT_NODE_SIZING_UPDATED, null);
}), [
    { text: 'Degree', value: 'degree' },
    { text: 'Constant', value: 'constant' },
    { text: 'Expression', value: 'expression' },
]);
displayNodeSize.form.range('Size multiplier', setting<number>('nodeSizeScale', () => emit(EVT_NODE_SIZING_UPDATED, null)), 0.1, 8, 0.1,
    'Scale node sizes without changing their relative sizes.');
const nodeSizeConstant = displayNodeSize.form.range('Node size', setting<number>('nodeSizingConstant', () => emit(EVT_NODE_SIZING_UPDATED, null)),
    0.1, 24, 0.1, 'Zoom also scales node size.');
const nodeSizeExpression = displayNodeSize.form.expression('Node size expression',
    setting<string>('nodeSizingExpression', () => emit(EVT_NODE_SIZING_UPDATED, null)), nodeSizingField, () => null);
function updateSizingVisibility(): void {
    nodeSizeConstant.element.hidden = settings.nodeSizingMode !== 'constant';
    nodeSizeExpression.element.hidden = settings.nodeSizingMode !== 'expression';
}
updateSizingVisibility();

filterExpressions.form.expression('Nodes filter',
    setting<string>('nodeFilterExpression', () => emit(EVT_FILTERS_UPDATED, null)),
    nodeFilterField, value => value.trim() ? validateNodeFilterExpression(value) : null);
filterExpressions.form.expression('Edges filter',
    setting<string>('edgeFilterExpression', () => emit(EVT_FILTERS_UPDATED, null)),
    edgeFilterField, value => value.trim() ? validateEdgeFilterExpression(value) : null);

function syncStaticSettingsPane(): void {
    updateLayoutVisibility();
    updateLinkDistanceVisibility();
    updateExpressionVisibility();
    updateSizingVisibility();
    for (const group of [layout, engineSimulation, engineForces, engineLinks, engineRendering,
        displayGeneral, displayRendering, displayGrid, displayLabels, displayNodeSize,
        filterExpressions, embedding]) group.form.sync();
}

export function syncSettingsPane(): void {
    syncStaticSettingsPane();
    for (const group of [nodeFiltersSection, edgeFiltersSection, nodeColorsSection,
        edgeColorsSection, edgeWidthsSection, savedPresets, manageSettings]) group.form.sync();
}

setExpressionPaneRefresh(syncSettingsPane);
on(EVT_RENDER_OPTIONS_CHANGED, syncStaticSettingsPane);

/**
 * Fully refreshes the settings pane and graph rendering after the settings
 * object was mutated wholesale (preset load, embedded display, file import).
 */
function refreshAfterSettingsChange(): void {
    updateDynamicGraphPanes();
    syncStaticSettingsPane();
    emit(EVT_GPU_PARAMS_CHANGED, null);
    emit(EVT_SETTINGS_UPDATED, null);
    emit(EVT_NODE_SIZING_UPDATED, null);
    emit(EVT_RENDER_OPTIONS_CHANGED, null);
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

// Dynamic type controls keep their sections and open state when graphs change.
function countByType(types: Iterable<string>): Map<string, number> {
    const counts = new Map<string, number>();
    for (const type of types) counts.set(type, (counts.get(type) ?? 0) + 1);
    return counts;
}

function filterControls(
    target: Section, filters: Record<string, boolean>,
    keys: string[], counts: Map<string, number>,
): void {
    const form = target.form;
    form.clear();
    if (keys.length === 0) {
        form.element.textContent = 'No types in this graph.';
        return;
    }
    const actions = form.actions();
    form.button('Show all', () => {
        for (const key of keys) filters[key] = true;
        form.sync();
        emit(EVT_FILTERS_UPDATED, null);
    }, actions);
    form.button('Hide all', () => {
        for (const key of keys) filters[key] = false;
        form.sync();
        emit(EVT_FILTERS_UPDATED, null);
    }, actions);

    for (const key of keys) {
        if (!(key in filters)) filters[key] = true;
        const control = form.toggle(key, {
            get: () => filters[key] !== false,
            set: value => { filters[key] = value; },
            onChange: () => emit(EVT_FILTERS_UPDATED, null),
        }, (counts.get(key) ?? 0).toLocaleString());
        const wrapper = document.createElement('div');
        wrapper.className = 'sg-filter-row';
        control.element.replaceWith(wrapper);
        wrapper.appendChild(control.element);
        const only = document.createElement('button');
        only.type = 'button';
        only.className = 'sg-filter-only';
        only.textContent = 'Only';
        only.setAttribute('aria-label', `Show only ${key}`);
        only.addEventListener('click', () => {
            const isolated = keys.every(type => type === key ? filters[type] !== false : filters[type] === false);
            for (const type of keys) filters[type] = isolated ? true : type === key;
            form.sync();
            emit(EVT_FILTERS_UPDATED, null);
        });
        wrapper.appendChild(only);
        control.element.addEventListener('dblclick', event => {
            event.preventDefault();
            only.click();
        });
    }
}

function colorControls(
    target: Section, colors: typeof settings.nodeColors, keys: string[],
    fallback: (key: string) => typeof settings.nodeColors[string],
): void {
    const form = target.form;
    form.clear();
    form.element.classList.add('sg-color-list');
    if (keys.length === 0) {
        form.element.textContent = 'No types in this graph.';
        form.element.classList.add('sg-color-list-empty');
        return;
    }
    form.element.classList.remove('sg-color-list-empty');
    for (const key of keys) {
        if (!(key in colors)) colors[key] = structuredClone(fallback(key));
        form.register(createColorControl(
            key, () => colors[key]!, () => emit(EVT_COLORS_UPDATED, null),
        ));
    }
}

export function updateDynamicGraphPanes(): void {
    const graph = getGraph();
    const nodeCounts = countByType(graph.getNodes().map(node => node.type));
    const edgeCounts = countByType(graph.getEdges().map(edge => edge.type));
    const nodeTypes = sortNodeTypes(nodeCounts.keys());
    const edgeTypes = sortEdgeTypes(edgeCounts.keys());
    filterControls(nodeFiltersSection, settings.nodeFilters, nodeTypes, nodeCounts);
    filterControls(edgeFiltersSection, settings.edgeFilters, edgeTypes, edgeCounts);
    colorControls(nodeColorsSection, settings.nodeColors, nodeTypes, getNodeColor);
    colorControls(edgeColorsSection, settings.edgeColors, edgeTypes, getEdgeColor);
    edgeWidthsSection.form.clear();
    if (edgeTypes.length === 0) edgeWidthsSection.form.element.textContent = 'No edge types in this graph.';
    for (const key of edgeTypes) {
        if (!(key in settings.edgeWidths)) settings.edgeWidths[key] = getEdgeWidth(key);
        edgeWidthsSection.form.range(key, {
            get: () => settings.edgeWidths[key]!,
            set: value => { settings.edgeWidths[key] = value; },
            onChange: () => emit(EVT_WIDTHS_UPDATED, null),
        }, 0.5, 5, 0.5);
    }
    rebuildPresetsFolder();
    syncStaticSettingsPane();
}

const presetUiState = { selectedPresetKey: '' };
function presetKey(entry: PresetEntry): string {
    return `${entry.source}:${entry.name}`;
}
function parsePresetKey(key: string): { name: string; source: PresetSource } {
    const index = key.indexOf(':');
    return { source: key.slice(0, index) as PresetSource, name: key.slice(index + 1) };
}

function rebuildPresetsFolder(): void {
    const form = savedPresets.form;
    form.clear();
    const entries = listAllPresets();
    const keys = entries.map(presetKey);
    if (!keys.includes(presetUiState.selectedPresetKey)) presetUiState.selectedPresetKey = keys[0] ?? '';
    const selected = form.select('Preset', {
        get: () => presetUiState.selectedPresetKey,
        set: value => { presetUiState.selectedPresetKey = value; },
        onChange: updateButtons,
    }, entries.map(entry => ({
        text: entry.source === 'predefined' ? `${entry.name} *` : entry.name,
        value: presetKey(entry),
    })));
    if (keys.length === 0) selected.element.hidden = true;
    const actions = form.actions();
    const load = form.button('Load', () => {
        try {
            const { name, source } = parsePresetKey(presetUiState.selectedPresetKey);
            applySettingsPreset(name, source);
            refreshAfterSettingsChange();
        } catch (error) {
            showError(`Load preset failed: ${message(error)}`);
        }
    }, actions);
    form.button('Save as…', () => {
        const name = window.prompt('Preset name')?.trim();
        if (!name) return;
        try {
            saveSettingsPreset(name);
            presetUiState.selectedPresetKey = presetKey({ name, source: 'user' });
            rebuildPresetsFolder();
        } catch (error) {
            showError(`Save preset failed: ${message(error)}`);
        }
    }, actions);
    const remove = form.button('Delete', () => {
        const { name } = parsePresetKey(presetUiState.selectedPresetKey);
        if (!window.confirm(`Delete "${name}"?`)) return;
        try {
            deleteSettingsPreset(name);
            rebuildPresetsFolder();
        } catch (error) {
            showError(`Delete preset failed: ${message(error)}`);
        }
    }, actions);
    remove.classList.add('sg-setting-actions-full');
    function updateButtons(): void {
        const empty = !presetUiState.selectedPresetKey;
        load.disabled = empty;
        remove.disabled = empty || parsePresetKey(presetUiState.selectedPresetKey).source === 'predefined';
    }
    updateButtons();
}

const settingsImportInput = document.createElement('input');
settingsImportInput.type = 'file';
settingsImportInput.accept = '.json,application/json';
settingsImportInput.hidden = true;
document.body.appendChild(settingsImportInput);
settingsImportInput.addEventListener('change', async () => {
    const file = settingsImportInput.files?.[0];
    if (!file) return;
    try {
        importSettingsFromJson(await file.text());
        refreshAfterSettingsChange();
    } catch (error) {
        showError(`Import settings failed: ${message(error)}`);
    } finally {
        settingsImportInput.value = '';
    }
});
function exportSettingsToFile(): void {
    const blob = new Blob([exportSettingsToJson()], { type: 'application/json' });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${timestamp}_display-settings.json`;
    anchor.click();
    URL.revokeObjectURL(url);
}
const manage = manageSettings.form.actions();
manageSettings.form.button('Export to file', exportSettingsToFile, manage);
manageSettings.form.button('Import from file', () => settingsImportInput.click(), manage);
const resetSettings = manageSettings.form.button('Reset to defaults', () => {
    resetSettingsToDefaults();
    refreshAfterSettingsChange();
}, manage);
resetSettings.classList.add('sg-setting-actions-full');
rebuildPresetsFolder();

embedding.form.select<GraphDisplayMode>('On graph load', {
    get: getGraphDisplayMode,
    set: setGraphDisplayMode,
    onChange: () => {},
}, GRAPH_DISPLAY_MODES.map(mode => ({ text: mode, value: mode })));
embedding.form.button('Embed into graph', () => {
    getGraph().display = snapshotCurrentSettings() as unknown as GraphDisplay;
    setGraphDirty(true);
});
embedding.form.button('Clear embedded settings', () => {
    const graph = getGraph();
    if (graph.display) {
        graph.display = undefined;
        setGraphDirty(true);
    }
});
