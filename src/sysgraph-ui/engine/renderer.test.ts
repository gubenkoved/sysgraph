import { afterEach, describe, expect, it, vi } from 'vitest';
import { cameraBasis, orientationFromYawPitch } from './camera-orientation.js';
import { requestWebGpuAdapter, WebGPUGraphRenderer } from './renderer.js';

afterEach(() => vi.unstubAllGlobals());

describe('WebGPU startup', () => {
    it('explains when the app is loaded from an insecure origin', async () => {
        vi.stubGlobal('navigator', {});
        vi.stubGlobal('isSecureContext', false);
        vi.stubGlobal('location', { origin: 'http://macbook.local:5173' });

        await expect(WebGPUGraphRenderer.create({} as HTMLCanvasElement, () => {}))
            .rejects.toThrow('Open it over HTTPS, or forward the server port');
    });

    it('uses the default adapter when a browser rejects the power preference', async () => {
        const adapter = {} as GPUAdapter;
        const requestAdapter = vi.fn()
            .mockRejectedValueOnce(new TypeError('unsupported preference'))
            .mockResolvedValueOnce(adapter);

        await expect(requestWebGpuAdapter({ requestAdapter } as unknown as GPU)).resolves.toBe(adapter);
        expect(requestAdapter).toHaveBeenCalledTimes(2);
        expect(requestAdapter).toHaveBeenLastCalledWith();
    });

    it('distinguishes an exposed API from a missing GPU adapter', async () => {
        const requestAdapter = vi.fn().mockResolvedValue(null);

        await expect(requestWebGpuAdapter({ requestAdapter } as unknown as GPU))
            .rejects.toThrow('WebGPU is exposed, but this browser returned no GPU adapter');
    });
});

