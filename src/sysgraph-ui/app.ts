import { state, getGraph, updateGraph, resetState, setSearch } from './modules/state.js';
import { Graph } from './modules/graph.js';
import { refreshGraphUI, refreshGraphColors, computeMatchColors, autoAdjustCurvature, applyD3Params, ForceGraphInstance } from './modules/graph-ui.js';
import { on, emit, registerHandler } from './modules/event-bus.js';
import { search, SearchSyntaxError } from './modules/search.js';
import { loadDataFromApi, serializeGraph, parseGraphData } from './modules/data-io.js';
import { updateDynamicGraphPanes } from './modules/settings-pane.js';
import { initToolbar, updateGraphInfo } from './modules/toolbar.js';
import { initSelection } from './modules/selection.js';
import { initZoomIndicator } from './modules/zoom-indicator.js';
import { showError, dismissError } from './modules/util.js';
import './modules/details-panel.js';
import {
    EVT_GRAPH_UPDATED, EVT_CLEAR_CLICKED, EVT_FILTERS_UPDATED,
    EVT_SEARCH_CHANGED, EVT_SEARCH_CYCLE, EVT_SELECTION_CHANGED, EVT_SETTINGS_UPDATED,
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
const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;

// --- event wiring ---
on(EVT_GRAPH_UPDATED, async () => {
    updateDynamicGraphPanes();
    await refreshGraphUI();
    updateGraphInfo();
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
                matches,
                currentMatchIndex: -1,
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

on(EVT_SELECTION_CHANGED, () => updateGraphInfo());

on(EVT_SEARCH_CYCLE, ({ direction }: { direction: 1 | -1 }) => {
    const search = state.search;
    if (!search || search.matches.length === 0) return;
    const total = search.matches.length;
    const next = search.currentMatchIndex === -1 && direction === -1
        ? total - 1
        : ((search.currentMatchIndex + direction) % total + total) % total;
    search.currentMatchIndex = next;
    const nodeId = search.matches[next].nodeId;
    const nodes = ForceGraphInstance.graphData().nodes as Array<{ id: string; x?: number; y?: number }>;
    const node = nodes.find(n => n.id === nodeId);
    if (node?.x != null && node?.y != null) {
        ForceGraphInstance.centerAt(node.x, node.y, 500);
    }
    searchMatchCountEl.textContent = `${next + 1} / ${total} match${total !== 1 ? 'es' : ''}`;
    searchMatchCountEl.style.display = 'inline';
});

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
    loadingOverlay.classList.add('visible');
    try {
        const loadedData = await loadDataFromApi();
        updateGraph(new Graph(loadedData.nodes, loadedData.edges));
        emit(EVT_GRAPH_UPDATED, null);
    } catch (err) {
        console.error('reload failed:', err);
        showError(`Reload failed: ${(err as Error).message}`);
    } finally {
        loadingOverlay.classList.remove('visible');
    }
});

// --- initialize selection overlay, toolbar & zoom indicator ---
const { selectionCanvas, canvas } = initSelection();
initToolbar(selectionCanvas, canvas);
initZoomIndicator();

// --- initial load ---
window.addEventListener('load', async () => {
    emit(EVT_D3_PARAMS_CHANGED, null);
    loadingOverlay.classList.add('visible');
    try {
        const loadedData = await loadDataFromApi();
        updateGraph(new Graph(loadedData.nodes, loadedData.edges));
        emit(EVT_GRAPH_UPDATED, null);
    } catch (err) {
        console.error('initial load failed:', err);
        showError(`Failed to load graph: ${(err as Error).message}`);
    } finally {
        loadingOverlay.classList.remove('visible');
    }
});
