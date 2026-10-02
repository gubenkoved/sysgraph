import { initAnalyticsPanel } from './modules/analytics-panel.js';
import { initAppTooltips } from './modules/app-tooltips.js';
import { type LoadedGraphData, loadDataFromApi, loadExampleGraph, parseGraphData, serializeGraph } from './modules/data-io.js';
import { emit, on, registerHandler } from './modules/event-bus.js';
import { Graph } from './modules/graph.js';
import { applyGpuParams, centerOnNode, computeMatchColors, GraphViewInstance, getVisibleGraph, rebuildGraphObjects, refreshGraphColors, refreshGraphLinkWidths, refreshGraphSelection, refreshGraphUI, refreshNodeSizing, refreshRenderOptions, requestRecenterView } from './modules/graph-ui.js';
import { initLayout } from './modules/layout.js';
import { initLongPress } from './modules/long-press.js';
import { initPhysicsIndicator } from './modules/physics-indicator.js';
import { initQuickStart, markQuickStartReady } from './modules/quick-start.js';
import { SearchSyntaxError, search } from './modules/search.js';
import { initSelection } from './modules/selection.js';
import { persistSettings } from './modules/settings.js';
import { maybeApplyGraphDisplay, updateDynamicGraphPanes } from './modules/settings-pane.js';
import { snapshotCurrentSettings } from './modules/settings-presets.js';
import { decodeShareFromHash, encodeGraphToShareUrl, type ShareDisplayMode, stripShareHash } from './modules/share.js';
import { getGraph, isGraphDirty, resetState, setGraphDirty, setSearch, state, updateGraph } from './modules/state.js';
import { initTheme } from './modules/theme.js';
import { initToolbar, setTool, updateGraphInfo } from './modules/toolbar.js';
import { dismissError, showError, showInfoToast } from './modules/util.js';
import { initZoomIndicator } from './modules/zoom-indicator.js';
import './modules/details-panel.js';
import './modules/templates-panel.js';
import {CMD_EXPORT, CMD_IMPORT,
    CMD_LOAD_EXAMPLE,
    CMD_RELOAD, CMD_SHARE, EVT_CLEAR_CLICKED,
    EVT_COLORS_UPDATED,EVT_FILTERS_UPDATED,
    EVT_GPU_PARAMS_CHANGED,
    EVT_GRAPH_UPDATED,
    EVT_NODE_SIZING_UPDATED,
    EVT_RENDER_OPTIONS_CHANGED,
    EVT_SEARCH_CHANGED, EVT_SEARCH_CYCLE, EVT_SELECTION_CHANGED, EVT_SETTINGS_UPDATED,
    EVT_THEME_CHANGED,
    EVT_VISIBLE_GRAPH_CHANGED,
    EVT_WIDTHS_UPDATED,
    STANDALONE,
} from './modules/constants.js';
import '@material/web/button/filled-tonal-button.js';
import '@material/web/button/outlined-button.js';
import '@material/web/button/text-button.js';
import '@material/web/icon/icon.js';
import '@material/web/iconbutton/icon-button.js';
import '@material/web/iconbutton/outlined-icon-button.js';
import '@material/web/radio/radio.js';
import '@material/web/switch/switch.js';
import '@material/web/textfield/outlined-text-field.js';
import 'dockview-core/dist/styles/dockview.css';

// ── cached DOM elements ─────────────────────────────────────
const searchMatchCountEl = document.getElementById('searchMatchCount') as HTMLElement;
const addToSelectionBtn = document.getElementById('addToSelection') as HTMLButtonElement;
const loadingOverlay = document.getElementById('loading-overlay') as HTMLElement;

// ── standalone-mode indicator ───────────────────────────────
// in standalone builds, suffix the version with an accented "S" (e.g. v1.2.3S)
// instead of rendering a separate badge; the S is colored so it stands out
// from the faint version text
if (STANDALONE) {
    const appVersion = document.getElementById('app-version');
    if (appVersion) {
        const s = document.createElement('span');
        s.className = 'version-standalone';
        s.textContent = 'S';
        appVersion.appendChild(s);
    }
}

// ── theme (apply persisted choice before the UI renders) ────
initTheme();
initAppTooltips();

// ── search ──────────────────────────────────────────────────

// last expression typed in the search bar, kept so the matches can be
// recomputed when the visible graph changes
let currentSearchExpression = '';

