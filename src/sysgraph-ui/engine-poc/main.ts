import { initAppTooltips } from '../modules/app-tooltips.js';
import { type ExampleInfo, loadExampleGraph, loadExamplesManifest } from '../modules/data-io.js';
import { CameraAxisOverlay } from './camera-axis.js';
import { fitCameraToPositions } from './camera-fit.js';
import type { ExampleResponse } from './example-worker.js';
import type { GraphRequest, GraphResponse, Topology } from './graph-worker.js';
import { HoverIntent } from './hover-intent.js';
import { GraphInteractionIndex } from './interaction.js';
import { createLabelAtlas, GraphLabelLayout, LABEL_FONT_REQUEST, type ScreenRect } from './labels.js';
import { createDepths, createProjection, unprojectAtDepth } from './projection.js';
import { type CameraState, type EdgeStyle, WebGPUGraphRenderer } from './renderer.js';
import './style.css';

function element<T extends HTMLElement>(id: string): T {
    const found = document.getElementById(id);
    if (!found) throw new Error(`Missing element #${id}`);
    return found as T;
}

const canvas = element<HTMLCanvasElement>('graph-canvas');
// Leave the lab's lower-left control and performance panels unobstructed.
const cameraAxis = new CameraAxisOverlay(document.body, { left: 390, bottom: 210 });
const status = element<HTMLElement>('status');
const adapterLabel = element<HTMLElement>('adapter');
const graphSource = element<HTMLSelectElement>('graph-source');
const syntheticControls = element<HTMLElement>('synthetic-controls');
const exampleNote = element<HTMLElement>('example-note');
const loadAction = element<HTMLElement>('load-action');
const sizePreset = element<HTMLSelectElement>('size-preset');
const nodeInput = element<HTMLInputElement>('node-count');
const edgeInput = element<HTMLInputElement>('edge-count');
const topologyInput = element<HTMLSelectElement>('topology');
const edgeStyleInput = element<HTMLSelectElement>('edge-style');
const showNodesInput = element<HTMLInputElement>('show-nodes');
const outlineNodesInput = element<HTMLInputElement>('outline-nodes');
const outlineWidthInput = element<HTMLInputElement>('outline-width');
const outlineWidthValue = element<HTMLElement>('outline-width-value');
const showLabelsInput = element<HTMLInputElement>('show-labels');
const runLayoutInput = element<HTMLInputElement>('run-layout');
const layoutRateInput = element<HTMLSelectElement>('layout-rate');
const resetLayoutButton = element<HTMLButtonElement>('reset-layout');
const clearPinsButton = element<HTMLButtonElement>('clear-pins');
const sceneNoteTitle = element<HTMLElement>('scene-note-title');
const sceneNoteDetail = element<HTMLElement>('scene-note-detail');
const layoutValue = element<HTMLElement>('layout-value');
const strokeInput = element<HTMLInputElement>('stroke');
const strokeValue = element<HTMLElement>('stroke-value');
const resolutionInput = element<HTMLSelectElement>('resolution');
const autoCameraInput = element<HTMLInputElement>('auto-camera');
const view3DInput = element<HTMLInputElement>('view-3d');
const hint2D = element<HTMLElement>('hint-2d');
const hint3D = element<HTMLElement>('hint-3d');
const regenerateButton = element<HTMLButtonElement>('regenerate');
const fitButton = element<HTMLButtonElement>('fit-view');
const fpsValue = element<HTMLElement>('fps-value');
const frameValue = element<HTMLElement>('frame-value');
const cpuValue = element<HTMLElement>('cpu-value');
const sceneValue = element<HTMLElement>('scene-value');
const workValue = element<HTMLElement>('work-value');
const labelsValue = element<HTMLElement>('labels-value');
const generationValue = element<HTMLElement>('generation-value');
const hoverInfo = element<HTMLElement>('hover-info');
initAppTooltips();

