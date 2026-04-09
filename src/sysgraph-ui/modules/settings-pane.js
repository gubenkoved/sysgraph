import { settings, getNodeColor, getEdgeColor, getEdgeWidth } from './settings.js';
import { getGraph } from './state.js';
import { ForceGraphInstance } from './graph-ui.js';
import { emit, handle } from './event-bus.js';

import { Pane } from 'tweakpane';

const pane = new Pane({
    title: 'parameters',
    container: document.getElementById("settingsPane"),
});

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
        emit("d3-simulation-parameters-changed", null);
    });
}

d3RenderingSettingsFolder.addBinding(settings, 'd3CenterForce').on('change', () => {
    emit("d3-simulation-parameters-changed", null);
});

// --- graph display settings ---
const displayOptionsFolder = pane.addFolder({ title: "display options", expanded: false });

displayOptionsFolder.addBinding(settings, 'showIsolated').on('change', () => {
    emit("graph-ui-settings-updated", null);
});

displayOptionsFolder.addBinding(settings, 'showGrid').on('change', () => {
    emit("graph-ui-settings-updated", null);
});

displayOptionsFolder.addBinding(settings, 'curvatureStep', { min: 0.0, max: 0.200, step: 0.001 }).on('change', () => {
    emit("graph-ui-links-curvature-updated", null);
});

// --- label settings ---
const labelSettingsFolder = pane.addFolder({ title: "label settings", expanded: false });

const nodeLabelModeBinding = labelSettingsFolder.addBinding(settings, 'nodeLabelMode', {
    label: 'node label',
    view: 'list',
    options: [
        { text: 'default', value: 'default' },
        { text: 'type', value: 'type' },
        { text: 'id', value: 'id' },
        { text: 'expression', value: 'expression' },
    ],
});

const nodeLabelExpressionBinding = labelSettingsFolder.addBinding(settings, 'nodeLabelExpression', {
    label: 'expression',
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

const actionsFolder = pane.addFolder({ title: "actions", expanded: true });

// --- refresh button ---
actionsFolder.addButton({ title: 'reload sysgraph' }).on('click', async () => {
    await handle("reload-graph");
});

actionsFolder.addBlade({ view: 'separator' });

// --- pin / unpin ---
actionsFolder.addButton({ title: 'pin all' }).on('click', () => {
    const graphData = ForceGraphInstance.graphData();
    graphData.nodes.forEach(node => {
        node.fx = node.x;
        node.fy = node.y;
    });
});

actionsFolder.addButton({ title: 'unpin all' }).on('click', () => {
    const graphData = ForceGraphInstance.graphData();
    graphData.nodes.forEach(node => {
        node.fx = undefined;
        node.fy = undefined;
    });
});

actionsFolder.addBlade({ view: 'separator' });

// --- clear / export / import ---
actionsFolder.addButton({ title: 'clear' }).on('click', async () => {
    emit("clear-button-clicked", null);
});

actionsFolder.addButton({ title: 'export data' }).on('click', () => {
    const blob = handle("export-graph");
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${timestamp}_graph.json`;
    a.click();
    URL.revokeObjectURL(url);
});

actionsFolder.addButton({ title: 'import data' }).on('click', () => {
    document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const text = await file.text();
    await handle("import-graph", text);

    event.target.value = '';
});

// --- filter panes ---
let nodeFiltersFolder = pane.addFolder({ title: "node filters", expanded: false });
let edgeFiltersFolder = pane.addFolder({ title: "edge filters", expanded: false });

// --- color panes ---
let nodeColorsFolder = pane.addFolder({ title: "node colors", expanded: true });
let edgeColorsFolder = pane.addFolder({ title: "edge colors", expanded: true });

// --- edge width pane ---
let edgeWidthsFolder = pane.addFolder({ title: "edge widths", expanded: false });

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

    const nodeTypes = new Set();
    for (const node of graph.getNodes()) {
        nodeTypes.add(node.type);
    }

    const edgeTypes = new Set();
    for (const edge of graph.getEdges()) {
        edgeTypes.add(edge.type);
    }

    for (const key of nodeTypes) {
        if (!(key in settings.nodeFilters)) {
            settings.nodeFilters[key] = true;
        }
        nodeFiltersFolder.addBinding(settings.nodeFilters, key).on('change', () => {
            emit("graph-filters-updated", null);
        });
    }

    for (const key of edgeTypes) {
        if (!(key in settings.edgeFilters)) {
            settings.edgeFilters[key] = true;
        }
        edgeFiltersFolder.addBinding(settings.edgeFilters, key).on('change', () => {
            emit("graph-filters-updated", null);
        });
    }

    // initialize colors and edge widths in settings
    for (const key of nodeTypes) {
        if (!(key in settings.nodeColors)) {
            settings.nodeColors[key] = structuredClone(getNodeColor(key));
        }
        nodeColorsFolder.addBinding(settings.nodeColors, key);
    }

    for (const key of edgeTypes) {
        if (!(key in settings.edgeColors)) {
            settings.edgeColors[key] = structuredClone(getEdgeColor(key));
        }
        edgeColorsFolder.addBinding(settings.edgeColors, key);
    }

    for (const key of edgeTypes) {
        if (!(key in settings.edgeWidths)) {
            settings.edgeWidths[key] = getEdgeWidth(key);
        }
        edgeWidthsFolder.addBinding(settings.edgeWidths, key, {
            min: 0.5, max: 5, step: 0.5,
        });
    }
}