/** Runs the search over the currently visible graph and updates the UI. */
function applySearch(expression: string): void {
    if (expression.trim()) {
        try {
            // search only what is on screen, so matches can never point at
            // nodes hidden by the filters
            const matches = search(getVisibleGraph(), expression);
            const matchesMap = new Map(matches.map(x => [x.nodeId, x]));
            setSearch({
                matchesMap,
                matchColorsMap: computeMatchColors(matchesMap),
                matches,
                currentMatchIndex: -1,
            });
            dismissError('search-syntax');
            searchMatchCountEl.textContent = `${matchesMap.size} match${matchesMap.size !== 1 ? 'es' : ''}`;
            searchMatchCountEl.style.visibility = 'visible';
            addToSelectionBtn.disabled = matchesMap.size === 0;
        } catch (err) {
            if (err instanceof SearchSyntaxError) {
                setSearch(null);
                searchMatchCountEl.style.visibility = 'hidden';
                addToSelectionBtn.disabled = true;
                showError(err.message, { id: 'search-syntax' });
            } else {
                console.error('search error:', err);
                setSearch(null);
                searchMatchCountEl.style.visibility = 'hidden';
                addToSelectionBtn.disabled = true;
            }
        }
    } else {
        setSearch(null);
        dismissError('search-syntax');
        searchMatchCountEl.style.visibility = 'hidden';
        addToSelectionBtn.disabled = true;
    }
    // re-evaluate node colors so the active renderer reflects the new matches.
    // the 2D canvas redraws every frame so it would pick this up anyway, but the
    // 3D renderer only re-runs its nodeColor accessor on an explicit refresh
    refreshGraphColors();
}

// ── event wiring ────────────────────────────────────────────
on(EVT_GRAPH_UPDATED, async () => {
    updateDynamicGraphPanes();
    await refreshGraphUI(true);
    // reconcile the engine after the visible graph changed: it warms up for a
    // non-empty graph and stays frozen for an empty one (e.g. after a clear),
    // even when the display mode skipped re-emitting the d3-params event
    applyGpuParams();
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
    currentSearchExpression = expression ?? '';
    applySearch(currentSearchExpression);
});

// filters (type, adjacency, expressions, hide-isolated) change what is visible,
// so the matches must be recomputed against the new visible graph
on(EVT_VISIBLE_GRAPH_CHANGED, () => {
    if (currentSearchExpression.trim()) {
        applySearch(currentSearchExpression);
    }
});

on(EVT_SELECTION_CHANGED, () => { updateGraphInfo(); refreshGraphSelection(); });

on(EVT_SEARCH_CYCLE, ({ direction }: { direction: 1 | -1 }) => {
    const search = state.search;
    if (!search || search.matches.length === 0) return;
    const total = search.matches.length;
    const next = search.currentMatchIndex === -1 && direction === -1
        ? total - 1
        : ((search.currentMatchIndex + direction) % total + total) % total;
    search.currentMatchIndex = next;
    const nodeId = search.matches[next].nodeId;
    GraphViewInstance.refreshCurrentSearchMatch();
    centerOnNode(nodeId, 650);
    searchMatchCountEl.textContent = `${next + 1} / ${total} match${total !== 1 ? 'es' : ''}`;
    searchMatchCountEl.style.visibility = 'visible';
});

on(EVT_SETTINGS_UPDATED, async () => {
    await refreshGraphUI();
});

on(EVT_COLORS_UPDATED, () => {
    refreshGraphColors();
});

on(EVT_WIDTHS_UPDATED, () => {
    refreshGraphLinkWidths();
});

on(EVT_THEME_CHANGED, () => {
    // Rebake glyph colors and update the WebGPU clear color.
    rebuildGraphObjects();
});

on(EVT_GPU_PARAMS_CHANGED, applyGpuParams);
on(EVT_NODE_SIZING_UPDATED, refreshNodeSizing);
on(EVT_RENDER_OPTIONS_CHANGED, refreshRenderOptions);

for (const event of [EVT_GRAPH_UPDATED, EVT_FILTERS_UPDATED, EVT_SETTINGS_UPDATED, EVT_NODE_SIZING_UPDATED,
    EVT_COLORS_UPDATED, EVT_WIDTHS_UPDATED, EVT_GPU_PARAMS_CHANGED, EVT_RENDER_OPTIONS_CHANGED]) {
    on(event, persistSettings);
}

// ── command handlers ────────────────────────────────────────
registerHandler(CMD_EXPORT, () => {
    const graph = getGraph();
    return new Blob([serializeGraph(graph)], { type: 'application/json' });
});

registerHandler(CMD_SHARE, async (displayMode?: ShareDisplayMode) => {
    // toData() already includes the graph's own embedded display block when present
    const data = getGraph().toData();
    if (displayMode === 'current') {
        // embed a snapshot of the live view settings so the recipient
        // reproduces this view (consumed on load by maybeApplyGraphDisplay,
        // respecting its apply/ask mode)
        data.display = snapshotCurrentSettings() as unknown as typeof data.display;
    } else if (displayMode !== 'embedded') {
        // 'none' (or unset): share the graph without any view settings
        delete data.display;
    }
    // 'embedded': keep the graph's own display block untouched
    return encodeGraphToShareUrl(data);
});

