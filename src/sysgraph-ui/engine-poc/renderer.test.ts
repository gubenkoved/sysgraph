import { afterEach, describe, expect, it, vi } from 'vitest';
import { WebGPUGraphRenderer } from './renderer.js';

afterEach(() => vi.unstubAllGlobals());

describe('renderer startup resource limits', () => {
    it('keeps every render pipeline within the eight vertex storage buffers available on baseline WebGPU devices', async () => {
        const vertex = 1;
        const layouts: number[] = [];
        const device = {
            lost: new Promise(() => {}),
            addEventListener: () => {},
            destroy: () => {},
            queue: { copyExternalImageToTexture: () => {} },
            createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
            createBindGroupLayout: (descriptor: GPUBindGroupLayoutDescriptor) => descriptor,
            createPipelineLayout: (descriptor: GPUPipelineLayoutDescriptor) => {
                const count = descriptor.bindGroupLayouts.reduce((total, layout) => total +
                    (layout as GPUBindGroupLayoutDescriptor).entries.filter(entry =>
                        (entry.visibility & vertex) !== 0 && entry.buffer?.type?.includes('storage')).length, 0);
                layouts.push(count);
                if (count > 8) throw new Error(`Too many vertex storage buffers: ${count}`);
                return descriptor;
            },
            createRenderPipelineAsync: async () => ({}),
            createComputePipelineAsync: async () => ({ getBindGroupLayout: () => ({}) }),
            createBuffer: () => ({ destroy: () => {} }),
            createTexture: () => ({ createView: () => ({}), destroy: () => {} }),
            createSampler: () => ({}),
            createBindGroup: () => ({}),
        };
        const adapter = { requestDevice: async () => device, info: { vendor: 'test' } };
        vi.stubGlobal('GPUShaderStage', { VERTEX: vertex, FRAGMENT: 2, COMPUTE: 4 });
        vi.stubGlobal('GPUBufferUsage', { STORAGE: 1, COPY_DST: 2, UNIFORM: 4 });
        vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 1, COPY_DST: 2, RENDER_ATTACHMENT: 4 });
        vi.stubGlobal('navigator', { gpu: {
            requestAdapter: async () => adapter,
            getPreferredCanvasFormat: () => 'rgba8unorm',
        } });
        vi.stubGlobal('document', {
            documentElement: { getAttribute: () => 'light' },
            createElement: () => ({ getContext: () => ({
                measureText: () => ({ width: 12 }), strokeText: () => {}, fillText: () => {},
            }) }),
        });
        const canvas = { getContext: () => ({ configure: () => {}, unconfigure: () => {} }) } as unknown as HTMLCanvasElement;

        const renderer = await WebGPUGraphRenderer.create(canvas, () => {});
        expect(layouts).toEqual([7, 2, 2]);
        renderer.destroy();
    });
});

describe('node size updates', () => {
    it('uploads all radii in one buffer write and updates both live position buffers', () => {
        const writeBuffer = vi.fn();
        const dispatchWorkgroups = vi.fn();
        const submit = vi.fn();
        const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), dispatchWorkgroups, end: vi.fn() };
        const graph = {
            nodeCount: 2, radii: {}, nodes: [{}, {}], radiusBindGroups: [{}, {}],
            initialNodes: Float32Array.of(0, 0, 0, 5, 10, 0, 0, 7),
            layout: { setNodeRadii: vi.fn() },
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, radiusPipeline: {}, device: {
                queue: { writeBuffer, submit },
                createCommandEncoder: () => ({ beginComputePass: () => pass, finish: () => ({}) }),
            },
        }) as WebGPUGraphRenderer;

        renderer.setNodeRadii(Float32Array.of(0.3, 72));

        expect(graph.initialNodes[3]).toBeCloseTo(0.3);
        expect(graph.initialNodes[7]).toBe(72);
        expect(writeBuffer).toHaveBeenCalledTimes(1);
        expect(dispatchWorkgroups).toHaveBeenCalledTimes(2);
        expect(submit).toHaveBeenCalledTimes(1);
    });
});

