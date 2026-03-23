export const state = {
    highlight: null,
    currentTool: "pointer",
    selection: {
        selectedNodeIds: new Set(),
        isSelecting: false,
        selectionStart: null,
        selectionEnd: null,
        selectionStartCanvas: null,
        selectionEndCanvas: null,
    }
}

export let data = initData();

export function initData() {
    return {
        nodes: [],
        edges: [],
    }
}

export function updateData(newData) {
    data = newData;
}
