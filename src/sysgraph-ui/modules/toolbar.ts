import { state, setCurrentTool } from './state.js';
import { emit } from './event-bus.js';
import { deleteSelectedNodes } from './selection.js';
import { EVT_SEARCH_CHANGED, EVT_SEARCH_CYCLE } from './constants.js';

// cached DOM elements
const toolPointerBtn = document.getElementById('toolPointer') as HTMLElement;
const toolRectSelectBtn = document.getElementById('toolRectSelect') as HTMLElement;
const toolSearchBtn = document.getElementById('toolSearch') as HTMLElement;
const deleteBtn = document.getElementById('deleteSelected') as HTMLButtonElement;
const unselectBtn = document.getElementById('unselectAll') as HTMLButtonElement;
const invertSelectionBtn = document.getElementById('invertSelection') as HTMLButtonElement;
const graphInfoEl = document.getElementById('graphInfo') as HTMLElement;
const searchInput = document.getElementById('searchInput') as HTMLInputElement;
const searchHelpTrigger = document.getElementById('searchHelpTrigger') as HTMLElement;
const searchHelpAnchor = document.getElementById('searchHelpAnchor') as HTMLElement;
const searchHelpPopover = document.getElementById('searchHelp') as HTMLElement;
const searchMatchCount = document.getElementById('searchMatchCount') as HTMLElement;
const addToSelectionBtn = document.getElementById('addToSelection') as HTMLButtonElement;

type Tool = 'pointer' | 'rect-select' | 'search';

/**
 * Activates the given tool and updates toolbar button states.
 */
export function setTool(tool: Tool, selectionCanvas: HTMLCanvasElement, canvas: HTMLCanvasElement): void {
    setCurrentTool(tool);

    toolPointerBtn.classList.toggle('active', tool === 'pointer');
    toolRectSelectBtn.classList.toggle('active', tool === 'rect-select');
    toolSearchBtn.classList.toggle('active', tool === 'search');

    if (tool === 'rect-select') {
        selectionCanvas.style.pointerEvents = 'auto';
        selectionCanvas.style.cursor = 'crosshair';
    } else {
        selectionCanvas.style.pointerEvents = 'none';
        canvas.style.cursor = 'default';
    }

    if (tool === 'search') {
        searchInput.style.display = 'inline-block';
        searchHelpAnchor.style.display = 'inline-flex';
        addToSelectionBtn.style.display = 'inline-block';
        searchInput.focus();
        if (searchInput.value) {
            emit(EVT_SEARCH_CHANGED, searchInput.value);
        } else {
            searchMatchCount.style.display = 'none';
            addToSelectionBtn.disabled = true;
        }
    } else {
        searchInput.style.display = 'none';
        searchHelpAnchor.style.display = 'none';
        searchHelpPopover.classList.remove('open');
        searchMatchCount.style.display = 'none';
        addToSelectionBtn.style.display = 'none';
        emit(EVT_SEARCH_CHANGED, '');
    }

    updateGraphInfo();
}

/** Updates the selection info label and button visibility based on current state. */
export function updateGraphInfo(): void {
    const isSelectionTool = state.currentTool === 'rect-select' || state.currentTool === 'search';

    if (isSelectionTool) {
        deleteBtn.style.display = 'inline-block';
        unselectBtn.style.display = 'inline-block';
        if (state.selection.selectedNodeIds.size > 0) {
            graphInfoEl.textContent = `${state.selection.selectedNodeIds.size} node${state.selection.selectedNodeIds.size !== 1 ? 's' : ''} selected`;
            deleteBtn.disabled = false;
            unselectBtn.disabled = false;
            invertSelectionBtn.style.display = 'inline-block';
        } else {
            graphInfoEl.textContent = '';
            deleteBtn.disabled = true;
            unselectBtn.disabled = true;
            invertSelectionBtn.style.display = 'none';
        }
    } else {
        deleteBtn.style.display = 'none';
        unselectBtn.style.display = 'none';
        invertSelectionBtn.style.display = 'none';
        const nodeCount = state.graph.nodesMap.size;
        const edgeCount = state.graph.edgesMap.size;
        graphInfoEl.textContent = nodeCount > 0
            ? `${nodeCount} nodes · ${edgeCount} relationships`
            : '';
    }
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
        } else if (event.key === 'Delete' && state.currentTool === 'rect-select' && state.selection.selectedNodeIds.size > 0) {
            await deleteSelectedNodes();
        }
    });
}
