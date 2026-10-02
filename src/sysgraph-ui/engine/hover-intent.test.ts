import { describe, expect, it } from 'vitest';
import { HoverIntent } from './hover-intent.js';

describe('hover intent', () => {
    it('ignores nodes crossed quickly and activates the one where the pointer settles', () => {
        const intent = new HoverIntent();
        intent.observe(1, 0);
        expect(intent.advance(80)).toBeUndefined();
        intent.observe(2, 80);
        expect(intent.advance(150)).toBeUndefined();
        expect(intent.advance(190)).toBe(2);
        expect(intent.active).toBe(2);
    });

    it('keeps the current neighborhood through short gaps and switches after another dwell', () => {
        const intent = new HoverIntent();
        intent.activate(1);
        intent.observe(null, 0);
        expect(intent.advance(60)).toBeUndefined();
        intent.observe(2, 60);
        expect(intent.active).toBe(1);
        expect(intent.advance(169)).toBeUndefined();
        expect(intent.advance(170)).toBe(2);
        intent.observe(null, 200);
        expect(intent.advance(289)).toBeUndefined();
        expect(intent.advance(290)).toBeNull();
    });

    it('cancels pending changes during a drag or when the pointer leaves', () => {
        const intent = new HoverIntent();
        intent.observe(1, 0);
        intent.cancelPending();
        expect(intent.advance(500)).toBeUndefined();
        intent.activate(2);
        intent.observe(3, 600);
        intent.reset();
        expect(intent.advance(900)).toBeUndefined();
        expect(intent.active).toBeNull();
    });
});
