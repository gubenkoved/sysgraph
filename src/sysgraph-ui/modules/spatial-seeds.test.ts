import { describe, expect, it } from 'vitest';
import type { FGNode } from './graph-ui-types.js';
import { restorePlanarGeography, seedDepths } from './spatial-seeds.js';

describe('authored spatial seeds', () => {
    it('keeps authored depth, with pins and globe coordinates taking precedence', () => {
        const nodes: FGNode[] = [
            { id: 'a', type: 'node', authoredZ: 320 },
            { id: 'b', type: 'node', authoredZ: 80, fz: -40 },
        ];
        const positions = new Float32Array([0, 0, 0, 1, 10, 10, 0, 1]);
        expect([...seedDepths(nodes, positions, null)]).toEqual([320, -40]);
        expect([...seedDepths(nodes, positions, new Float32Array([500, 600]))]).toEqual([500, -40]);
    });

    it('restores the 2D map after a geographic graph is viewed as a globe', () => {
        const nodes: FGNode[] = [
            { id: 'a', type: 'place', x: 700, y: -200, authoredX: -100, authoredY: 50,
                properties: { lat: 40, lon: -74 } },
            { id: 'b', type: 'place', x: 710, y: -210, authoredX: -90, authoredY: 40,
                properties: { lat: 41, lon: -73 } },
        ];
        expect(restorePlanarGeography(nodes)).toBe(true);
        expect(nodes.map(node => [node.x, node.y])).toEqual([[-100, 50], [-90, 40]]);
    });
});
