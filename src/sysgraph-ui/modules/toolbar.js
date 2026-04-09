import { state } from './state.js';
import { emit, on } from './event-bus.js';
import { deleteSelectedNodes } from './selection.js';

// cached DOM elements
const toolPointerBtn = document.getElementById('toolPointer');
const toolRectSelectBtn = document.getElementById('toolRectSelect');
const toolSearchBtn = document.getElementById('toolSearch');
const deleteBtn = document.getElementById('deleteSelected');
const unselectBtn = document.getElementById('unselectAll');
const selectionInfoEl = document.getElementById('selectionInfo');
const searchInput = document.getElementById('searchInput');
const searchHelpTrigger = document.getElementById('searchHelpTrigger');
const searchHelpAnchor = document.getElementById('searchHelpAnchor');
const searchHelpPopover = document.getElementById('searchHelp');
const searchMatchCount = document.getElementById('searchMatchCount');
const addToSelectionBtn = document.getElementById('addToSelection');

/**
 * Activates the given tool and updates toolbar button states.
 * @param {'pointer' | 'rect-select' | 'search'} tool
 * @param {HTMLCanvasElement} selectionCanvas
 * @param {HTMLCanvasElement} canvas
 */
export function setTool(tool, selectionCanvas, canvas) {
    state.currentTool = tool;

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
            emit("search-expression-changed", searchInput.value);
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
        emit("search-expression-changed", "");
    }

    updateSelectionInfo();
}

/** Updates the selection info label and button visibility based on current state. */
export function updateSelectionInfo() {
    const isSelectionTool = state.currentTool === 'rect-select' || state.currentTool === 'search';

    if (isSelectionTool) {
        deleteBtn.style.display = 'inline-block';
        unselectBtn.style.display = 'inline-block';
        if (state.selection.selectedNodeIds.size > 0) {
            selectionInfoEl.textContent = `${state.selection.selectedNodeIds.size} node${state.selection.selectedNodeIds.size !== 1 ? 's' : ''} selected`;
            deleteBtn.disabled = false;
            unselectBtn.disabled = false;
        } else {
            selectionInfoEl.textContent = '';
            deleteBtn.disabled = true;
            unselectBtn.disabled = true;
        }
    } else {
        selectionInfoEl.textContent = '';
        deleteBtn.style.display = 'none';
        unselectBtn.style.display = 'none';
    }
}

/**
 * Wires up toolbar buttons, search input, and keyboard shortcuts.
 * @param {HTMLCanvasElement} selectionCanvas
 * @param {HTMLCanvasElement} canvas
 */
export function initToolbar(selectionCanvas, canvas) {
    // search input
    searchInput.addEventListener('input', (event) => {
        event.stopPropagation();
        emit("search-expression-changed", event.target.value);
    });

    // search help popover toggle
    searchHelpTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        searchHelpPopover.classList.toggle('open');
    });

    // dismiss on outside click
    document.addEventListener('click', (e) => {
        if (!searchHelpAnchor.contains(e.target)) {
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
        updateSelectionInfo();
    });

    addToSelectionBtn.addEventListener('click', () => {
        if (state.search && state.search.matchesMap.size > 0) {
            for (const nodeId of state.search.matchesMap.keys()) {
                state.selection.selectedNodeIds.add(nodeId);
            }
            updateSelectionInfo();
        }
    });

    // keyboard shortcuts
    document.addEventListener('keydown', async (event) => {
        const el = event.target;

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
