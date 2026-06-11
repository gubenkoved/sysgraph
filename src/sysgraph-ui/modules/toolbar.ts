import iconLight from '../icon.png';
import iconDark from '../icon-dark.png';
import { selectAlgorithm, suspendAnalytics } from './analytics.js';
import { closeAnalyticsPanel, openAnalyticsPanel } from './analytics-panel.js';
import { CMD_EXPORT, CMD_IMPORT, CMD_RELOAD, CMD_SHARE, EVT_ANALYTICS_UPDATED, EVT_CLEAR_CLICKED, EVT_LAYOUT_CHANGED, EVT_RENDER_MODE_CHANGED, EVT_SEARCH_CHANGED, EVT_SEARCH_CYCLE, EVT_THEME_CHANGED, EVT_TOOL_CHANGED, PANEL_SETTINGS, PANEL_TEMPLATES, STANDALONE } from './constants.js';
import { type ContextMenuItem, showContextMenu } from './context-menu.js';
import { buildExampleMenuItems, type ExampleInfo, loadExamplesManifest } from './data-io.js';
import { cancelPendingEdge } from './edit-mode.js';
import { emit, handle, on } from './event-bus.js';
import { getVisibleGraph, setRenderMode } from './graph-ui.js';
import { isPanelOpen, resetLayout, togglePanel } from './layout.js';
import { is3D } from './render-mode.js';
import { deleteSelectedNodes } from './selection.js';
import type { ShareDisplayMode, ShareEncodeResult } from './share.js';
import type { EditSubTool } from './state.js';
import { setAnalyticsActive, setCurrentTool, setEditActive, setEditSubTool, setGraphDirty, state } from './state.js';
import { closeTemplatesPanel } from './templates-panel.js';
import { getTheme, toggleTheme } from './theme.js';
import { showError, showInfoToast } from './util.js';

// cached DOM elements
const toolPointerBtn = document.getElementById('toolPointer') as HTMLElement;
const toolRectSelectBtn = document.getElementById('toolRectSelect') as HTMLElement;
const toolSearchBtn = document.getElementById('toolSearch') as HTMLElement;
const toolEditBtn = document.getElementById('toolEdit') as HTMLElement;
const toolAnalyticsBtn = document.getElementById('toolAnalytics') as HTMLElement;
const editSubToolGroup = document.getElementById('editSubToolGroup') as HTMLElement;
const editModifyBtn = document.getElementById('editModify') as HTMLElement;
const editConnectBtn = document.getElementById('editConnect') as HTMLElement;
const editTemplatesBtn = document.getElementById('editTemplates') as HTMLElement;
const actionGroup = document.getElementById('actionGroup') as HTMLElement;
const deleteBtn = document.getElementById('deleteSelected') as HTMLButtonElement;
const unselectBtn = document.getElementById('unselectAll') as HTMLButtonElement;
const invertSelectionBtn = document.getElementById('invertSelection') as HTMLButtonElement;
const rectAddModeBtn = document.getElementById('rectAddMode') as HTMLButtonElement;
const toggleSettingsBtn = document.getElementById('toggleSettings') as HTMLElement;
const themeToggleBtn = document.getElementById('themeToggle') as HTMLElement;
const logoButton = document.getElementById('toolbar-logo-button') as HTMLButtonElement;
const toolbarLogo = document.getElementById('toolbar-logo') as HTMLImageElement;
const toolbarEl = document.getElementById('toolbar') as HTMLElement;
const importFileInput = document.getElementById('importFile') as HTMLInputElement;
const shareDialogOverlay = document.getElementById('shareDialogOverlay') as HTMLElement;
const shareDialogClose = document.getElementById('shareDialogClose') as HTMLElement;
const shareDisplayModes = document.getElementById('shareDisplayModes') as HTMLElement;
const shareDisplayEmbeddedRow = document.getElementById('shareDisplayEmbeddedRow') as HTMLElement;
const shareUrlInput = document.getElementById('shareUrlInput') as HTMLInputElement;
const shareUrlSize = document.getElementById('shareUrlSize') as HTMLElement;
const shareCopyBtn = document.getElementById('shareCopyBtn') as HTMLButtonElement;
const shareTooLarge = document.getElementById('shareTooLarge') as HTMLElement;
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

