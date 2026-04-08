import { state, getGraph, updateGraph, resetState } from './modules/state.js';
import { Graph } from './modules/graph.js';
import { refreshGraphUI, computeMatchColors, autoAdjustCurvature, applyD3Params } from './modules/graph-ui.js';
import { on, emit, registerHandler } from './modules/event-bus.js';
import { search } from './modules/search.js';
import { loadDataFromApi, serializeGraph, parseGraphData } from './modules/data-io.js';
import { updateDynamicGraphPanes } from './modules/settings-pane.js';
import { initToolbar, updateSelectionInfo } from './modules/toolbar.js';
import { initSelection } from './modules/selection.js';
import JSONFormatter from "https://cdn.jsdelivr.net/npm/json-formatter-js/+esm";
import WinBox from "https://unpkg.com/winbox@0.2.82/src/js/winbox.js";

// --- cached DOM elements ---
const searchMatchCountEl = document.getElementById('searchMatchCount');
const addToSelectionBtn = document.getElementById('addToSelection');

/** @type {WinBox|null} */
let detailsWinBox = null;

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

    if (detailsWinBox) {
        detailsWinBox.body.innerHTML = '';
        detailsWinBox.body.appendChild(formatter.render());
        detailsWinBox.show();
    } else {
        detailsWinBox = new WinBox({
            title: 'Details',
            class: ['no-full', 'no-max', 'no-min', 'details-window'],
            html: '',
            x: 8,
            y: 56,
            width: 460,
            height: 350,
            minwidth: 200,
            minheight: 80,
            top: 48,
            right: 0,
            bottom: 0,
            left: 0,
            onclose: function () {
                detailsWinBox = null;
                return false;
            },
        });
        detailsWinBox.body.appendChild(formatter.render());
    }
}

/** Hides the details panel. */
function hideDetails() {
    if (detailsWinBox) {
        detailsWinBox.close(true);
        detailsWinBox = null;
    }
}

window.addEventListener('resize', () => {
    if (!detailsWinBox) return;
    const maxX = window.innerWidth - detailsWinBox.width;
    const maxY = window.innerHeight - detailsWinBox.height;
    const x = Math.max(0, Math.min(detailsWinBox.x, maxX));
    const y = Math.max(48, Math.min(detailsWinBox.y, maxY));
    detailsWinBox.move(x, y);
});

// --- event wiring ---
on("node-clicked", node => showDetails(node));
on("link-clicked", link => showDetails(link));
on("graph-updated", async () => {
    updateDynamicGraphPanes();
    await refreshGraphUI();
});
on("background-click", () => hideDetails());
on("clear-button-clicked", async () => {
    resetState();
    emit("graph-updated", null);
});
on("graph-filters-updated", async () => {
    await refreshGraphUI();
})

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

on("selection-changed", () => updateSelectionInfo());

// graph ui related handlers
on("graph-ui-settings-updated", async () => {
    await refreshGraphUI();
});
on("graph-ui-links-curvature-updated", autoAdjustCurvature);
on("d3-simulation-parameters-changed", applyD3Params);

// --- command handlers ---
registerHandler("export-graph", () => {
    const graph = getGraph();
    return new Blob([serializeGraph(graph)], { type: 'application/json' });
});

registerHandler("import-graph", (text) => {
    const loadedData = parseGraphData(text);
    resetState();
    updateGraph(new Graph(loadedData.nodes, loadedData.edges));
    emit("graph-updated", null);
});

registerHandler("reload-graph", async () => {
    const loadedData = await loadDataFromApi();
    updateGraph(new Graph(loadedData.nodes, loadedData.edges));
    emit("graph-updated", null);
});

// --- initialize selection overlay & toolbar ---
const { selectionCanvas, canvas } = initSelection();
initToolbar(selectionCanvas, canvas);

// --- initial load ---
window.addEventListener('load', async () => {
    console.log("initial loading...");
    emit("d3-simulation-parameters-changed", null);
    const loadedData = await loadDataFromApi();
    const graph = new Graph(loadedData.nodes, loadedData.edges);
    updateGraph(graph);
    emit("graph-updated", null);
});
