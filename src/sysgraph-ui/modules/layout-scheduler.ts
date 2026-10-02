export interface LayoutFrameState {
    enabled: boolean;
    ready: boolean;
    fastForward: boolean;
    batchPending: boolean;
    batchSize: number;
    now: number;
    lastTick: number;
    rate: number;
    nodeCount: number;
    edgeCount: number;
}

/** More small-graph ticks per frame, with conservative batches for dense graphs. */
export function fastForwardBatchSize(nodeCount: number, edgeCount: number): number {
    if (edgeCount >= 250_000 || nodeCount >= 25_000) return 2;
    if (edgeCount >= 50_000 || nodeCount >= 5_000) return 4;
    if (edgeCount >= 10_000 || nodeCount >= 2_000) return 6;
    if (edgeCount >= 2_500 || nodeCount >= 750) return 10;
    if (edgeCount >= 500 || nodeCount >= 200) return 16;
    return 24;
}

/** Aim for short GPU batches so the graph continues to redraw during convergence. */
export function adaptFastForwardBatchSize(
    current: number, completedSteps: number, elapsedMs: number, nodeCount: number, edgeCount: number,
): number {
    const limit = fastForwardBatchSize(nodeCount, edgeCount);
    if (elapsedMs < 24 && completedSteps >= current) return Math.min(limit, current * 2);
    if (elapsedMs > 75) return Math.max(1, Math.floor(current / 2));
    return current;
}

export function layoutStepsForFrame(state: LayoutFrameState): number {
    if (!state.enabled || !state.ready) return 0;
    if (state.fastForward) {
        return state.batchPending ? 0 : Math.min(
            Math.max(1, Math.floor(state.batchSize)),
            fastForwardBatchSize(state.nodeCount, state.edgeCount),
        );
    }
    return state.now - state.lastTick >= 1000 / Math.max(1, state.rate) ? 1 : 0;
}
