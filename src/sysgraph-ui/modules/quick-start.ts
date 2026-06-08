import { CMD_LOAD_EXAMPLE, EVT_GRAPH_UPDATED, EVT_TOOL_CHANGED, STANDALONE } from './constants.js';
import { showContextMenu } from './context-menu.js';
import { loadExamplesManifest } from './data-io.js';
import { handle, on } from './event-bus.js';
import { state } from './state.js';
import { showError } from './util.js';

// cached DOM elements
const quickStartEl = document.getElementById('quickStart') as HTMLElement;
const importBtn = document.getElementById('quickStartImport') as HTMLElement;
const exampleBtn = document.getElementById('quickStartExample') as HTMLElement;
const editBtn = document.getElementById('quickStartEdit') as HTMLElement;
const importFileInput = document.getElementById('importFile') as HTMLInputElement;

// suppress the panel until the initial backend load settles; standalone builds
// have no backend, so they are ready immediately
let ready = STANDALONE;

/**
 * Marks the quick-start panel ready to appear (called once the initial backend
 * load has settled) and refreshes its visibility.
 */
export function markQuickStartReady(): void {
    ready = true;
    refreshVisibility();
}

/** Shows the quick-start panel only when the graph is empty and edit mode is inactive. */
function refreshVisibility(): void {
    const isEmpty = state.graph.nodesMap.size === 0;
    const visible = ready && isEmpty && state.currentTool !== 'edit';
    quickStartEl.classList.toggle('visible', visible);
}

/** Activates a role="button" row on Enter/Space for keyboard accessibility. */
function activateOnKey(el: HTMLElement): void {
    el.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            el.click();
        }
    });
}

/**
 * Wires the empty-graph quick-start panel. Buttons reuse the existing toolbar
 * flows: import triggers the shared hidden file input, "load example" opens the
 * same picker menu, and "edit mode" delegates to the provided callback.
 */
export function initQuickStart(onEditMode: () => void): void {
    importBtn.addEventListener('click', () => {
        // reuse the shared hidden input wired by the toolbar
        importFileInput.click();
    });
    activateOnKey(importBtn);

    void initExampleButton();

    editBtn.addEventListener('click', () => {
        onEditMode();
    });
    activateOnKey(editBtn);

    on(EVT_GRAPH_UPDATED, refreshVisibility);
    on(EVT_TOOL_CHANGED, refreshVisibility);

    refreshVisibility();
}

/** Loads the example manifest and wires the picker; hides the button when none exist. */
async function initExampleButton(): Promise<void> {
    const examples = await loadExamplesManifest();
    if (examples.length === 0) {
        exampleBtn.style.display = 'none';
        return;
    }

    exampleBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        const rect = exampleBtn.getBoundingClientRect();
        showContextMenu(
            rect.left,
            rect.bottom + 4,
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
    });
    activateOnKey(exampleBtn);
}