// canvas refs captured at init so tool changes can be requested from elsewhere
// (e.g. when the analytics dock tab is closed by the user)
let toolCanvases: { selection: HTMLCanvasElement; canvas: HTMLCanvasElement } | null = null;

/** Reverts to the pointer tool when the analytics panel is closed via its tab. */
export function exitAnalyticsTool(): void {
    if (state.currentTool === 'analytics' && toolCanvases) {
        setTool('pointer', toolCanvases.selection, toolCanvases.canvas);
    }
}


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
    // edit mode relies on the 2D canvas (node placement, rubber-band edges,
    // pointer hit-testing) and isn't supported by the 3D renderer; if the user
    // enters it while in 3D (e.g. via the quick-start panel), fall back to 2D
    if (tool === 'edit' && is3D()) {
        setRenderMode('2d');
        showInfoToast('Switched to 2D view — edit mode is only available in 2D.', {
            id: 'edit-needs-2d',
            icon: 'edit',
        });
    }

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
        // templates only apply while editing; close the panel on exit
        closeTemplatesPanel();
        editTemplatesBtn.classList.remove('active');
    }

    // analytics mode setup / teardown
    if (tool === 'analytics') {
        setAnalyticsActive(true);
        openAnalyticsPanel();
        if (!state.analytics.algorithmId) {
            // first entry: seed the default algorithm; the panel's tabs drive
            // further selection (and intentionally clear the run on switch)
            selectAlgorithm('stats');
        } else {
            // re-entry: keep the preserved picks/result/decoration and just
            // refresh the panel to reflect them
            emit(EVT_ANALYTICS_UPDATED, null);
        }
    } else {
        // leaving analytics: preserve the run so it can be resumed later, only
        // cancel a dangling pending pick
        setAnalyticsActive(false);
        closeAnalyticsPanel();
        suspendAnalytics();
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
    updateToolbarOverflow();
}

/** Updates the selection info label and button visibility based on current state. */
export function updateGraphInfo(): void {
    const isSelectionTool = state.currentTool === 'rect-select' || state.currentTool === 'search';

    if (isSelectionTool) {
        actionGroup.style.display = 'inline-flex';
        // the additive toggle is a touch affordance for the rect-select tool
        // only (the search tool has its own "add matches" button)
        rectAddModeBtn.style.display = state.currentTool === 'rect-select' ? 'inline-flex' : 'none';
        rectAddModeBtn.classList.toggle('active', state.selection.additive);
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
        const totalNodes = state.graph.nodesMap.size;
        const totalEdges = state.graph.edgesMap.size;
        if (totalNodes === 0) {
            graphInfoEl.textContent = '';
            return;
        }
        const visible = getVisibleGraph();
        const visibleNodes = visible.nodesMap.size;
        const visibleEdges = visible.edgesMap.size;
        const nodesText = visibleNodes !== totalNodes ? `${visibleNodes} / ${totalNodes}` : `${totalNodes}`;
        const edgesText = visibleEdges !== totalEdges ? `${visibleEdges} / ${totalEdges}` : `${totalEdges}`;
        graphInfoEl.textContent = `${nodesText} nodes · ${edgesText} relationships`;
    }
}

/**
 * Enables a subtle horizontal scrollbar on the toolbar only when its content
 * genuinely overflows the available width. Leaving overflow-x:auto on
 * permanently would surface a phantom 1px scrollbar from sub-pixel centering
 * (translateX(-50%)) even on wide screens with plenty of room.
 */
