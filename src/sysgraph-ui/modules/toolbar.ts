import iconLight from '../icon.png';
import iconDark from '../icon-dark.png';
import { clearAnalytics, selectAlgorithm } from './analytics.js';
import { closeAnalyticsPanel, openAnalyticsPanel } from './analytics-panel.js';
import { CMD_EXPORT, CMD_IMPORT, CMD_LOAD_EXAMPLE, CMD_RELOAD, EVT_CLEAR_CLICKED, EVT_SEARCH_CHANGED, EVT_SEARCH_CYCLE, EVT_THEME_CHANGED, EVT_TOOL_CHANGED, STANDALONE } from './constants.js';
import { type ContextMenuItem, showContextMenu } from './context-menu.js';
import { type ExampleInfo, loadExamplesManifest } from './data-io.js';
import { cancelPendingEdge } from './edit-mode.js';
import { emit, handle, on } from './event-bus.js';
import { deleteSelectedNodes } from './selection.js';
import type { EditSubTool } from './state.js';
import { setAnalyticsActive, setCurrentTool, setEditActive, setEditSubTool, setGraphDirty, state } from './state.js';
import { getTheme, toggleTheme } from './theme.js';
import { showError } from './util.js';

// cached DOM elements
const toolPointerBtn = document.getElementById('toolPointer') as HTMLElement;
const toolRectSelectBtn = document.getElementById('toolRectSelect') as HTMLElement;
const toolSearchBtn = document.getElementById('toolSearch') as HTMLElement;
const toolEditBtn = document.getElementById('toolEdit') as HTMLElement;
const toolAnalyticsBtn = document.getElementById('toolAnalytics') as HTMLElement;
const editSubToolGroup = document.getElementById('editSubToolGroup') as HTMLElement;
const editModifyBtn = document.getElementById('editModify') as HTMLElement;
const editConnectBtn = document.getElementById('editConnect') as HTMLElement;
const actionGroup = document.getElementById('actionGroup') as HTMLElement;
const deleteBtn = document.getElementById('deleteSelected') as HTMLButtonElement;
const unselectBtn = document.getElementById('unselectAll') as HTMLButtonElement;
const invertSelectionBtn = document.getElementById('invertSelection') as HTMLButtonElement;
const toggleSettingsBtn = document.getElementById('toggleSettings') as HTMLElement;
const themeToggleBtn = document.getElementById('themeToggle') as HTMLElement;
const logoButton = document.getElementById('toolbar-logo-button') as HTMLButtonElement;
const toolbarLogo = document.getElementById('toolbar-logo') as HTMLImageElement;
const settingsPane = document.getElementById('settingsPane') as HTMLElement;
const importFileInput = document.getElementById('importFile') as HTMLInputElement;
const graphInfoEl = document.getElementById('graphInfo') as HTMLElement;
const searchBar = document.getElementById('searchBar') as HTMLElement;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchHelpTrigger = document.getElementById('searchHelpTrigger') as HTMLElement;
const searchHelpAnchor = document.getElementById('searchHelpAnchor') as HTMLElement;
const searchHelpPopover = document.getElementById('searchHelp') as HTMLElement;
const searchMatchCount = document.getElementById('searchMatchCount') as HTMLElement;
const addToSelectionBtn = document.getElementById('addToSelection') as HTMLButtonElement;

type Tool = 'pointer' | 'rect-select' | 'search' | 'edit' | 'analytics';

// bundled example graphs, loaded once on init; the logo menu only offers the
// "load example" entry when at least one example is available
let examples: ExampleInfo[] = [];

/** Reflects the current theme on the toggle button's icon. */
function updateThemeIcon(): void {
    const dark = getTheme() === 'dark';
    const icon = themeToggleBtn.querySelector('md-icon');
    if (icon) {
        icon.textContent = dark ? 'light_mode' : 'dark_mode';
    }
    if (toolbarLogo) {
        toolbarLogo.src = dark ? iconDark : iconLight;
    }
}

/** Updates the edit sub-tool buttons' active state and cancels any pending edge. */
function applyEditSubTool(subTool: EditSubTool): void {
    setEditSubTool(subTool);
    cancelPendingEdge();
    editModifyBtn.classList.toggle('active', subTool === 'modify');
    editConnectBtn.classList.toggle('active', subTool === 'connect');
}

/**
 * Activates the given tool and updates toolbar button states.
 */
