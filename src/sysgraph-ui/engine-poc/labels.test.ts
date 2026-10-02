import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphInteractionIndex } from './interaction.js';
import { createLabelAtlas, GraphLabelLayout, normalizeLabelLines } from './labels.js';
import type { CameraState } from './renderer.js';

afterEach(() => vi.unstubAllGlobals());

describe('graph labels', () => {
    it('preserves line breaks and puts spaces, but no newline characters, in the atlas', () => {
        const lines = normalizeLabelLines('minor god\r\nEcho');
        expect(lines.map(line => line.join(''))).toEqual(['minor god', 'Echo']);

        const context = {
            measureText: (value: string) => ({ width: value.length * 12 }),
            strokeText: vi.fn(),
            fillText: vi.fn(),
        };
        vi.stubGlobal('document', {
            createElement: () => ({ getContext: () => context }),
            documentElement: { getAttribute: () => 'light' },
        });
        const atlas = createLabelAtlas(['minor god\nEcho']);
        expect(atlas.canvas).toMatchObject({ width: 3072, height: 1536 });
        expect(context).toHaveProperty('font', "500 45px Ubuntu, 'Segoe UI', Arial, sans-serif");
        expect(atlas.glyphs.has(' ')).toBe(true);
        expect(atlas.glyphs.has('\n')).toBe(false);
        expect(atlas.kerning?.('m', 'i')).toBe(0);
    });

    it('stacks lines and prevents labels from overlapping the full text block', () => {
        const nodes = new Float32Array([0, 0, 0, 5, 0, 30, 0, 5]);
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array([0, 1]));
        const characters = Array.from(new Set('0123456789#?… minorgodEchother'));
        const atlas = {
            canvas: {} as HTMLCanvasElement,
            glyphs: new Map(characters.map((character, index) => [character, index] as const)),
            advances: new Float32Array(characters.length).fill(8),
        };
        const camera: CameraState = {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: false, yaw: 0, pitch: 0, distance: 100, referenceDistance: 100,
        };
        const layout = new GraphLabelLayout(nodes, interaction, atlas, ['minor god\nEcho', 'other']);
        const frame = layout.build(camera, 600, 400, 1, [], 0, interaction.getNeighbors(0));

        expect(frame.labelCount).toBe(1);
        expect(frame.glyphCount).toBe(12); // The space and line break consume no glyph quads.
        expect(frame.data[8 * 12 + 1]! - frame.data[1]!).toBe(20);

        const prioritized = layout.build(camera, 600, 400, 1, [], null, undefined, 1);
        expect(prioritized.labelCount).toBe(1);
        expect(prioritized.glyphCount).toBe(5); // The active search result wins the overlap.
    });

    it('crossfades labels when overlap or focus choices change and reverses without jumping', () => {
        const nodes = Float32Array.of(0, 0, 0, 5, 0, 0, 0, 5);
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array(0));
        const characters = Array.from(new Set('0123456789#?… AlphaBeta'));
        const atlas = {
            canvas: {} as HTMLCanvasElement,
            glyphs: new Map(characters.map((character, index) => [character, index] as const)),
            advances: new Float32Array(characters.length).fill(8),
        };
        const camera: CameraState = {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: false, yaw: 0, pitch: 0, distance: 100, referenceDistance: 100,
        };
        const layout = new GraphLabelLayout(nodes, interaction, atlas, ['Alpha', 'Beta']);
        const alphaByNode = (time: number, focus: number | null): Map<number, number> => {
            const frame = layout.build(camera, 600, 400, 1, [], focus, undefined, undefined, time, true);
            const words = new Uint32Array(frame.data.buffer, frame.data.byteOffset, frame.data.length);
            const result = new Map<number, number>();
            for (let glyph = 0; glyph < frame.glyphCount; glyph++) {
                result.set(words[glyph * 12 + 8]!, frame.data[glyph * 12 + 9]!);
            }
            return result;
        };

        expect(alphaByNode(0, 0).get(0)).toBe(0);
        expect(alphaByNode(200, 0).get(0)).toBe(1);
        const changed = alphaByNode(220, 1);
        expect(changed.get(0)).toBe(1);
        expect(changed.get(1)).toBe(0);
        const midway = alphaByNode(295, 1);
        expect(midway.get(0)).toBeGreaterThan(0);
        expect(midway.get(0)).toBeLessThan(1);
        expect(midway.get(1)).toBeGreaterThan(0);
        expect(midway.get(1)).toBeLessThan(1);

        const reversed = alphaByNode(295, 0);
        expect(reversed.get(0)).toBeCloseTo(midway.get(0)!);
        expect(reversed.get(1)).toBeCloseTo(midway.get(1)!);
        expect(alphaByNode(500, 0).get(0)).toBe(1);
        expect(alphaByNode(500, 0).has(1)).toBe(false);

        expect(alphaByNode(520, null).get(0)).toBe(1);
        expect(alphaByNode(720, null).size).toBe(0);
    });

    it('uses font pair spacing to place glyphs without losing overlap bounds', () => {
        const nodes = Float32Array.of(0, 0, 0, 5);
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array(0));
        const atlas = {
            canvas: {} as HTMLCanvasElement,
            glyphs: new Map([['?', 0], ['A', 1], ['V', 2]]),
            advances: Float32Array.of(8, 8, 8),
            kerning: (left: string, right: string) => left === 'A' && right === 'V' ? -1.5 : 0,
        };
        const camera: CameraState = {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: false, yaw: 0, pitch: 0, distance: 100, referenceDistance: 100,
        };
        const layout = new GraphLabelLayout(nodes, interaction, atlas, ['AV']);
        const frame = layout.build(camera, 600, 400, 1, [], 0);
        expect(frame.glyphCount).toBe(2);
        expect(frame.data[12]! - frame.data[0]!).toBeCloseTo(6.5);
    });

    it('fills available screen space in 3D even at a low camera scale', () => {
        const columns = 12;
        const rows = 8;
        const nodes = new Float32Array(columns * rows * 4);
        const labels: string[] = [];
        for (let row = 0; row < rows; row++) {
            for (let column = 0; column < columns; column++) {
                const index = row * columns + column;
                nodes[index * 4] = (column - (columns - 1) / 2) * 320;
                nodes[index * 4 + 1] = (row - (rows - 1) / 2) * 200;
                nodes[index * 4 + 3] = 1;
                labels.push(`N${index}`);
            }
        }
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array(0));
        const characters = Array.from(new Set('0123456789#?… N'));
        const atlas = {
            canvas: {} as HTMLCanvasElement,
            glyphs: new Map(characters.map((character, index) => [character, index] as const)),
            advances: new Float32Array(characters.length).fill(8),
        };
        const camera: CameraState = {
            centerX: 0, centerY: 0, centerZ: 0, scale: 0.25, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0, distance: 1000, referenceDistance: 1000,
        };
        const layout = new GraphLabelLayout(nodes, interaction, atlas, labels, new Float32Array(labels.length));

        expect(layout.build(camera, 1200, 800, 1, [], null).labelCount).toBe(labels.length);
        expect(layout.build({ ...camera, scale: 0.05 }, 1200, 800, 1, [], null).labelCount).toBeLessThan(labels.length);
    });
});