const camera: CameraState = {
    centerX: 0, centerY: 0, centerZ: 0, scale: 0.35, stroke: 1.6,
    mode3d: false, yaw: 0.48, pitch: 0.3, distance: 1000, referenceDistance: 1000,
};
let renderer: WebGPUGraphRenderer | null = null;
let interaction: GraphInteractionIndex | null = null;
let labelLayout: GraphLabelLayout | null = null;
let currentNodes: Float32Array | null = null;
let depths: Float32Array | null = null;
let initialNodes: Float32Array | null = null;
let displayedGraph: GraphResponse | ExampleResponse | null = null;
let displayedTitle: string | undefined;
let layoutReady = false;
let layoutPreparingRequest = -1;
let layoutEpoch = 0;
let lastLayoutTick = 0;
let lastSnapshotAt = 0;
let lastSnapshotTick = 0;
let nodeLabels: string[] | null = null;
let nodeIds: string[] | null = null;
let examples: ExampleInfo[] = [];
let worker: Worker | null = null;
let requestId = 0;
let running = true;
let dragging = false;
let draggingOrbit = false;
let draggingNode: number | null = null;
let dragOffsetX = 0;
let dragOffsetY = 0;
let pointerX = 0;
let pointerY = 0;
let pointerInside = false;
let hoveredNode: number | null = null;
const hoverIntent = new HoverIntent();
let autoCenterX = 0;
let autoCenterY = 0;
let autoStarted = 0;
let autoYaw = camera.yaw;
let autoPitch = camera.pitch;
let last3DPickAt = 0;
let last3DPickState: number[] | null = null;
let lastFrame = 0;
let lastStats = 0;
let resolution = 1;
const frameIntervals: number[] = [];
const submitTimes: number[] = [];
const layoutEncodeTimes: number[] = [];
const DISPLAY_SETTINGS_KEY = 'sysgraph.engine-poc.display.v1';

void document.fonts.load(LABEL_FONT_REQUEST).then(() => {
    if (!renderer || !currentNodes || !interaction) return;
    const atlas = createLabelAtlas(nodeLabels ?? undefined);
    labelLayout = new GraphLabelLayout(currentNodes, interaction, atlas, nodeLabels ?? undefined, depths ?? undefined);
    renderer.setLabelAtlas(atlas);
}).catch(() => {
    // Use the system sans-serif fallback when the web font is unavailable.
});

function formatInt(value: number): string {
    return new Intl.NumberFormat('en-US').format(value);
}

function syncDisplayControls(): void {
    camera.stroke = Number(strokeInput.value);
    strokeValue.textContent = `${camera.stroke.toFixed(1)} px`;
    outlineWidthValue.textContent = `${Number(outlineWidthInput.value).toFixed(1)} px`;
    outlineWidthInput.disabled = !showNodesInput.checked || !outlineNodesInput.checked;
    resolution = resolutionInput.value === 'native' ? Math.min(window.devicePixelRatio || 1, 3) : 1;
    camera.mode3d = view3DInput.checked;
    hint2D.hidden = camera.mode3d;
    hint3D.hidden = !camera.mode3d;
}

function restoreDisplaySettings(): void {
    try {
        const raw = localStorage.getItem(DISPLAY_SETTINGS_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const saved = parsed as Record<string, unknown>;
            if (saved.edgeStyle === 'thin' || saved.edgeStyle === 'smooth') edgeStyleInput.value = saved.edgeStyle;
            if (typeof saved.stroke === 'number' && Number.isFinite(saved.stroke)) {
                strokeInput.value = String(Math.max(0.8, Math.min(4, saved.stroke)));
            }
            if (saved.resolution === '1' || saved.resolution === 'native') resolutionInput.value = saved.resolution;
            if (typeof saved.showNodes === 'boolean') showNodesInput.checked = saved.showNodes;
            if (typeof saved.showLabels === 'boolean') showLabelsInput.checked = saved.showLabels;
            if (typeof saved.view3d === 'boolean') view3DInput.checked = saved.view3d;
            if (typeof saved.runLayout === 'boolean') runLayoutInput.checked = saved.runLayout;
            if (saved.layoutRate === '15' || saved.layoutRate === '30' || saved.layoutRate === '60') layoutRateInput.value = saved.layoutRate;
            if (typeof saved.outlineNodes === 'boolean') outlineNodesInput.checked = saved.outlineNodes;
            if (typeof saved.outlineWidth === 'number' && Number.isFinite(saved.outlineWidth)) {
                outlineWidthInput.value = String(Math.max(0.5, Math.min(3.5, saved.outlineWidth)));
            }
        }
    } catch {
        // Storage can be unavailable in restricted browser contexts.
    }
    syncDisplayControls();
}

function saveDisplaySettings(): void {
    try {
        localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify({
            edgeStyle: edgeStyleInput.value,
            stroke: Number(strokeInput.value),
            resolution: resolutionInput.value,
            showNodes: showNodesInput.checked,
            showLabels: showLabelsInput.checked,
            view3d: view3DInput.checked,
            runLayout: runLayoutInput.checked,
            layoutRate: layoutRateInput.value,
            outlineNodes: outlineNodesInput.checked,
            outlineWidth: Number(outlineWidthInput.value),
        }));
    } catch {
        // The controls still work when storage is unavailable.
    }
}

