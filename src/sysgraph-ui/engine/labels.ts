import { orientationForCamera } from './camera-orientation.js';
import type { GraphInteractionIndex } from './interaction.js';
import { screenNodeRadius } from './node-size.js';
import { createDepths, createProjection, projectPoint } from './projection.js';
import type { CameraState } from './renderer.js';

const ATLAS_SCALE = 3;
export const ATLAS_WIDTH = 3072;
export const ATLAS_HEIGHT = 1536;
export const ATLAS_CELL_WIDTH = 18 * ATLAS_SCALE;
export const ATLAS_CELL_HEIGHT = 24 * ATLAS_SCALE;
export const LABEL_FONT_REQUEST = '600 42px "Ubuntu Mono"';
export const MAX_LABELS = 700;
export const MAX_LABEL_GLYPHS = 28_000;
export const MAX_LABEL_INSTANCES = MAX_LABEL_GLYPHS * 2;
export type LabelStyle = 'plain' | 'outlined' | 'plate' | 'soft-background';
export type LabelRendering = 'glyphs' | 'glyphs-filtered' | 'whole' | 'whole-snapped';

const GRID_SIZE = 12;
// Reserve half the GPU glyph buffer for labels fading out during a dense scene change.
const MAX_SELECTED_GLYPHS = 14_000;
const SAMPLE_SIZE = 22;
const GLYPH_WIDTH = ATLAS_CELL_WIDTH / ATLAS_SCALE;
const GLYPH_HEIGHT = ATLAS_CELL_HEIGHT / ATLAS_SCALE;
const LINE_HEIGHT = 20;
const LETTER_SPACING = 0.55;
const PLATE_INSET_X = 7;
const PLATE_INSET_Y = 1;
const MAX_LABEL_CHARS = 24;
const MAX_LABEL_LINES = 4;
const LABEL_FADE_IN_MS = 180;
const LABEL_FADE_OUT_MS = 150;
const ATLAS_COLUMNS = Math.floor(ATLAS_WIDTH / ATLAS_CELL_WIDTH);
const ATLAS_CAPACITY = ATLAS_COLUMNS * Math.floor(ATLAS_HEIGHT / ATLAS_CELL_HEIGHT);

export interface LabelFrame {
    data: Float32Array;
    glyphCount: number;
    plateCount: number;
    labelCount: number;
    underlay?: boolean;
}

export interface ScreenRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export interface LabelAtlas {
    canvas: HTMLCanvasElement;
    glyphs: Map<string, number>;
    advances: Float32Array;
    kerning?: (left: string, right: string) => number;
    style?: LabelStyle;
    rendering?: LabelRendering;
    tiles?: Map<number, LabelTile>;
    lightTheme?: boolean;
}

export interface LabelTile {
    width: number;
    height: number;
    uv: [number, number, number, number];
    lineWidths?: number[];
}

interface PreparedLabel {
    lines: string[][];
    offsets: number[][];
    lineWidths: number[];
    glyphCount: number;
    width: number;
    height: number;
}

interface LabelVisibility {
    alpha: number;
    from: number;
    target: boolean;
    startedAt: number;
}

function opacityAt(state: LabelVisibility, now: number): number {
    const duration = state.target ? LABEL_FADE_IN_MS : LABEL_FADE_OUT_MS;
    const t = Math.max(0, Math.min(1, (now - state.startedAt) / duration));
    const eased = t * t * (3 - 2 * t);
    return state.from + ((state.target ? 1 : 0) - state.from) * eased;
}

/** Preserve explicit line breaks while keeping each on-screen label bounded. */
export function normalizeLabelLines(label: string): string[][] {
    const lines = label.replace(/\r\n?/g, '\n').split('\n')
        .map(line => Array.from(line.replace(/\s+/g, ' ').trim().toUpperCase()))
        .filter(line => line.length > 0);
    const omittedLines = lines.length > MAX_LABEL_LINES;
    return lines.slice(0, MAX_LABEL_LINES).map((line, index) => {
        const truncated = line.length > MAX_LABEL_CHARS || (omittedLines && index === MAX_LABEL_LINES - 1);
        return truncated ? [...line.slice(0, MAX_LABEL_CHARS - 1), '…'] : line;
    });
}

