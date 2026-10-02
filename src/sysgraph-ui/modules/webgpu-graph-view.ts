import * as d3 from 'd3';
import { CameraAxisOverlay } from '../engine/camera-axis.js';
import { fitCameraToPositions } from '../engine/camera-fit.js';
import { orbitPitchAroundViewRight, orbitTrackball, orbitYawAroundViewUp, orientationForCamera } from '../engine/camera-orientation.js';
import { cameraMagnification, setCameraMagnification } from '../engine/camera-zoom.js';
import type { LayoutProfile } from '../engine/force-layout.js';
import { HoverIntent } from '../engine/hover-intent.js';
import { GraphInteractionIndex } from '../engine/interaction.js';
import { createLabelAtlas, GraphLabelLayout, LABEL_FONT_REQUEST, type LabelRendering, type LabelStyle } from '../engine/labels.js';
import { screenNodeRadius } from '../engine/node-size.js';
import { createProjection, projectPoint, projectSegment, unprojectAtDepth, unprojectOnCameraPlane } from '../engine/projection.js';
import { type CameraState, WebGPUGraphRenderer } from '../engine/renderer.js';
import { calculateAutomaticLayout } from './automatic-layout.js';
import { CameraFlight, isFlightKey } from './camera-flight.js';
import { type CameraCenterTransition, cameraCenterAt } from './camera-navigation.js';
import { nodeRadius } from './constants.js';
import { seedGeodesicGlobe } from './geodesic-layout.js';
import { getNodeLabel, makeLinkDistanceFn, resolveLinkArrowLength, resolveLinkColor, resolveLinkWidth, resolveNodeColor } from './graph-ui-appearance.js';
import type { FGLink, FGNode, RendererHandlers } from './graph-ui-types.js';
import { seedInitialLayout } from './initial-layout.js';
import { adaptFastForwardBatchSize, layoutStepsForFrame } from './layout-scheduler.js';
import { settings } from './settings.js';
import { restorePlanarGeography, seedDepths } from './spatial-seeds.js';
import { state } from './state.js';
import { getTheme } from './theme.js';

/** Main application's camera, pointer and data bridge for the shared WebGPU engine. */
export class WebGPUGraphView {
    readonly canvas: HTMLCanvasElement;
    readonly ready: Promise<void>;
    private readonly badgeCanvas: HTMLCanvasElement;
    private readonly badgeContext: CanvasRenderingContext2D | null;
    private readonly cameraAxis: CameraAxisOverlay;
    private readonly warmupStatus: HTMLDivElement;
    private renderer: WebGPUGraphRenderer | null = null;
    private data: { nodes: FGNode[]; links: FGLink[] } = { nodes: [], links: [] };
    private positions = new Float32Array(0);
    private depths: Float32Array = new Float32Array(0);
    private index: GraphInteractionIndex | null = null;
    private labels: GraphLabelLayout | null = null;
    private renderedLabelStyle: LabelStyle | null = null;
    private renderedLabelRendering: LabelRendering | null = null;
    private nodeIndex = new Map<string, number>();
    private badgeNodes: Array<{ index: number; count: number }> = [];
    private badgeVersion = 0;
    private lastBadgeInput: number[] | null = null;
    private zoomHandler: ((view: { k: number }) => void) | null = null;
    private tickHandler: (() => void) | null = null;
    private stopHandler: (() => void) | null = null;
    private physics = false;
    private fastForward = false;
    private fastBatchFence: Promise<void> | null = null;
    private fastBatchSize = 1;
    private layoutReady = false;
    private layoutPreparing = false;
    private warmupPending = false;
    private revealOnFrame = false;
    private layoutKey = '';
    private distanceKey = '';
    private placementKey = '';
    private fitPending = false;
    private graphVersion = 0;
    private lastLayoutTick = 0;
    private lastSnapshot = 0;
    private lastSnapshotTick = 0;
    private hovered: number | null = null;
    private readonly hoverIntent = new HoverIntent();
    private hoverPointer: { x: number; y: number } | null = null;
    private last3DPickAt = 0;
    private pointer: { id: number; x: number; y: number; startX: number; startY: number;
        button: number; node: number | null; moved: boolean; offsetX: number; offsetY: number; offsetZ: number;
        dragPlane: { x: number; y: number; z: number } | null; startedAt: number } | null = null;
    private touchPointers: Map<number, { x: number; y: number }> | null = null;
    private touchGestureUsedMultiplePointers = false;
    private suppressContextMenuUntil = 0;
    private frameHandle = 0;
    private cameraTransition: CameraCenterTransition | null = null;
    private readonly flight = new CameraFlight();
    private lastFlightFrame = 0;
    private windowBlurHandler: (() => void) | null = null;
    private widthValue = 1;
    private heightValue = 1;
    readonly camera: CameraState = {
        centerX: 0, centerY: 0, centerZ: 0, scale: 1, stroke: 1.5, mode3d: false,
        yaw: settings.cameraProjection === 'orthographic' ? Math.PI / 4 : 0.48,
        pitch: settings.cameraProjection === 'orthographic' ? Math.atan(1 / Math.sqrt(2)) : 0.30,
        distance: 1000, referenceDistance: 1000,
        projection: settings.cameraProjection, nodeStyle: settings.nodeRenderStyle,
    };

    constructor(host: HTMLElement, private readonly handlers: RendererHandlers, mode3d: boolean) {
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'width:100%;height:100%;display:block;touch-action:none;cursor:var(--graph-cursor-grab)';
        this.canvas.tabIndex = 0;
        this.canvas.setAttribute('aria-label', mode3d
            ? '3D graph. Arrow keys fly; Shift plus an arrow orbits; drag to orbit.' : 'Graph canvas');
        this.badgeCanvas = document.createElement('canvas');
        this.badgeCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:1';
        this.badgeContext = this.badgeCanvas.getContext('2d');
        this.badgeCanvas.setAttribute('aria-hidden', 'true');
        this.warmupStatus = document.createElement('div');
        this.warmupStatus.className = 'webgpu-warmup';
        this.warmupStatus.setAttribute('role', 'status');
        this.warmupStatus.textContent = 'Preparing layout…';
        host.append(this.canvas, this.badgeCanvas, this.warmupStatus);
        this.cameraAxis = new CameraAxisOverlay(host);
        this.camera.mode3d = mode3d;
        this.ready = WebGPUGraphRenderer.create(this.canvas, message => this.showError(message)).then(renderer => {
            this.renderer = renderer;
            this.refreshTheme();
            this.uploadGraph();
            if (this.fitPending && !this.warmupPending) { this.fitPending = false; this.fitView(); }
            this.frameHandle = requestAnimationFrame(this.frame);
        }).catch(error => {
            this.showError(error instanceof Error ? error.message : String(error));
        });
        this.installInput();
        void document.fonts.load(LABEL_FONT_REQUEST).then(() => this.refreshLabels()).catch(() => {
            // The system sans-serif fallback remains usable without network fonts.
        });
    }