describe('search emphasis mask', () => {
    it('preserves hover tiers and updates only the old and new active result when cycling', () => {
        const writeBuffer = vi.fn();
        const graph = {
            nodeCount: 4, flags: new Uint32Array(4), searchMask: new Uint8Array(4),
            activeSearch: null, highlight: {},
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, device: { queue: { writeBuffer } }, focusNode: null,
        }) as WebGPUGraphRenderer;

        renderer.setSearchHighlights(Uint32Array.of(1, 2), null);
        renderer.setFocus(0, Uint32Array.of(1), Uint32Array.of(2));
        expect([...graph.flags]).toEqual([3, 6, 5, 0]);

        writeBuffer.mockClear();
        renderer.setActiveSearchHighlight(2);
        expect([...graph.flags]).toEqual([3, 6, 9, 0]);
        expect(writeBuffer).toHaveBeenCalledTimes(1);
        expect(writeBuffer.mock.calls[0]![1]).toBe(8);

        writeBuffer.mockClear();
        renderer.setActiveSearchHighlight(1);
        expect([...graph.flags]).toEqual([3, 10, 5, 0]);
        expect(writeBuffer.mock.calls.map(call => call[1])).toEqual([8, 4]);

        renderer.setSearchHighlights(new Uint32Array(0), null);
        expect([...graph.flags]).toEqual([3, 2, 1, 0]);
    });
});

describe('3D pinning', () => {
    it('writes the current depth with a pinned node position', () => {
        const writeBuffer = vi.fn();
        const graph = {
            nodeCount: 1, nodes: [{}, {}], initialNodes: Float32Array.of(1, 2, 3, 5),
            pinIndices: new Set<number>(), pinData: new Float32Array(3), layout: null,
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, device: { queue: { writeBuffer } },
        }) as WebGPUGraphRenderer;
        renderer.pinNode(0, 10, 20, 30);
        expect([...graph.pinData]).toEqual([10, 20, 30]);
        expect([...(writeBuffer.mock.calls[0]![2] as Float32Array)]).toEqual([10, 20, 30, -5]);
        expect(writeBuffer).toHaveBeenCalledTimes(2);
    });
});

describe('fast forward render submission', () => {
    it('encodes several force ticks before drawing from the final ping-pong buffer', () => {
        let ticks = 0;
        const encode = vi.fn(() => ++ticks % 2);
        const pass = { setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() };
        const encoder = { beginRenderPass: () => pass, finish: () => ({}) };
        const cameraData = new Float32Array(20);
        const graph = {
            layout: { encode, get ticks() { return ticks; } },
            activeIndex: 0, bindGroups: ['buffer A', 'buffer B'],
            loopStart: 0, edgeCount: 0, arrowCount: 0, loopArrowCount: 0, nodeCount: 0,
            foregroundEdges: new Uint32Array(0),
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, cameraData, cameraWords: new Uint32Array(cameraData.buffer), cameraBuffer: {},
            device: { queue: { writeBuffer: vi.fn(), submit: vi.fn() }, createCommandEncoder: () => encoder },
            context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
            background: { r: 1, g: 1, b: 1, a: 1 }, linePipeline2D: {}, focusNode: null,
        }) as WebGPUGraphRenderer;
        const camera = { centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: false, yaw: 0, pitch: 0, distance: 100, referenceDistance: 100 };

        const work = renderer.draw(camera, 'thin', false, 0, 800, 600, null, 3);
        expect(encode).toHaveBeenCalledTimes(3);
        expect(work.layoutSteps).toBe(3);
        expect(work.layoutTicks).toBe(3);
        expect(pass.setBindGroup).toHaveBeenCalledWith(0, 'buffer B');
    });
});

describe('analytics path edge overlay', () => {
    it('maps data edges to render order and redraws them after the edge field', () => {
        const pass = { setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() };
        const cameraData = new Float32Array(20);
        const graph = {
            layout: null, activeIndex: 0, bindGroups: [{}],
            loopStart: 3, edgeCount: 3, arrowCount: 0, loopArrowCount: 0, nodeCount: 0,
            edgeOrder: Uint32Array.of(2, 0, 1), foregroundEdges: new Uint32Array(0),
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, cameraData, cameraWords: new Uint32Array(cameraData.buffer), cameraBuffer: {},
            device: { queue: { writeBuffer: vi.fn(), submit: vi.fn() },
                createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }) },
            context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
            background: { r: 1, g: 1, b: 1, a: 1 }, smoothPipeline2D: {}, focusNode: null,
        }) as WebGPUGraphRenderer;

        renderer.setForegroundEdges(Uint32Array.of(0, 2));
        expect([...graph.foregroundEdges]).toEqual([0, 1]);
        renderer.draw({ centerX: 0, centerY: 0, scale: 1, stroke: 1, mode3d: false,
            yaw: 0, pitch: 0, distance: 100, referenceDistance: 100 }, 'smooth', false, 0, 800, 600, null);
        expect(pass.draw.mock.calls).toEqual([[6, 3], [6, 1, 0, 0], [6, 1, 0, 1]]);
    });
});
