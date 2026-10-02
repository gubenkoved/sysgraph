import * as d3 from 'd3';
import { afterEach, describe, expect, it } from 'vitest';
import { clearColorCaches, resolveLinkColor, resolveLinkWidth, resolveNodeAppearance } from './graph-ui-appearance.js';
import { settings } from './settings.js';
import { state } from './state.js';

const previous = {
    active: state.analytics.active,
    decoration: state.analytics.decoration,
    highlight: state.highlight,
    search: state.search,
    edgeColors: settings.edgeColors,
    edgeWidths: settings.edgeWidths,
    nodeColors: settings.nodeColors,
};

afterEach(() => {
    state.analytics.active = previous.active;
    state.analytics.decoration = previous.decoration;
    state.highlight = previous.highlight;
    state.search = previous.search;
    settings.edgeColors = previous.edgeColors;
    settings.edgeWidths = previous.edgeWidths;
    settings.nodeColors = previous.nodeColors;
    clearColorCaches();
});

describe('search appearance', () => {
    it('keeps an unmatched node translucent while hover highlighting is active', () => {
        settings.nodeColors = { ...settings.nodeColors, city: { r: 32, g: 104, b: 184, a: 1 } };
        state.analytics.active = false;
        state.analytics.decoration = null;
        state.search = { matches: [], matchesMap: new Map(), matchColorsMap: new Map(), currentMatchIndex: -1 };
        state.highlight = { nodeDistancesMap: new Map([['background', 1]]), edgeDistancesMap: new Map() };
        clearColorCaches();

        const muted = d3.color(resolveNodeAppearance({ id: 'background', type: 'city' }).fillStyle)!.rgb();
        expect([muted.r, muted.g, muted.b]).toEqual([32, 104, 184]);
        expect(muted.opacity).toBeGreaterThan(0);
        expect(muted.opacity).toBeLessThanOrEqual(0.28);
    });
});

describe('shortest path appearance', () => {
    it('dims background nodes through alpha without changing their original color', () => {
        settings.nodeColors = { ...settings.nodeColors, city: { r: 32, g: 104, b: 184, a: 1 } };
        state.analytics.active = true;
        state.analytics.decoration = {
            kind: 'subset', emphasis: 'path', nodeIds: new Set(['focused']),
            edgeIds: new Set(), edgeWidthMultiplier: 1.5,
        };
        clearColorCaches();

        const muted = d3.color(resolveNodeAppearance({ id: 'background', type: 'city' }).fillStyle)!.rgb();
        expect([muted.r, muted.g, muted.b]).toEqual([32, 104, 184]);
        expect(muted.opacity).toBeCloseTo(0.1);
    });

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
