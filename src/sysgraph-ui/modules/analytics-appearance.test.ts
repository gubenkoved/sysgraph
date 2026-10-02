import * as d3 from 'd3';
import { afterEach, describe, expect, it } from 'vitest';
import { clearColorCaches, resolveLinkColor, resolveLinkWidth } from './graph-ui-appearance.js';
import { settings } from './settings.js';
import { state } from './state.js';

const previous = {
    active: state.analytics.active,
    decoration: state.analytics.decoration,
    edgeColors: settings.edgeColors,
    edgeWidths: settings.edgeWidths,
};

afterEach(() => {
    state.analytics.active = previous.active;
    state.analytics.decoration = previous.decoration;
    settings.edgeColors = previous.edgeColors;
    settings.edgeWidths = previous.edgeWidths;
    clearColorCaches();
});

describe('shortest path appearance', () => {
    it('keeps path edges visible when the dataset gives roads a faint stroke', () => {
        settings.edgeColors = { ...settings.edgeColors, road: { r: 130, g: 130, b: 130, a: 0.06 } };
        settings.edgeWidths = { ...settings.edgeWidths, road: 0.5 };
        state.analytics.active = true;
        state.analytics.decoration = {
            kind: 'subset', emphasis: 'path', nodeIds: new Set(['a', 'b']),
            edgeIds: new Set(['path']), edgeWidthMultiplier: 1.5,
        };
        clearColorCaches();
        const path = { id: 'path', source_id: 'a', target_id: 'b', type: 'road' };
        const other = { ...path, id: 'other' };

        expect(d3.color(resolveLinkColor(path))!.opacity).toBeGreaterThan(0.9);
        expect(d3.color(resolveLinkColor(other))!.opacity).toBeLessThan(0.02);
        expect(resolveLinkWidth(path)).toBeGreaterThan(2);
        expect(resolveLinkWidth(other)).toBe(0.5);
    });
});