describe('renderer startup resource limits', () => {
    it('keeps every render pipeline within the eight vertex storage buffers available on baseline WebGPU devices', async () => {
        const vertex = 1;
        const layouts: number[] = [];
        const pipelines: GPURenderPipelineDescriptor[] = [];
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
            createRenderPipelineAsync: async (descriptor: GPURenderPipelineDescriptor) => {
                pipelines.push(descriptor);
                return {};
            },
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
        expect(layouts).toEqual([7, 0, 0, 2, 2]);
        const contextComposite = pipelines.find(pipeline => pipeline.fragment?.entryPoint === 'compositeContext');
        expect(contextComposite?.depthStencil).toBeUndefined();
        const grids = pipelines.filter(pipeline => ['gridVertex', 'gridPlaneVertex']
            .includes(pipeline.vertex.entryPoint ?? ''));
        expect(grids).toHaveLength(2);
        expect(grids.map(pipeline => [pipeline.vertex.entryPoint, pipeline.depthStencil?.depthCompare,
            pipeline.depthStencil?.depthWriteEnabled])).toEqual([
            ['gridVertex', undefined, undefined], ['gridPlaneVertex', 'less-equal', false],
        ]);
        const spatialEdges = pipelines.filter(pipeline => pipeline.depthStencil &&
            ['lineVertex', 'smoothVertex', 'loopVertex', 'arrowVertex', 'loopArrowVertex']
                .includes(pipeline.vertex.entryPoint ?? ''));
        expect(spatialEdges).toHaveLength(10);
        expect(spatialEdges.every(pipeline =>
            pipeline.depthStencil?.depthCompare === 'less-equal')).toBe(true);
        for (const vertex of ['lineVertex', 'smoothVertex', 'loopVertex', 'arrowVertex', 'loopArrowVertex']) {
            expect(spatialEdges.filter(pipeline => pipeline.vertex.entryPoint === vertex)
                .map(pipeline => pipeline.depthStencil?.depthWriteEnabled)).toEqual([true, false]);
        }
        const spatialNodes = pipelines.filter(pipeline => pipeline.depthStencil &&
            pipeline.vertex.entryPoint === 'nodeVertex');
        expect(spatialNodes).toHaveLength(5);
        expect(spatialNodes.map(pipeline => [pipeline.fragment?.entryPoint, pipeline.depthStencil?.depthWriteEnabled]))
            .toEqual([['surfaceNodeCoreFragment', true], ['labelNodeDepthFragment', true],
                ['surfaceNodeTranslucentDepthFragment', true],
                ['surfaceNodeTranslucentFragment', false],
                ['surfaceNodeRimFragment', false]]);
        expect(spatialNodes.map(pipeline => pipeline.depthStencil?.depthCompare))
            .toEqual(['less-equal', 'less-equal', 'less-equal', 'equal', 'less-equal']);
        expect(spatialNodes[1]!.fragment?.targets[0]?.writeMask).toBe(0);
        expect(spatialNodes[2]!.fragment?.targets[0]?.writeMask).toBe(0);
        const planarNodes = pipelines.filter(pipeline => !pipeline.depthStencil &&
            pipeline.vertex.entryPoint === 'nodeVertex');
        expect(planarNodes.map(pipeline => pipeline.fragment?.entryPoint)).toEqual([
            'nodeFragment', 'mutedNodeFragment', 'matchedNodeFragment',
        ]);
        expect(planarNodes.every(pipeline =>
            pipeline.fragment?.targets[0]?.blend?.color.srcFactor === 'src-alpha')).toBe(true);
        const spatialLabels = pipelines.filter(pipeline => pipeline.depthStencil &&
            pipeline.vertex.entryPoint === 'labelVertex');
        expect(spatialLabels[0]!.depthStencil?.depthCompare).toBe('less-equal');
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
            hasSearchHighlights: false, activeSearch: null, highlight: {},
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, device: { queue: { writeBuffer } }, focusNode: null,
        }) as WebGPUGraphRenderer;

        renderer.setSearchHighlights(Uint32Array.of(1, 2), null);
        expect(graph.hasSearchHighlights).toBe(true);
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
        expect(graph.hasSearchHighlights).toBe(false);
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
    it('uploads scene brightness with a neutral default and finite display limits', () => {
        const cameraBuffer = {};
        const uploaded: number[] = [];
        const cameraData = new Float32Array(32);
        const pass = { setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph: { layout: null, activeIndex: 0, bindGroups: [{}], loopStart: 0, edgeCount: 0,
                arrowCount: 0, loopArrowCount: 0, nodeCount: 0, foregroundEdges: new Uint32Array(0) },
            cameraData, cameraWords: new Uint32Array(cameraData.buffer), cameraBuffer,
            device: { queue: {
                writeBuffer: vi.fn((buffer: object, _offset: number, data: Float32Array) => {
                    if (buffer === cameraBuffer) uploaded.push(data[10]!);
                }),
                submit: vi.fn(),
            }, createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }) },
            context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
            background: { r: 1, g: 1, b: 1, a: 1 }, linePipeline2D: {}, focusNode: null,
        }) as WebGPUGraphRenderer;
        const camera = { centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: false, yaw: 0, pitch: 0, distance: 100, referenceDistance: 100 };

        renderer.draw(camera, 'thin', false, 0, 800, 600, null);
        renderer.draw(camera, 'thin', false, 0, 800, 600, null, false, 0, 1.4);
        renderer.draw(camera, 'thin', false, 0, 800, 600, null, false, 0, 0.1);
        renderer.draw(camera, 'thin', false, 0, 800, 600, null, false, 0, 5);
        renderer.draw(camera, 'thin', false, 0, 800, 600, null, false, 0, Number.NaN);

        expect(uploaded).toHaveLength(5);
        expect(uploaded[0]).toBe(1);
        expect(uploaded[1]).toBeCloseTo(1.4);
        expect(uploaded.slice(2)).toEqual([0.5, 2, 1]);
    });

    it('encodes several force ticks before drawing from the final ping-pong buffer', () => {
        let ticks = 0;
        const encode = vi.fn(() => ++ticks % 2);
        const pass = { setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() };
        const encoder = { beginRenderPass: () => pass, finish: () => ({}) };
        const cameraData = new Float32Array(32);
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

describe('3D depth ordering', () => {
    it('compares links against node surfaces in one depth pass', () => {
        const makePass = () => ({ setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() });
        const spatialPass = makePass();
        const twoDPass = makePass();
        const beginRenderPass = vi.fn()
            .mockReturnValueOnce(spatialPass)
            .mockReturnValueOnce(twoDPass);
        const cameraData = new Float32Array(32);
        const graph = {
            layout: null, activeIndex: 0, bindGroups: [{}],
            loopStart: 1, edgeCount: 1, arrowCount: 0, loopArrowCount: 0, nodeCount: 1,
            hasTranslucentNodes: true,
            foregroundEdges: new Uint32Array(0),
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, cameraData, cameraWords: new Uint32Array(cameraData.buffer), cameraBuffer: {},
            device: { queue: { writeBuffer: vi.fn(), submit: vi.fn() },
                createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }) },
            context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
            getDepthTexture: () => ({ createView: () => ({}) }),
            background: { r: 1, g: 1, b: 1, a: 1 },
            nodePipeline: 'node 3D', nodeTranslucentDepthPipeline: 'dim node depth 3D',
            nodeTranslucentPipeline: 'dim node color 3D',
            nodeRimPipeline: 'node rim 3D', linePipeline: 'edge 3D',
            nodePipeline2D: 'node 2D', linePipeline2D: 'edge 2D', focusNode: null,
        }) as WebGPUGraphRenderer;
        const orientation = orientationFromYawPitch(0.7, 1.8);
        const camera = { centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0, pitch: 0, orientation, distance: 100, referenceDistance: 100 };

        const work = renderer.draw(camera, 'thin', true, 0, 800, 600, null);
        expect(new Uint32Array(cameraData.buffer)[19]).toBe(1); // Unspecified 3D style defaults to Solid.
        const basis = cameraBasis(orientation);
        for (const [index, axis] of [basis.right, basis.down, basis.toward].entries()) {
            for (let component = 0; component < 3; component++) {
                expect(cameraData[20 + index * 4 + component]).toBeCloseTo(axis[component]!);
            }
        }
        expect(spatialPass.setPipeline.mock.calls.map(call => call[0])).toEqual([
            'node 3D', 'edge 3D', 'dim node depth 3D', 'dim node color 3D', 'node rim 3D',
        ]);
        expect(spatialPass.draw.mock.calls).toEqual([[6, 1], [2], [6, 1], [6, 1], [6, 1]]);
        expect(work.vertices).toBe(26);
        const descriptor = beginRenderPass.mock.calls[0]![0] as GPURenderPassDescriptor;
        expect(descriptor.colorAttachments[0]?.loadOp).toBe('clear');
        expect(descriptor.depthStencilAttachment?.depthLoadOp).toBe('clear');

        renderer.draw({ ...camera, mode3d: false, nodeStyle: 'simple' }, 'thin', true, 0, 800, 600, null);
        expect(new Uint32Array(cameraData.buffer)[19]).toBe(0);
        expect(twoDPass.setPipeline.mock.calls.map(call => call[0])).toEqual(['edge 2D', 'node 2D']);
        expect(beginRenderPass).toHaveBeenCalledTimes(2);
    });

    it('draws faded edges without depth writes before a bright path and translucent nodes', () => {
        const pass = { setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() };
        const cameraData = new Float32Array(32);
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph: {
                layout: null, activeIndex: 0, activeSearch: null, bindGroups: ['graph'],
                loopStart: 1, edgeCount: 2, arrowCount: 1, loopArrowCount: 1, nodeCount: 2,
                hasTranslucentNodes: true, foregroundEdges: Uint32Array.of(0),
            },
            cameraData, cameraWords: new Uint32Array(cameraData.buffer), cameraBuffer: {},
            device: { queue: { writeBuffer: vi.fn(), submit: vi.fn() },
                createCommandEncoder: () => ({ beginRenderPass: () => pass, finish: () => ({}) }) },
            context: { getCurrentTexture: () => ({ createView: () => 'screen' }) },
            getDepthTexture: () => ({ createView: () => 'depth' }),
            background: { r: 1, g: 1, b: 1, a: 1 }, focusNode: null,
            nodePipeline: 'opaque nodes', linePipeline: 'depth-writing edges',
            lineNoDepthWritePipeline: 'faded lines', loopNoDepthWritePipeline: 'faded loops',
            smoothPipeline: 'bright path', arrowNoDepthWritePipeline: 'faded arrows',
            loopArrowNoDepthWritePipeline: 'faded loop arrows',
            nodeTranslucentDepthPipeline: 'muted node depth',
            nodeTranslucentPipeline: 'muted node color', nodeRimPipeline: 'node rims',
        }) as WebGPUGraphRenderer;

        renderer.draw({ centerX: 0, centerY: 0, scale: 1, stroke: 1, mode3d: true,
            yaw: 0, pitch: 0, distance: 100, referenceDistance: 100 },
        'thin', true, 0, 800, 600, null);

        expect(pass.setPipeline.mock.calls.map(call => call[0])).toEqual([
            'opaque nodes', 'faded lines', 'faded loops', 'bright path',
            'faded arrows', 'faded loop arrows', 'muted node depth', 'muted node color', 'node rims',
        ]);
        expect(pass.draw).toHaveBeenCalledWith(6, 1, 0, 0);
    });

    it('draws a fixed 3D plane against scene depth and keeps the 2D grid behind geometry', () => {
        const makePass = () => ({ setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() });
        const spatialPass = makePass();
        const twoDPass = makePass();
        const beginRenderPass = vi.fn()
            .mockReturnValueOnce(spatialPass)
            .mockReturnValueOnce(twoDPass);
        const cameraData = new Float32Array(32);
        const graph = {
            layout: null, activeIndex: 0, bindGroups: ['graph'],
            loopStart: 1, edgeCount: 1, arrowCount: 0, loopArrowCount: 0, nodeCount: 1,
            hasTranslucentNodes: false, foregroundEdges: new Uint32Array(0),
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, cameraData, cameraWords: new Uint32Array(cameraData.buffer), cameraBuffer: {},
            gridBindGroup: 'grid camera', gridPipeline: 'grid 2D', gridPipeline3D: 'grid 3D',
            device: { queue: { writeBuffer: vi.fn(), submit: vi.fn() },
                createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }) },
            context: { getCurrentTexture: () => ({ createView: () => ({}) }) },
            getDepthTexture: () => ({ createView: () => ({}) }),
            background: { r: 1, g: 1, b: 1, a: 1 },
            nodePipeline: 'node 3D', nodeRimPipeline: 'node rim 3D', linePipeline: 'edge 3D',
            nodePipeline2D: 'node 2D', linePipeline2D: 'edge 2D', focusNode: null,
        }) as WebGPUGraphRenderer;
        const camera = { centerX: 0, centerY: 0, scale: 1, stroke: 1,
            mode3d: true, yaw: 0.5, pitch: 0.3, distance: 100, referenceDistance: 100 };

        renderer.draw(camera, 'thin', true, 0, 800, 600, null, false, 100);
        expect(spatialPass.setPipeline.mock.calls.map(call => call[0])).toEqual([
            'node 3D', 'edge 3D', 'grid 3D', 'node rim 3D',
        ]);
        expect(spatialPass.setBindGroup.mock.calls.slice(-2)).toEqual([[0, 'grid camera'], [0, 'graph']]);
        expect(spatialPass.draw.mock.calls[spatialPass.draw.mock.calls.length - 2]).toEqual([6]);

        renderer.draw({ ...camera, mode3d: false }, 'thin', true, 0, 800, 600, null, false, 100);
        expect(twoDPass.setPipeline.mock.calls.map(call => call[0])).toEqual([
            'grid 2D', 'edge 2D', 'node 2D',
        ]);
        expect(twoDPass.setBindGroup.mock.calls[0]).toEqual([0, 'grid camera']);
        expect(twoDPass.draw.mock.calls[0]).toEqual([3]);
    });

    it('depth-tests labels against nodes while keeping edge depth in the emphasized 3D neighborhood', () => {
        const makePass = () => ({ setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() });
        const contextPass = makePass();
        const compositePass = makePass();
        const focusPass = makePass();
        const labelPass = makePass();
        const beginRenderPass = vi.fn()
            .mockReturnValueOnce(contextPass)
            .mockReturnValueOnce(compositePass)
            .mockReturnValueOnce(focusPass)
            .mockReturnValueOnce(labelPass);
        const cameraData = new Float32Array(32);
        const layerCameraData = new Float32Array(32);
        const cameraBuffer = {};
        const contextCameraBuffer = {};
        const pathCameraBuffer = {};
        const uploadedLayers = new Map<object, number>();
        const uploadedFocusNodes = new Map<object, number>();
        const writeBuffer = vi.fn((buffer: object, _offset: number, data: Float32Array) => {
            if (buffer === cameraBuffer || buffer === contextCameraBuffer || buffer === pathCameraBuffer) {
                const words = new Uint32Array(data.buffer);
                uploadedLayers.set(buffer, words[9]!);
                uploadedFocusNodes.set(buffer, words[6]!);
            }
        });
        const graph = {
            layout: null, activeIndex: 0, activeSearch: null,
            bindGroups: ['focus graph'], contextBindGroups: ['context graph'], pathBindGroups: ['path graph'],
            labelFrameBindGroups: ['label graph'],
            loopStart: 1, edgeCount: 1, arrowCount: 0, loopArrowCount: 0, nodeCount: 1,
            hasTranslucentNodes: false, foregroundEdges: Uint32Array.of(0),
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, cameraData, cameraWords: new Uint32Array(cameraData.buffer), cameraBuffer,
            layerCameraData, layerCameraWords: new Uint32Array(layerCameraData.buffer),
            contextCameraBuffer, pathCameraBuffer, labelBuffer: {}, labelBindGroup: 'label atlas',
            device: { queue: { writeBuffer, submit: vi.fn() },
                createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }) },
            context: { getCurrentTexture: () => ({ createView: () => 'screen' }) },
            getContextLayer: () => ({ view: 'faint scene', bindGroup: 'faint scene texture' }),
            getDepthTexture: () => ({ createView: () => 'depth' }),
            background: { r: 1, g: 1, b: 1, a: 1 },
            contextCompositePipeline: 'composite', gridPipeline: 'grid 2D',
            gridPipeline3D: 'grid 3D', gridBindGroup: 'grid camera',
            nodePipeline: 'node 3D', nodeRimPipeline: 'node rim 3D', linePipeline: 'edge 3D',
            lineNoDepthWritePipeline: 'faint edge 3D',
            labelNodeDepthPipeline: 'node-only label depth',
            smoothPipeline: 'path 3D',
            nodePipeline2D: 'node 2D', linePipeline2D: 'edge 2D', labelPipeline: 'label 3D',
            focusNode: 0,
        }) as WebGPUGraphRenderer;
        const camera = { centerX: 0, centerY: 0, scale: 1, stroke: 1, mode3d: true,
            yaw: 0, pitch: 0, distance: 100, referenceDistance: 100 };
        const labels = { glyphCount: 1, plateCount: 0, data: new Float32Array(12) } as
            NonNullable<Parameters<WebGPUGraphRenderer['draw']>[6]>;

        renderer.draw(camera, 'thin', true, 0, 800, 600, labels, false, 100);

        expect(uploadedLayers.get(cameraBuffer)).toBe(2);
        expect(uploadedLayers.get(contextCameraBuffer)).toBe(1);
        expect(uploadedLayers.get(pathCameraBuffer)).toBe(0);
        expect(uploadedFocusNodes.get(pathCameraBuffer)).toBe(0xffffffff);
        expect(contextPass.setBindGroup).toHaveBeenCalledWith(0, 'context graph');
        expect(contextPass.setPipeline.mock.calls.map(call => call[0])).toEqual(['edge 2D', 'node 2D']);
        expect(contextPass.draw.mock.calls).toEqual([[2], [6, 1]]);
        expect(compositePass.setPipeline.mock.calls.map(call => call[0])).toEqual(['composite']);
        expect(compositePass.setBindGroup).toHaveBeenCalledWith(0, 'faint scene texture');
        expect(compositePass.draw.mock.calls).toEqual([[3]]);
        expect(focusPass.setPipeline.mock.calls.map(call => call[0])).toEqual([
            'node 3D', 'faint edge 3D', 'path 3D', 'grid 3D', 'node rim 3D',
        ]);
        expect(focusPass.setBindGroup.mock.calls).toEqual([
            [0, 'focus graph'], [0, 'path graph'], [0, 'focus graph'], [0, 'grid camera'], [0, 'focus graph'],
        ]);
        expect(labelPass.setPipeline.mock.calls.map(call => call[0])).toEqual([
            'node-only label depth', 'label 3D',
        ]);
        expect(labelPass.setBindGroup.mock.calls).toEqual([
            [0, 'focus graph'],
            [0, 'label graph'], [1, 'label atlas'],
        ]);
        expect(focusPass.draw).toHaveBeenCalledWith(6, 1, 0, 0);
        expect(labelPass.draw.mock.calls).toEqual([[6, 1], [6, 1]]);
        expect(beginRenderPass.mock.calls.map(call => Boolean(call[0].depthStencilAttachment)))
            .toEqual([false, false, true, true]);
        expect(beginRenderPass.mock.calls[0]![0].colorAttachments[0].clearValue.a).toBe(0);
        expect(beginRenderPass.mock.calls[2]![0].colorAttachments[0].loadOp).toBe('load');
        expect(beginRenderPass.mock.calls[3]![0].colorAttachments[0].loadOp).toBe('load');
        expect(beginRenderPass.mock.calls[3]![0].depthStencilAttachment.depthLoadOp).toBe('clear');
    });

    it('keeps 3D labels above links and draws the optional 2D soft background before nodes', () => {
        const makePass = () => ({ setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() });
        const graphPass = makePass();
        const labelPass = makePass();
        const twoDPass = makePass();
        const beginRenderPass = vi.fn()
            .mockReturnValueOnce(graphPass)
            .mockReturnValueOnce(labelPass)
            .mockReturnValueOnce(twoDPass);
        const cameraData = new Float32Array(32);
        const graph = {
            layout: null, activeIndex: 0, activeSearch: null,
            bindGroups: ['graph'], labelFrameBindGroups: ['label graph'],
            loopStart: 1, edgeCount: 1, arrowCount: 0, loopArrowCount: 0, nodeCount: 1,
            hasTranslucentNodes: false, foregroundEdges: new Uint32Array(0),
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, cameraData, cameraWords: new Uint32Array(cameraData.buffer), cameraBuffer: {},
            labelBuffer: {}, labelBindGroup: 'label atlas',
            device: { queue: { writeBuffer: vi.fn(), submit: vi.fn() },
                createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }) },
            context: { getCurrentTexture: () => ({ createView: () => 'screen' }) },
            getDepthTexture: () => ({ createView: () => 'depth' }),
            background: { r: 1, g: 1, b: 1, a: 1 },
            nodePipeline: 'node 3D', nodeRimPipeline: 'node rim 3D', linePipeline: 'edge 3D',
            labelNodeDepthPipeline: 'node-only label depth', labelPipeline: 'label 3D',
            nodePipeline2D: 'node 2D', linePipeline2D: 'edge 2D', labelPipeline2D: 'label 2D',
            focusNode: null,
        }) as WebGPUGraphRenderer;
        const camera = { centerX: 0, centerY: 0, scale: 1, stroke: 1, mode3d: true,
            yaw: 0, pitch: 0, distance: 100, referenceDistance: 100 };
        const labels = { glyphCount: 1, plateCount: 1, underlay: true, data: new Float32Array(24) } as
            NonNullable<Parameters<WebGPUGraphRenderer['draw']>[6]>;

        renderer.draw(camera, 'thin', true, 0, 800, 600, labels);
        expect(graphPass.setPipeline.mock.calls.map(call => call[0])).toEqual([
            'node 3D', 'edge 3D', 'node rim 3D',
        ]);
        expect(labelPass.setPipeline.mock.calls.map(call => call[0])).toEqual([
            'node-only label depth', 'label 3D',
        ]);
        expect(labelPass.draw.mock.calls).toEqual([[6, 1], [6, 1, 0, 1], [6, 1]]);
        expect(beginRenderPass.mock.calls[1]![0].colorAttachments[0].loadOp).toBe('load');
        expect(beginRenderPass.mock.calls[1]![0].depthStencilAttachment.depthLoadOp).toBe('clear');

        renderer.draw({ ...camera, mode3d: false }, 'thin', true, 0, 800, 600, labels);
        expect(twoDPass.setPipeline.mock.calls.map(call => call[0])).toEqual([
            'edge 2D', 'label 2D', 'node 2D', 'label 2D',
        ]);
        expect(twoDPass.draw.mock.calls).toEqual([[2], [6, 1, 0, 1], [6, 1], [6, 1]]);
        expect(beginRenderPass).toHaveBeenCalledTimes(3);
    });

    it('keeps the faded 2D hover context separate from emphasized nodes and edges', () => {
        const makePass = () => ({ setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() });
        const passes = [makePass(), makePass(), makePass()];
        const beginRenderPass = vi.fn()
            .mockReturnValueOnce(passes[0])
            .mockReturnValueOnce(passes[1])
            .mockReturnValueOnce(passes[2]);
        const cameraData = new Float32Array(32);
        const layerCameraData = new Float32Array(32);
        const graph = {
            layout: null, activeIndex: 0, activeSearch: null,
            bindGroups: ['focus graph'], contextBindGroups: ['context graph'],
            loopStart: 1, edgeCount: 1, arrowCount: 0, loopArrowCount: 0, nodeCount: 1,
            hasTranslucentNodes: false, foregroundEdges: new Uint32Array(0),
        };
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph, cameraData, cameraWords: new Uint32Array(cameraData.buffer), cameraBuffer: {},
            layerCameraData, layerCameraWords: new Uint32Array(layerCameraData.buffer),
            contextCameraBuffer: {}, pathCameraBuffer: {},
            device: { queue: { writeBuffer: vi.fn(), submit: vi.fn() },
                createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }) },
            context: { getCurrentTexture: () => ({ createView: () => 'screen' }) },
            getContextLayer: () => ({ view: 'faint scene', bindGroup: 'faint scene texture' }),
            background: { r: 1, g: 1, b: 1, a: 1 },
            contextCompositePipeline: 'composite', gridPipeline: 'grid 2D', gridBindGroup: 'grid camera',
            nodePipeline2D: 'node 2D', linePipeline2D: 'edge 2D', focusNode: 0,
        }) as WebGPUGraphRenderer;

        renderer.draw({ centerX: 0, centerY: 0, scale: 1, stroke: 1, mode3d: false,
            yaw: 0, pitch: 0, distance: 100, referenceDistance: 100 }, 'thin', true, 0, 800, 600, null, false, 100);

        expect(beginRenderPass).toHaveBeenCalledTimes(3);
        expect(passes[0]!.setBindGroup).toHaveBeenCalledWith(0, 'context graph');
        expect(passes[0]!.setPipeline.mock.calls.map(call => call[0])).toEqual(['edge 2D', 'node 2D']);
        expect(passes[1]!.setPipeline.mock.calls.map(call => call[0])).toEqual(['grid 2D', 'composite']);
        expect(passes[2]!.setBindGroup).toHaveBeenCalledWith(0, 'focus graph');
        expect(passes[2]!.setPipeline.mock.calls.map(call => call[0])).toEqual(['edge 2D', 'node 2D']);
        expect(beginRenderPass.mock.calls.every(call => !call[0].depthStencilAttachment)).toBe(true);
        expect(beginRenderPass.mock.calls[2]![0].colorAttachments[0].loadOp).toBe('load');
    });

    it('caps overlapping 2D non-matches while drawing matched nodes separately', () => {
        const makePass = () => ({ setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() });
        const mutedPass = makePass();
        const graphPass = makePass();
        const beginRenderPass = vi.fn().mockReturnValueOnce(mutedPass).mockReturnValueOnce(graphPass);
        const cameraData = new Float32Array(32);
        const renderer = Object.assign(Object.create(WebGPUGraphRenderer.prototype), {
            graph: {
                layout: null, activeIndex: 0, activeSearch: null, bindGroups: ['graph'],
                loopStart: 1, edgeCount: 1, arrowCount: 0, loopArrowCount: 0, nodeCount: 2,
                hasTranslucentNodes: true, hasSearchHighlights: true, foregroundEdges: Uint32Array.of(0),
            },
            cameraData, cameraWords: new Uint32Array(cameraData.buffer), cameraBuffer: {},
            device: { queue: { writeBuffer: vi.fn(), submit: vi.fn() },
                createCommandEncoder: () => ({ beginRenderPass, finish: () => ({}) }) },
            context: { getCurrentTexture: () => ({ createView: () => 'screen' }) },
            getContextLayer: () => ({ view: 'muted nodes', bindGroup: 'muted texture' }),
            background: { r: 1, g: 1, b: 1, a: 1 }, focusNode: null,
            mutedNodePipeline2D: 'muted nodes', matchedNodePipeline2D: 'matched nodes',
            contextCompositePipeline: 'alpha-capped composite',
            linePipeline2D: 'edges', smoothPipeline2D: 'path',
        }) as WebGPUGraphRenderer;

        renderer.draw({ centerX: 0, centerY: 0, scale: 1, stroke: 1, mode3d: false,
            yaw: 0, pitch: 0, distance: 100, referenceDistance: 100 },
        'thin', true, 0, 800, 600, null);

        expect(beginRenderPass).toHaveBeenCalledTimes(2);
        expect(mutedPass.setPipeline.mock.calls.map(call => call[0])).toEqual(['muted nodes']);
        expect(mutedPass.draw.mock.calls).toEqual([[6, 2]]);
        expect(graphPass.setPipeline.mock.calls.map(call => call[0])).toEqual([
            'edges', 'path', 'alpha-capped composite', 'matched nodes',
        ]);
        expect(graphPass.setBindGroup.mock.calls.slice(-2)).toEqual([
            [0, 'muted texture'], [0, 'graph'],
        ]);
    });
});

describe('analytics path edge overlay', () => {
    it('maps data edges to render order and redraws them after the edge field', () => {
        const pass = { setBindGroup: vi.fn(), setPipeline: vi.fn(), draw: vi.fn(), end: vi.fn() };
        const cameraData = new Float32Array(32);
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