function updateToolbarOverflow(): void {
    // tolerate 1px of sub-pixel rounding so the phantom bar never appears
    const overflowing = toolbarEl.scrollWidth - toolbarEl.clientWidth > 1;
    toolbarEl.classList.toggle('is-scrollable', overflowing);
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
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const defaultName = `${timestamp}_graph.json`;

    // let the user pick a filename, pre-filled with the generated default
    const input = window.prompt('Export graph as', defaultName);
    if (input === null) return; // cancelled — keep the graph dirty

    // fall back to the default for empty input and ensure a .json extension
    const trimmed = input.trim();
    const base = trimmed === '' ? defaultName : trimmed;
    const filename = base.toLowerCase().endsWith('.json') ? base : `${base}.json`;

    const blob = handle<undefined, Blob>(CMD_EXPORT);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    // the current graph is now safely on disk — no unexported data
    setGraphDirty(false);
}

/** Clears the current graph. */
function doClear(): void {
    emit(EVT_CLEAR_CLICKED, null);
}

/** Formats a byte count as a compact human-readable size. */
function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
}

/** Minimal shape of the md-radio elements in the share-display group. */
type ShareRadio = HTMLElement & { value: string; checked: boolean; disabled: boolean };

/** Returns the radio elements backing the view-settings choice. */
function shareDisplayRadios(): ShareRadio[] {
    return [...shareDisplayModes.querySelectorAll('md-radio')] as ShareRadio[];
}

/** Reads the currently selected view-settings mode. */
function getShareDisplayMode(): ShareDisplayMode {
    const selected = shareDisplayRadios().find(r => r.checked);
    return (selected?.value as ShareDisplayMode | undefined) ?? 'none';
}

/** Selects the given view-settings mode in the radio group. */
function setShareDisplayMode(mode: ShareDisplayMode): void {
    for (const radio of shareDisplayRadios()) {
        radio.checked = radio.value === mode;
    }
}

