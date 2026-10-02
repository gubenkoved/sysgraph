import { describe, expect, it } from 'vitest';
import { nodeRadius } from '../modules/constants.js';
import { MAX_NODE_SCREEN_RADIUS, MIN_NODE_SCREEN_RADIUS, screenNodeRadius } from './node-size.js';

describe('node screen radius', () => {
    it('supports near-point nodes and large nodes while respecting camera zoom and perspective', () => {
        expect(nodeRadius({ val: 0.1 })).toBeCloseTo(0.3);
        expect(nodeRadius({ val: 24 })).toBe(72);
        expect(screenNodeRadius(0.3, 1)).toBe(MIN_NODE_SCREEN_RADIUS);
        expect(screenNodeRadius(72, 1)).toBe(72);
        expect(screenNodeRadius(72, 2, 1.5)).toBe(192);
        expect(screenNodeRadius(72, 4)).toBe(MAX_NODE_SCREEN_RADIUS);
        expect(screenNodeRadius(72, 4, 1, 800)).toBe(288);
        expect(screenNodeRadius(72, 20, 1, 800)).toBe(800);
    });
});