    private showError(message: string): void {
        console.error(message);
        let error = this.canvas.nextElementSibling as HTMLElement | null;
        if (!error?.classList.contains('webgpu-error')) {
            error = document.createElement('div');
            error.className = 'webgpu-error';
            this.canvas.after(error);
        }
        error.textContent = message;
    }

    graphData(): { nodes: FGNode[]; links: FGLink[] };
    graphData(value: { nodes: FGNode[]; links: FGLink[] }): this;
    graphData(value?: { nodes: FGNode[]; links: FGLink[] }): { nodes: FGNode[]; links: FGLink[] } | this {
        if (!value) return this.data;
        const wasEmpty = this.data.nodes.length === 0;
        const sameTopology = value.nodes.length === this.data.nodes.length &&
            value.links.length === this.data.links.length &&
            value.nodes.every((node, i) => this.nodeIndex.get(node.id) === i) &&
            value.links.every((link, i) => this.data.links[i]?.id === link.id &&
                this.data.links[i]?.source_id === link.source_id && this.data.links[i]?.target_id === link.target_id);
        this.data = value;
        this.syncAdjacencyBadges();
        if (sameTopology) {
            this.resizeNodes();
            this.refresh(); this.refreshLabels(); this.refreshSelection();
        }
        else this.uploadGraph();
        if (wasEmpty && value.nodes.length) requestAnimationFrame(() => this.fitView());
        return this;
    }

    resizeNodes(): void {
        if (this.positions.length !== this.data.nodes.length * 4) return;
        const radii = Float32Array.from(this.data.nodes, node => nodeRadius(node));
        let resized = false;
        for (let i = 0; i < radii.length; i++) {
            const offset = i * 4 + 3;
            if (Math.abs(this.positions[offset]!) === radii[i]) continue;
            this.positions[offset] = (this.positions[offset]! < 0 ? -1 : 1) * radii[i]!;
            resized = true;
        }
        if (!resized) return;
        this.renderer?.setNodeRadii(radii);
        this.index?.refreshRadiusBounds();
        this.labels?.invalidatePositions();
        this.badgeVersion++;
    }

    private uploadGraph(): void {
        if (!this.renderer) return;
        this.flight.clear();
        this.cameraTransition = null;
        this.fastBatchSize = 1;
        this.layoutReady = false;
        this.stopHandler?.();
        this.graphVersion++;
        const { nodes, links } = this.data;
        const count = nodes.length;
        const reused = nodes.reduce((total, node) => total + Number(this.nodeIndex.has(node.id)), 0);
        this.warmupPending = settings.layoutMode === 'force' && count > 1 && links.length > 0 && settings.gpuWarmupMs > 0 &&
            (this.nodeIndex.size === 0 || reused < count * 0.5);
        this.revealOnFrame = true;
        this.canvas.style.visibility = 'hidden';
        this.badgeCanvas.style.visibility = 'hidden';
        this.canvas.style.pointerEvents = 'none';
        this.cameraAxis.hide();
        this.warmupStatus.textContent = 'Preparing layout…';
        this.warmupStatus.classList.toggle('visible', this.warmupPending);
        this.nodeIndex = new Map(nodes.map((node, i) => [node.id, i]));
        const validLinks: FGLink[] = [];
        const endpoints: number[] = [];
        for (const link of links) {
            const a = this.nodeIndex.get(link.source_id);
            const b = this.nodeIndex.get(link.target_id);
            if (a === undefined || b === undefined) continue;
            link.source = nodes[a]!;
            link.target = nodes[b]!;
            endpoints.push(a, b);
            validLinks.push(link);
        }
        this.data.links = validLinks;
        const edges = Uint32Array.from(endpoints);
        const distance = makeLinkDistanceFn(settings.gpuLinkDistanceExpression, settings.gpuLinkDistance);
        let distances: Float32Array = Float32Array.from(validLinks, link =>
            settings.gpuLinkDistanceMode === 'expression' ? distance(link) : settings.gpuLinkDistance);
        const profile = this.layoutProfile();
        const globe = settings.layoutMode === 'force' && this.camera.mode3d
            ? seedGeodesicGlobe(nodes, validLinks, distances) : null;
        if (settings.layoutMode === 'force') {
            if (globe) distances = globe.chordDistances;
            else seedInitialLayout(nodes, validLinks, distances, profile);
            for (const node of nodes) if (node.fx !== undefined || node.fy !== undefined) {
                node.x = node.fx ?? node.x;
                node.y = node.fy ?? node.y;
            }
        } else {
            const placed = calculateAutomaticLayout(nodes, validLinks, {
                mode: settings.layoutMode, spacing: settings.layoutSpacing,
                rankSpacing: settings.layoutRankSpacing, direction: settings.layoutDirection,
                rootId: settings.layoutRootId,
            });
            for (let i = 0; i < count; i++) {
                nodes[i]!.x = placed[i * 2]!;
                nodes[i]!.y = placed[i * 2 + 1]!;
            }
        }
        this.positions = new Float32Array(count * 4);
        const radius = Math.max(60, Math.sqrt(count) * 32);
        for (let i = 0; i < count; i++) {
            const node = nodes[i]!;
            const angle = i * 2.399963229728653;
            const spread = Math.sqrt((i + 0.5) / Math.max(1, count)) * radius;
            node.x = Number.isFinite(node.x) ? node.x : Math.cos(angle) * spread;
            node.y = Number.isFinite(node.y) ? node.y : Math.sin(angle) * spread;
            this.positions.set([node.x!, node.y!, 0, (node.fx !== undefined || node.fy !== undefined ? -1 : 1) * nodeRadius(node)], i * 4);
        }
        this.depths = seedDepths(nodes, this.positions, globe?.depths ?? null);
        for (let i = 0; i < count; i++) {
            const node = nodes[i]!;
            node.z = this.depths[i]!;
            this.positions[i * 4 + 2] = this.depths[i]!;
        }
        this.index = new GraphInteractionIndex(this.positions, edges);
        const labels = nodes.map(node => getNodeLabel(node));
        const atlas = createLabelAtlas(labels, settings.labelStyle, settings.labelRendering);
        this.renderedLabelStyle = settings.labelStyle;
        this.renderedLabelRendering = settings.labelRendering;
        this.labels = new GraphLabelLayout(this.positions, this.index, atlas, labels, this.depths);
        this.renderer.setGraph(this.positions, edges, distances, this.depths, this.colors(), profile,
            settings.layoutMode === 'force' && this.camera.mode3d ? 3 : 2);
        this.refreshAnalyticsPath();
        this.refreshSearchHighlights();
        this.layoutKey = this.currentLayoutKey();
        this.distanceKey = this.currentDistanceKey();
        this.placementKey = this.currentPlacementKey();
        this.refreshSelection();
        this.renderer.setLabelAtlas(atlas);
        for (let i = 0; i < count; i++) {
            const node = nodes[i]!;
            if (node.fx !== undefined || node.fy !== undefined) this.renderer.pinNode(i, node.x!, node.y!, node.z);
        }
        this.resetHover();
        if (!this.warmupPending && this.fitPending) { this.fitPending = false; this.fitView(); }
        this.prepareLayout();
    }