/** Rasterize each distinct character once; per-frame labels remain WebGPU quads. */
export function createLabelAtlas(labels?: readonly string[], style: LabelStyle = 'outlined',
    rendering: LabelRendering = 'glyphs'): LabelAtlas {
    const characters = new Set('0123456789#?… ');
    for (const label of labels ?? []) {
        for (const line of normalizeLabelLines(label)) {
            for (const character of line) {
                if (characters.size >= ATLAS_CAPACITY) break;
                characters.add(character);
            }
        }
    }
    const glyphs = new Map(Array.from(characters, (character, index) => [character, index] as const));
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_WIDTH;
    canvas.height = ATLAS_HEIGHT;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not create the label glyph atlas.');
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.font = `${LABEL_FONT_REQUEST}, 'Ubuntu Mono', Consolas, monospace`;
    context.lineJoin = 'round';
    context.lineWidth = 3;
    const lightTheme = document.documentElement.getAttribute('data-theme') === 'light';
    context.strokeStyle = lightTheme ? 'rgba(255, 255, 255, 0.94)' : 'rgba(7, 19, 26, 0.9)';
    context.fillStyle = lightTheme ? '#1d3142' : '#e7f7f0';
    const advances = new Float32Array(glyphs.size);
    const measuredWidths = new Float32Array(glyphs.size);
    for (const [character, index] of glyphs) {
        const x = (index % ATLAS_COLUMNS) * ATLAS_CELL_WIDTH + ATLAS_SCALE * 2;
        const y = Math.floor(index / ATLAS_COLUMNS) * ATLAS_CELL_HEIGHT + ATLAS_SCALE * 17;
        measuredWidths[index] = context.measureText(character).width;
        advances[index] = Math.max(2, Math.min(GLYPH_WIDTH - 2, measuredWidths[index]! / ATLAS_SCALE + 0.15));
        if (style === 'outlined' || style === 'soft-background') context.strokeText(character, x, y);
        context.fillText(character, x, y);
    }
    const tiles = new Map<number, LabelTile>();
    if (rendering === 'whole' || rendering === 'whole-snapped') {
        const reusableTiles = new Map<string, LabelTile>();
        let x = 0;
        let y = Math.ceil(glyphs.size / ATLAS_COLUMNS) * ATLAS_CELL_HEIGHT;
        let rowHeight = 0;
        for (let index = 0; index < (labels?.length ?? 0); index++) {
            const lines = normalizeLabelLines(labels![index]!);
            if (!lines.length) continue;
            const lineTexts = lines.map(line => line.join(''));
            const key = lineTexts.join('\n');
            const reused = reusableTiles.get(key);
            if (reused) { tiles.set(index, reused); continue; }
            const measuredLineWidths = lineTexts.map(line => context.measureText(line).width);
            const textWidth = Math.max(...measuredLineWidths);
            const tileWidth = Math.ceil(textWidth + 4 * ATLAS_SCALE);
            const tileHeight = (GLYPH_HEIGHT + (lines.length - 1) * LINE_HEIGHT + 4) * ATLAS_SCALE;
            if (tileWidth > ATLAS_WIDTH) continue;
            if (x + tileWidth > ATLAS_WIDTH) {
                x = 0;
                y += rowHeight + 2 * ATLAS_SCALE;
                rowHeight = 0;
            }
            if (y + tileHeight > ATLAS_HEIGHT) continue;
            for (let lineIndex = 0; lineIndex < lineTexts.length; lineIndex++) {
                const baseline = y + (19 + lineIndex * LINE_HEIGHT) * ATLAS_SCALE;
                if (style === 'outlined' || style === 'soft-background') {
                    context.strokeText(lineTexts[lineIndex]!, x + 2 * ATLAS_SCALE, baseline);
                }
                context.fillText(lineTexts[lineIndex]!, x + 2 * ATLAS_SCALE, baseline);
            }
            const tile: LabelTile = { width: tileWidth / ATLAS_SCALE, height: tileHeight / ATLAS_SCALE,
                lineWidths: measuredLineWidths.map(width => width / ATLAS_SCALE),
                uv: [x / ATLAS_WIDTH, y / ATLAS_HEIGHT,
                    (x + tileWidth) / ATLAS_WIDTH, (y + tileHeight) / ATLAS_HEIGHT] };
            tiles.set(index, tile);
            reusableTiles.set(key, tile);
            x += tileWidth + 2 * ATLAS_SCALE;
            rowHeight = Math.max(rowHeight, tileHeight);
        }
    }
    // Keep text measurement on a tiny canvas so the layout does not retain the
    // large raster atlas after its pixels have been copied to the GPU.
    const metricsCanvas = document.createElement('canvas');
    metricsCanvas.width = 1;
    metricsCanvas.height = 1;
    const metricsContext = metricsCanvas.getContext('2d');
    if (!metricsContext) throw new Error('Could not measure label text.');
    metricsContext.font = context.font;
    return { canvas, glyphs, advances, kerning: makeKerningCalculator(metricsContext, glyphs, measuredWidths),
        style, rendering, tiles, lightTheme };
}

