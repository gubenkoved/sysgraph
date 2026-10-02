import { describe, expect, it } from 'vitest';
import { adaptFastForwardBatchSize, fastForwardBatchSize, layoutStepsForFrame } from './layout-scheduler.js';

const frame = {
    enabled: true, ready: true, fastForward: false, batchPending: false, batchSize: 1,
    now: 1000, lastTick: 980, rate: 30, nodeCount: 44, edgeCount: 106,
};

describe('GPU layout scheduling', () => {
    it('uses the configured rate normally and runs batches in fast forward', () => {
        expect(layoutStepsForFrame(frame)).toBe(0);
        expect(layoutStepsForFrame({ ...frame, lastTick: 950 })).toBe(1);
        expect(layoutStepsForFrame({ ...frame, fastForward: true })).toBe(1);
        expect(layoutStepsForFrame({ ...frame, fastForward: true, batchSize: 24 })).toBe(24);
        expect(layoutStepsForFrame({ ...frame, fastForward: true, batchSize: 24,
            nodeCount: 100_000, edgeCount: 500_000 })).toBe(2);
        expect(layoutStepsForFrame({ ...frame, fastForward: true, batchPending: true })).toBe(0);
        expect(layoutStepsForFrame({ ...frame, fastForward: true, enabled: false })).toBe(0);
        expect(layoutStepsForFrame({ ...frame, fastForward: true, ready: false })).toBe(0);
    });

    it('reduces batch size as graphs grow', () => {
        expect(fastForwardBatchSize(44, 106)).toBe(24);
        expect(fastForwardBatchSize(1600, 3120)).toBe(10);
        expect(fastForwardBatchSize(100_000, 500_000)).toBe(2);
        expect(adaptFastForwardBatchSize(4, 4, 12, 44, 106)).toBe(8);
        expect(adaptFastForwardBatchSize(8, 8, 110, 44, 106)).toBe(4);
        expect(adaptFastForwardBatchSize(4, 2, 12, 44, 106)).toBe(4);
        expect(adaptFastForwardBatchSize(2, 2, 12, 100_000, 500_000)).toBe(2);
    });
});
