import { state, getGraph, updateGraph, resetState } from './modules/state.js';
import { Graph } from './modules/graph.js';
import { refreshGraphUI, computeMatchColors } from './modules/graph-ui.js';
import { on, emit } from './modules/event-bus.js';
import { search } from './modules/search.js';
import { loadDataFromApi } from './modules/data-io.js';
import { updateDynamicGraphPanes } from './modules/settings-pane.js';
import { initToolbar, updateSelectionInfo } from './modules/toolbar.js';
import { initSelection, setUpdateSelectionInfo } from './modules/selection.js';
import JSONFormatter from "https://cdn.jsdelivr.net/npm/json-formatter-js/+esm";

// --- cached DOM elements ---
/** @type {HTMLElement} */
const detailsContainer = document.getElementById('details');
const searchMatchCountEl = document.getElementById('searchMatchCount');
const addToSelectionBtn = document.getElementById('addToSelection');

/**
 * Renders the properties of a node or link in the details panel.
 * @param {{ id: string, type: string, kind: string, properties?: Object }} nodeOrLink
 */
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

/** Hides the details panel. */
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
    if (expression && expression.trim()) {
        const graph = getGraph();
        const matches = search(graph, expression);
        const matchesMap = new Map(matches.map(x => [x.nodeId, x]));
        state.search = {
            matchesMap,
            matchColorsMap: computeMatchColors(matchesMap),
        }
        searchMatchCountEl.textContent = `${matchesMap.size} match${matchesMap.size !== 1 ? 'es' : ''}`;
        searchMatchCountEl.style.display = 'inline';
        addToSelectionBtn.disabled = matchesMap.size === 0;
    } else {
        state.search = null;
        searchMatchCountEl.style.display = 'none';
        addToSelectionBtn.disabled = true;
    }
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