function makeKerningCalculator(context: CanvasRenderingContext2D, glyphs: Map<string, number>, measuredWidths: Float32Array):
    (left: string, right: string) => number {
    const pairOffsets = new Map<string, number>();
    return (left: string, right: string): number => {
        const key = `${left}\0${right}`;
        const cached = pairOffsets.get(key);
        if (cached !== undefined) return cached;
        const leftWidth = measuredWidths[glyphs.get(left) ?? glyphs.get('?')!]!;
        const rightWidth = measuredWidths[glyphs.get(right) ?? glyphs.get('?')!]!;
        const offset = (context.measureText(left + right).width - leftWidth - rightWidth) / ATLAS_SCALE;
        pairOffsets.set(key, offset);
        return offset;
    };
}

/** Keeps important labels first and accepts only non-overlapping screen cells. */
export class GraphLabelLayout {
    private readonly nodes: Float32Array;
    private readonly depths: Float32Array;
    private readonly degrees: Uint32Array;
    private readonly preferred: Uint8Array;
    private readonly labelTexts?: readonly string[];
    private readonly labels: (PreparedLabel | undefined)[];
    private readonly glyphs: Map<string, number>;
    private readonly advances: Float32Array;
    private readonly kerning?: (left: string, right: string) => number;
    private readonly style: LabelStyle;
    private readonly rendering: LabelRendering;
    private readonly tiles: Map<number, LabelTile>;
    private readonly lightTheme: boolean;
    private readonly data = new Float32Array(MAX_LABEL_INSTANCES * 12);
    private readonly words = new Uint32Array(this.data.buffer);
    private occupied = new Uint8Array(0);
    private samples = new Uint32Array(0);
    private lastInput: number[] | null = null;
    private lastFrame: LabelFrame | null = null;
    private readonly visibility = new Map<number, LabelVisibility>();
    private animating = false;

    constructor(nodes: Float32Array, interaction: GraphInteractionIndex, atlas: LabelAtlas, labels?: readonly string[], depths?: Float32Array) {
        this.nodes = nodes;
        this.depths = depths ?? createDepths(nodes);
        this.degrees = Uint32Array.from({ length: nodes.length / 4 }, (_, index) => interaction.getDegree(index));
        this.preferred = new Uint8Array(nodes.length / 4);
        this.glyphs = atlas.glyphs;
        this.advances = atlas.advances;
        this.kerning = atlas.kerning;
        this.style = atlas.style ?? 'outlined';
        this.rendering = atlas.rendering ?? 'glyphs';
        this.tiles = atlas.tiles ?? new Map();
        this.lightTheme = atlas.lightTheme ?? false;
        this.labelTexts = labels;
        this.labels = new Array(nodes.length / 4);
    }

    private prepareLabel(index: number): PreparedLabel {
        const cached = this.labels[index];
        if (cached) return cached;
        const lines = normalizeLabelLines(this.labelTexts?.[index] ?? `#${index + 1}`);
        let glyphCount = 0;
        let width = 0;
        const offsets: number[][] = [];
        const lineWidths: number[] = [];
        for (const line of lines) {
            let lineWidth = 0;
            const positions: number[] = [];
            for (let characterIndex = 0; characterIndex < line.length; characterIndex++) {
                const character = line[characterIndex]!;
                if (characterIndex > 0) lineWidth += LETTER_SPACING + (this.kerning?.(line[characterIndex - 1]!, character) ?? 0);
                positions.push(lineWidth);
                const glyph = this.glyphs.get(character) ?? this.glyphs.get('?')!;
                lineWidth += this.advances[glyph]!;
                if (character !== ' ') glyphCount++;
            }
            width = Math.max(width, lineWidth);
            offsets.push(positions);
            lineWidths.push(lineWidth);
        }
        const plate = this.style === 'plate';
        const tile = this.tiles.get(index);
        if (tile) {
            glyphCount = 1;
            width = tile.width;
        }
        const label = { lines, offsets, lineWidths, glyphCount,
            width: width + (plate ? PLATE_INSET_X * 2 : 0),
            height: (tile?.height ?? GLYPH_HEIGHT + (lines.length - 1) * LINE_HEIGHT) +
                (plate ? PLATE_INSET_Y * 2 : 0) };
        this.labels[index] = label;
        return label;
    }

