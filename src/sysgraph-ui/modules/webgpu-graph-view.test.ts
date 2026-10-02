import { afterEach, describe, expect, it, vi } from 'vitest';
import { HoverIntent } from '../engine-poc/hover-intent.js';
import { createProjection, projectPoint } from '../engine-poc/projection.js';
import type { FGNode } from './graph-ui-types.js';
import { WebGPUGraphView } from './webgpu-graph-view.js';

afterEach(() => vi.restoreAllMocks());

describe('node resize on an existing graph', () => {
    it('updates radii without uploading a new graph or losing positions', () => {
        const uploadGraph = vi.fn();
        const setNodeRadii = vi.fn();
        const positions = Float32Array.of(12, -7, 0, 3);
        const oldNode = { id: 'n', type: 'test', properties: {}, val: 1 } as FGNode;
        const view = Object.assign(Object.create(WebGPUGraphView.prototype), {
            data: { nodes: [oldNode], links: [] }, positions,
            nodeIndex: new Map([['n', 0]]), renderer: { setNodeRadii },
            badgeVersion: 0,
            syncAdjacencyBadges: vi.fn(), refresh: vi.fn(), refreshLabels: vi.fn(),
            refreshSelection: vi.fn(), uploadGraph,
        }) as WebGPUGraphView;

        view.graphData({ nodes: [{ ...oldNode, val: 24 }], links: [] });

        expect(uploadGraph).not.toHaveBeenCalled();
        expect(setNodeRadii).toHaveBeenCalledTimes(1);
        expect([...positions]).toEqual([12, -7, 0, 72]);
    });
});

describe('fitting a newly loaded 3D graph', () => {
    it('waits for layout warmup and then frames the current GPU positions in the viewport', () => {
        const positions = Float32Array.of(
            100, 0, 1200, 5,
            220, 350, 1400, 5,
            50, 510, 1300, 5,
        );
        const view = Object.assign(Object.create(WebGPUGraphView.prototype), {
            data: { nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], links: [] },
            positions, renderer: {}, warmupPending: true, fitPending: false,
            widthValue: 1, heightValue: 1,
            canvas: { getBoundingClientRect: () => ({ width: 1600, height: 900 }) },
            camera: {
                centerX: -1000, centerY: -1000, centerZ: 0, scale: 0.1, stroke: 1,
                mode3d: true, yaw: 0.48, pitch: 0.3, distance: 1000, referenceDistance: 1000,
            },
            zoomHandler: vi.fn(),
        }) as WebGPUGraphView;

        view.fitView();
        expect((view as unknown as { fitPending: boolean }).fitPending).toBe(true);
        expect(view.camera.centerX).toBe(-1000);

        (view as unknown as { warmupPending: boolean }).warmupPending = false;
        view.fitView();
        const projection = createProjection(view.camera, 1600, 900);
        const screens = [0, 4, 8].map(offset => {
            const point = { x: 0, y: 0, factor: 1 };
            projectPoint(projection, positions[offset]!, positions[offset + 1]!, positions[offset + 2]!, point);
            return point;
        });
        expect((Math.min(...screens.map(point => point.x)) + Math.max(...screens.map(point => point.x))) / 2).toBeCloseTo(800, 0);
        expect((Math.min(...screens.map(point => point.y)) + Math.max(...screens.map(point => point.y))) / 2).toBeCloseTo(450, 0);
        expect(view.camera.centerZ).toBeGreaterThan(1000);
        expect((view as unknown as { fitPending: boolean }).fitPending).toBe(false);
    });
});

describe('analytics result navigation', () => {
    it('centers on the live layout position in 3D even if the node object is stale', () => {
        const view = Object.assign(Object.create(WebGPUGraphView.prototype), {
            data: { nodes: [{ id: 'destination', x: -900, y: -900 }], links: [] },
            positions: Float32Array.of(220, -80, 700, 5),
            nodeIndex: new Map([['destination', 0]]), cameraTransition: null,
            camera: { centerX: 0, centerY: 0, centerZ: 10, mode3d: true },
        }) as WebGPUGraphView;
        vi.spyOn(performance, 'now').mockReturnValue(100);

        expect(view.centerOnNodeId('destination', 500)).toBe(true);
        expect(view.camera.centerX).toBe(0);
        const advance = view as unknown as { advanceCameraTransition(now: number): void };
        advance.advanceCameraTransition(600);
        expect([view.camera.centerX, view.camera.centerY, view.camera.centerZ]).toEqual([220, -80, 700]);
        expect(view.centerOnNodeId('missing')).toBe(false);
    });
});

describe('node hover dwell', () => {
    it('changes neighborhood only after the pointer settles while the cursor responds immediately', () => {
        const nodes = [{ id: 'a' }, { id: 'b' }] as FGNode[];
        const onNodeHover = vi.fn();
        const canvas = { style: { cursor: 'grab' } };
        let picked: FGNode | null = nodes[0]!;
        const view = Object.assign(Object.create(WebGPUGraphView.prototype), {
            data: { nodes, links: [] }, nodeIndex: new Map([['a', 0], ['b', 1]]),
            camera: { mode3d: false }, canvas, pointer: null,
            hoverIntent: new HoverIntent(), hoverPointer: null, hovered: null,
            handlers: { onNodeHover }, pick: () => picked, applyFocus: vi.fn(),
            labels: { invalidatePositions: vi.fn() },
        }) as WebGPUGraphView;
        const hover = view as unknown as {
            updateHover(event: { clientX: number; clientY: number }): void;
            advanceHoverIntent(now: number): void;
        };
        const clock = vi.spyOn(performance, 'now').mockReturnValue(0);
        hover.updateHover({ clientX: 20, clientY: 30 });
        expect(canvas.style.cursor).toBe('pointer');
        hover.advanceHoverIntent(80);
        expect(onNodeHover).not.toHaveBeenCalled();
        hover.advanceHoverIntent(110);
        expect(onNodeHover).toHaveBeenLastCalledWith(nodes[0]);

        picked = nodes[1]!;
        clock.mockReturnValue(200);
        hover.updateHover({ clientX: 40, clientY: 30 });
        hover.advanceHoverIntent(280);
        expect(onNodeHover).toHaveBeenCalledTimes(1);
        hover.advanceHoverIntent(310);
        expect(onNodeHover).toHaveBeenLastCalledWith(nodes[1]);

        picked = null;
        clock.mockReturnValue(400);
        hover.updateHover({ clientX: 60, clientY: 30 });
        expect(canvas.style.cursor).toBe('grab');
        hover.advanceHoverIntent(480);
        expect(onNodeHover).toHaveBeenCalledTimes(2);
        hover.advanceHoverIntent(490);
        expect(onNodeHover).toHaveBeenLastCalledWith(null);
    });
});