export function setTool(tool: Tool, selectionCanvas: HTMLCanvasElement, canvas: HTMLCanvasElement): void {
    setCurrentTool(tool);

    toolPointerBtn.classList.toggle('active', tool === 'pointer');
    toolRectSelectBtn.classList.toggle('active', tool === 'rect-select');
    toolSearchBtn.classList.toggle('active', tool === 'search');
    toolEditBtn.classList.toggle('active', tool === 'edit');
    toolAnalyticsBtn.classList.toggle('active', tool === 'analytics');

    // edit mode setup / teardown
    if (tool === 'edit') {
        setEditActive(true);
        editSubToolGroup.style.display = 'inline-flex';
        applyEditSubTool('modify');
    } else {
        setEditActive(false);
        cancelPendingEdge();
        editSubToolGroup.style.display = 'none';
    }

    // analytics mode setup / teardown
    if (tool === 'analytics') {
        setAnalyticsActive(true);
        openAnalyticsPanel();
        // seed the default algorithm; the panel's tabs drive further selection
        selectAlgorithm(state.analytics.algorithmId ?? 'stats');
    } else {
        setAnalyticsActive(false);
        closeAnalyticsPanel();
        clearAnalytics();
    }

    if (tool === 'rect-select') {
        selectionCanvas.style.pointerEvents = 'auto';
        selectionCanvas.style.cursor = 'crosshair';
    } else {
        selectionCanvas.style.pointerEvents = 'none';
        canvas.style.cursor = tool === 'edit' ? 'crosshair' : 'default';
    }

    if (tool === 'search') {
        searchBar.style.display = 'flex';
        addToSelectionBtn.style.display = 'inline-flex';
        searchInput.focus();
        if (searchInput.value) {
            emit(EVT_SEARCH_CHANGED, searchInput.value);
        } else {
            searchMatchCount.style.visibility = 'hidden';
            addToSelectionBtn.disabled = true;
        }
    } else {
        searchBar.style.display = 'none';
        searchHelpPopover.classList.remove('open');
        searchMatchCount.style.visibility = 'hidden';
        addToSelectionBtn.style.display = 'none';
        emit(EVT_SEARCH_CHANGED, '');
    }

    emit(EVT_TOOL_CHANGED, null);
    updateGraphInfo();
}

/** Updates the selection info label and button visibility based on current state. */
export function updateGraphInfo(): void {
    const isSelectionTool = state.currentTool === 'rect-select' || state.currentTool === 'search';

    if (isSelectionTool) {
        actionGroup.style.display = 'inline-flex';
        if (state.selection.selectedNodeIds.size > 0) {
            graphInfoEl.textContent = `${state.selection.selectedNodeIds.size} node${state.selection.selectedNodeIds.size !== 1 ? 's' : ''} selected`;
            deleteBtn.disabled = false;
            unselectBtn.disabled = false;
            invertSelectionBtn.style.display = 'inline-flex';
        } else {
            graphInfoEl.textContent = '';
            deleteBtn.disabled = true;
            unselectBtn.disabled = true;
            invertSelectionBtn.style.display = 'none';
        }
    } else {
        actionGroup.style.display = 'none';
        const nodeCount = state.graph.nodesMap.size;
        const edgeCount = state.graph.edgesMap.size;
        graphInfoEl.textContent = nodeCount > 0
            ? `${nodeCount} nodes · ${edgeCount} relationships`
            : '';
    }
}

/**
 * Loads the bundled example manifest so the logo menu can offer the
 * "load example" entry when at least one example is available.
 */
async function initExamples(): Promise<void> {
    examples = await loadExamplesManifest();
}

/** Pulls a fresh graph from the backend (unavailable in standalone builds). */
async function doReload(): Promise<void> {
    try {
        await handle(CMD_RELOAD);
    } catch (err) {
        console.error('reload failed:', err);
        showError(`Reload failed: ${err instanceof Error ? err.message : String(err)}`);
    }
}

/** Opens the file picker to import a graph from JSON. */
function doImport(): void {
    importFileInput.click();
}

/** Serializes the current graph and triggers a download. */
function doExport(): void {
    const blob = handle<undefined, Blob>(CMD_EXPORT);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${timestamp}_graph.json`;
    a.click();
    URL.revokeObjectURL(url);
    // the current graph is now safely on disk — no unexported data
    setGraphDirty(false);
}

/** Clears the current graph. */
function doClear(): void {
    emit(EVT_CLEAR_CLICKED, null);
}

/** Opens a compact picker listing the bundled example graphs. */
function openExampleMenu(x: number, y: number): void {
    showContextMenu(
        x,
        y,
        examples.map((example) => ({
            label: `${example.title} (${example.nodes}n / ${example.edges}e)`,
            icon: 'category',
            action: async () => {
                try {
                    await handle(CMD_LOAD_EXAMPLE, example.file);
                } catch (err) {
                    console.error('load example failed:', err);
                    showError(`Load example failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            },
        })),
    );
}

/** Builds the logo dropdown menu items based on the current state. */
function buildLogoMenu(): ContextMenuItem[] {
    const isEmpty = state.graph.nodesMap.size === 0;
    const items: ContextMenuItem[] = [];

    // "reload sysgraph" pulls a fresh graph from the backend — unavailable in
    // standalone builds, which never contact the backend
    if (!STANDALONE) {
        items.push({ label: 'Reload sysgraph', icon: 'sync', action: doReload });
    }

    items.push({ label: 'Import graph…', icon: 'upload', action: doImport });

    if (examples.length > 0) {
        items.push({
            label: 'Load example',
            icon: 'category',
            action: () => {
                const rect = logoButton.getBoundingClientRect();
                openExampleMenu(rect.left, rect.bottom + 4);
            },
        });
    }

    items.push({
        label: 'Export graph',
        icon: 'download',
        disabled: isEmpty,
        action: doExport,
    });
    items.push({ divider: true });
    items.push({
        label: 'Clear graph',
        icon: 'delete_sweep',
        danger: true,
        disabled: isEmpty,
        action: doClear,
    });

    return items;
}