function setStatus(message: string, kind: 'ready' | 'busy' | 'error' = 'busy'): void {
    status.textContent = message;
    status.dataset.kind = kind;
}

function setFatal(message: string): void {
    running = false;
    worker?.terminate();
    setStatus(message, 'error');
    document.body.classList.add('has-error');
}

function readCounts(): { nodeCount: number; edgeCount: number } {
    const nodeCount = Math.max(12, Math.min(100_000, Math.floor(Number(nodeInput.value) || 10_000)));
    const edgeCount = Math.max(12, Math.min(1_000_000, Math.floor(Number(edgeInput.value) || 100_000)));
    nodeInput.value = String(nodeCount);
    edgeInput.value = String(edgeCount);
    return { nodeCount, edgeCount };
}

function fitView(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (!currentNodes || !fitCameraToPositions(camera, currentNodes, width, height)) return;
    autoCenterX = camera.centerX;
    autoCenterY = camera.centerY;
    autoYaw = camera.yaw;
    autoPitch = camera.pitch;
    autoStarted = performance.now();
}

function resizeCanvas(): void {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * resolution));
    const height = Math.max(1, Math.round(rect.height * resolution));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
}

function applyGraph(graph: GraphResponse | ExampleResponse, sourceTitle?: string): void {
    if (!renderer) return;
    displayedGraph = graph;
    displayedTitle = sourceTitle;
    const globe = camera.mode3d && 'globe' in graph ? graph.globe : undefined;
    const sceneNodes = (globe?.nodes ?? graph.nodes).slice();
    depths = globe?.depths.slice() ?? createDepths(sceneNodes);
    const edgeDistances = globe?.edgeDistances ?? ('edgeDistances' in graph ? graph.edgeDistances : undefined);
    renderer.setGraph(sceneNodes, graph.edges, edgeDistances, depths,
        'nodeColors' in graph ? { nodes: graph.nodeColors, edges: graph.edgeColors,
            widths: graph.edgeWidths, arrows: graph.arrows } : undefined,
        'layoutProfile' in graph ? graph.layoutProfile : undefined, camera.mode3d ? 3 : 2);
    for (let i = 0; i < depths.length; i++) sceneNodes[i * 4 + 2] = depths[i]!;
    layoutEpoch++;
    currentNodes = sceneNodes;
    initialNodes = sceneNodes.slice();
    layoutReady = false;
    layoutPreparingRequest = -1;
    lastLayoutTick = 0;
    lastSnapshotAt = 0;
    lastSnapshotTick = 0;
    last3DPickState = null;
    const labels = 'labels' in graph ? graph.labels : undefined;
    const atlas = createLabelAtlas(labels);
    renderer.setLabelAtlas(atlas);
    const indexStarted = performance.now();
    interaction = new GraphInteractionIndex(sceneNodes, graph.edges);
    const indexMs = performance.now() - indexStarted;
    labelLayout = new GraphLabelLayout(sceneNodes, interaction, atlas, labels, depths);
    nodeLabels = labels ?? null;
    nodeIds = 'nodeIds' in graph ? graph.nodeIds : null;
    hoveredNode = null;
    hoverIntent.reset();
    dragging = false;
    draggingOrbit = false;
    draggingNode = null;
    canvas.classList.remove('hovering');
    canvas.classList.remove('dragging', 'dragging-node');
    hoverInfo.textContent = 'Hover a node to reveal its neighborhood';
    hoverInfo.classList.remove('active');
    fitView();
    const bytes = renderer.graphInfo?.bytes ?? 0;
    const dataSize = bytes < 1_000_000 ? `${(bytes / 1_000).toFixed(1)} kB` : `${(bytes / 1_000_000).toFixed(1)} MB`;
    sceneValue.textContent = `${sourceTitle ? `${sourceTitle} · ` : ''}${formatInt(graph.nodeCount)} nodes · ${formatInt(graph.edgeCount)} edges`;
    const setupMs = 'layoutMs' in graph ? `${graph.layoutMs.toFixed(0)} ms static layout` : `${graph.generationMs.toFixed(0)} ms generation`;
    generationValue.textContent = `${setupMs} · ${indexMs.toFixed(0)} ms index · ${dataSize} graph buffers`;
    frameIntervals.length = 0;
    submitTimes.length = 0;
    layoutEncodeTimes.length = 0;
    lastFrame = 0;
    lastStats = 0;
    fpsValue.textContent = '—';
    frameValue.textContent = '—';
    cpuValue.textContent = '—';
    workValue.textContent = '—';
    updateLayoutState();
    if (runLayoutInput.checked) void prepareLayout();
}

