import { state, getGraph, updateGraph, resetState } from './modules/state.js';
import { Graph } from './modules/graph.js';
import { refreshGraphUI, computeMatchColors, autoAdjustCurvature, applyD3Params } from './modules/graph-ui.js';
import { on, emit, registerHandler } from './modules/event-bus.js';
import { search } from './modules/search.js';
import { loadDataFromApi, serializeGraph, parseGraphData } from './modules/data-io.js';
import { updateDynamicGraphPanes } from './modules/settings-pane.js';
import { initToolbar, updateSelectionInfo } from './modules/toolbar.js';
import { initSelection } from './modules/selection.js';
import JSONFormatter from 'json-formatter-js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/button/text-button.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/textfield/outlined-text-field.js';

// --- cached DOM elements ---
const searchMatchCountEl = document.getElementById('searchMatchCount');
const addToSelectionBtn = document.getElementById('addToSelection');
const detailsPanel = document.getElementById('detailsPanel');
const detailsPanelBody = document.getElementById('detailsPanelBody');
const detailsPanelClose = document.getElementById('detailsPanelClose');

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
    detailsPanelBody.innerHTML = '';
    detailsPanelBody.appendChild(formatter.render());
    detailsPanel.classList.add('open');
}

/** Hides the details panel. */
function hideDetails() {
    detailsPanel.classList.remove('open');
}

detailsPanelClose.addEventListener('click', () => hideDetails());

// --- drag support for details panel ---
{
    const header = detailsPanel.querySelector('.panel-header');
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header.addEventListener('pointerdown', (e) => {
        if (e.target.closest('md-icon-button')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = detailsPanel.offsetLeft;
        startTop = detailsPanel.offsetTop;
        header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const parent = detailsPanel.parentElement;
        const x = Math.max(0, Math.min(startLeft + e.clientX - startX, parent.clientWidth - detailsPanel.offsetWidth));
        const y = Math.max(0, Math.min(startTop + e.clientY - startY, parent.clientHeight - detailsPanel.offsetHeight));
        detailsPanel.style.left = x + 'px';
        detailsPanel.style.top = y + 'px';
    });

    header.addEventListener('pointerup', () => { dragging = false; });
}

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