    private syncAdjacencyBadges(): void {
        const counts = state.adjacencyFilter?.hiddenCounts;
        this.badgeNodes = counts ? this.data.nodes.flatMap((node, index) => {
            const count = counts.get(node.id) ?? 0;
            return count > 0 ? [{ index, count }] : [];
        }) : [];
        this.badgeVersion++;
    }

    private drawAdjacencyBadges(width: number, height: number, ratio: number): void {
        const context = this.badgeContext;
        if (!context) return;
        if (this.badgeNodes.length === 0) {
            if (this.badgeCanvas.width !== 1) this.badgeCanvas.width = 1;
            if (this.badgeCanvas.height !== 1) this.badgeCanvas.height = 1;
            this.lastBadgeInput = null;
            return;
        }
        const input = [width, height, ratio, this.badgeVersion, this.camera.centerX, this.camera.centerY, this.camera.centerZ ?? 0,
            this.camera.scale, Number(this.camera.mode3d), this.camera.projection === 'orthographic' ? 1 : 0,
            ...orientationForCamera(this.camera),
            this.camera.distance, this.camera.referenceDistance];
        if (this.lastBadgeInput?.every((value, index) => value === input[index])) return;
        this.lastBadgeInput = input;
        const pixelsWide = Math.max(1, Math.round(width * ratio));
        const pixelsHigh = Math.max(1, Math.round(height * ratio));
        if (this.badgeCanvas.width !== pixelsWide || this.badgeCanvas.height !== pixelsHigh) {
            this.badgeCanvas.width = pixelsWide;
            this.badgeCanvas.height = pixelsHigh;
        }
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
        context.clearRect(0, 0, width, height);
        const projection = createProjection(this.camera, width, height);
        const projected = { x: 0, y: 0, factor: 1, visible: true };
        context.font = '600 11px Ubuntu, sans-serif';
        context.textAlign = 'right';
        context.textBaseline = 'alphabetic';
        context.lineJoin = 'round';
        context.lineWidth = 2.5;
        context.strokeStyle = getTheme() === 'light' ? '#ffffff' : '#07131a';
        context.fillStyle = '#24b34f';
        for (const { index, count } of this.badgeNodes) {
            const offset = index * 4;
            projectPoint(projection, this.positions[offset]!, this.positions[offset + 1]!, this.depths[index]!, projected);
            if (!projected.visible || projected.x < 0 || projected.y < 0 ||
                projected.x >= width || projected.y >= height) continue;
            const radius = screenNodeRadius(this.positions[offset + 3]!, this.camera.scale, projected.factor,
                this.camera.mode3d ? Math.max(width, height) : undefined);
            const text = `+${count}`;
            const x = projected.x - radius - 3;
            const y = projected.y - radius - 2;
            context.strokeText(text, x, y);
            context.fillText(text, x, y);
        }
    }

    private layoutProfile(): LayoutProfile {
        return { charge: settings.gpuCharge, linkStrength: settings.gpuLinkStrength,
            collisionMultiplier: settings.gpuCollisionMultiplier, velocityDecay: settings.gpuVelocityDecay,
            forceXYStrength: settings.gpuForceXYStrength };
    }

    private colors(): { nodes: Float32Array; edges: Float32Array; widths: Float32Array; arrows: Float32Array } {
        const nodes = new Float32Array(this.data.nodes.length * 4);
        const edges = new Float32Array(this.data.links.length * 4);
        const widths = new Float32Array(this.data.links.length);
        const arrows = new Float32Array(this.data.links.length);
        const parsed = new Map<string, [number, number, number, number]>();
        const write = (array: Float32Array, index: number, value: string): void => {
            let rgba = parsed.get(value);
            if (!rgba) {
                const color = d3.color(value)?.rgb();
                rgba = color ? [color.r / 255, color.g / 255, color.b / 255, color.opacity] : [0.6, 0.8, 0.9, 1];
                parsed.set(value, rgba);
            }
            array.set(rgba, index * 4);
        };
        this.data.nodes.forEach((node, i) => {
            const searchColor = !state.analytics.active ? state.search?.matchColorsMap.get(node.id) : undefined;
            write(nodes, i, searchColor ?? resolveNodeColor(node));
        });
        this.data.links.forEach((link, i) => { write(edges, i, resolveLinkColor(link)); });
        this.data.links.forEach((link, i) => { widths[i] = Math.max(0.1, resolveLinkWidth(link)); });
        this.data.links.forEach((link, i) => { arrows[i] = resolveLinkArrowLength(link); });
        return { nodes, edges, widths, arrows };
    }