function updateLayoutState(): void {
    const active = runLayoutInput.checked && layoutReady;
    sceneNoteTitle.textContent = active ? 'GPU FORCE LAYOUT' : 'STATIC LAYOUT';
    sceneNoteDetail.textContent = `${active ? `${layoutRateInput.value} TICKS / SEC` : 'NO PHYSICS IN FRAME TIME'} · ` +
        `${camera.mode3d ? '3D' : '2D'} ${active ? 'PHYSICS' : 'VIEW'}`;
    if (active) setStatus('WebGPU ready · live force layout', 'ready');
    else if (runLayoutInput.checked) setStatus('Preparing GPU force layout…');
    else setStatus('WebGPU ready · frozen layout', 'ready');
}

async function prepareLayout(): Promise<void> {
    const activeRenderer = renderer;
    const activeRequest = requestId;
    const activeEpoch = layoutEpoch;
    if (!activeRenderer || !runLayoutInput.checked || layoutReady || layoutPreparingRequest === activeEpoch) return;
    layoutPreparingRequest = activeEpoch;
    updateLayoutState();
    try {
        const ready = await activeRenderer.prepareLayout();
        if (activeRenderer !== renderer || activeRequest !== requestId || activeEpoch !== layoutEpoch) return;
        layoutReady = ready;
        updateLayoutState();
    } catch (error) {
        if (activeRequest !== requestId || activeEpoch !== layoutEpoch) return;
        runLayoutInput.checked = false;
        saveDisplaySettings();
        updateLayoutState();
        setStatus(`GPU layout unavailable: ${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
        if (layoutPreparingRequest === activeEpoch) layoutPreparingRequest = -1;
    }
}

function refreshCpuPositions(snapshot: Float32Array): void {
    if (!currentNodes || snapshot.length !== currentNodes.length) return;
    interaction?.updatePositions(snapshot);
    if (depths) for (let i = 0; i < depths.length; i++) depths[i] = snapshot[i * 4 + 2]!;
    labelLayout?.invalidatePositions();
    if (pointerInside) updateHover(true);
}

function requestPositionSnapshot(now: number): void {
    if (!pointerInside && !showLabelsInput.checked) return;
    if (!renderer || !layoutReady || renderer.layoutTicks === lastSnapshotTick || now - lastSnapshotAt < 150) return;
    lastSnapshotAt = now;
    const activeRequest = requestId;
    const activeRenderer = renderer;
    const epoch = layoutEpoch;
    void activeRenderer.snapshotPositions().then(snapshot => {
        if (!snapshot || activeRequest !== requestId || activeRenderer !== renderer || epoch !== layoutEpoch) return;
        lastSnapshotTick = activeRenderer.layoutTicks;
        refreshCpuPositions(snapshot);
    }).catch(error => setStatus(`Position snapshot failed: ${error instanceof Error ? error.message : String(error)}`, 'error'));
}

function generateGraph(): void {
    if (!renderer || !running) return;
    const { nodeCount, edgeCount } = readCounts();
    const topology = topologyInput.value as Topology;
    const id = ++requestId;
    worker?.terminate();
    worker = new Worker(new URL('./graph-worker.ts', import.meta.url), { type: 'module' });
    setStatus(`Generating ${formatInt(nodeCount)} nodes and ${formatInt(edgeCount)} edges…`);
    generationValue.textContent = 'Generating…';
    worker.onmessage = (event: MessageEvent<GraphResponse>) => {
        const graph = event.data;
        if (graph.id !== requestId || !renderer) return;
        try {
            applyGraph(graph);
        } catch (error) {
            setStatus(error instanceof Error ? error.message : String(error), 'error');
        }
    };
    worker.onerror = event => setStatus(`Graph worker failed: ${event.message}`, 'error');
    const request: GraphRequest = { id, nodeCount, edgeCount, topology };
    worker.postMessage(request);
}

async function loadExample(): Promise<void> {
    if (!renderer || !running) return;
    const example = examples.find(item => item.file === graphSource.value);
    if (!example) return;
    const id = ++requestId;
    worker?.terminate();
    worker = null;
    setStatus(`Loading ${example.title}…`);
    generationValue.textContent = 'Loading example…';
    try {
        const graph = await loadExampleGraph(example.file);
        if (id !== requestId) return;
        setStatus(`Computing a static layout for ${example.title}…`);
        worker = new Worker(new URL('./example-worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<ExampleResponse>) => {
            if (event.data.id !== requestId) return;
            try {
                applyGraph(event.data, example.title);
            } catch (error) {
                setStatus(error instanceof Error ? error.message : String(error), 'error');
            }
        };
        worker.onerror = event => setStatus(`Example layout failed: ${event.message}`, 'error');
        worker.postMessage({ id, graph });
    } catch (error) {
        if (id === requestId) setStatus(error instanceof Error ? error.message : String(error), 'error');
    }
}

function loadSelectedGraph(): void {
    if (graphSource.value === 'synthetic') generateGraph();
    else void loadExample();
}

async function populateExamples(): Promise<void> {
    examples = await loadExamplesManifest();
    if (!examples.length) return;
    const group = document.createElement('optgroup');
    group.label = 'Built-in examples';
    for (const example of examples) {
        const option = document.createElement('option');
        option.value = example.file;
        option.textContent = `${example.title} (${formatInt(example.nodes)}n / ${formatInt(example.edges)}e)`;
        group.append(option);
    }
    graphSource.append(group);
}

function updateSourceControls(): void {
    const synthetic = graphSource.value === 'synthetic';
    syntheticControls.hidden = !synthetic;
    exampleNote.hidden = synthetic;
    loadAction.textContent = synthetic ? 'Generate graph' : 'Reload example';
}

function trackSample(values: number[], sample: number): void {
    values.push(sample);
    if (values.length > 120) values.shift();
}

function updateStats(now: number, cpuSubmitMs: number, drawCalls: number, vertices: number, labelCount: number, labelMs: number, labelsEnabled: boolean): void {
    if (now - lastStats < 500) return;
    lastStats = now;
    if (frameIntervals.length) {
        const sorted = [...frameIntervals].sort((a, b) => a - b);
        const mean = frameIntervals.reduce((sum, value) => sum + value, 0) / frameIntervals.length;
        fpsValue.textContent = (1000 / mean).toFixed(0);
        frameValue.textContent = `${sorted[Math.ceil(sorted.length * 0.95) - 1]!.toFixed(1)} ms p95`;
    }
    if (submitTimes.length) {
        const mean = submitTimes.reduce((sum, value) => sum + value, 0) / submitTimes.length;
        cpuValue.textContent = `${mean.toFixed(2)} ms`;
    } else {
        cpuValue.textContent = `${cpuSubmitMs.toFixed(2)} ms`;
    }
    workValue.textContent = `${drawCalls} draw calls · ${formatInt(vertices)} vertices`;
    const layoutEncoding = layoutEncodeTimes.length
        ? ` · ${(layoutEncodeTimes.reduce((sum, value) => sum + value, 0) / layoutEncodeTimes.length).toFixed(2)} ms CPU encode/tick`
        : '';
    layoutValue.textContent = layoutReady
        ? `${runLayoutInput.checked ? 'Running' : 'Paused'} · ${formatInt(renderer?.layoutTicks ?? 0)} GPU ticks${layoutEncoding} · GPU duration unmeasured`
        : 'Layout paused · 0 ticks';
    labelsValue.textContent = labelsEnabled
        ? `${labelCount} labels · ${labelMs.toFixed(2)} ms placement on CPU`
        : 'Labels off · CPU submit excludes GPU execution.';
}

function labelBlockers(): ScreenRect[] {
    const canvasRect = canvas.getBoundingClientRect();
    return Array.from(document.querySelectorAll<HTMLElement>('.topbar, .control-panel, .performance-panel, .hover-info'), element => {
        const rect = element.getBoundingClientRect();
        return {
            left: rect.left - canvasRect.left,
            top: rect.top - canvasRect.top,
            right: rect.right - canvasRect.left,
            bottom: rect.bottom - canvasRect.top,
        };
    });
}

function frame(now: number): void {
    if (!running || !renderer) return;
    if (lastFrame && now - lastFrame < 250) trackSample(frameIntervals, now - lastFrame);
    lastFrame = now;
    if (autoCameraInput.checked) {
        const time = (now - autoStarted) / 1000;
        if (camera.mode3d) {
            camera.yaw = autoYaw + time * 0.18;
            camera.pitch = Math.max(-1.1, Math.min(1.1, autoPitch + Math.sin(time * 0.29) * 0.12));
        } else {
            camera.centerX = autoCenterX + Math.sin(time * 0.43) * 250;
            camera.centerY = autoCenterY + Math.sin(time * 0.31) * 170;
        }
    }
    if (pointerInside) updateHover();
    advanceHoverIntent(now);
    try {
        const layoutInterval = 1000 / Number(layoutRateInput.value);
        const stepLayout = runLayoutInput.checked && layoutReady && now - lastLayoutTick >= layoutInterval;
        if (stepLayout) lastLayoutTick = now;
        const labelStarted = performance.now();
        const labels = showLabelsInput.checked && labelLayout && interaction
            ? labelLayout.build(
                camera, canvas.clientWidth, canvas.clientHeight, resolution,
                labelBlockers(), hoveredNode,
                hoveredNode !== null ? interaction.getNeighbors(hoveredNode) : undefined,
                undefined, now,
            )
            : null;
        const labelMs = labels ? performance.now() - labelStarted : 0;
        const result = renderer.draw(
            { ...camera, scale: camera.scale * resolution, stroke: camera.stroke * resolution, pixelRatio: resolution },
            edgeStyleInput.value as EdgeStyle,
            showNodesInput.checked,
            outlineNodesInput.checked && showNodesInput.checked ? Number(outlineWidthInput.value) * resolution : 0,
            canvas.width,
            canvas.height,
            labels,
            stepLayout,
        );
        cameraAxis.update(camera, canvas.clientWidth, canvas.clientHeight, now,
            dragging && draggingNode === null || autoCameraInput.checked && camera.mode3d);
        requestPositionSnapshot(now);
        if (result.drawCalls) trackSample(submitTimes, result.cpuSubmitMs);
        if (result.layoutTick) trackSample(layoutEncodeTimes, result.layoutEncodeMs);
        updateStats(now, result.cpuSubmitMs, result.drawCalls, result.vertices, labels?.labelCount ?? 0, labelMs, showLabelsInput.checked);
        requestAnimationFrame(frame);
    } catch (error) {
        cameraAxis.hide();
        setFatal(error instanceof Error ? error.message : String(error));
    }
}

function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    return {
        x: camera.centerX + (clientX - rect.left - rect.width / 2) / camera.scale,
        y: camera.centerY + (clientY - rect.top - rect.height / 2) / camera.scale,
    };
}

function pickNode(clientX: number, clientY: number): number | null {
    if (!showNodesInput.checked || !interaction) return null;
    if (camera.mode3d && depths) {
        const rect = canvas.getBoundingClientRect();
        return interaction.pick3D(clientX - rect.left, clientY - rect.top, camera, depths, rect.width, rect.height);
    }
    const world = screenToWorld(clientX, clientY);
    return interaction.pick(world.x, world.y, camera.scale);
}

function pointerWorldAtNode(clientX: number, clientY: number, node: number): { x: number; y: number } | null {
    if (!camera.mode3d || !depths) return screenToWorld(clientX, clientY);
    const rect = canvas.getBoundingClientRect();
    return unprojectAtDepth(createProjection(camera, rect.width, rect.height),
        clientX - rect.left, clientY - rect.top, depths[node]!);
}

function commitHover(next: number | null, force = false): void {
    const index = interaction;
    if (!renderer) return;
    if (next === hoveredNode && !force) return;
    hoveredNode = next;
    renderer.setFocus(next, next !== null ? index?.getNeighbors(next) : undefined);
    hoverInfo.classList.toggle('active', next !== null);
    const exampleLabel = next !== null ? nodeLabels?.[next] : undefined;
    const exampleId = next !== null ? nodeIds?.[next] : undefined;
    const nodeName = next === null ? '' : exampleLabel
        ? `${exampleLabel}${exampleId && exampleId !== exampleLabel ? ` (${exampleId})` : ''}`
        : `Node #${formatInt(next + 1)}`;
    hoverInfo.textContent = next === null || !index
        ? 'Hover a node to reveal its neighborhood'
        : `${nodeName} · ${formatInt(index.getDegree(next))} direct links${renderer.isPinned(next) ? ' · pinned' : ''}`;
}

function updateHover(force = false): void {
    if (!renderer) return;
    if (!pointerInside || dragging) {
        hoverIntent.reset();
        canvas.classList.remove('hovering');
        commitHover(null);
        return;
    }
    if (draggingNode !== null) {
        hoverIntent.activate(draggingNode);
        canvas.classList.add('hovering');
        commitHover(draggingNode, force);
        return;
    }
    if (camera.mode3d && pointerInside && draggingNode === null) {
        const state = [pointerX, pointerY, camera.centerX, camera.centerY, camera.centerZ ?? 0, camera.scale,
            camera.yaw, camera.pitch, camera.distance];
        if (!force && last3DPickState?.every((value, position) => value === state[position])) return;
        if (!force && performance.now() - last3DPickAt < 80) return;
        last3DPickAt = performance.now();
        last3DPickState = state;
    }
    const next = interaction ? pickNode(pointerX, pointerY) : null;
    canvas.classList.toggle('hovering', next !== null);
    hoverIntent.observe(next, performance.now());
    if (force && next === hoverIntent.active) commitHover(next, true);
}

function advanceHoverIntent(now: number): void {
    if (!renderer || !pointerInside || dragging || draggingNode !== null || !hoverIntent.ready(now)) return;
    const next = pickNode(pointerX, pointerY);
    hoverIntent.observe(next, now);
    canvas.classList.toggle('hovering', next !== null);
    const active = hoverIntent.advance(now);
    if (active !== undefined) commitHover(active);
}

canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.button !== 1) return;
    autoCameraInput.checked = false;
    pointerInside = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    const picked = event.button === 0 && showNodesInput.checked
        ? pickNode(event.clientX, event.clientY)
        : null;
    if (event.shiftKey && picked !== null) {
        renderer?.unpinNode(picked);
        updateHover(true);
        return;
    }
    if (picked !== null && currentNodes) {
        const world = pointerWorldAtNode(event.clientX, event.clientY, picked);
        if (!world) return;
        draggingNode = picked;
        const offset = picked * 4;
        dragOffsetX = currentNodes[offset]! - world.x;
        dragOffsetY = currentNodes[offset + 1]! - world.y;
        renderer?.pinNode(picked, currentNodes[offset]!, currentNodes[offset + 1]!, depths?.[picked]);
        canvas.classList.add('dragging-node');
    } else {
        dragging = true;
        draggingOrbit = camera.mode3d && event.button === 0;
        canvas.classList.add('dragging');
    }
    updateHover(true);
    canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', event => {
    const dx = event.clientX - pointerX;
    const dy = event.clientY - pointerY;
    pointerInside = true;
    pointerX = event.clientX;
    pointerY = event.clientY;
    if (draggingNode !== null) {
        const world = pointerWorldAtNode(event.clientX, event.clientY, draggingNode);
        if (!world) return;
        const x = world.x + dragOffsetX;
        const y = world.y + dragOffsetY;
        renderer?.pinNode(draggingNode, x, y, depths?.[draggingNode]);
        interaction?.moveNode(draggingNode, x, y);
        labelLayout?.invalidatePositions();
        return;
    }
    if (!dragging) {
        updateHover();
        return;
    }
    if (draggingOrbit) {
        camera.yaw += dx * 0.006;
        camera.pitch = Math.max(-1.1, Math.min(1.1, camera.pitch + dy * 0.006));
    } else if (camera.mode3d) {
        const rect = canvas.getBoundingClientRect();
        const projection = createProjection(camera, rect.width, rect.height);
        const before = unprojectAtDepth(projection, event.clientX - dx - rect.left, event.clientY - dy - rect.top, camera.centerZ ?? 0);
        const after = unprojectAtDepth(projection, event.clientX - rect.left, event.clientY - rect.top, camera.centerZ ?? 0);
        if (before && after) {
            camera.centerX += before.x - after.x;
            camera.centerY += before.y - after.y;
        } else {
            camera.centerX -= dx / camera.scale;
            camera.centerY -= dy / camera.scale;
        }
    } else {
        camera.centerX -= dx / camera.scale;
        camera.centerY -= dy / camera.scale;
    }
});
function finishDrag(): void {
    draggingNode = null;
    dragging = false;
    draggingOrbit = false;
    canvas.classList.remove('dragging');
    canvas.classList.remove('dragging-node');
    updateHover(true);
}
canvas.addEventListener('pointerup', finishDrag);
canvas.addEventListener('pointercancel', finishDrag);
canvas.addEventListener('lostpointercapture', finishDrag);
canvas.addEventListener('pointerleave', () => {
    if (dragging || draggingNode !== null) return;
    pointerInside = false;
    updateHover();
});
canvas.addEventListener('wheel', event => {
    event.preventDefault();
    autoCameraInput.checked = false;
    if (camera.mode3d) {
        const rect = canvas.getBoundingClientRect();
        const screenX = event.clientX - rect.left;
        const screenY = event.clientY - rect.top;
        const before = unprojectAtDepth(createProjection(camera, rect.width, rect.height), screenX, screenY, camera.centerZ ?? 0);
        camera.distance = Math.max(camera.referenceDistance * 0.55,
            Math.min(camera.referenceDistance * 12, camera.distance * Math.exp(event.deltaY * 0.001)));
        const after = unprojectAtDepth(createProjection(camera, rect.width, rect.height), screenX, screenY, camera.centerZ ?? 0);
        if (before && after) {
            camera.centerX += before.x - after.x;
            camera.centerY += before.y - after.y;
        }
    } else {
        const before = screenToWorld(event.clientX, event.clientY);
        camera.scale = Math.max(0.035, Math.min(16, camera.scale * Math.exp(-event.deltaY * 0.001)));
        const after = screenToWorld(event.clientX, event.clientY);
        camera.centerX += before.x - after.x;
        camera.centerY += before.y - after.y;
    }
    pointerX = event.clientX;
    pointerY = event.clientY;
    pointerInside = true;
    updateHover(true);
}, { passive: false });
canvas.addEventListener('dblclick', fitView);