    invalidatePositions(): void {
        this.lastInput = null;
    }

    build(
        camera: CameraState,
        width: number,
        height: number,
        resolution: number,
        blockers: ScreenRect[],
        focus: number | null,
        neighbors?: Uint32Array,
        priority?: number | null,
        now = performance.now(),
        focusOnly = false,
    ): LabelFrame {
        const input = [camera.centerX, camera.centerY, camera.centerZ ?? 0, camera.scale, width, height, resolution, focus ?? -1, blockers.length,
            Number(camera.mode3d), camera.projection === 'orthographic' ? 1 : 0,
            ...orientationForCamera(camera), camera.distance, camera.referenceDistance, priority ?? -1, Number(focusOnly)];
        for (const blocker of blockers) input.push(blocker.left, blocker.top, blocker.right, blocker.bottom);
        if (!this.animating && this.lastInput?.length === input.length &&
            this.lastInput.every((value, index) => value === input[index])) {
            return this.lastFrame!;
        }
        this.lastInput = input;
        const columns = Math.ceil(width / GRID_SIZE);
        const rows = Math.ceil(height / GRID_SIZE);
        if (this.occupied.length !== columns * rows) this.occupied = new Uint8Array(columns * rows);
        else this.occupied.fill(0);

        const mark = (rect: ScreenRect, check: boolean): boolean => {
            const minX = Math.max(0, Math.floor(rect.left / GRID_SIZE));
            const maxX = Math.min(columns - 1, Math.floor(rect.right / GRID_SIZE));
            const minY = Math.max(0, Math.floor(rect.top / GRID_SIZE));
            const maxY = Math.min(rows - 1, Math.floor(rect.bottom / GRID_SIZE));
            if (maxX < minX || maxY < minY) return false;
            if (check) {
                for (let y = minY; y <= maxY; y++) {
                    for (let x = minX; x <= maxX; x++) {
                        if (this.occupied[y * columns + x]) return false;
                    }
                }
            }
            for (let y = minY; y <= maxY; y++) {
                this.occupied.fill(1, y * columns + minX, y * columns + maxX + 1);
            }
            return true;
        };

        for (const blocker of blockers) mark(blocker, false);
        // Screen-space overlap already makes labels progressively appear as
        // zoom spreads nodes apart. A camera-scale quota hides labels even
        // when their projected text boxes have ample room (especially in 3D).
        const limit = MAX_LABELS;
        const projection = createProjection(camera, width, height);
        const projected = { x: 0, y: 0, factor: 1, visible: true };
        const maxRadius = camera.mode3d ? Math.max(width, height) : undefined;
        let plannedGlyphs = 0;
        let labelCount = 0;
        const accepted: number[] = [];
        const acceptedSet = new Set<number>();

        const add = (index: number): void => {
            if (index < 0 || index >= this.degrees.length || acceptedSet.has(index) || labelCount >= limit) return;
            const node = index * 4;
            projectPoint(projection, this.nodes[node]!, this.nodes[node + 1]!, this.depths[index]!, projected);
            if (!projected.visible) return;
            const { x, y } = projected;
            const label = this.prepareLabel(index);
            if (!label.lines.length || plannedGlyphs + label.glyphCount > MAX_SELECTED_GLYPHS) return;
            const left = x + Math.max(5, screenNodeRadius(this.nodes[node + 3]!, camera.scale, projected.factor, maxRadius)) + 5;
            const top = y - label.height / 2;
            if (left < 8 || left + label.width > width - 8 || top < 8 || top + label.height > height - 8) return;
            if (!mark({ left: left - 3, top: top - 3, right: left + label.width + 3, bottom: top + label.height + 3 }, true)) return;

            plannedGlyphs += label.glyphCount;
            accepted.push(index);
            acceptedSet.add(index);
            labelCount++;
        };

        if (priority !== null && priority !== undefined) add(priority);
        if (focus !== null) {
            add(focus);
            for (const neighbor of neighbors ?? []) {
                if (labelCount >= limit) break;
                add(neighbor);
            }
        } else if (!focusOnly) {
            const sampleColumns = Math.ceil(width / SAMPLE_SIZE);
            const sampleRows = Math.ceil(height / SAMPLE_SIZE);
            if (this.samples.length !== sampleColumns * sampleRows) this.samples = new Uint32Array(sampleColumns * sampleRows);
            this.samples.fill(0xffffffff);
            for (let index = 0; index < this.degrees.length; index++) {
                const node = index * 4;
                projectPoint(projection, this.nodes[node]!, this.nodes[node + 1]!, this.depths[index]!, projected);
                if (!projected.visible) continue;
                const { x, y } = projected;
                if (x < 0 || y < 0 || x >= width || y >= height) continue;
                if (this.occupied[Math.floor(y / GRID_SIZE) * columns + Math.floor(x / GRID_SIZE)]) continue;
                const slot = Math.floor(y / SAMPLE_SIZE) * sampleColumns + Math.floor(x / SAMPLE_SIZE);
                const previous = this.samples[slot]!;
                if (previous === 0xffffffff || this.degrees[index]! > this.degrees[previous]! ||
                    this.degrees[index] === this.degrees[previous] &&
                    this.preferred[index] && !this.preferred[previous]) this.samples[slot] = index;
            }
            const candidates: number[] = [];
            for (const index of this.samples) {
                if (index !== 0xffffffff) candidates.push(index);
            }
            candidates.sort((a, b) => this.degrees[b]! - this.degrees[a]! ||
                this.preferred[b]! - this.preferred[a]! || a - b);
            for (const index of candidates) {
                if (labelCount >= limit) break;
                add(index);
            }
        }
        for (const [index, state] of this.visibility) {
            state.alpha = opacityAt(state, now);
            if (state.target && !acceptedSet.has(index)) {
                state.from = state.alpha;
                state.target = false;
                state.startedAt = now;
                this.preferred[index] = 0;
            }
        }
        for (const index of accepted) {
            this.preferred[index] = 1;
            const state = this.visibility.get(index);
            if (!state) this.visibility.set(index, { alpha: 0, from: 0, target: true, startedAt: now });
            else if (!state.target) {
                state.from = state.alpha;
                state.target = true;
                state.startedAt = now;
            }
        }

        let glyphCount = 0;
        const plates: Array<{ index: number; x: number; y: number; width: number; height: number;
            alpha: number; kind: number; radius: number; feather: number }> = [];
        const emitLabel = (index: number, alpha: number): void => {
            const label = this.prepareLabel(index);
            const node = index * 4;
            projectPoint(projection, this.nodes[node]!, this.nodes[node + 1]!, this.depths[index]!, projected);
            if (!projected.visible) return;
            const x = projected.x, y = projected.y;
            const left = x + Math.max(5, screenNodeRadius(this.nodes[node + 3]!, camera.scale, projected.factor, maxRadius)) + 5;
            const top = y - label.height / 2;
            const tile = this.tiles.get(index);
            if (this.style === 'plate') {
                plates.push({ index, x: (left - x) * resolution, y: (top - y) * resolution,
                    width: label.width * resolution, height: label.height * resolution, alpha,
                    kind: this.lightTheme ? 2 : 1, radius: 6 * resolution, feather: resolution });
            } else if (this.style === 'soft-background') {
                const measuredMax = Math.max(...label.lineWidths);
                for (let lineIndex = 0; lineIndex < label.lines.length; lineIndex++) {
                    const lineWidth = tile
                        ? tile.lineWidths?.[lineIndex] ?? (tile.width - 4) * label.lineWidths[lineIndex]! / Math.max(measuredMax, 0.001)
                        : label.lineWidths[lineIndex]!;
                    // The mask hugs each row of text; empty space between lines
                    // and beyond shorter rows remains part of the scene.
                    const lineLeft = tile ? left : left - 2;
                    plates.push({ index, x: (lineLeft - x) * resolution,
                        y: (top + lineIndex * LINE_HEIGHT - y) * resolution,
                        width: (lineWidth + 4) * resolution,
                        height: GLYPH_HEIGHT * resolution, alpha,
                        kind: this.lightTheme ? 4 : 3, radius: 3 * resolution, feather: 2 * resolution });
                }
            }
            if (tile) {
                const offset = glyphCount * 12;
                this.data[offset] = (left + (this.style === 'plate' ? PLATE_INSET_X : 0) - x) * resolution;
                this.data[offset + 1] = (top + (this.style === 'plate' ? PLATE_INSET_Y : 0) - y) * resolution;
                this.data[offset + 2] = tile.width * resolution;
                this.data[offset + 3] = tile.height * resolution;
                this.data.set(tile.uv, offset + 4);
                this.words[offset + 8] = index;
                this.data[offset + 9] = alpha;
                this.words[offset + 10] = 0;
                this.words[offset + 11] = this.rendering === 'whole-snapped' ? 3 : 2;
                glyphCount++;
                return;
            }
            for (let lineIndex = 0; lineIndex < label.lines.length; lineIndex++) {
                for (let characterIndex = 0; characterIndex < label.lines[lineIndex]!.length; characterIndex++) {
                    const character = label.lines[lineIndex]![characterIndex]!;
                    const glyph = this.glyphs.get(character) ?? this.glyphs.get('?')!;
                    if (character !== ' ') {
                        const cellLeft = glyph % ATLAS_COLUMNS * ATLAS_CELL_WIDTH;
                        const cellTop = Math.floor(glyph / ATLAS_COLUMNS) * ATLAS_CELL_HEIGHT;
                        const offset = glyphCount * 12;
                        this.data[offset] = (left + (this.style === 'plate' ? PLATE_INSET_X : 0) - x
                            + label.offsets[lineIndex]![characterIndex]!) * resolution;
                        this.data[offset + 1] = (top + (this.style === 'plate' ? PLATE_INSET_Y : 0)
                            + lineIndex * LINE_HEIGHT - y) * resolution;
                        this.data[offset + 2] = GLYPH_WIDTH * resolution;
                        this.data[offset + 3] = GLYPH_HEIGHT * resolution;
                        this.data[offset + 4] = cellLeft / ATLAS_WIDTH;
                        this.data[offset + 5] = cellTop / ATLAS_HEIGHT;
                        this.data[offset + 6] = (cellLeft + ATLAS_CELL_WIDTH) / ATLAS_WIDTH;
                        this.data[offset + 7] = (cellTop + ATLAS_CELL_HEIGHT) / ATLAS_HEIGHT;
                        this.words[offset + 8] = index;
                        this.data[offset + 9] = alpha;
                        this.words[offset + 10] = 0;
                        this.words[offset + 11] = this.rendering === 'glyphs' ? 0 : 2;
                        glyphCount++;
                    }
                }
            }
        };

        this.animating = false;
        let outgoingBudget = MAX_LABEL_GLYPHS - plannedGlyphs;
        const outgoing: Array<{ index: number; alpha: number }> = [];
        for (const [index, state] of this.visibility) {
            state.alpha = opacityAt(state, now);
            if (state.target) {
                if (state.alpha < 1) this.animating = true;
                continue;
            }
            if (state.alpha <= 0.001) { this.visibility.delete(index); continue; }
            this.animating = true;
            outgoing.push({ index, alpha: state.alpha });
        }
        outgoing.sort((a, b) => b.alpha - a.alpha);
        for (const { index, alpha } of outgoing) {
            const count = this.prepareLabel(index).glyphCount;
            if (count > outgoingBudget) continue;
            outgoingBudget -= count;
            emitLabel(index, alpha);
        }
        for (const index of accepted) emitLabel(index, this.visibility.get(index)!.alpha);
        const plateCount = Math.min(plates.length, MAX_LABEL_INSTANCES - glyphCount);
        for (let plateIndex = 0; plateIndex < plateCount; plateIndex++) {
            const plate = plates[plateIndex]!;
            const offset = (glyphCount + plateIndex) * 12;
            this.data[offset] = plate.x;
            this.data[offset + 1] = plate.y;
            this.data[offset + 2] = plate.width;
            this.data[offset + 3] = plate.height;
            this.data[offset + 4] = plate.radius;
            this.data[offset + 5] = plate.feather;
            this.data[offset + 6] = plate.radius;
            this.data[offset + 7] = plate.feather;
            this.words[offset + 8] = plate.index;
            this.data[offset + 9] = plate.alpha;
            this.words[offset + 10] = plate.kind;
            this.words[offset + 11] = this.rendering === 'whole-snapped' ? 1 : 0;
        }
        this.lastFrame = { data: this.data.subarray(0, (glyphCount + plateCount) * 12), glyphCount,
            plateCount, labelCount, underlay: this.style === 'soft-background' && plateCount > 0 };
        return this.lastFrame;
    }
}
