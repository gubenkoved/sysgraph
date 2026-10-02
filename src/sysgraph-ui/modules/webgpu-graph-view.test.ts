import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraBasis, orientationFromYawPitch } from '../engine/camera-orientation.js';
import { HoverIntent } from '../engine/hover-intent.js';
import { createProjection, projectPoint } from '../engine/projection.js';
import { CameraFlight } from './camera-flight.js';
import { clearColorCaches } from './graph-ui-appearance.js';
import type { FGNode } from './graph-ui-types.js';
import { settings } from './settings.js';
import { state } from './state.js';
import { WebGPUGraphView } from './webgpu-graph-view.js';

afterEach(() => { vi.restoreAllMocks(); settings.labelStyle = 'outlined'; settings.labelRendering = 'glyphs-filtered'; });

describe('node color upload', () => {
    it('sends unmatched search nodes to WebGPU with their original RGB and reduced alpha', () => {
        const previous = { search: state.search, highlight: state.highlight,
            analyticsActive: state.analytics.active, nodeColors: settings.nodeColors };
        try {
            settings.nodeColors = { ...settings.nodeColors, city: { r: 32, g: 104, b: 184, a: 1 } };
            state.search = { matches: [], matchesMap: new Map(), matchColorsMap: new Map(), currentMatchIndex: -1 };
            state.highlight = { nodeDistancesMap: new Map([['background', 1]]), edgeDistancesMap: new Map() };
            state.analytics.active = false;
            clearColorCaches();
            const view = Object.assign(Object.create(WebGPUGraphView.prototype), {
                data: { nodes: [{ id: 'background', type: 'city' }], links: [] },
            }) as WebGPUGraphView;

            const color = (view as unknown as { colors(): { nodes: Float32Array } }).colors().nodes;
            [32, 104, 184].forEach((channel, index) => {
                expect(color[index]).toBeCloseTo(channel / 255);
            });
            expect(color[3]).toBeCloseTo(0.28);
        } finally {
            state.search = previous.search;
            state.highlight = previous.highlight;
            state.analytics.active = previous.analyticsActive;
            settings.nodeColors = previous.nodeColors;
            clearColorCaches();
        }
    });
});

describe('label style options', () => {
    it('rebuilds the label atlas when the style changes without rebuilding the graph', () => {
        const refreshLabels = vi.fn();
        const uploadGraph = vi.fn();
        const view = Object.assign(Object.create(WebGPUGraphView.prototype), {
            camera: { projection: settings.cameraProjection, nodeStyle: settings.nodeRenderStyle },
            renderedLabelStyle: 'outlined', renderedLabelRendering: 'glyphs-filtered',
            refreshLabels, applyFocus: vi.fn(), uploadGraph,
        }) as WebGPUGraphView;

        settings.labelStyle = 'plain';
        view.syncOptions();

        expect(refreshLabels).toHaveBeenCalledTimes(1);
        expect(uploadGraph).not.toHaveBeenCalled();
    });

    it('switches text rendering without rebuilding the graph', () => {
        const refreshLabels = vi.fn();
        const uploadGraph = vi.fn();
        const view = Object.assign(Object.create(WebGPUGraphView.prototype), {
            camera: { projection: settings.cameraProjection, nodeStyle: settings.nodeRenderStyle },
            renderedLabelStyle: 'outlined', renderedLabelRendering: 'glyphs-filtered',
            refreshLabels, applyFocus: vi.fn(), uploadGraph,
        }) as WebGPUGraphView;

        settings.labelRendering = 'whole-snapped';
        view.syncOptions();

        expect(refreshLabels).toHaveBeenCalledTimes(1);
        expect(uploadGraph).not.toHaveBeenCalled();
    });
});

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
        const canvas = { style: { cursor: 'var(--graph-cursor-grab)' } };
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
        expect(canvas.style.cursor).toBe('var(--graph-cursor-grab)');
        hover.advanceHoverIntent(480);
        expect(onNodeHover).toHaveBeenCalledTimes(2);
        hover.advanceHoverIntent(490);
        expect(onNodeHover).toHaveBeenLastCalledWith(null);
    });
});