/** Regenerates the data URL based on the current dialog options. */
async function regenerateShareUrl(): Promise<void> {
    let result: ShareEncodeResult;
    try {
        result = await handle<ShareDisplayMode, Promise<ShareEncodeResult>>(CMD_SHARE, getShareDisplayMode());
    } catch (err) {
        console.error('data URL generation failed:', err);
        showError(`Failed to generate data URL: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }

    // always offer the URL; just warn when it's large enough that some clients
    // (chat apps, email, QR codes) may truncate it
    shareTooLarge.hidden = !result.tooLarge;
    shareUrlInput.value = result.url;
    shareUrlSize.textContent = formatBytes(result.bytes);
}

/** Copies the generated link to the clipboard, falling back to selection. */
async function copyShareUrl(): Promise<void> {
    const url = shareUrlInput.value;
    if (!url) return;
    try {
        await navigator.clipboard.writeText(url);
        showInfoToast('Data URL copied to clipboard', { id: 'share-copied', icon: 'link' });
    } catch {
        // clipboard API needs a secure context — fall back to selecting the text
        shareUrlInput.focus();
        shareUrlInput.select();
        showInfoToast('Press Ctrl+C to copy the data URL', { id: 'share-copied', icon: 'link' });
    }
}

/** Closes the share dialog. */
function closeShareDialog(): void {
    shareDialogOverlay.hidden = true;
}

/** Opens the share dialog and generates an initial link. */
function openShareDialog(): void {
    // the "embedded" option only makes sense when the loaded graph carries its
    // own display block; disable it otherwise
    const hasEmbedded = state.graph.display != null;
    const embeddedRadio = shareDisplayRadios().find(r => r.value === 'embedded');
    if (embeddedRadio) embeddedRadio.disabled = !hasEmbedded;
    shareDisplayEmbeddedRow.classList.toggle('disabled', !hasEmbedded);

    // default to not embedding any view settings (smallest, most-shareable URL)
    setShareDisplayMode('none');
    shareDialogOverlay.hidden = false;
    void regenerateShareUrl();
}

/** Opens a compact picker listing the bundled example graphs. */
function openExampleMenu(x: number, y: number): void {
    showContextMenu(x, y, buildExampleMenuItems(examples));
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
        label: 'Export graph…',
        icon: 'download',
        disabled: isEmpty,
        action: doExport,
    });
    items.push({
        label: 'Share as data URL…',
        icon: 'share',
        disabled: isEmpty,
        action: openShareDialog,
    });
    items.push({ divider: true });
    items.push({
        label: 'Reset layout',
        icon: 'view_quilt',
        action: resetLayout,
    });
    items.push({
        label: is3D() ? 'Switch to 2D view' : 'Switch to 3D view',
        icon: 'deployed_code',
        action: () => setRenderMode(is3D() ? '2d' : '3d'),
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
    toolCanvases = { selection: selectionCanvas, canvas };
    // md-icon-button renders a 48px absolutely-positioned touch target that
    // overflows our compact 34px buttons by ~7px; on the edge buttons this
    // leaks past the toolbar and creates a real (but unwanted) horizontal
    // scroll. these are dense desktop chrome sized via the 34px state layer,
    // so drop the oversized touch target
    for (const btn of toolbarEl.querySelectorAll('md-icon-button')) {
        btn.setAttribute('touch-target', 'none');
    }

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

    editTemplatesBtn.addEventListener('click', () => {
        const open = togglePanel(PANEL_TEMPLATES);
        editTemplatesBtn.classList.toggle('active', open);
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

    rectAddModeBtn.addEventListener('click', () => {
        state.selection.additive = !state.selection.additive;
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

    // share dialog wiring
    shareDialogClose.addEventListener('click', closeShareDialog);
    shareCopyBtn.addEventListener('click', () => void copyShareUrl());
    // regenerate the link whenever the view-settings choice changes
    shareDisplayModes.addEventListener('change', () => void regenerateShareUrl());
    // click on the backdrop (outside the dialog) closes it
    shareDialogOverlay.addEventListener('click', (event) => {
        if (event.target === shareDialogOverlay) closeShareDialog();
    });
    shareDialogOverlay.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') closeShareDialog();
    });

    // load the bundled example manifest so the logo menu can offer it
    void initExamples();

    // settings (parameters) pane toggle — docks alongside the other panels
    toggleSettingsBtn.addEventListener('click', () => {
        const open = togglePanel(PANEL_SETTINGS);
        toggleSettingsBtn.classList.toggle('active', open);
    });

    // keep the settings button in sync when the panel is closed via its tab
    on(EVT_LAYOUT_CHANGED, () => {
        toggleSettingsBtn.classList.toggle('active', isPanelOpen(PANEL_SETTINGS));
        editTemplatesBtn.classList.toggle('active', isPanelOpen(PANEL_TEMPLATES));
    });

    // dark mode toggle
    themeToggleBtn.addEventListener('click', () => {
        toggleTheme();
    });
    on(EVT_THEME_CHANGED, updateThemeIcon);
    updateThemeIcon();

    // 2D-only tools have no meaning in 3D; fall back to the pointer and let CSS
    // (body.mode-3d) hide the 2D-only chrome
    document.body.classList.toggle('mode-3d', is3D());
    on(EVT_RENDER_MODE_CHANGED, (mode: string) => {
        document.body.classList.toggle('mode-3d', mode === '3d');
        // preserve the active tool across the switch when it is supported in the
        // new mode; rect-select and edit rely on the 2D canvas, so fall back to
        // the pointer when entering 3D with one of those active
        if (mode === '3d' && (state.currentTool === 'rect-select' || state.currentTool === 'edit')) {
            setTool('pointer', selectionCanvas, canvas);
        }
    });

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

    // keep the horizontal scroll affordance in sync as contextual tool groups
    // appear/disappear or the viewport resizes
    const overflowObserver = new ResizeObserver(() => updateToolbarOverflow());
    overflowObserver.observe(toolbarEl);
    window.addEventListener('resize', updateToolbarOverflow);
    updateToolbarOverflow();
}