registerHandler(CMD_IMPORT, async (text?: string) => {
    if (!text) return;
    try {
        const loadedData = parseGraphData(text);
        resetState();
        updateGraph(new Graph(loadedData.nodes, loadedData.edges, loadedData.display));
        maybeApplyGraphDisplay(loadedData.display);
        requestRecenterView();
        emit(EVT_GRAPH_UPDATED, null);

        const skipped = loadedData.skippedEdges ?? 0;
        if (skipped > 0) {
            showInfoToast(
                `Imported ${loadedData.nodes.length} nodes, ${loadedData.edges.length} edges (skipped ${skipped} edge${skipped !== 1 ? 's' : ''} with unknown endpoints)`,
            );
        }
    } catch (err) {
        console.error('import failed:', err);
        showError(`Import failed: ${(err as Error).message}`);
    }
});

registerHandler(CMD_LOAD_EXAMPLE, async (file?: string) => {
    if (!file) return;
    loadingOverlay.classList.add('visible');
    try {
        const loadedData = await loadExampleGraph(file);
        resetState();
        updateGraph(new Graph(loadedData.nodes, loadedData.edges, loadedData.display));
        maybeApplyGraphDisplay(loadedData.display);
        requestRecenterView();
        emit(EVT_GRAPH_UPDATED, null);
    } catch (err) {
        console.error('load example failed:', err);
        showError(`Load example failed: ${(err as Error).message}`);
    } finally {
        loadingOverlay.classList.remove('visible');
    }
});

registerHandler(CMD_RELOAD, async () => {
    if (STANDALONE) return;
    loadingOverlay.classList.add('visible');
    try {
        const loadedData = await loadDataFromApi();
        updateGraph(new Graph(loadedData.nodes, loadedData.edges, loadedData.display));
        maybeApplyGraphDisplay(loadedData.display);
        setGraphDirty(false);
        emit(EVT_GRAPH_UPDATED, null);
    } catch (err) {
        console.error('reload failed:', err);
        showError(`Reload failed: ${(err as Error).message}`);
    } finally {
        loadingOverlay.classList.remove('visible');
    }
});

// ── initialize the dock layout first so panels have a place to mount ─
initLayout();

// ── initialize selection overlay, toolbar & zoom indicator ──
const { selectionCanvas, canvas } = initSelection();
initToolbar(selectionCanvas, canvas);
initAnalyticsPanel();
initQuickStart(() => setTool('edit', selectionCanvas, canvas));
initZoomIndicator();
initPhysicsIndicator();
initLongPress();

// ── guard against losing unexported graph data on close/reload ─
window.addEventListener('beforeunload', (event) => {
    if (isGraphDirty()) {
        event.preventDefault();
        // legacy browsers require returnValue to be set to trigger the prompt
        event.returnValue = '';
    }
});

/**
 * Loads a graph carried in the URL hash fragment (a data URL), if present.
 * Returns true when a graph was loaded so the caller skips the backend
 * / standalone empty-graph paths.
 */
async function tryLoadSharedGraph(): Promise<boolean> {
    let loadedData: LoadedGraphData | null;
    try {
        loadedData = await decodeShareFromHash(window.location.hash);
    } catch (err) {
        console.error('failed to load graph from data URL:', err);
        showError(`Failed to load graph from data URL: ${(err as Error).message}`);
        // drop the broken hash so a reload doesn't keep failing
        stripShareHash();
        return false;
    }

    if (!loadedData) return false;

    resetState();
    updateGraph(new Graph(loadedData.nodes, loadedData.edges, loadedData.display));
    maybeApplyGraphDisplay(loadedData.display);
    requestRecenterView();
    setGraphDirty(false);
    emit(EVT_GRAPH_UPDATED, null);

    const skipped = loadedData.skippedEdges ?? 0;
    showInfoToast(
        `Loaded graph from data URL: ${loadedData.nodes.length} nodes, ${loadedData.edges.length} edges${skipped > 0 ? ` (skipped ${skipped} edge${skipped !== 1 ? 's' : ''})` : ''}`,
        { icon: 'link' },
    );

    // strip the (potentially huge) hash so it never lingers in history
    stripShareHash();
    return true;
}

// ── initial load ────────────────────────────────────────────
window.addEventListener('load', async () => {
    emit(EVT_GPU_PARAMS_CHANGED, null);

    // a shared-link hash takes precedence over both the backend and the
    // standalone empty-graph path
    if (await tryLoadSharedGraph()) {
        markQuickStartReady();
        return;
    }

    // Standalone mode: no backend. Start with an empty graph; the user loads
    // data via JSON import.
    if (STANDALONE) {
        emit(EVT_GRAPH_UPDATED, null);
        return;
    }

    loadingOverlay.classList.add('visible');
    try {
        const loadedData = await loadDataFromApi();
        updateGraph(new Graph(loadedData.nodes, loadedData.edges, loadedData.display));
        maybeApplyGraphDisplay(loadedData.display);
        setGraphDirty(false);
        emit(EVT_GRAPH_UPDATED, null);
    } catch (err) {
        console.error('initial load failed:', err);
        showError(`Failed to load graph: ${(err as Error).message}`);
    } finally {
        loadingOverlay.classList.remove('visible');
        // allow the quick-start panel to appear now that the backend load settled
        markQuickStartReady();
    }
});