describe('3D pointer camera controls', () => {
    function inputView(pickedNode: FGNode | null = null) {
        const listeners = new Map<string, (event: Event) => void>();
        const canvas = {
            addEventListener: (type: string, listener: (event: Event) => void) => listeners.set(type, listener),
            focus: vi.fn(),
            setPointerCapture: vi.fn(),
            releasePointerCapture: vi.fn(),
            getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 }),
            style: { cursor: 'var(--graph-cursor-grab)' },
        };
        const node = pickedNode ?? { id: 'node', x: 0, y: 0, z: 0 } as FGNode;
        const pinNode = vi.fn();
        const moveNode = vi.fn();
        const onNodeClick = vi.fn();
        const onBackgroundClick = vi.fn();
        const openContextMenu = vi.fn();
        const pick = vi.fn(() => pickedNode);
        const view = Object.assign(Object.create(WebGPUGraphView.prototype), {
            canvas, data: { nodes: [node], links: [] }, nodeIndex: new Map([[node.id, 0]]),
            positions: Float32Array.of(0, 0, 0, 5), depths: Float32Array.of(0),
            flight: new CameraFlight(),
            camera: {
                centerX: 0, centerY: 0, centerZ: 0, scale: 1, stroke: 1,
                mode3d: true, yaw: 0, pitch: 0, distance: 1000, referenceDistance: 1000,
            },
            hoverIntent: new HoverIntent(), renderer: { pinNode }, index: { moveNode },
            labels: { invalidatePositions: vi.fn() },
            handlers: { onNodeClick, onBackgroundClick, onNodeHover: vi.fn() }, pick,
            hovered: null, openContextMenu,
        }) as WebGPUGraphView;
        (view as unknown as { installInput(): void }).installInput();
        const pointer = (type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel', x: number, y: number,
            button = 0, shiftKey = false, pointerId = 7, pointerType: 'mouse' | 'touch' = 'mouse') => {
            const event = { pointerId, pointerType, isPrimary: pointerType === 'mouse' || pointerId === 1,
                clientX: x, clientY: y, button, buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
                shiftKey, preventDefault: vi.fn() } as unknown as PointerEvent;
            listeners.get(type)!(event as Event);
            return event;
        };
        const wheel = (deltaY: number, x = 400, y = 300) => {
            const preventDefault = vi.fn();
            listeners.get('wheel')!({ deltaY, clientX: x, clientY: y, preventDefault } as unknown as Event);
            expect(preventDefault).toHaveBeenCalledOnce();
        };
        const contextMenu = () => {
            const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as Event;
            listeners.get('contextmenu')!(event);
            return event;
        };
        const keyboard = (type: 'keydown' | 'keyup', key: string, shiftKey = false) => {
            const event = { key, preventDefault: vi.fn(), defaultPrevented: false,
                altKey: false, ctrlKey: false, metaKey: false, shiftKey } as unknown as KeyboardEvent;
            listeners.get(type)!(event);
            return event;
        };
        return { view, pointer, wheel, contextMenu, pick, pinNode, moveNode,
            keyboard, blur: () => listeners.get('blur')!({} as Event),
            onNodeClick, onBackgroundClick, openContextMenu, node };
    }

    it('flies only while 3D graph keys are held and clears motion on blur', () => {
        const { view, keyboard, blur } = inputView();
        const flight = (view as unknown as { flight: CameraFlight }).flight;
        const down = keyboard('keydown', 'ArrowUp');
        expect(down.preventDefault).toHaveBeenCalledOnce();
        expect(flight.step(view.camera, 0.016, 600).move[2]).toBeLessThan(0);
        keyboard('keyup', 'ArrowUp');
        expect(flight.step(view.camera, 0.016, 600).move[2]).toBeLessThan(0);
        blur();
        expect(flight.step(view.camera, 0.016, 600)).toEqual({ move: [0, 0, 0], yaw: 0, pitch: 0 });

        view.camera.mode3d = false;
        expect(keyboard('keydown', 'ArrowUp').preventDefault).not.toHaveBeenCalled();
        expect(flight.step(view.camera, 0.016, 600)).toEqual({ move: [0, 0, 0], yaw: 0, pitch: 0 });
    });

    it('changes a held arrow from strafe to orbit as Shift is pressed and released', () => {
        const { view, keyboard } = inputView();
        const flight = (view as unknown as { flight: CameraFlight }).flight;
        keyboard('keydown', 'ArrowLeft');
        expect(flight.step(view.camera, 0.05, 600).move[0]).toBeLessThan(0);
        keyboard('keydown', 'Shift', true);
        const orbit = flight.step(view.camera, 0.05, 600);
        expect(orbit.move).toEqual([0, 0, 0]);
        expect(orbit.yaw).toBeLessThan(0);
        keyboard('keyup', 'Shift');
        const strafe = flight.step(view.camera, 0.05, 600);
        expect(strafe.yaw).toBe(0);
        expect(strafe.move[0]).toBeLessThan(0);
    });

    it('changes a held up arrow from forward flight to vertical orbit', () => {
        const { view, keyboard } = inputView();
        const flight = (view as unknown as { flight: CameraFlight }).flight;
        keyboard('keydown', 'ArrowUp');
        expect(flight.step(view.camera, 0.05, 600).move[2]).toBeLessThan(0);
        keyboard('keydown', 'Shift', true);
        const orbit = flight.step(view.camera, 0.05, 600);
        expect(orbit.move).toEqual([0, 0, 0]);
        expect(orbit.pitch).toBeGreaterThan(0);
        keyboard('keyup', 'Shift');
        const forward = flight.step(view.camera, 0.05, 600);
        expect(forward.pitch).toBe(0);
        expect(forward.move[2]).toBeLessThan(0);
    });

    it('uses a high-contrast cursor while moving the camera and restores it afterward', () => {
        const { view, pointer } = inputView();
        expect(view.canvas.style.cursor).toBe('var(--graph-cursor-grab)');

        pointer('pointerdown', 400, 300);
        expect(view.canvas.style.cursor).toBe('var(--graph-cursor-grab)');
        pointer('pointermove', 450, 350);
        expect(view.canvas.style.cursor).toBe('var(--graph-cursor-grabbing)');
        pointer('pointerup', 450, 350);
        expect(view.canvas.style.cursor).toBe('var(--graph-cursor-grab)');
    });

    it('orbits vertically through the pole', () => {
        const { view, pointer } = inputView();
        pointer('pointerdown', 400, 550);
        pointer('pointermove', 400, 50);
        const vertical = view.camera.orientation;
        expect(vertical).toBeDefined();
        expect(cameraBasis(vertical!).toward[2]).toBeLessThan(0);
        pointer('pointerup', 400, 50);
    });

    it('permits roll on an off-center diagonal drag', () => {
        const { view, pointer } = inputView();
        pointer('pointerdown', 650, 450);
        pointer('pointermove', 300, 120);
        expect(view.camera.orientation).toBeDefined();
        expect(Math.abs(cameraBasis(view.camera.orientation!).right[1])).toBeGreaterThan(0.01);
        pointer('pointerup', 300, 120);
    });

    it('uses Shift+drag to orbit from a node, while Shift+click still selects it', () => {
        const node = { id: 'node', x: 0, y: 0, z: 0 } as FGNode;
        const { view, pointer, pick, pinNode, onNodeClick } = inputView(node);
        pointer('pointerdown', 400, 300, 0, true);
        pointer('pointermove', 500, 230, 0, true);
        expect(pick).not.toHaveBeenCalled();
        pointer('pointerup', 500, 230, 0, true);
        expect(view.camera.orientation).toBeDefined();
        expect(pinNode).not.toHaveBeenCalled();
        expect(onNodeClick).not.toHaveBeenCalled();

        pointer('pointerdown', 400, 300, 0, true);
        pointer('pointerup', 400, 300, 0, true);
        expect(onNodeClick).toHaveBeenCalledExactlyOnceWith(node, expect.objectContaining({ shiftKey: true }));
    });

    it('keeps middle-drag panning and node dragging finite when looking side-on', () => {
        const node = { id: 'node', x: 0, y: 0, z: 0 } as FGNode;
        const { view, pointer, pick, pinNode, moveNode } = inputView(node);
        view.camera.yaw = Math.PI / 2;
        view.camera.orientation = orientationFromYawPitch(Math.PI / 2, 0);

        pointer('pointerdown', 400, 300, 1);
        pointer('pointermove', 450, 330, 1);
        pointer('pointerup', 450, 330, 1);
        expect([view.camera.centerX, view.camera.centerY, view.camera.centerZ]
            .every(value => Number.isFinite(value))).toBe(true);
        expect(Math.abs(view.camera.centerZ!)).toBeGreaterThan(0);

        pointer('pointerdown', 400, 300);
        pointer('pointermove', 450, 330);
        pointer('pointerup', 450, 330);
        expect(pick).toHaveBeenCalled();
        expect([node.x, node.y, node.z, node.fx, node.fy, node.fz]
            .every(value => Number.isFinite(value))).toBe(true);
        expect(Math.abs(node.z!)).toBeGreaterThan(0);
        expect(moveNode).toHaveBeenCalled();
        expect(pinNode).toHaveBeenCalledWith(0, node.x, node.y, node.z);
    });

    it('pans with right drag without opening a context menu after movement', () => {
        const { view, pointer, contextMenu, openContextMenu } = inputView();
        pointer('pointerdown', 400, 300, 2);
        pointer('pointermove', 480, 350, 2);
        expect([view.camera.centerX, view.camera.centerY, view.camera.centerZ]).not.toEqual([0, 0, 0]);
        expect(view.camera.orientation).toBeUndefined();
        const event = contextMenu() as unknown as { preventDefault: ReturnType<typeof vi.fn> };
        expect(event.preventDefault).toHaveBeenCalledOnce();
        expect(openContextMenu).not.toHaveBeenCalled();
        pointer('pointerup', 480, 350, 2);
    });

    it('lets a perspective wheel zoom move substantially closer than the initial fit distance', () => {
        const { view, wheel, pointer } = inputView();
        wheel(-1000);
        expect(view.camera.distance).toBeLessThan(view.camera.referenceDistance * 0.55);
        expect(view.camera.distance).toBeGreaterThan(0);
        const beforePan = [view.camera.centerX, view.camera.centerY, view.camera.centerZ];
        pointer('pointerdown', 400, 300, 1);
        pointer('pointermove', 500, 350, 1);
        pointer('pointerup', 500, 350, 1);
        expect([view.camera.centerX, view.camera.centerY, view.camera.centerZ]).not.toEqual(beforePan);
        expect([view.camera.centerX, view.camera.centerY, view.camera.centerZ]
            .every(value => Number.isFinite(value))).toBe(true);
    });

    it('reports perspective magnification through zoom() while dollying without changing scale', () => {
        const { view } = inputView();
        expect(view.zoom()).toBe(1);
        expect(view.zoom(4)).toBe(view);
        expect(view.zoom()).toBeCloseTo(4);
        expect(view.camera.distance).toBeCloseTo(250);
        expect(view.camera.scale).toBe(1);

        const onZoom = vi.fn();
        view.onZoom(onZoom);
        view.zoom(8);
        expect(view.zoom()).toBeCloseTo(8);
        expect(view.camera.distance).toBeCloseTo(125);
        expect(view.camera.scale).toBe(1);
        expect(onZoom).toHaveBeenCalledExactlyOnceWith({ k: 8 });
    });

    it('orbits with one finger on empty 3D space', () => {
        const { view, pointer } = inputView();
        pointer('pointerdown', 400, 500, 0, false, 1, 'touch');
        pointer('pointermove', 400, 300, 0, false, 1, 'touch');
        expect(view.camera.orientation).toBeDefined();
        pointer('pointerup', 400, 300, 0, false, 1, 'touch');
    });

    it('navigates when a finger starts on a node while a stationary tap still selects it', () => {
        const node = { id: 'node', x: 0, y: 0, z: 0 } as FGNode;
        const { view, pointer, pinNode, onNodeClick } = inputView(node);
        pointer('pointerdown', 400, 400, 0, false, 1, 'touch');
        pointer('pointermove', 450, 300, 0, false, 1, 'touch');
        pointer('pointerup', 450, 300, 0, false, 1, 'touch');
        expect(view.camera.orientation).toBeDefined();
        expect(pinNode).not.toHaveBeenCalled();
        expect(onNodeClick).not.toHaveBeenCalled();

        pointer('pointerdown', 400, 300, 0, false, 1, 'touch');
        pointer('pointerup', 400, 300, 0, false, 1, 'touch');
        expect(onNodeClick).toHaveBeenCalledExactlyOnceWith(node, expect.objectContaining({ pointerType: 'touch' }));
    });

    it('uses a two-finger pinch to zoom close and pan with the midpoint without orbiting', () => {
        const { view, pointer } = inputView();
        const initialDistance = view.camera.distance;
        const initialOrientation = view.camera.orientation;
        const initialPivot = { x: view.camera.centerX, y: view.camera.centerY, z: view.camera.centerZ ?? 0 };
        pointer('pointerdown', 350, 300, 0, false, 1, 'touch');
        pointer('pointerdown', 450, 300, 0, false, 2, 'touch');
        pointer('pointermove', 150, 330, 0, false, 1, 'touch');
        pointer('pointermove', 650, 330, 0, false, 2, 'touch');
        expect(view.camera.distance).toBeLessThan(initialDistance * 0.55);
        const projectedPivot = { x: 0, y: 0, factor: 1 };
        projectPoint(createProjection(view.camera, 800, 600),
            initialPivot.x, initialPivot.y, initialPivot.z, projectedPivot);
        expect(projectedPivot.x).toBeCloseTo(400, 0);
        expect(projectedPivot.y).toBeCloseTo(330, 0);
        expect(view.camera.orientation).toEqual(initialOrientation);
        pointer('pointerup', 150, 330, 0, false, 1, 'touch');
        pointer('pointerup', 650, 330, 0, false, 2, 'touch');
    });

    it('pinches to zoom in 2D and keeps the graph under the moving midpoint', () => {
        const { view, pointer } = inputView();
        view.camera.mode3d = false;
        pointer('pointerdown', 350, 300, 0, false, 1, 'touch');
        pointer('pointerdown', 450, 300, 0, false, 2, 'touch');
        pointer('pointermove', 250, 340, 0, false, 1, 'touch');
        pointer('pointermove', 550, 340, 0, false, 2, 'touch');
        expect(view.camera.scale).toBeGreaterThan(1);
        const projectedOrigin = { x: 0, y: 0, factor: 1 };
        projectPoint(createProjection(view.camera, 800, 600), 0, 0, 0, projectedOrigin);
        expect(projectedOrigin.x).toBeCloseTo(400, 0);
        expect(projectedOrigin.y).toBeCloseTo(340, 0);
        pointer('pointerup', 250, 340, 0, false, 1, 'touch');
        pointer('pointerup', 550, 340, 0, false, 2, 'touch');
    });

    it('pinches to zoom in an orthographic 3D camera', () => {
        const { view, pointer } = inputView();
        view.camera.projection = 'orthographic';
        pointer('pointerdown', 350, 300, 0, false, 1, 'touch');
        pointer('pointerdown', 450, 300, 0, false, 2, 'touch');
        pointer('pointermove', 250, 300, 0, false, 1, 'touch');
        pointer('pointermove', 550, 300, 0, false, 2, 'touch');
        expect(view.camera.scale).toBeGreaterThan(1);
        expect(view.camera.distance).toBe(1000);
        pointer('pointerup', 250, 300, 0, false, 1, 'touch');
        pointer('pointerup', 550, 300, 0, false, 2, 'touch');
    });

    it('cancels node dragging and clicking when a second finger starts a pinch', () => {
        const node = { id: 'node', x: 0, y: 0, z: 0 } as FGNode;
        const { pointer, pinNode, moveNode, onNodeClick, onBackgroundClick } = inputView(node);
        pointer('pointerdown', 300, 300, 0, false, 1, 'touch');
        pointer('pointerdown', 500, 300, 0, false, 2, 'touch');
        pointer('pointermove', 250, 300, 0, false, 1, 'touch');
        pointer('pointermove', 550, 300, 0, false, 2, 'touch');
        pointer('pointerup', 250, 300, 0, false, 1, 'touch');
        pointer('pointerup', 550, 300, 0, false, 2, 'touch');
        expect(pinNode).not.toHaveBeenCalled();
        expect(moveNode).not.toHaveBeenCalled();
        expect(onNodeClick).not.toHaveBeenCalled();
        expect(onBackgroundClick).not.toHaveBeenCalled();
    });

    it('continues one-finger orbit smoothly after lifting one finger from a pinch', () => {
        const { view, pointer, onBackgroundClick } = inputView();
        pointer('pointerdown', 350, 300, 0, false, 1, 'touch');
        pointer('pointerdown', 450, 300, 0, false, 2, 'touch');
        pointer('pointermove', 250, 300, 0, false, 1, 'touch');
        pointer('pointermove', 550, 300, 0, false, 2, 'touch');
        const distanceAfterPinch = view.camera.distance;
        pointer('pointerup', 250, 300, 0, false, 1, 'touch');
        expect(view.camera.orientation).toBeUndefined();
        pointer('pointermove', 600, 300, 0, false, 2, 'touch');
        expect(view.camera.orientation).toBeDefined();
        expect(view.camera.distance).toBe(distanceAfterPinch);
        pointer('pointerup', 600, 300, 0, false, 2, 'touch');
        expect(onBackgroundClick).not.toHaveBeenCalled();
    });

    it('clears a cancelled touch so a later one-finger gesture can orbit', () => {
        const node = { id: 'node', x: 0, y: 0, z: 0 } as FGNode;
        const { view, pointer, onNodeClick } = inputView(node);
        pointer('pointerdown', 400, 300, 0, false, 1, 'touch');
        pointer('pointercancel', 400, 300, 0, false, 1, 'touch');
        expect(onNodeClick).not.toHaveBeenCalled();
        pointer('pointerdown', 400, 300, 0, false, 2, 'touch');
        pointer('pointermove', 500, 300, 0, false, 2, 'touch');
        expect(view.camera.orientation).toBeDefined();
        pointer('pointerup', 500, 300, 0, false, 2, 'touch');
        expect(onNodeClick).not.toHaveBeenCalled();
    });
});
