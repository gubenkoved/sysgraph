import { settings, getDefaultNodeColor, getDefaultEdgeColor } from './settings.js';
import { getGraph, resetState, updateGraph } from './state.js';
import { Graph } from './graph.js';
import { ForceGraphInstance, refreshGraphUI } from './graph-ui.js';
import { emit } from './event-bus.js';
import { loadDataFromApi, serializeGraph, parseGraphData } from './data-io.js';

import { Pane } from 'https://cdn.jsdelivr.net/npm/tweakpane@4.0.5/dist/tweakpane.min.js';

const pane = new Pane({
    title: 'parameters',
    container: document.getElementById("settingsPane"),
});

// --- refresh button ---
pane.addButton({ title: 'refresh data' }).on('click', async () => {
    const loadedData = await loadDataFromApi();
    updateGraph(new Graph(loadedData.nodes, loadedData.edges));
    refreshGraphUI();
});

// --- d3 simulation parameters (data-driven) ---
const d3Params = [
    { key: 'd3Charge',              min: -800, max: 100,  step: 10   },
    { key: 'd3LinkDistance',         min: 40,   max: 300,  step: 5    },
    { key: 'd3LinkStrength',        min: 0.0,  max: 1.0,  step: 0.01 },
    { key: 'd3CollisionMultiplier', min: 0.5,  max: 2.0,  step: 0.05 },
    { key: 'd3AlphaTarget',         min: 0.0,  max: 0.5,  step: 0.01 },
    { key: 'd3VelocityDecay',       min: 0.01, max: 0.99, step: 0.01 },
    { key: 'd3ForceXYStrength',     min: 0.00, max: 0.99, step: 0.01 },
];

for (const p of d3Params) {
    pane.addBinding(settings, p.key, p).on('change', () => {
        emit("d3-simulation-parameters-changed", null);
    });
}

pane.addBinding(settings, 'd3CenterForce').on('change', () => {
    emit("d3-simulation-parameters-changed", null);
});

pane.addBlade({ view: 'separator' });

// --- graph display settings ---
pane.addBinding(settings, 'showIsolated').on('change', () => {
    refreshGraphUI();
});

pane.addBinding(settings, 'curvatureStep', { min: 0.0, max: 0.200, step: 0.001 }).on('change', () => {
    emit("graph-ui-links-curvature-updated", null);
});

// --- pin / unpin ---
pane.addButton({ title: 'pin all' }).on('click', () => {
    const graphData = ForceGraphInstance.graphData();
    graphData.nodes.forEach(node => {
        node.fx = node.x;
        node.fy = node.y;
    });
});

pane.addButton({ title: 'unpin all' }).on('click', () => {
    const graphData = ForceGraphInstance.graphData();
    graphData.nodes.forEach(node => {
        node.fx = undefined;
        node.fy = undefined;
    });
});

pane.addBlade({ view: 'separator' });

// --- clear / export / import ---
pane.addButton({ title: 'clear' }).on('click', async () => {
    emit("clear-button-clicked", null);
});

pane.addButton({ title: 'export data' }).on('click', () => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const graph = getGraph();
    const blob = new Blob([serializeGraph(graph)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${timestamp}_graph.json`;
    a.click();
    URL.revokeObjectURL(url);
});

pane.addButton({ title: 'import data' }).on('click', () => {
    document.getElementById('importFile').click();
});

document.getElementById('importFile').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const text = await file.text();
    const loadedData = parseGraphData(text);

    resetState();
    updateGraph(new Graph(loadedData.nodes, loadedData.edges));

    await refreshGraphUI();

    event.target.value = '';
});

// --- filter panes ---
let nodeFiltersFolder = pane.addFolder({ title: "node filters", expanded: false });
let edgeFiltersFolder = pane.addFolder({ title: "edge filters", expanded: false });

// --- color panes ---
let nodeColorsFolder = pane.addFolder({ title: "node colors", expanded: true });
let edgeColorsFolder = pane.addFolder({ title: "edge colors", expanded: true });

export function updateDynamicGraphPanes() {
    const nfExpanded = nodeFiltersFolder.expanded;
    const efExpanded = edgeFiltersFolder.expanded;
    const ncExpanded = nodeColorsFolder.expanded;
    const ecExpanded = edgeColorsFolder.expanded;

    nodeFiltersFolder.dispose();
    edgeFiltersFolder.dispose();
    nodeColorsFolder.dispose();
    edgeColorsFolder.dispose();

    nodeFiltersFolder = pane.addFolder({ title: "node filters", expanded: nfExpanded });
    edgeFiltersFolder = pane.addFolder({ title: "edge filters", expanded: efExpanded });
    nodeColorsFolder = pane.addFolder({ title: "node colors", expanded: ncExpanded });
    edgeColorsFolder = pane.addFolder({ title: "edge colors", expanded: ecExpanded });

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
            refreshGraphUI();
        });
    }

    for (const key of edgeTypes) {
        if (!(key in settings.edgeFilters)) {
            settings.edgeFilters[key] = true;
        }
        edgeFiltersFolder.addBinding(settings.edgeFilters, key).on('change', () => {
            refreshGraphUI();
        });
    }

    for (const key of nodeTypes) {
        if (!(key in settings.nodeColors)) {
            settings.nodeColors[key] = structuredClone(getDefaultNodeColor(key));
        }
        nodeColorsFolder.addBinding(settings.nodeColors, key);
    }

    for (const key of edgeTypes) {
        if (!(key in settings.edgeColors)) {
            settings.edgeColors[key] = structuredClone(getDefaultEdgeColor(key));
        }
        edgeColorsFolder.addBinding(settings.edgeColors, key);
    }
}
