import { getGraph, updateGraph, resetState, setSearch } from './modules/state.js';
import { Graph } from './modules/graph.js';
import { refreshGraphUI, refreshGraphColors, computeMatchColors, autoAdjustCurvature, applyD3Params } from './modules/graph-ui.js';
import { on, emit, registerHandler } from './modules/event-bus.js';
import { search, SearchSyntaxError } from './modules/search.js';
import { loadDataFromApi, serializeGraph, parseGraphData } from './modules/data-io.js';
import { updateDynamicGraphPanes } from './modules/settings-pane.js';
import { initToolbar, updateSelectionInfo } from './modules/toolbar.js';
import { initSelection } from './modules/selection.js';
import { showError, dismissError } from './modules/util.js';
import './modules/details-panel.js';
import {
    EVT_GRAPH_UPDATED, EVT_CLEAR_CLICKED, EVT_FILTERS_UPDATED,
    EVT_SEARCH_CHANGED, EVT_SELECTION_CHANGED, EVT_SETTINGS_UPDATED,
    EVT_COLORS_UPDATED,
    EVT_CURVATURE_UPDATED, EVT_D3_PARAMS_CHANGED,
    CMD_RELOAD, CMD_EXPORT, CMD_IMPORT,
} from './modules/constants.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/button/text-button.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/textfield/outlined-text-field.js';

// --- cached DOM elements ---
const searchMatchCountEl = document.getElementById('searchMatchCount') as HTMLElement;
const addToSelectionBtn = document.getElementById('addToSelection') as HTMLButtonElement;

// --- event wiring ---
on(EVT_GRAPH_UPDATED, async () => {
    updateDynamicGraphPanes();
    await refreshGraphUI();
});

on(EVT_CLEAR_CLICKED, async () => {
    resetState();
    emit(EVT_GRAPH_UPDATED, null);
});

on(EVT_FILTERS_UPDATED, async () => {
    await refreshGraphUI();
});

on(EVT_SEARCH_CHANGED, (expression: string) => {
    if (expression?.trim()) {
        try {
            const graph = getGraph();
            const matches = search(graph, expression);
            const matchesMap = new Map(matches.map(x => [x.nodeId, x]));
            setSearch({
                matchesMap,
                matchColorsMap: computeMatchColors(matchesMap),
            });
            dismissError('search-syntax');
            searchMatchCountEl.textContent = `${matchesMap.size} match${matchesMap.size !== 1 ? 'es' : ''}`;
            searchMatchCountEl.style.display = 'inline';
            addToSelectionBtn.disabled = matchesMap.size === 0;
        } catch (err) {
            if (err instanceof SearchSyntaxError) {
                setSearch(null);
                searchMatchCountEl.style.display = 'none';
                addToSelectionBtn.disabled = true;
                showError(err.message, { id: 'search-syntax' });
            } else {
                console.error('search error:', err);
                setSearch(null);
                searchMatchCountEl.style.display = 'none';
                addToSelectionBtn.disabled = true;
            }
        }
    } else {
        setSearch(null);
        dismissError('search-syntax');
        searchMatchCountEl.style.display = 'none';
        addToSelectionBtn.disabled = true;
    }
});

on(EVT_SELECTION_CHANGED, () => updateSelectionInfo());

on(EVT_SETTINGS_UPDATED, async () => {
    await refreshGraphUI();
});

on(EVT_COLORS_UPDATED, () => {
    refreshGraphColors();
});

on(EVT_CURVATURE_UPDATED, autoAdjustCurvature);
on(EVT_D3_PARAMS_CHANGED, applyD3Params);

// --- command handlers ---
registerHandler(CMD_EXPORT, () => {
    const graph = getGraph();
    return new Blob([serializeGraph(graph)], { type: 'application/json' });
});

registerHandler(CMD_IMPORT, async (text?: string) => {
    if (!text) return;
    try {
        const loadedData = parseGraphData(text);
        resetState();
        updateGraph(new Graph(loadedData.nodes, loadedData.edges));
        emit(EVT_GRAPH_UPDATED, null);
    } catch (err) {
        console.error('import failed:', err);
        showError(`Import failed: ${(err as Error).message}`);
    }
});

registerHandler(CMD_RELOAD, async () => {
    try {
        const loadedData = await loadDataFromApi();
        updateGraph(new Graph(loadedData.nodes, loadedData.edges));
        emit(EVT_GRAPH_UPDATED, null);
    } catch (err) {
        console.error('reload failed:', err);
        showError(`Reload failed: ${(err as Error).message}`);
    }
});

// --- initialize selection overlay & toolbar ---
const { selectionCanvas, canvas } = initSelection();
initToolbar(selectionCanvas, canvas);

// --- initial load ---
window.addEventListener('load', async () => {
    emit(EVT_D3_PARAMS_CHANGED, null);
    try {
        const loadedData = await loadDataFromApi();
        updateGraph(new Graph(loadedData.nodes, loadedData.edges));
        emit(EVT_GRAPH_UPDATED, null);
    } catch (err) {
        console.error('initial load failed:', err);
        showError(`Failed to load graph: ${(err as Error).message}`);
    }
});