/**
 * Wires up toolbar buttons, search input, and keyboard shortcuts.
 */
export function initToolbar(selectionCanvas: HTMLCanvasElement, canvas: HTMLCanvasElement): void {
    // search input
    searchInput.addEventListener('input', (event) => {
        event.stopPropagation();
        emit(EVT_SEARCH_CHANGED, (event.target as HTMLInputElement).value);
    });

    searchInput.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            emit(EVT_SEARCH_CYCLE, { direction: e.shiftKey ? -1 : 1 });
        }
    });

    // search help popover toggle
    searchHelpTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        searchHelpPopover.classList.toggle('open');
    });

    // dismiss on outside click
    document.addEventListener('click', (e) => {
        if (!searchHelpAnchor.contains(e.target as Node)) {
            searchHelpPopover.classList.remove('open');
        }
    });

    // toolbar button handlers
    toolPointerBtn.addEventListener('click', () => {
        setTool('pointer', selectionCanvas, canvas);
    });

    toolRectSelectBtn.addEventListener('click', () => {
        setTool('rect-select', selectionCanvas, canvas);
    });

    toolSearchBtn.addEventListener('click', () => {
        setTool('search', selectionCanvas, canvas);
    });

    toolEditBtn.addEventListener('click', () => {
        setTool('edit', selectionCanvas, canvas);
    });

    toolAnalyticsBtn.addEventListener('click', () => {
        setTool('analytics', selectionCanvas, canvas);
    });

    editModifyBtn.addEventListener('click', () => {
        applyEditSubTool('modify');
    });

    editConnectBtn.addEventListener('click', () => {
        applyEditSubTool('connect');
    });

    deleteBtn.addEventListener('click', async () => {
        await deleteSelectedNodes();
    });

    unselectBtn.addEventListener('click', () => {
        state.selection.selectedNodeIds.clear();
        updateGraphInfo();
    });

    invertSelectionBtn.addEventListener('click', () => {
        const prevSelected = new Set(state.selection.selectedNodeIds);
        state.selection.selectedNodeIds.clear();
        for (const id of state.graph.nodesMap.keys()) {
            if (!prevSelected.has(id)) {
                state.selection.selectedNodeIds.add(id);
            }
        }
        updateGraphInfo();
    });

    addToSelectionBtn.addEventListener('click', () => {
        if (state.search && state.search.matchesMap.size > 0) {
            for (const nodeId of state.search.matchesMap.keys()) {
                state.selection.selectedNodeIds.add(nodeId);
            }
            updateGraphInfo();
        }
    });

    // data actions live in the logo dropdown menu; the hidden file input is
    // still driven by the menu's "import graph" entry
    importFileInput.addEventListener('change', async () => {
        const file = importFileInput.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            await handle(CMD_IMPORT, text);
        } catch (err) {
            console.error('import failed:', err);
            showError(`Import failed: ${err instanceof Error ? err.message : String(err)}`);
        }
        importFileInput.value = '';
    });

    // logo click opens the data-actions dropdown menu
    logoButton.addEventListener('click', (event) => {
        event.stopPropagation();
        const rect = logoButton.getBoundingClientRect();
        showContextMenu(rect.left, rect.bottom + 4, buildLogoMenu());
    });

    // load the bundled example manifest so the logo menu can offer it
    void initExamples();

    // settings (parameters) pane toggle
    toggleSettingsBtn.addEventListener('click', () => {
        const open = settingsPane.classList.toggle('open');
        toggleSettingsBtn.classList.toggle('active', open);
    });

    // dark mode toggle
    themeToggleBtn.addEventListener('click', () => {
        toggleTheme();
    });
    on(EVT_THEME_CHANGED, updateThemeIcon);
    updateThemeIcon();

    // keyboard shortcuts
    document.addEventListener('keydown', async (event) => {
        const el = event.target as HTMLElement;

        const isTyping =
            el.tagName === 'INPUT' ||
            el.tagName === 'MD-OUTLINED-TEXT-FIELD' ||
            el.tagName === 'TEXTAREA' ||
            el.isContentEditable;

        if (isTyping)
            return;

        if (event.key === 'p' || event.key === 'P') {
            setTool('pointer', selectionCanvas, canvas);
        } else if (event.key === 'r' || event.key === 'R') {
            setTool('rect-select', selectionCanvas, canvas);
        } else if (event.key === 'e' || event.key === 'E') {
            setTool('edit', selectionCanvas, canvas);
        } else if (event.key === 'a' || event.key === 'A') {
            setTool('analytics', selectionCanvas, canvas);
        } else if (event.key === 'Escape' && state.edit.active) {
            cancelPendingEdge();
        } else if (event.key === 'Delete' && state.currentTool === 'rect-select' && state.selection.selectedNodeIds.size > 0) {
            await deleteSelectedNodes();
        }
    });
}
