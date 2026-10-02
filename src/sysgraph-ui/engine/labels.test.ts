import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphInteractionIndex } from './interaction.js';
import { createLabelAtlas, GraphLabelLayout, normalizeLabelLines } from './labels.js';
import type { CameraState } from './renderer.js';

afterEach(() => vi.unstubAllGlobals());

describe('graph labels', () => {
    it('preserves line breaks and puts spaces, but no newline characters, in the atlas', () => {
        const lines = normalizeLabelLines('minor god\r\nEcho');
        expect(lines.map(line => line.join(''))).toEqual(['MINOR GOD', 'ECHO']);
        expect(normalizeLabelLines('Liège')[0]!.join('')).toBe('LIÈGE');

        const context = {
            measureText: (value: string) => ({ width: value.length * 12 }),
            strokeText: vi.fn(),
            fillText: vi.fn(),
        };
        let theme = 'light';
        vi.stubGlobal('document', {
            createElement: () => ({ getContext: () => context }),
            documentElement: { getAttribute: () => theme },
        });
        const atlas = createLabelAtlas(['minor god\nEcho']);
        expect(atlas.canvas).toMatchObject({ width: 3072, height: 1536 });
        expect(context).toHaveProperty('font', '600 42px "Ubuntu Mono", \'Ubuntu Mono\', Consolas, monospace');
        expect(atlas.glyphs.has(' ')).toBe(true);
        expect(atlas.glyphs.has('\n')).toBe(false);
        expect(atlas.kerning?.('m', 'i')).toBe(0);
        expect(context.strokeText).toHaveBeenCalled();
        expect(context).toHaveProperty('fillStyle', '#1d3142');

        context.strokeText.mockClear();
        createLabelAtlas(['Liège'], 'plain');
        expect(context.strokeText).not.toHaveBeenCalled();
        createLabelAtlas(['Liège'], 'soft-background');
        expect(context.strokeText).toHaveBeenCalled();
        context.strokeText.mockClear();
        theme = 'dark';
        const plateAtlas = createLabelAtlas(['Liège'], 'plate');
        expect(context.strokeText).not.toHaveBeenCalled();
        expect(context).toHaveProperty('fillStyle', '#e7f7f0');
        expect(plateAtlas.lightTheme).toBe(false);

        const wholeAtlas = createLabelAtlas(['minor god\nEcho'], 'plain', 'whole');
        expect(wholeAtlas.tiles?.get(0)).toMatchObject({ height: 48 });
        expect(wholeAtlas.tiles?.get(0)?.uv[1]).toBeGreaterThan(0);
        expect(context.fillText).toHaveBeenCalledWith('MINOR GOD', expect.any(Number), expect.any(Number));
        const duplicated = createLabelAtlas(['Same', 'Same'], 'plain', 'whole');
        expect(duplicated.tiles?.get(0)).toBe(duplicated.tiles?.get(1));
    });

    it('stacks lines and prevents labels from overlapping the full text block', () => {
        const nodes = new Float32Array([0, 0, 0, 5, 0, 30, 0, 5]);
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array([0, 1]));
        const characters = Array.from(new Set('0123456789#?… MINORGODECHOTHER'));
        const atlas = {
            canvas: {} as HTMLCanvasElement,
            glyphs: new Map(characters.map((character, index) => [character, index] as const)),
            advances: new Float32Array(characters.length).fill(8),
            style: 'plate' as const,
            lightTheme: true,
        };
        const camera: CameraState = {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: false, yaw: 0, pitch: 0, distance: 100, referenceDistance: 100,
        };
        const layout = new GraphLabelLayout(nodes, interaction, atlas, ['minor god\nEcho', 'other']);
        const frame = layout.build(camera, 600, 400, 1, [], 0, interaction.getNeighbors(0), undefined, 0);

        expect(frame.labelCount).toBe(1);
        expect(frame.glyphCount).toBe(12); // The space and line break consume no glyph quads.
        expect(frame.plateCount).toBe(1);
        expect(frame.underlay).toBe(false);
        const plateOffset = frame.glyphCount * 12;
        const words = new Uint32Array(frame.data.buffer, frame.data.byteOffset, frame.data.length);
        expect(words[plateOffset + 10]).toBe(2);
        expect(frame.data[plateOffset + 2]).toBeGreaterThan(0);
        expect(frame.data[8 * 12 + 1]! - frame.data[1]!).toBe(20);

        const prioritized = layout.build(camera, 600, 400, 1, [], null, undefined, 1, 0);
        expect(prioritized.labelCount).toBe(1);
        expect(prioritized.glyphCount).toBe(5); // The active search result wins the overlap.
    });

    it('crossfades labels when overlap or focus choices change and reverses without jumping', () => {
        const nodes = Float32Array.of(0, 0, 0, 5, 0, 0, 0, 5);
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array(0));
        const characters = Array.from(new Set('0123456789#?… ALPHABETA'));
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
        expect(frame.plateCount).toBe(0);
        expect(frame.underlay).toBe(false);
        expect(frame.data[12]! - frame.data[0]!).toBeCloseTo(7.05);
    });

    it('uses one GPU quad for a whole label and marks only the snapped method for pixel alignment', () => {
        const nodes = Float32Array.of(0, 0, 0, 5);
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array(0));
        const camera: CameraState = {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: false, yaw: 0, pitch: 0, distance: 100, referenceDistance: 100,
        };
        const base = {
            canvas: {} as HTMLCanvasElement,
            glyphs: new Map([['?', 0], ['A', 1], ['B', 2]]),
            advances: Float32Array.of(8, 8, 8),
            tiles: new Map([[0, { width: 26, height: 28, uv: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number] }]]),
        };
        for (const rendering of ['whole', 'whole-snapped'] as const) {
            const layout = new GraphLabelLayout(nodes, interaction, { ...base, rendering }, ['AB']);
            const frame = layout.build(camera, 600, 400, 1, [], 0);
            const words = new Uint32Array(frame.data.buffer, frame.data.byteOffset, frame.data.length);
            expect(frame.glyphCount).toBe(1);
            expect(frame.data.slice(4, 8)).toEqual(Float32Array.of(0.1, 0.2, 0.3, 0.4));
            expect(words[11]).toBe(rendering === 'whole-snapped' ? 3 : 2);
        }

        const glyphLayout = new GraphLabelLayout(nodes, interaction,
            { ...base, tiles: new Map(), rendering: 'glyphs-filtered' }, ['AB']);
        const glyphFrame = glyphLayout.build(camera, 600, 400, 1, [], 0);
        const glyphWords = new Uint32Array(glyphFrame.data.buffer, glyphFrame.data.byteOffset, glyphFrame.data.length);
        expect(glyphFrame.glyphCount).toBe(2);
        expect(glyphWords[11]).toBe(2);
    });

    it('draws a background only for the selected label style across rendering methods', () => {
        const nodes = Float32Array.of(0, 0, 0, 5);
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array(0));
        const camera: CameraState = {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: false, yaw: 0, pitch: 0, distance: 100, referenceDistance: 100,
        };
        const base = {
            canvas: {} as HTMLCanvasElement,
            glyphs: new Map([['?', 0], ['A', 1], ['B', 2], ['C', 3]]),
            advances: Float32Array.of(8, 8, 8, 8),
            lightTheme: true,
        };
        for (const rendering of ['glyphs', 'glyphs-filtered', 'whole', 'whole-snapped'] as const) {
            const tiles = rendering.startsWith('whole')
                ? new Map([[0, { width: 24, height: 48, lineWidths: [20, 8],
                    uv: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number] }]])
                : new Map();
            for (const [style, expectedPlates] of [['plain', 0], ['outlined', 0],
                ['plate', 1], ['soft-background', 2]] as const) {
                const layout = new GraphLabelLayout(nodes, interaction,
                    { ...base, style, rendering, tiles }, ['AB\nC']);
                const frame = layout.build(camera, 800, 600, 1, [], 0);
                expect(frame.labelCount, `${style}/${rendering}`).toBe(1);
                expect(frame.glyphCount, `${style}/${rendering}`).toBe(tiles.size ? 1 : 3);
                expect(frame.plateCount, `${style}/${rendering}`).toBe(expectedPlates);
                expect(frame.data.length, `${style}/${rendering}`).toBe((frame.glyphCount + expectedPlates) * 12);
                expect(frame.underlay, `${style}/${rendering}`).toBe(style === 'soft-background');
            }
        }
    });

    it('places an explicitly selected soft background behind each visible text line with the same fade as its glyphs', () => {
        const nodes = Float32Array.of(0, 0, 0, 5);
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array(0));
        const atlas = {
            canvas: {} as HTMLCanvasElement,
            glyphs: new Map([['?', 0], ['A', 1], ['B', 2], ['C', 3]]),
            advances: Float32Array.of(8, 8, 8, 8),
            style: 'soft-background' as const,
            lightTheme: true,
        };
        const camera: CameraState = {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: false, yaw: 0, pitch: 0, distance: 100, referenceDistance: 100,
        };
        const layout = new GraphLabelLayout(nodes, interaction, atlas, ['AB\nC']);
        const starting = layout.build(camera, 800, 600, 1, [], 0, undefined, undefined, 0);
        expect(starting.plateCount).toBe(2);
        expect(starting.data[starting.glyphCount * 12 + 9]).toBe(0);

        const frame = layout.build(camera, 800, 600, 1, [], 0, undefined, undefined, 200);
        const words = new Uint32Array(frame.data.buffer, frame.data.byteOffset, frame.data.length);
        const first = frame.glyphCount * 12;
        const second = first + 12;
        expect(frame.glyphCount).toBe(3);
        expect(frame.plateCount).toBe(2);
        expect(frame.underlay).toBe(true);
        expect(frame.data.length).toBe(5 * 12);
        expect(words[first + 10]).toBe(4); // Light-theme soft underlay.
        expect(words[second + 10]).toBe(4);
        expect(frame.data[first]).toBe(8); // Two CSS pixels to the left of the text.
        expect(frame.data[first + 2]).toBeCloseTo(20.55); // Two CSS pixels at each end.
        expect(frame.data[second + 2]).toBe(12);
        expect(frame.data[second + 1]! - frame.data[first + 1]!).toBe(20);
        expect(frame.data[first + 3]).toBe(24);
        expect(frame.data[first + 4]).toBe(3); // Corner radius.
        expect(frame.data[first + 5]).toBe(2); // Feather width.
        expect(frame.data[first + 9]).toBe(1);
        expect(frame.data[second + 9]).toBe(1);

        const dark = new GraphLabelLayout(nodes, interaction, { ...atlas, lightTheme: false }, ['AB\nC']);
        const darkFrame = dark.build(camera, 800, 600, 1, [], 0);
        const darkWords = new Uint32Array(darkFrame.data.buffer, darkFrame.data.byteOffset, darkFrame.data.length);
        expect(darkWords[darkFrame.glyphCount * 12 + 10]).toBe(3);
    });

    it('uses measured per-line text widths for an explicitly selected soft background behind a whole-label tile', () => {
        const nodes = Float32Array.of(0, 0, 0, 5);
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array(0));
        const atlas = {
            canvas: {} as HTMLCanvasElement,
            glyphs: new Map([['?', 0], ['A', 1], ['B', 2], ['C', 3]]),
            advances: Float32Array.of(8, 8, 8, 8),
            style: 'soft-background' as const,
            rendering: 'whole' as const,
            tiles: new Map([[0, { width: 24, height: 48, lineWidths: [20, 8],
                uv: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number] }]]),
        };
        const camera: CameraState = {
            centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: false, yaw: 0, pitch: 0, distance: 100, referenceDistance: 100,
        };
        const layout = new GraphLabelLayout(nodes, interaction, atlas, ['AB\nC']);
        const frame = layout.build(camera, 800, 600, 1, [], 0);
        expect(frame.glyphCount).toBe(1);
        expect(frame.plateCount).toBe(2);
        expect(frame.data[12 + 2]).toBe(24);
        expect(frame.data[24 + 2]).toBe(12);
        expect(frame.data[24 + 1]! - frame.data[12 + 1]!).toBe(20);
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

    it('keeps a close 3D node label outside its enlarged circle', () => {
        const nodes = Float32Array.of(0, 0, 0, 20);
        const interaction = new GraphInteractionIndex(nodes, new Uint32Array(0));
        const atlas = {
            canvas: {} as HTMLCanvasElement,
            glyphs: new Map([['?', 0], ['A', 1]]),
            advances: Float32Array.of(8, 8),
        };
        const camera: CameraState = {
            centerX: 0, centerY: 0, centerZ: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0, distance: 50, referenceDistance: 1000,
        };
        const layout = new GraphLabelLayout(nodes, interaction, atlas, ['A']);
        expect(layout.build(camera, 800, 600, 1, [], 0).labelCount).toBe(0);
        expect(layout.build({ ...camera, distance: 1000 }, 800, 600, 1, [], 0).labelCount).toBe(1);
    });
});
