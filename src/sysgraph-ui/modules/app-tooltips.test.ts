import { describe, expect, it } from 'vitest';
import { tooltipPosition } from './app-tooltips.js';

describe('application tooltip placement', () => {
    it('flips above a control near the bottom of the viewport', () => {
        expect(tooltipPosition({ left: 80, top: 180, width: 32, height: 24, bottom: 204 },
            120, 40, 240, 220)).toEqual({ left: 36, top: 131, placement: 'top' });
    });

    it('keeps wide tooltips inside either edge of the viewport', () => {
        expect(tooltipPosition({ left: 0, top: 10, width: 24, height: 24, bottom: 34 },
            150, 32, 180, 180).left).toBe(8);
        expect(tooltipPosition({ left: 170, top: 10, width: 24, height: 24, bottom: 34 },
            150, 32, 200, 180).left).toBe(42);
    });
});
