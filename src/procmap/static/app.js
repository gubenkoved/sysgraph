import { state, getGraph, updateGraph, resetState } from './modules/state.js';
import { Graph } from './modules/graph.js';
import { refreshGraphUI } from './modules/graph-ui.js';
import { on, emit } from './modules/event-bus.js';
import { search } from './modules/search.js';
import { loadDataFromApi } from './modules/data-io.js';
import { updateDynamicGraphPanes } from './modules/settings-pane.js';
import { initToolbar, updateSelectionInfo } from './modules/toolbar.js';
import { initSelection, setUpdateSelectionInfo } from './modules/selection.js';
import JSONFormatter from "https://cdn.jsdelivr.net/npm/json-formatter-js/+esm";

// --- details panel ---
const detailsContainer = document.getElementById('details');

function showDetails(nodeOrLink) {
    const data = {
        id: nodeOrLink.id,
        type: nodeOrLink.type,
        kind: nodeOrLink.kind,
        properties: nodeOrLink.properties || {},
    };

    const formatter = new JSONFormatter(data, 2);

    while (detailsContainer.firstChild) {
        detailsContainer.removeChild(detailsContainer.firstChild);
    }
    detailsContainer.appendChild(formatter.render());
    detailsContainer.hidden = false;
}

function hideDetails() {
    detailsContainer.hidden = true;
}

// --- event wiring ---
on("node-clicked", node => showDetails(node));
on("link-clicked", link => showDetails(link));
on("pre-graph-ui-refresh", () => updateDynamicGraphPanes());
on("background-click", () => hideDetails());
on("clear-button-clicked", async () => {
    resetState();
    await refreshGraphUI();
});

on("search-expression-changed", (expression) => {
    const graph = getGraph();
    const result = search(graph, expression);
    state.selection.selectedNodeIds = result.nodeIds;
    updateSelectionInfo();
});

// --- initialize selection overlay & toolbar ---
const { selectionCanvas, canvas } = initSelection();
setUpdateSelectionInfo(updateSelectionInfo);
initToolbar(selectionCanvas, canvas);

// --- initial load ---
window.addEventListener('load', async () => {
    console.log("initial loading...");
    emit("d3-simulation-parameters-changed", null);
    const loadedData = await loadDataFromApi();
    const graph = new Graph(loadedData.nodes, loadedData.edges);
    updateGraph(graph);
    refreshGraphUI();
});