sizePreset.addEventListener('change', () => {
    if (sizePreset.value === 'custom') return;
    const [nodes, edges] = sizePreset.value.split(':');
    nodeInput.value = nodes!;
    edgeInput.value = edges!;
    generateGraph();
});
graphSource.addEventListener('change', () => {
    updateSourceControls();
    loadSelectedGraph();
});
for (const input of [nodeInput, edgeInput]) {
    input.addEventListener('input', () => { sizePreset.value = 'custom'; });
    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') generateGraph();
    });
}
topologyInput.addEventListener('change', generateGraph);
regenerateButton.addEventListener('click', loadSelectedGraph);
runLayoutInput.addEventListener('change', () => {
    saveDisplaySettings();
    if (runLayoutInput.checked) {
        if (layoutReady) updateLayoutState();
        else void prepareLayout();
    }
    else updateLayoutState();
});
layoutRateInput.addEventListener('change', () => {
    saveDisplaySettings();
    updateLayoutState();
});
resetLayoutButton.addEventListener('click', () => {
    renderer?.resetLayout();
    layoutEpoch++;
    layoutEncodeTimes.length = 0;
    if (initialNodes) refreshCpuPositions(initialNodes);
    lastSnapshotTick = 0;
    lastLayoutTick = 0;
    updateLayoutState();
    updateHover(true);
});
clearPinsButton.addEventListener('click', () => {
    renderer?.clearPins();
    updateHover(true);
});
fitButton.addEventListener('click', fitView);
edgeStyleInput.addEventListener('change', saveDisplaySettings);
showLabelsInput.addEventListener('change', saveDisplaySettings);
showNodesInput.addEventListener('change', () => {
    syncDisplayControls();
    saveDisplaySettings();
});
outlineNodesInput.addEventListener('change', () => {
    syncDisplayControls();
    saveDisplaySettings();
});
outlineWidthInput.addEventListener('input', () => {
    syncDisplayControls();
    saveDisplaySettings();
});
strokeInput.addEventListener('input', () => {
    syncDisplayControls();
    saveDisplaySettings();
});
resolutionInput.addEventListener('change', () => {
    syncDisplayControls();
    resizeCanvas();
    saveDisplaySettings();
});
autoCameraInput.addEventListener('change', () => {
    autoCenterX = camera.centerX;
    autoCenterY = camera.centerY;
    autoYaw = camera.yaw;
    autoPitch = camera.pitch;
    autoStarted = performance.now();
});
view3DInput.addEventListener('change', () => {
    syncDisplayControls();
    if (displayedGraph && 'globe' in displayedGraph && displayedGraph.globe) {
        const pinned = currentNodes && renderer
            ? Array.from({ length: currentNodes.length / 4 }, (_, index) => index).filter(index => renderer!.isPinned(index))
            : [];
        applyGraph(displayedGraph, displayedTitle);
        for (const index of pinned) renderer?.pinNode(index, currentNodes![index * 4]!,
            currentNodes![index * 4 + 1]!, depths?.[index]);
    } else renderer?.setLayoutDimensions(camera.mode3d ? 3 : 2);
    autoYaw = camera.yaw;
    autoPitch = camera.pitch;
    autoStarted = performance.now();
    updateLayoutState();
    updateHover(true);
    saveDisplaySettings();
});
window.addEventListener('keydown', event => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
    if (event.key.toLowerCase() === 'f') fitView();
    if (event.code === 'Space') {
        event.preventDefault();
        autoCameraInput.checked = !autoCameraInput.checked;
        autoCameraInput.dispatchEvent(new Event('change'));
    }
});

async function initialize(): Promise<void> {
    if (!window.isSecureContext) throw new Error('WebGPU requires HTTPS or localhost.');
    void populateExamples();
    restoreDisplaySettings();
    resizeCanvas();
    renderer = await WebGPUGraphRenderer.create(canvas, setFatal);
    adapterLabel.textContent = renderer.adapterName;
    new ResizeObserver(resizeCanvas).observe(canvas);
    loadSelectedGraph();
    requestAnimationFrame(frame);
}

initialize().catch(error => setFatal(error instanceof Error ? error.message : String(error)));