    refresh(): this {
        const styles = this.colors();
        this.renderer?.setColors(styles.nodes, styles.edges, styles.widths, styles.arrows);
        this.refreshAnalyticsPath();
        this.refreshSearchHighlights();
        this.applyFocus();
        return this;
    }
    refreshSearchHighlights(): void {
        const decoration = state.analytics.active ? state.analytics.decoration : null;
        if (decoration?.kind === 'subset' && decoration.emphasis === 'path') {
            const matches = Uint32Array.from([...decoration.nodeIds].flatMap(id => {
                const index = this.nodeIndex.get(id);
                return index === undefined ? [] : [index];
            }));
            const focused = decoration.focusedNodeId === undefined ? null : this.nodeIndex.get(decoration.focusedNodeId) ?? null;
            this.renderer?.setSearchHighlights(matches, focused);
            return;
        }
        const search = !state.analytics.active ? state.search : null;
        const matches = new Uint32Array(search?.matches.length ?? 0);
        let count = 0;
        if (search) for (const match of search.matches) {
            const index = this.nodeIndex.get(match.nodeId);
            if (index !== undefined) matches[count++] = index;
        }
        const activeId = search?.matches[search.currentMatchIndex]?.nodeId;
        this.renderer?.setSearchHighlights(matches.subarray(0, count), activeId === undefined ? null : this.nodeIndex.get(activeId) ?? null);
    }
    private refreshAnalyticsPath(): void {
        const decoration = state.analytics.active ? state.analytics.decoration : null;
        if (decoration?.kind !== 'subset' || decoration.emphasis !== 'path') {
            this.renderer?.setForegroundEdges(new Uint32Array(0));
            return;
        }
        const indices: number[] = [];
        this.data.links.forEach((edge, index) => {
            if (decoration.edgeIds.has(edge.id)) indices.push(index);
        });
        this.renderer?.setForegroundEdges(Uint32Array.from(indices));
    }
    refreshCurrentSearchMatch(): void {
        const decoration = state.analytics.active ? state.analytics.decoration : null;
        if (decoration?.kind === 'subset' && decoration.emphasis === 'path') {
            const focused = decoration.focusedNodeId === undefined ? null : this.nodeIndex.get(decoration.focusedNodeId) ?? null;
            this.renderer?.setActiveSearchHighlight(focused);
            return;
        }
        const search = !state.analytics.active ? state.search : null;
        const activeId = search?.matches[search.currentMatchIndex]?.nodeId;
        this.renderer?.setActiveSearchHighlight(activeId === undefined ? null : this.nodeIndex.get(activeId) ?? null);
    }
    refreshSelection(): void {
        this.renderer?.setDecorations(Uint32Array.from(this.data.nodes,
            node => state.selection.selectedNodeIds.has(node.id) ? 1 : 0));
    }
    syncOptions(): void {
        if (this.camera.projection !== settings.cameraProjection) {
            this.camera.projection = settings.cameraProjection;
            if (settings.cameraProjection === 'orthographic') {
                this.camera.yaw = Math.PI / 4;
                this.camera.pitch = Math.atan(1 / Math.sqrt(2));
                this.camera.orientation = orientationForCamera({ yaw: this.camera.yaw, pitch: this.camera.pitch });
            }
            if (this.camera.mode3d) this.fitView();
        }
        this.camera.nodeStyle = settings.nodeRenderStyle;
        if (this.renderedLabelStyle !== settings.labelStyle ||
            this.renderedLabelRendering !== settings.labelRendering) this.refreshLabels();
        this.applyFocus();
    }
    refreshLabels(): void {
        if (!this.renderer || !this.index) return;
        const labels = this.data.nodes.map(node => getNodeLabel(node));
        const atlas = createLabelAtlas(labels, settings.labelStyle, settings.labelRendering);
        this.labels = new GraphLabelLayout(this.positions, this.index, atlas, labels, this.depths);
        this.renderer.setLabelAtlas(atlas);
        this.renderedLabelStyle = settings.labelStyle;
        this.renderedLabelRendering = settings.labelRendering;
    }
    refreshTheme(): void {
        this.renderer?.setBackground(getTheme() === 'light'
            ? { r: 1, g: 1, b: 1, a: 1 }
            : { r: 0.025, g: 0.052, b: 0.078, a: 1 });
        this.refreshLabels();
        this.badgeVersion++;
    }
    setPhysics(value: boolean): void {
        this.physics = value && settings.layoutMode === 'force';
        if (this.physics) this.prepareLayout();
        else { this.fastForward = false; this.stopHandler?.(); }
    }
    setFastForward(value: boolean): void {
        if (value && !this.fastForward) this.fastBatchSize = 1;
        this.fastForward = value;
    }
    isFastForward(): boolean { return this.fastForward; }
    get layoutTicks(): number { return this.renderer?.layoutTicks ?? 0; }
    private currentDistanceKey(): string {
        return `${settings.gpuLinkDistanceMode}:${settings.gpuLinkDistance}:${settings.gpuLinkDistanceExpression}`;
    }
    private currentLayoutKey(): string {
        return `${settings.gpuCharge}:${settings.gpuLinkStrength}:${settings.gpuCollisionMultiplier}:` +
            `${settings.gpuVelocityDecay}:${settings.gpuForceXYStrength}`;
    }
    private currentPlacementKey(): string {
        return `${settings.layoutMode}:${settings.layoutSpacing}:${settings.layoutRankSpacing}:` +
            `${settings.layoutDirection}:${settings.layoutRootId}`;
    }
    invalidateLayout(): void { this.distanceKey = ''; }
    updateLayoutOptions(): void {
        if (this.distanceKey !== this.currentDistanceKey() || this.placementKey !== this.currentPlacementKey()) {
            this.uploadGraph();
            if (this.warmupPending) this.fitPending = true;
            else this.fitView();
        }
        else if (this.layoutKey !== this.currentLayoutKey()) {
            this.renderer?.setLayoutProfile(this.layoutProfile());
            this.layoutKey = this.currentLayoutKey();
        }
        this.setPhysics(state.physicsOverride ?? settings.gpuEnablePhysics);
    }
    reapplyLayout(): void {
        if (settings.layoutMode === 'force') {
            for (const node of this.data.nodes) if (node.fx === undefined && node.fy === undefined) {
                node.x = undefined;
                node.y = undefined;
            }
        }
        this.uploadGraph();
        if (this.warmupPending) this.fitPending = true;
        else this.fitView();
    }
    private prepareLayout(): void {
        if (!this.renderer || settings.layoutMode !== 'force' || (!this.physics && !this.warmupPending) || this.layoutReady ||
            this.layoutPreparing || !this.data.nodes.length) return;
        const active = this.renderer;
        const version = this.graphVersion;
        const isCurrent = (): boolean => active === this.renderer && version === this.graphVersion;
        this.layoutPreparing = true;
        void (async () => {
            const ready = await active.prepareLayout();
            if (!isCurrent()) return;
            this.layoutReady = ready;
            if (!this.warmupPending) return;
            if (ready) {
                await active.warmupLayout(settings.gpuWarmupMs, 240, () => isCurrent() && settings.gpuWarmupMs > 0);
                if (!isCurrent()) return;
                let snapshot = await active.snapshotPositions();
                for (let attempt = 0; snapshot === null && attempt < 10 && isCurrent(); attempt++) {
                    await new Promise<void>(resolve => setTimeout(resolve, 20));
                    snapshot = await active.snapshotPositions();
                }
                if (!isCurrent()) return;
                if (snapshot) this.acceptSnapshot(snapshot, active, version);
            }
            this.finishWarmup();
        })().catch(error => {
            if (!isCurrent()) return;
            this.physics = false;
            this.showError(`GPU layout: ${String(error)}`);
            this.finishWarmup();
        }).finally(() => {
            this.layoutPreparing = false;
            if (version !== this.graphVersion && (this.physics || this.warmupPending)) this.prepareLayout();
        });
    }
    private finishWarmup(): void {
        this.warmupPending = false;
        this.lastLayoutTick = performance.now();
        if (this.fitPending) { this.fitPending = false; this.fitView(); }
    }
    private acceptSnapshot(snapshot: Float32Array, renderer: WebGPUGraphRenderer, version: number): void {
        if (renderer !== this.renderer || version !== this.graphVersion || snapshot.length !== this.positions.length) return;
        for (let i = 0; i < this.data.nodes.length; i++) {
            const offset = i * 4 + 3;
            snapshot[offset] = (snapshot[offset]! < 0 ? -1 : 1) * nodeRadius(this.data.nodes[i]!);
        }
        this.lastSnapshotTick = renderer.layoutTicks;
        this.lastSnapshot = performance.now();
        this.positions.set(snapshot);
        for (let i = 0; i < this.depths.length; i++) this.depths[i] = snapshot[i * 4 + 2]!;
        this.badgeVersion++;
        this.index?.updatePositions(snapshot);
        this.labels?.invalidatePositions();
        for (let i = 0; i < this.data.nodes.length; i++) {
            this.data.nodes[i]!.x = snapshot[i * 4]!;
            this.data.nodes[i]!.y = snapshot[i * 4 + 1]!;
            this.data.nodes[i]!.z = snapshot[i * 4 + 2]!;
        }
    }
    pinNode(node: FGNode): void {
        const index = this.nodeIndex.get(node.id);
        if (index === undefined) return;
        this.renderer?.pinNode(index, node.x ?? 0, node.y ?? 0, node.z ?? this.depths[index]);
        this.positions[index * 4 + 3] = -Math.abs(this.positions[index * 4 + 3]!);
    }
    unpinNode(node: FGNode): void {
        const index = this.nodeIndex.get(node.id);
        if (index === undefined) return;
        this.renderer?.unpinNode(index);
        this.positions[index * 4 + 3] = Math.abs(this.positions[index * 4 + 3]!);
    }
    setMode(mode3d: boolean): void {
        if (this.camera.mode3d === mode3d) return;
        this.flight.clear();
        this.cameraTransition = null;
        if (!mode3d) restorePlanarGeography(this.data.nodes);
        this.camera.mode3d = mode3d;
        this.canvas.setAttribute('aria-label', mode3d
            ? '3D graph. Arrow keys fly; Shift plus an arrow orbits; drag to orbit.' : 'Graph canvas');
        if (mode3d) this.canvas.focus({ preventScroll: true });
        if (settings.layoutMode === 'force') {
            this.uploadGraph();
            if (this.warmupPending) this.fitPending = true;
            else this.fitView();
        }
        this.updateHover();
    }
    fitView(): void {
        this.flight?.clear();
        this.cameraTransition = null;
        if ((!this.renderer || this.warmupPending) && this.data.nodes.length) { this.fitPending = true; return; }
        if (!this.data.nodes.length) { this.camera.centerZ = 0; this.centerAt(0, 0); this.zoom(1); return; }
        const rect = this.canvas.getBoundingClientRect();
        if (rect.width <= 1 || rect.height <= 1) { this.fitPending = true; return; }
        this.widthValue = rect.width;
        this.heightValue = rect.height;
        if (!fitCameraToPositions(this.camera, this.positions, this.widthValue, this.heightValue)) {
            this.fitPending = true;
            return;
        }
        this.fitPending = false;
        this.zoomHandler?.({ k: this.zoom() });
    }
    width(): number; width(value: number): this;
    width(value?: number): number | this { if (value === undefined) return this.widthValue; this.widthValue = Math.max(1, value); return this; }
    height(): number; height(value: number): this;
    height(value?: number): number | this { if (value === undefined) return this.heightValue; this.heightValue = Math.max(1, value); return this; }
    zoom(): number; zoom(value: number, duration?: number): this;
    zoom(value?: number): number | this {
        if (value === undefined) return cameraMagnification(this.camera);
        this.cameraTransition = null;
        const magnification = setCameraMagnification(this.camera, value);
        this.zoomHandler?.({ k: magnification });
        return this;
    }
    centerAt(): { x: number; y: number }; centerAt(x: number, y: number, duration?: number): this;
    centerAt(x?: number, y?: number, duration = 0): { x: number; y: number } | this {
        if (x === undefined || y === undefined) return { x: this.camera.centerX, y: this.camera.centerY };
        this.flight?.clear();
        if (duration > 0 && Number.isFinite(duration)) {
            const now = performance.now();
            this.advanceCameraTransition(now);
            this.cameraTransition = {
                fromX: this.camera.centerX, fromY: this.camera.centerY,
                toX: x, toY: y, startedAt: now, durationMs: duration,
            };
        } else {
            this.cameraTransition = null;
            this.camera.centerX = x; this.camera.centerY = y;
        }
        return this;
    }
    /** Navigate to a rendered node using the current layout snapshot, including 3D depth. */
    centerOnNodeId(nodeId: string, duration = 500): boolean {
        const index = this.nodeIndex.get(nodeId);
        if (index === undefined) return false;
        const offset = index * 4;
        const x = this.positions[offset];
        const y = this.positions[offset + 1];
        const z = this.positions[offset + 2];
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
        this.centerAt(x!, y!, duration);
        if (this.camera.mode3d) {
            if (this.cameraTransition) {
                this.cameraTransition.fromZ = this.camera.centerZ ?? 0;
                this.cameraTransition.toZ = z;
            } else this.camera.centerZ = z!;
        }
        return true;
    }
    private advanceCameraTransition(now: number): boolean {
        if (!this.cameraTransition) return false;
        const center = cameraCenterAt(this.cameraTransition, now);
        this.camera.centerX = center.x;
        this.camera.centerY = center.y;
        if (center.z !== undefined) this.camera.centerZ = center.z;
        if (center.done) this.cameraTransition = null;
        return true;
    }
    screen2GraphCoords(x: number, y: number): { x: number; y: number } {
        if (this.camera.mode3d) {
            const point = unprojectAtDepth(createProjection(this.camera, this.widthValue, this.heightValue),
                x, y, this.camera.centerZ ?? 0);
            if (point) return point;
        }
        return { x: this.camera.centerX + (x - this.widthValue / 2) / this.camera.scale,
            y: this.camera.centerY + (y - this.heightValue / 2) / this.camera.scale };
    }
    graph2ScreenCoords(x: number, y: number): { x: number; y: number } {
        return { x: (x - this.camera.centerX) * this.camera.scale + this.widthValue / 2,
            y: (y - this.camera.centerY) * this.camera.scale + this.heightValue / 2 };
    }
    onZoom(handler: (value: { k: number }) => void): this { this.zoomHandler = handler; return this; }
    onEngineTick(handler: () => void): this { this.tickHandler = handler; return this; }
    onEngineStop(handler: () => void): this { this.stopHandler = handler; return this; }
    pick(clientX: number, clientY: number): FGNode | null {
        if (!this.index || !settings.gpuShowNodes || this.warmupPending || this.revealOnFrame) return null;
        const rect = this.canvas.getBoundingClientRect();
        const index = this.camera.mode3d
            ? this.index.pick3D(clientX - rect.left, clientY - rect.top, this.camera, this.depths, rect.width, rect.height)
            : (() => { const world = this.screen2GraphCoords(clientX - rect.left, clientY - rect.top); return this.index!.pick(world.x, world.y, this.camera.scale); })();
        return index === null ? null : this.data.nodes[index] ?? null;
    }
    openContextMenu(event: MouseEvent): void {
        event.preventDefault();
        event.stopPropagation();
        const node = this.pick(event.clientX, event.clientY);
        if (node) this.handlers.onNodeRightClick(node, event);
        else {
            const link = this.findLink(event);
            if (link) this.handlers.onLinkRightClick(link, event);
            else this.handlers.onBackgroundRightClick(event);
        }
    }
    private commitHover(index: number | null): void {
        if (index === this.hovered) return;
        this.hovered = index;
        this.applyFocus();
        this.handlers.onNodeHover(index === null ? null : this.data.nodes[index] ?? null);
        this.labels?.invalidatePositions();
    }
    private resetHover(): void {
        this.hoverIntent.reset();
        this.hoverPointer = null;
        this.last3DPickAt = 0;
        this.commitHover(null);
        this.canvas.style.cursor = state.currentTool === 'edit' ? 'crosshair' : 'var(--graph-cursor-grab)';
    }
    private updateHover(event?: { clientX: number; clientY: number }, forcePick = false): void {
        if (!event) { this.resetHover(); return; }
        this.hoverPointer = { x: event.clientX, y: event.clientY };
        const now = performance.now();
        if (!forcePick && this.camera.mode3d && now - this.last3DPickAt < 60) return;
        if (this.camera.mode3d) this.last3DPickAt = now;
        const node = this.pick(event.clientX, event.clientY);
        this.hoverIntent.observe(node ? this.nodeIndex.get(node.id) ?? null : null, now);
        this.canvas.style.cursor = node ? 'pointer' :
            state.currentTool === 'edit' ? 'crosshair' : 'var(--graph-cursor-grab)';
    }
    private advanceHoverIntent(now: number): void {
        if (this.pointer || !this.hoverPointer || !this.hoverIntent.ready(now)) return;
        // The scene may have moved since the last pointer event. Confirm the
        // same node is still under the pointer before committing a highlight.
        const node = this.pick(this.hoverPointer.x, this.hoverPointer.y);
        this.hoverIntent.observe(node ? this.nodeIndex.get(node.id) ?? null : null, now);
        this.canvas.style.cursor = node ? 'pointer' :
            state.currentTool === 'edit' ? 'crosshair' : 'var(--graph-cursor-grab)';
        const next = this.hoverIntent.advance(now);
        if (next !== undefined) this.commitHover(next);
    }
    private applyFocus(): void {
        const focused = settings.gpuShowNodes && settings.highlightOnHover && !(state.analytics.active && state.analytics.decoration)
            ? this.hovered : null;
        const neighborhood = focused !== null ? this.index?.getNeighborhood(focused) : undefined;
        this.renderer?.setFocus(focused, neighborhood?.firstHop, neighborhood?.secondHop);
    }
    private pointerWorld(event: PointerEvent, node: number,
        dragPlane: { x: number; y: number; z: number } | null = null): { x: number; y: number; z: number } {
        const rect = this.canvas.getBoundingClientRect();
        if (!this.camera.mode3d) return {
            ...this.screen2GraphCoords(event.clientX - rect.left, event.clientY - rect.top), z: 0,
        };
        const offset = node * 4;
        const plane = dragPlane ?? {
            x: this.positions[offset]!, y: this.positions[offset + 1]!, z: this.positions[offset + 2]!,
        };
        return unprojectOnCameraPlane(createProjection(this.camera, rect.width, rect.height),
            event.clientX - rect.left, event.clientY - rect.top, plane);
    }
    private findLink(event: MouseEvent): FGLink | null {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left, y = event.clientY - rect.top;
        let best = 36, result: FGLink | null = null;
        const projection = this.camera.mode3d ? createProjection(this.camera, rect.width, rect.height) : null;
        const segment = { a: { x: 0, y: 0, factor: 1, visible: true },
            b: { x: 0, y: 0, factor: 1, visible: true } };
        const projected = new Map<number, { x: number; y: number; factor: number; visible: boolean }>();
        const point = (index: number): { x: number; y: number; factor: number; visible: boolean } => {
            const cached = projected.get(index);
            if (cached) return cached;
            const node = this.data.nodes[index]!;
            const output = { x: 0, y: 0, factor: 1, visible: true };
            if (projection) projectPoint(projection, node.x ?? 0, node.y ?? 0, this.depths[index]!, output);
            else Object.assign(output, this.graph2ScreenCoords(node.x ?? 0, node.y ?? 0));
            projected.set(index, output);
            return output;
        };
        for (const link of this.data.links) {
            const a = this.nodeIndex.get(link.source_id);
            const b = this.nodeIndex.get(link.target_id);
            if (a === undefined || b === undefined) continue;
            let p = point(a);
            let q = point(b);
            if (a === b) {
                if (!p.visible) continue;
                const radius = screenNodeRadius(this.positions[a * 4 + 3]!, this.camera.scale, p.factor,
                    this.camera.mode3d ? Math.max(rect.width, rect.height) : undefined) + 9;
                const distance = Math.abs(Math.hypot(x - p.x - radius, y - p.y + radius) - radius);
                if (distance * distance < best) { best = distance * distance; result = link; }
                continue;
            }
            if (projection && this.camera.projection !== 'orthographic') {
                const source = this.data.nodes[a]!;
                const target = this.data.nodes[b]!;
                if (!projectSegment(projection, source.x ?? 0, source.y ?? 0, this.depths[a]!,
                    target.x ?? 0, target.y ?? 0, this.depths[b]!, segment)) continue;
                p = segment.a;
                q = segment.b;
            } else if (!p.visible || !q.visible) continue;
            const vx = q.x - p.x, vy = q.y - p.y;
            const t = Math.max(0, Math.min(1, ((x - p.x) * vx + (y - p.y) * vy) / Math.max(1, vx * vx + vy * vy)));
            const d = (x - p.x - vx * t) ** 2 + (y - p.y - vy * t) ** 2;
            if (d < best) { best = d; result = link; }
        }
        return result;
    }
    /** Keep the point beneath a mouse cursor or touch midpoint stable while zooming and panning. */
    private zoomBetween(previous: { x: number; y: number }, next: { x: number; y: number }, factor: number,
        rect: DOMRect): void {
        this.cameraTransition = null;
        const pivot = { x: this.camera.centerX, y: this.camera.centerY, z: this.camera.centerZ ?? 0 };
        const before = unprojectOnCameraPlane(createProjection(this.camera, rect.width, rect.height),
            previous.x - rect.left, previous.y - rect.top, pivot);
        if (Number.isFinite(factor) && factor > 0 && factor !== 1) this.zoom(this.zoom() * factor);
        const after = unprojectOnCameraPlane(createProjection(this.camera, rect.width, rect.height),
            next.x - rect.left, next.y - rect.top, pivot);
        this.camera.centerX += before.x - after.x;
        this.camera.centerY += before.y - after.y;
        if (this.camera.mode3d) this.camera.centerZ = (this.camera.centerZ ?? 0) + before.z - after.z;
    }
    private installInput(): void {
        this.canvas.addEventListener('keydown', event => {
            if (this.camera.mode3d && event.key === 'Shift') {
                this.flight.setOrbitModifier(true);
                return;
            }
            if (!this.camera.mode3d || !isFlightKey(event.key) || event.defaultPrevented ||
                event.altKey || event.ctrlKey || event.metaKey) return;
            event.preventDefault();
            this.cameraTransition = null;
            this.flight.setOrbitModifier(event.shiftKey);
            this.flight.press(event.key);
        });
        this.canvas.addEventListener('keyup', event => {
            if (event.key === 'Shift') {
                this.flight.setOrbitModifier(false);
                return;
            }
            if (!isFlightKey(event.key)) return;
            this.flight.release(event.key);
            if (this.camera.mode3d) event.preventDefault();
        });
        this.canvas.addEventListener('blur', () => this.flight.clear());
        if (typeof window !== 'undefined') {
            this.windowBlurHandler = () => this.flight.clear();
            window.addEventListener('blur', this.windowBlurHandler);
        }
        this.canvas.addEventListener('pointerdown', event => {
            const touch = event.pointerType === 'touch';
            if (!touch && event.button > 2) return;
            if (this.camera.mode3d) this.canvas.focus({ preventScroll: true });
            this.cameraTransition = null;
            this.hoverIntent.cancelPending();
            this.hoverPointer = null;
            if (touch) {
                if (!this.touchPointers) this.touchPointers = new Map();
                const touches = this.touchPointers;
                if (!touches.size) this.touchGestureUsedMultiplePointers = false;
                touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
                this.canvas.setPointerCapture(event.pointerId);
                this.resetHover();
                if (touches.size > 1) {
                    this.touchGestureUsedMultiplePointers = true;
                    this.pointer = null;
                    return;
                }
            } else if (event.button === 2) {
                this.suppressContextMenuUntil = 0;
                event.preventDefault();
            }
            // Touch drag navigates even when it starts on a node. A stationary
            // touch still selects that node on release.
            const node = !touch && event.button === 0 && !(this.camera.mode3d && event.shiftKey)
                ? this.pick(event.clientX, event.clientY) : null;
            const index = node ? this.nodeIndex.get(node.id) ?? null : null;
            const offset = index === null ? 0 : index * 4;
            const dragPlane = index !== null && this.camera.mode3d ? {
                x: this.positions[offset]!, y: this.positions[offset + 1]!, z: this.positions[offset + 2]!,
            } : null;
            const world = index !== null ? this.pointerWorld(event, index, dragPlane) : null;
            this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY,
                startX: event.clientX, startY: event.clientY, button: event.button,
                node: index, moved: false, dragPlane,
                startedAt: performance.now(),
                offsetX: node && world ? (dragPlane?.x ?? node.x ?? 0) - world.x : 0,
                offsetY: node && world ? (dragPlane?.y ?? node.y ?? 0) - world.y : 0,
                offsetZ: node && world && dragPlane ? dragPlane.z - world.z : 0 };
            if (!touch) this.canvas.setPointerCapture(event.pointerId);
        });
        this.canvas.addEventListener('pointermove', event => {
            if (event.pointerType === 'touch') {
                const touches = this.touchPointers;
                if (!touches?.has(event.pointerId)) return;
                if (touches.size >= 2) {
                    const [first, second] = [...touches.values()];
                    const previous = { x: (first!.x + second!.x) / 2, y: (first!.y + second!.y) / 2 };
                    const previousSpan = Math.hypot(first!.x - second!.x, first!.y - second!.y);
                    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
                    const [nextFirst, nextSecond] = [...touches.values()];
                    const next = { x: (nextFirst!.x + nextSecond!.x) / 2,
                        y: (nextFirst!.y + nextSecond!.y) / 2 };
                    const nextSpan = Math.hypot(nextFirst!.x - nextSecond!.x, nextFirst!.y - nextSecond!.y);
                    this.zoomBetween(previous, next, Math.max(8, nextSpan) / Math.max(8, previousSpan),
                        this.canvas.getBoundingClientRect());
                    return;
                }
                touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
            }
            const pointer = this.pointer;
            if (!pointer || pointer.id !== event.pointerId) {
                if (event.pointerType !== 'touch') this.updateHover(event);
                return;
            }
            const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
            if (!pointer.moved && Math.abs(event.clientX - pointer.startX) + Math.abs(event.clientY - pointer.startY) > 3) {
                pointer.moved = true;
                this.resetHover();
                this.canvas.style.cursor = 'var(--graph-cursor-grabbing)';
                if (pointer.button === 2) this.suppressContextMenuUntil = performance.now() + 500;
            }
            if (!pointer.moved) return;
            if (pointer.node !== null) {
                const node = this.data.nodes[pointer.node]!;
                const world = this.pointerWorld(event, pointer.node, pointer.dragPlane);
                const x = world.x + pointer.offsetX, y = world.y + pointer.offsetY;
                const z = this.camera.mode3d ? world.z + pointer.offsetZ : this.depths[pointer.node]!;
                node.x = x; node.y = y; node.fx = x; node.fy = y;
                node.z = z; node.fz = z;
                // The interaction index shares the position array. Move it
                // before changing that array so it can remove the old cell.
                this.index?.moveNode(pointer.node, x, y);
                this.depths[pointer.node] = z;
                this.positions[pointer.node * 4 + 2] = z;
                this.badgeVersion++;
                this.positions[pointer.node * 4 + 3] = -Math.abs(this.positions[pointer.node * 4 + 3]!);
                this.renderer?.pinNode(pointer.node, x, y, z);
                this.labels?.invalidatePositions();
            } else if (this.camera.mode3d && pointer.button === 0) {
                const rect = this.canvas.getBoundingClientRect();
                this.camera.orientation = orbitTrackball(orientationForCamera(this.camera),
                    pointer.x - rect.left, pointer.y - rect.top,
                    event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
            } else if (this.camera.mode3d) {
                const rect = this.canvas.getBoundingClientRect();
                const projection = createProjection(this.camera, rect.width, rect.height);
                const pivot = { x: this.camera.centerX, y: this.camera.centerY, z: this.camera.centerZ ?? 0 };
                const before = unprojectOnCameraPlane(projection, pointer.x - rect.left, pointer.y - rect.top, pivot);
                const after = unprojectOnCameraPlane(projection, event.clientX - rect.left, event.clientY - rect.top, pivot);
                this.camera.centerX += before.x - after.x;
                this.camera.centerY += before.y - after.y;
                this.camera.centerZ = (this.camera.centerZ ?? 0) + before.z - after.z;
            } else {
                this.camera.centerX -= dx / this.camera.scale;
                this.camera.centerY -= dy / this.camera.scale;
            }
            pointer.x = event.clientX; pointer.y = event.clientY;
        });
        const clickAt = (event: PointerEvent): void => {
            const node = this.pick(event.clientX, event.clientY);
            if (node) this.handlers.onNodeClick(node, event);
            else {
                const link = this.findLink(event);
                if (link) this.handlers.onLinkClick(link, event);
                else this.handlers.onBackgroundClick(event);
            }
        };
        const finishPointer = (event: PointerEvent, cancelled: boolean): void => {
            if (event.pointerType === 'touch') {
                const touches = this.touchPointers;
                if (!touches?.delete(event.pointerId)) return;
                const pointer = this.pointer?.id === event.pointerId ? this.pointer : null;
                if (pointer) this.pointer = null;
                if (touches.size === 1) {
                    // Resume a one-finger orbit or pan from the surviving finger's
                    // current position without a jump or a synthetic tap.
                    const [id, position] = touches.entries().next().value!;
                    this.pointer = { id, x: position.x, y: position.y,
                        startX: position.x, startY: position.y, button: 0, node: null, moved: true,
                        dragPlane: null, offsetX: 0, offsetY: 0, offsetZ: 0,
                        startedAt: performance.now() };
                } else if (!touches.size) {
                    if (!cancelled && !this.touchGestureUsedMultiplePointers && pointer && !pointer.moved &&
                        performance.now() - pointer.startedAt < 450) clickAt(event);
                    this.touchGestureUsedMultiplePointers = false;
                    this.resetHover();
                }
                return;
            }
            const pointer = this.pointer;
            if (!pointer || pointer.id !== event.pointerId) return;
            this.pointer = null;
            if (!cancelled && !pointer.moved && pointer.button === 0) clickAt(event);
            if (pointer.button === 2) {
                this.suppressContextMenuUntil = performance.now() + 500;
                if (!cancelled && !pointer.moved) this.openContextMenu(event);
            }
            const rect = this.canvas.getBoundingClientRect();
            if (cancelled || event.clientX < rect.left || event.clientX > rect.right ||
                event.clientY < rect.top || event.clientY > rect.bottom) this.resetHover();
            else this.updateHover(event, true);
        };
        this.canvas.addEventListener('pointerup', event => finishPointer(event, false));
        this.canvas.addEventListener('pointercancel', event => finishPointer(event, true));
        this.canvas.addEventListener('lostpointercapture', event => finishPointer(event, true));
        this.canvas.addEventListener('pointerleave', () => {
            if (!this.pointer && !this.touchPointers?.size) this.updateHover();
        });
        this.canvas.addEventListener('contextmenu', event => {
            if (this.pointer?.button === 2 || performance.now() < this.suppressContextMenuUntil) {
                event.preventDefault();
                event.stopPropagation();
                this.suppressContextMenuUntil = 0;
            } else this.openContextMenu(event);
        });
        this.canvas.addEventListener('wheel', event => {
            event.preventDefault();
            const rect = this.canvas.getBoundingClientRect();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
            const point = { x: event.clientX, y: event.clientY };
            this.zoomBetween(point, point, Math.exp(Math.max(-10, Math.min(10, -delta * 0.001))), rect);
            this.updateHover(event, true);
        }, { passive: false });
    }
    private frame = (now: number): void => {
        this.frameHandle = requestAnimationFrame(this.frame);
        const elapsedFlight = this.lastFlightFrame ? (now - this.lastFlightFrame) / 1000 : 0;
        this.lastFlightFrame = now;
        const renderer = this.renderer;
        if (!renderer || this.warmupPending) return;
        const automaticNavigation = this.advanceCameraTransition(now);
        const rect = this.canvas.getBoundingClientRect();
        this.widthValue = Math.max(1, rect.width);
        this.heightValue = Math.max(1, rect.height);
        if (this.fitPending && rect.width > 1 && rect.height > 1) this.fitView();
        if (this.camera.mode3d) {
            const { move: [dx, dy, dz], yaw, pitch } = this.flight.step(this.camera, elapsedFlight, rect.height);
            this.camera.centerX += dx;
            this.camera.centerY += dy;
            this.camera.centerZ = (this.camera.centerZ ?? 0) + dz;
            if (yaw) this.camera.orientation = orbitYawAroundViewUp(orientationForCamera(this.camera), yaw);
            if (pitch) this.camera.orientation = orbitPitchAroundViewRight(orientationForCamera(this.camera), pitch);
        }
        const ratio = Math.min(devicePixelRatio || 1, 2);
        const width = Math.max(1, Math.round(rect.width * ratio));
        const height = Math.max(1, Math.round(rect.height * ratio));
        if (this.canvas.width !== width || this.canvas.height !== height) { this.canvas.width = width; this.canvas.height = height; }
        this.advanceHoverIntent(now);
        const steps = layoutStepsForFrame({
            enabled: this.physics, ready: this.layoutReady, fastForward: this.fastForward,
            batchPending: this.fastBatchFence !== null, batchSize: this.fastBatchSize,
            now, lastTick: this.lastLayoutTick,
            rate: settings.gpuLayoutRate, nodeCount: this.data.nodes.length, edgeCount: this.data.links.length,
        });
        if (steps && !this.fastForward) this.lastLayoutTick = now;
        const search = !state.analytics.active ? state.search : null;
        const activeSearchId = search?.matches[search.currentMatchIndex]?.nodeId;
        const activeSearchIndex = activeSearchId === undefined ? null : this.nodeIndex.get(activeSearchId) ?? null;
        const decoration = state.analytics.active ? state.analytics.decoration : null;
        const activePathIndex = decoration?.kind === 'subset' && decoration.emphasis === 'path' && decoration.focusedNodeId
            ? this.nodeIndex.get(decoration.focusedNodeId) ?? null : null;
        const labelPriority = activeSearchIndex ?? activePathIndex;
        const labelFocus = this.hovered ?? (settings.labelDensity === 'focus' ? labelPriority : null);
        const labels = settings.nodeLabelMode !== 'none'
            ? this.labels?.build(this.camera, rect.width, rect.height, ratio, [], labelFocus,
                this.hovered !== null ? this.index?.getNeighbors(this.hovered) : undefined,
                labelPriority, now, settings.labelDensity === 'focus') ?? null
            : null;
        try {
            const work = renderer.draw({ ...this.camera, scale: this.camera.scale * ratio,
                stroke: settings.gpuEdgeWidth * ratio, pixelRatio: ratio },
                settings.gpuEdgeStyle, settings.gpuShowNodes, settings.gpuNodeOutline * ratio,
                width, height, labels, steps, settings.showGrid ? settings.gridStep : 0,
                settings.sceneBrightness);
            if (this.fastForward && work.layoutSteps > 0) {
                const submittedAt = performance.now();
                const version = this.graphVersion;
                const fence = renderer.whenSubmittedWorkDone();
                this.fastBatchFence = fence;
                void fence.catch(() => { /* Device loss is reported by the renderer. */ }).finally(() => {
                    if (this.fastBatchFence !== fence) return;
                    this.fastBatchFence = null;
                    if (!this.fastForward || this.renderer !== renderer || this.graphVersion !== version) return;
                    this.fastBatchSize = adaptFastForwardBatchSize(
                        this.fastBatchSize, work.layoutSteps, performance.now() - submittedAt,
                        this.data.nodes.length, this.data.links.length,
                    );
                });
            }
            this.drawAdjacencyBadges(rect.width, rect.height, ratio);
            this.cameraAxis.update(this.camera, rect.width, rect.height, now,
                this.pointer?.node === null && this.pointer.moved, automaticNavigation);
            if (this.revealOnFrame) {
                this.revealOnFrame = false;
                this.canvas.style.visibility = 'visible';
                this.badgeCanvas.style.visibility = 'visible';
                this.canvas.style.pointerEvents = '';
                this.warmupStatus.classList.remove('visible');
            }
            if (work.layoutTick) this.tickHandler?.();
            if (this.physics && this.layoutReady && work.layoutTicks !== this.lastSnapshotTick &&
                now - this.lastSnapshot > (this.fastForward ? 75 : 150)) {
                this.lastSnapshot = now;
                const version = this.graphVersion;
                void renderer.snapshotPositions().then(snapshot => {
                    if (snapshot) this.acceptSnapshot(snapshot, renderer, version);
                }).catch(error => this.showError(`GPU position readback: ${String(error)}`));
            }
        } catch (error) { this.showError(error instanceof Error ? error.message : String(error)); this.destroy(); }
    };
    destroy(): void {
        cancelAnimationFrame(this.frameHandle);
        if (this.windowBlurHandler && typeof window !== 'undefined') window.removeEventListener('blur', this.windowBlurHandler);
        this.flight.clear();
        this.renderer?.destroy(); this.renderer = null;
        this.cameraAxis.destroy(); this.canvas.remove(); this.badgeCanvas.remove(); this.warmupStatus.remove();
    }
}
