import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import SpriteText from 'three-spritetext';
import {
    D3_CHARGE_STRENGTH,
    D3_LINK_DISTANCE, D3_LINK_STRENGTH,
    SEARCH_COLOR_BEST,
    UI_FONT_FAMILY,
} from './constants.js';
import {
    colorAdjustAlpha,
    edgeColorFor,
    getNodeLabel,
    isNodePinned,
    linkTooltip,
    nodeTooltip,
    resolveLinkArrowLength,
    resolveLinkColor,
    resolveLinkCurvature,
    resolveLinkWidth,
    resolveNodeColor,
} from './graph-ui-appearance.js';
import type { FGLink, FGNode, ForceGraph3DInstance, ForceGraphInstance, RendererHandlers } from './graph-ui-types.js';
import { settings } from './settings.js';
import { state } from './state.js';
import { getTheme } from './theme.js';

// 3D WebGL renderer backed by 3d-force-graph. It reuses the shared appearance
// accessors so nodes and links are colored identically to the 2D renderer, and
// keeps the library's built-in dimension-aware forces (re-tuned to match 2D).

// height of the 3D label text in world units (the 2D label font size is in
// screen pixels, so it can't be reused directly)
const LABEL_TEXT_HEIGHT_3D = 5;

// search standout cues (3D only): non-matches are faded so the matches
// (bright-colored and pulsing) pop out of the depth-stacked scene.
// extra alpha factor applied on top of the shared non-match dim (multiplied),
// applied consistently to BOTH non-match nodes and edges so the graph dims
// uniformly while a search is active
const SEARCH_NON_MATCH_EXTRA_DIM_3D = 0.6;

// search-match pulse: matched nodes "breathe" via a sine-driven scale so they
// stand out through motion (the 3D analogue of the 2D pulsing ring). the whole
// node object (sphere + label) scales uniformly, so the label stays
// proportionally clear of the sphere and never bumps into it
const SEARCH_PULSE_AMPLITUDE_3D = 0.18; // ±18% scale swing
const SEARCH_PULSE_FREQ_3D = 1.5; // Hz

// origin axis cross (3D analogue of the 2D center cross): half-length of each
// axis line in world units, and the red tint mirroring the 2D center color
const AXIS_CROSS_HALF_3D = 25;
const AXIS_CROSS_COLOR = 0xff5050;
const AXIS_CROSS_OPACITY = 0.35;

// the origin axis cross, kept module-level so its visibility can be toggled by
// the showGrid setting (see updateAxisCross3D)
let axisCross: { visible: boolean } | null = null;

/**
 * Builds a persistent text sprite for a node's label, honoring the current
 * label mode, outline toggle and theme. Returns undefined when the node has no
 * label so the default sphere is used unadorned. The 2D renderer paints labels
 * straight onto the canvas; in 3D each label is its own scene object.
 */
function buildNodeLabelSprite(node: FGNode): SpriteText | undefined {
    const text = getNodeLabel(node);
    if (!text) return undefined;

    const dark = getTheme() === 'dark';
    const sprite = new SpriteText(text);
    sprite.textHeight = LABEL_TEXT_HEIGHT_3D;
    // match the 2D canvas labels (Ubuntu first); fontFace feeds the canvas font
    // string directly, so a full family fallback list is fine
    sprite.fontFace = UI_FONT_FAMILY;
    sprite.fontWeight = 'bold';
    sprite.color = dark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.85)';
    if (settings.nodeLabelOutline) {
        // contrasting halo, mirroring the 2D label outline
        sprite.strokeWidth = 2;
        sprite.strokeColor = dark ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
    }

    // three ships no type declarations here, so SpriteText's inherited
    // THREE.Sprite members (material, center) aren't visible to TS; they exist
    // at runtime
    const spriteObj = sprite as unknown as {
        material: { depthWrite: boolean };
        center: { x: number; y: number };
    };

    // render the label on top of the scene geometry so the node sphere never
    // occludes it as the camera orbits (matches the official text-nodes example)
    spriteObj.material.depthWrite = false;

    // offset the label below the node via the sprite's normalized center anchor
    // rather than a world-space position offset. `center` lives in the sprite's
    // own (always camera-facing) plane, so the label keeps a consistent
    // screen-space placement under the node from every viewing angle; a world
    // offset would instead swing the label around the node as you rotate.
    // center.y default 0.5 (centered on the node); center.y = 1 hangs the
    // sprite's top edge at the node, and each extra unit of sprite-height pushes
    // it further down — so add (radius + gap)/spriteHeight to clear the sphere
    const radius = Math.cbrt(Math.max(node.val ?? 1, 1)) * 6;
    const lineCount = text.split('\n').length;
    const spriteHeight = lineCount * LABEL_TEXT_HEIGHT_3D;
    const gap = LABEL_TEXT_HEIGHT_3D / 2;
    spriteObj.center.x = 0.5;
    spriteObj.center.y = 1 + (radius + gap) / spriteHeight;
    return sprite;
}

/**
 * 3D node-color accessor. The 2D renderer signals search hits with an animated
 * pulsing ring plus dimmed non-matches; the 3D renderer has no per-frame canvas
 * hook, so it instead makes hits pop by (a) painting matched nodes in their
 * bright search match color and (b) fading non-matches a bit further than the
 * shared 2D logic, so the matches stand out against the depth-stacked spheres.
 * Matched nodes also pulse (see pulseSearchMatches3D).
 */
function resolveNodeColor3D(node: FGNode): string {
    const decoration = state.analytics.active ? state.analytics.decoration : null;
    const searchActive = state.search && !state.highlight && !decoration;
    if (searchActive) {
        if (state.search?.matchesMap.has(node.id)) {
            return state.search.matchColorsMap.get(node.id) ?? SEARCH_COLOR_BEST;
        }
        // resolveNodeColor already applies the shared non-match dim; fade it
        // a little further so matches clearly stand out in the 3D scene
        return colorAdjustAlpha(resolveNodeColor(node), SEARCH_NON_MATCH_EXTRA_DIM_3D);
    }
    return resolveNodeColor(node);
}

/**
 * 3D link-color accessor. resolveLinkColor already dims every edge by the shared
 * search opacity; this fades them by the same extra factor as non-match nodes
 * so edges and nodes dim uniformly during a search (otherwise the much darker
 * nodes against normally-dimmed edges looks inconsistent).
 */
function resolveLinkColor3D(link: FGLink): string {
    const decoration = state.analytics.active ? state.analytics.decoration : null;
    const searchActive = state.search && !state.highlight && !decoration;
    if (searchActive) {
        return colorAdjustAlpha(resolveLinkColor(link), SEARCH_NON_MATCH_EXTRA_DIM_3D);
    }
    return resolveLinkColor(link);
}

/**
 * Cheap color refresh for the 3D renderer. Re-applies only the node/link color
 * accessors, which triggers the library's material update digest. Crucially it
 * does NOT rebuild the per-node label sprites — unlike the library's refresh(),
 * which flushes and recreates every node three-object (regenerating a canvas
 * texture per label). That full rebuild is far too heavy to run on every search
 * keystroke for large graphs.
 */
export function refreshColors3D(fg: ForceGraphInstance): void {
    const fg3d = fg as unknown as ForceGraph3DInstance;
    fg3d.nodeColor(resolveNodeColor3D).linkColor(resolveLinkColor3D);
}

// node ids currently driven by the search pulse, so they can be reset to their
// resting scale once they stop matching (or the search clears)
let pulsedNodeIds = new Set<string>();

// minimal shape of the per-node scene object: the default sphere mesh (the
// node's __threeObj), with the label sprite added as a child
interface PulseChild {
    isSprite?: boolean;
    scale: { x: number; y: number; z: number; set(x: number, y: number, z: number): void };
    // base (resting) scale captured the first time we pulse this sprite, so the
    // label can be counter-scaled back to a constant on-screen size
    __pulseBaseScale?: { x: number; y: number; z: number };
}
interface PulseObj {
    scale: { set(x: number, y: number, z: number): void };
    children: PulseChild[];
}

/**
 * Scales a matched node's sphere by `s` while keeping its label text a constant
 * size. The label sprite is a child of the sphere mesh, so it inherits the
 * sphere's scale; we counter-scale the sprite by 1/s (relative to its captured
 * resting scale) so only the sphere "breathes" and the text never resizes.
 * `s === 1` restores the resting state.
 */
function setNodeScale(node: FGNode, s: number): void {
    const obj = (node as unknown as { __threeObj?: PulseObj }).__threeObj;
    if (!obj) return;
    obj.scale.set(s, s, s);
    for (const child of obj.children) {
        if (!child.isSprite) continue;
        // capture the resting scale once (before we ever touch it), so a freshly
        // rebuilt sprite always counter-scales against its own true base
        if (!child.__pulseBaseScale) {
            child.__pulseBaseScale = { x: child.scale.x, y: child.scale.y, z: child.scale.z };
        }
        const base = child.__pulseBaseScale;
        child.scale.set(base.x / s, base.y / s, base.z / s);
    }
}

/**
 * Per-frame search-match pulse — the 3D analogue of the 2D pulsing ring. The 3D
 * renderer has no per-frame canvas hook, so this is driven by the shared rAF
 * loop in graph-ui. It "breathes" each matched node's sphere with a sine wave
 * so matches catch the eye through motion, on top of the color emphasis. The
 * label text is kept at a constant size (see setNodeScale). Non-matching nodes
 * that were previously pulsing are reset to their resting scale.
 */
export function pulseSearchMatches3D(fg: ForceGraphInstance): void {
    const decoration = state.analytics.active ? state.analytics.decoration : null;
    const matches = state.search && !state.highlight && !decoration ? state.search.matchesMap : null;
    const nodes = fg.graphData().nodes as FGNode[];

    // no active search: release any nodes still held at a pulsed scale
    if (!matches || matches.size === 0) {
        if (pulsedNodeIds.size > 0) {
            for (const n of nodes) {
                if (pulsedNodeIds.has(n.id)) setNodeScale(n, 1);
            }
            pulsedNodeIds.clear();
        }
        return;
    }

    const pulse = 1 + SEARCH_PULSE_AMPLITUDE_3D
        * Math.sin((Date.now() / 1000) * 2 * Math.PI * SEARCH_PULSE_FREQ_3D);

    const stillPulsed = new Set<string>();
    for (const n of nodes) {
        if (matches.has(n.id)) {
            setNodeScale(n, pulse);
            stillPulsed.add(n.id);
        } else if (pulsedNodeIds.has(n.id)) {
            setNodeScale(n, 1);
        }
    }
    pulsedNodeIds = stillPulsed;
}

// ---------------------------------------------------------------------------
// Pinned-node indicator (3D)
// ---------------------------------------------------------------------------
// the 2D renderer draws a double ring around pinned nodes every frame; the 3D
// renderer has no per-frame canvas hook, so a pinned node instead grows a small
// burst of spikes radiating from its center (an "anchored" cue). the spikes are
// a child of the node sphere, toggled from the shared rAF loop, so the cue
// appears/clears instantly on pin/unpin with no expensive object rebuild.

// six axial directions for the spike burst
const PIN_SPIKE_DIRS = [
    [1, 0, 0], [-1, 0, 0],
    [0, 1, 0], [0, -1, 0],
    [0, 0, 1], [0, 0, -1],
];

// minimal structural view of the three objects we touch (three is untyped here)
interface SceneObject {
    parent?: SceneObject | null;
    children: { geometry?: { dispose(): void }; material?: { dispose(): void } }[];
    add(o: unknown): void;
    remove(o: unknown): void;
}

// neutral, theme-aware marker color (mirrors the neutral 2D pin rings); kept
// independent of the selection/search/edit accents so it never reads as those
function pinSpikeStyle(): { color: string; opacity: number } {
    return getTheme() === 'dark'
        ? { color: '#ffffff', opacity: 0.92 }
        : { color: '#1a1a1a', opacity: 0.85 };
}

// builds a spike burst sized to the node's sphere radius
function buildPinSpikes(node: FGNode): SceneObject {
    const radius = Math.cbrt(Math.max(node.val ?? 1, 1)) * 6;
    const spikeLen = Math.max(radius * 0.9, 6);
    const spikeBase = Math.max(radius * 0.22, 1.5);
    const { color, opacity } = pinSpikeStyle();

    // one geometry + material shared by all six cones of this node
    const geom = new THREE.ConeGeometry(spikeBase, spikeLen, 10);
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity });
    const group = new THREE.Group();
    const up = new THREE.Vector3(0, 1, 0);

    for (const [dx, dy, dz] of PIN_SPIKE_DIRS) {
        const dir = new THREE.Vector3(dx, dy, dz).normalize();
        const cone = new THREE.Mesh(geom, mat);
        // cones point +Y by default; aim each one outward along its axis
        cone.quaternion.setFromUnitVectors(up, dir);
        // base flush with the sphere surface, tip pointing out
        cone.position.copy(dir.clone().multiplyScalar(radius + spikeLen / 2));
        group.add(cone);
    }
    return group as unknown as SceneObject;
}

function disposePinSpikes(group: SceneObject): void {
    for (const child of group.children) {
        child.geometry?.dispose();
        child.material?.dispose();
    }
}

// tracks the theme the currently-attached spikes were colored for, so a theme
// switch rebuilds them in the new color
let lastPinTheme = getTheme();

/**
 * Per-frame pinned-node indicator sync. Attaches a spike burst to pinned nodes
 * and removes it from unpinned ones. Re-attaches after a node object rebuild
 * (e.g. theme change / data refresh discards the sphere and its children) and
 * recolors the spikes when the theme changes. Driven by the shared rAF loop.
 */
export function updatePinIndicators3D(fg: ForceGraphInstance): void {
    const theme = getTheme();
    const themeChanged = theme !== lastPinTheme;
    lastPinTheme = theme;

    for (const n of fg.graphData().nodes as FGNode[]) {
        const holder = n as FGNode & { __threeObj?: SceneObject; __pinSpikes?: SceneObject };
        const sphere = holder.__threeObj;

        // theme switch: drop cached spikes so they rebuild in the new color
        if (themeChanged && holder.__pinSpikes) {
            holder.__pinSpikes.parent?.remove(holder.__pinSpikes);
            disposePinSpikes(holder.__pinSpikes);
            holder.__pinSpikes = undefined;
        }

        if (isNodePinned(n) && sphere) {
            if (!holder.__pinSpikes) holder.__pinSpikes = buildPinSpikes(n);
            // (re)attach if missing or orphaned by a sphere rebuild
            if (holder.__pinSpikes.parent !== sphere) sphere.add(holder.__pinSpikes);
        } else if (holder.__pinSpikes?.parent) {
            holder.__pinSpikes.parent.remove(holder.__pinSpikes);
        }
    }
}

// ---------------------------------------------------------------------------
// Adjacency hidden-count badge (3D)
// ---------------------------------------------------------------------------
// the 2D renderer draws a "+N" badge under nodes whose neighbors are hidden by
// the adjacency filter; the 3D renderer mounts an equivalent text sprite above
// each such node. it is synced from the shared rAF loop (no rebuild) and only
// regenerates its text when the count actually changes.

// world-unit height of the badge text (matches the 3D label scale)
const ADJ_BADGE_TEXT_HEIGHT_3D = 4.5;
// green "+N" badge, mirroring the 2D hidden-count color
const ADJ_BADGE_COLOR = 'rgb(8, 168, 8)';

interface AdjBadgeSprite extends SceneObject {
    text: string;
    textHeight: number;
    fontFace: string;
    fontWeight: string;
    color: string;
    strokeWidth: number;
    strokeColor: string;
    material: { depthWrite: boolean };
    center: { x: number; y: number };
}

function buildAdjBadge(node: FGNode): AdjBadgeSprite {
    const sprite = new SpriteText('') as unknown as AdjBadgeSprite;
    sprite.textHeight = ADJ_BADGE_TEXT_HEIGHT_3D;
    sprite.fontFace = UI_FONT_FAMILY;
    sprite.fontWeight = 'bold';
    sprite.color = ADJ_BADGE_COLOR;
    // contrasting halo so the count stays legible over any node color
    sprite.strokeWidth = 3;
    sprite.strokeColor = getTheme() === 'dark' ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)';
    sprite.material.depthWrite = false;
    // float the badge just above the node sphere (mirror of the below-node
    // label anchor: a negative center.y pushes the sprite up by its own height)
    const radius = Math.cbrt(Math.max(node.val ?? 1, 1)) * 6;
    const gap = ADJ_BADGE_TEXT_HEIGHT_3D / 2;
    sprite.center.x = 0.5;
    sprite.center.y = -(radius + gap) / ADJ_BADGE_TEXT_HEIGHT_3D;
    return sprite;
}

/**
 * Per-frame adjacency hidden-count badge sync. While the adjacency filter is
 * active, shows a "+N" sprite above each visible node that has hidden neighbors,
 * updating the text only when the count changes and re-attaching after a node
 * object rebuild. Removes the badge when the filter clears or the count drops to
 * zero. Driven by the shared rAF loop.
 */
export function updateAdjacencyCounts3D(fg: ForceGraphInstance): void {
    const counts = state.adjacencyFilter?.hiddenCounts ?? null;

    for (const n of fg.graphData().nodes as FGNode[]) {
        const holder = n as FGNode & {
            __threeObj?: SceneObject;
            __adjBadge?: AdjBadgeSprite;
            __adjBadgeCount?: number;
        };
        const sphere = holder.__threeObj;
        const count = counts?.get(n.id) ?? 0;

        if (count > 0 && sphere) {
            if (!holder.__adjBadge) holder.__adjBadge = buildAdjBadge(n);
            const badge = holder.__adjBadge;
            // only rewrite the text (which regenerates the canvas texture) when
            // the count actually changes
            if (holder.__adjBadgeCount !== count) {
                badge.text = `+${count}`;
                holder.__adjBadgeCount = count;
            }
            if (badge.parent !== sphere) sphere.add(badge);
        } else if (holder.__adjBadge?.parent) {
            holder.__adjBadge.parent.remove(holder.__adjBadge);
            holder.__adjBadgeCount = undefined;
        }
    }
}

// ---------------------------------------------------------------------------
// Analytics heatmap value labels (3D)
// ---------------------------------------------------------------------------
// the 2D renderer draws the raw per-node value (e.g. distance/degree) under
// each node when the analytics "show values" tweaker is on; the 3D renderer
// mounts an equivalent text sprite below each heatmap node. it is synced from
// the shared rAF loop (no rebuild) and only regenerates its text when the value
// actually changes. the sprite hangs below the node's label sprite so the two
// never overlap.

// world-unit height of the value text (slightly smaller than the node label)
const VALUE_TEXT_HEIGHT_3D = 4;

interface ValueSprite extends SceneObject {
    text: string;
    textHeight: number;
    fontFace: string;
    fontWeight: string;
    color: string;
    strokeWidth: number;
    strokeColor: string;
    material: { depthWrite: boolean };
    center: { x: number; y: number };
}

// theme-aware value text + contrasting halo, mirroring the 2D value labels
function valueSpriteStyle(): { color: string; strokeColor: string } {
    return getTheme() === 'dark'
        ? { color: 'rgba(255,255,255,0.95)', strokeColor: 'rgba(0,0,0,0.85)' }
        : { color: 'rgba(0,0,0,0.9)', strokeColor: 'rgba(255,255,255,0.9)' };
}

function buildValueSprite(node: FGNode): ValueSprite {
    const sprite = new SpriteText('') as unknown as ValueSprite;
    sprite.textHeight = VALUE_TEXT_HEIGHT_3D;
    sprite.fontFace = UI_FONT_FAMILY;
    sprite.fontWeight = 'bold';
    const { color, strokeColor } = valueSpriteStyle();
    sprite.color = color;
    sprite.strokeWidth = 2;
    sprite.strokeColor = strokeColor;
    sprite.material.depthWrite = false;
    // hang the value below the node, clearing the sphere AND the label sprite
    // (which already hangs below the node — see buildNodeLabelSprite). center.y
    // is in sprite-height units: 1 puts the value's top edge at the node center,
    // each extra unit pushes it further down (mirror of the label anchor)
    const radius = Math.cbrt(Math.max(node.val ?? 1, 1)) * 6;
    const labelText = getNodeLabel(node);
    const labelLines = labelText ? labelText.split('\n').length : 0;
    const labelHeight = labelLines * LABEL_TEXT_HEIGHT_3D;
    const labelGap = LABEL_TEXT_HEIGHT_3D / 2;
    const valueGap = VALUE_TEXT_HEIGHT_3D / 2;
    // distance from the node center down to the value sprite's top edge
    const drop = radius + labelGap + labelHeight + valueGap;
    sprite.center.x = 0.5;
    sprite.center.y = 1 + drop / VALUE_TEXT_HEIGHT_3D;
    return sprite;
}

// tracks the theme the currently-attached value sprites were colored for, so a
// theme switch rebuilds them in the new color
let lastValueTheme = getTheme();

/**
 * Per-frame analytics heatmap value-label sync. While a heatmap decoration with
 * "show values" on is active, shows the raw value sprite below each node that
 * has one, updating the text only when it changes and re-attaching after a node
 * object rebuild. Removes the sprite when the decoration clears, "show values"
 * is turned off, or the node has no value. Driven by the shared rAF loop.
 */
export function updateHeatmapValues3D(fg: ForceGraphInstance): void {
    const decoration = state.analytics.active ? state.analytics.decoration : null;
    const labels = decoration?.kind === 'heatmap' && decoration.showValues
        ? decoration.nodeLabels ?? null
        : null;

    const theme = getTheme();
    const themeChanged = theme !== lastValueTheme;
    lastValueTheme = theme;

    for (const n of fg.graphData().nodes as FGNode[]) {
        const holder = n as FGNode & {
            __threeObj?: SceneObject;
            __valueSprite?: ValueSprite;
            __valueText?: string;
        };
        const sphere = holder.__threeObj;
        const text = labels?.get(n.id);

        // theme switch: drop cached sprite so it rebuilds in the new color
        if (themeChanged && holder.__valueSprite) {
            holder.__valueSprite.parent?.remove(holder.__valueSprite);
            holder.__valueSprite = undefined;
            holder.__valueText = undefined;
        }

        if (text !== undefined && sphere) {
            if (!holder.__valueSprite) holder.__valueSprite = buildValueSprite(n);
            const sprite = holder.__valueSprite;
            // only rewrite the text (which regenerates the canvas texture) when
            // the value actually changes
            if (holder.__valueText !== text) {
                sprite.text = text;
                holder.__valueText = text;
            }
            if (sprite.parent !== sphere) sphere.add(sprite);
        } else if (holder.__valueSprite?.parent) {
            holder.__valueSprite.parent.remove(holder.__valueSprite);
            holder.__valueText = undefined;
        }
    }
}


/**
 * Adds three axis lines through the origin to the scene — the 3D analogue of
 * the 2D center cross — so the graph's center stays locatable while orbiting.
 * Gated by the shared `showGrid` setting (toggled live via updateAxisCross3D).
 */
function addAxisCross3D(fg3d: ForceGraph3DInstance): void {
    const scene = (fg3d as unknown as { scene(): SceneObject }).scene();
    const h = AXIS_CROSS_HALF_3D;
    const mat = new THREE.LineBasicMaterial({
        color: new THREE.Color(AXIS_CROSS_COLOR),
        transparent: true,
        opacity: AXIS_CROSS_OPACITY,
    });
    const points = [
        new THREE.Vector3(-h, 0, 0), new THREE.Vector3(h, 0, 0),
        new THREE.Vector3(0, -h, 0), new THREE.Vector3(0, h, 0),
        new THREE.Vector3(0, 0, -h), new THREE.Vector3(0, 0, h),
    ];
    // LineSegments draws each consecutive vertex pair as an independent segment,
    // so the three axes render as a cross rather than one connected polyline
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const cross = new THREE.LineSegments(geom, mat) as { visible: boolean };
    cross.visible = settings.showGrid;
    axisCross = cross;
    scene.add(cross);
}

/** Syncs the origin cross visibility with the `showGrid` setting (per frame). */
export function updateAxisCross3D(): void {
    if (axisCross) axisCross.visible = settings.showGrid;
}

/**
 * Builds the 3D renderer mounted into `host`, sized to the host's bounding box.
 * Interaction callbacks come from `handlers` (owned by the orchestrator) so this
 * module stays free of circular dependencies on graph-ui.
 */
export function build3DRenderer(host: HTMLElement, handlers: RendererHandlers): ForceGraphInstance {
    const fg3d = new ForceGraph3D(host) as unknown as ForceGraph3DInstance;
    fg3d
        .nodeId('id')
        .graphData({ nodes: [], links: [] })
        .nodeRelSize(6)
        .nodeColor(resolveNodeColor3D)
        .nodeOpacity(0.9)
        .nodeLabel(nodeTooltip)
        // persistent label sprite added alongside the default sphere
        .nodeThreeObjectExtend(true)
        .nodeThreeObject(buildNodeLabelSprite)
        .linkColor(resolveLinkColor)
        .linkWidth(resolveLinkWidth)
        .linkCurvature(resolveLinkCurvature)
        .linkOpacity(0.6)
        .linkLabel(linkTooltip)
        .linkDirectionalParticleColor((l: FGLink) => edgeColorFor(l))
        .linkDirectionalParticles(0)
        .linkDirectionalArrowLength(resolveLinkArrowLength)
        .linkDirectionalArrowRelPos(0.55)
        .onNodeClick(handlers.onNodeClick)
        .onLinkClick(handlers.onLinkClick)
        .onNodeDrag(handlers.onNodeDrag)
        .onNodeDragEnd(handlers.onNodeDrag)
        .onNodeRightClick(handlers.onNodeRightClick)
        .onLinkRightClick(handlers.onLinkRightClick)
        .onBackgroundRightClick(handlers.onBackgroundRightClick)
        .onBackgroundClick(handlers.onBackgroundClick)
        // suppress the library's built-in navigation hint overlay
        .showNavInfo(false)
        // transparent so the theme-aware #graph CSS background shows through
        .backgroundColor('rgba(0,0,0,0)');

    // reconfigure the library's built-in 3D force scalars to match the 2D
    // tuning; we deliberately keep its dimension-aware force objects rather than
    // swapping in the 2D d3 forces, which only act on x/y
    const charge = fg3d.d3Force('charge') as
        | { strength(s: number): unknown }
        | undefined;
    charge?.strength(D3_CHARGE_STRENGTH);
    const link = fg3d.d3Force('link') as
        | { distance(d: number): { strength(s: number): unknown } }
        | undefined;
    link?.distance(D3_LINK_DISTANCE).strength(D3_LINK_STRENGTH);

    const rect = host.getBoundingClientRect();
    fg3d.width(rect.width).height(rect.height);

    // origin axis cross — the 3D analogue of the 2D center cross
    addAxisCross3D(fg3d);

    // TrackballControls derives rotation by normalising the pointer delta
    // against a cached viewport (`controls.screen`) that it only computes in its
    // constructor via handleResize(). 3d-force-graph never calls handleResize()
    // again when the canvas is resized, so after our width()/height() call (and
    // any later dock-driven resize) `screen` is stale — rotation then divides by
    // the wrong/zero viewport and silently does nothing, while wheel-zoom (which
    // ignores `screen`) keeps working. refresh it now and on every host resize
    refresh3DControlsViewport(fg3d);
    const resizeObserver = new ResizeObserver(() => refresh3DControlsViewport(fg3d));
    resizeObserver.observe(host);

    // the library auto-starts its render loop, but the engine's very first
    // animation tick can fire before the (batched) graphData digest initialises
    // the force layout. that tick then throws inside the library's tickFrame
    // (reading the not-yet-created layout) and, because tickFrame runs before
    // the loop reschedules its rAF and before controls.update(), it leaves the
    // render loop dead — which freezes the orbit/zoom/pan controls. re-kick the
    // loop once on the next frame, by when the layout exists, so navigation
    // works. pauseAnimation() clears the stale frame id the crash left behind so
    // resumeAnimation() actually restarts the cycle. also refresh the controls
    // viewport again, since the canvas now has its settled size
    requestAnimationFrame(() => {
        fg3d.pauseAnimation().resumeAnimation();
        refresh3DControlsViewport(fg3d);
    });

    return fg3d as unknown as ForceGraphInstance;
}

// re-syncs TrackballControls' cached viewport (`screen`) with the real canvas
// size so rotation math stays correct after resizes (see build3DRenderer)
function refresh3DControlsViewport(fg3d: ForceGraph3DInstance): void {
    const controls = (fg3d as unknown as {
        controls(): { handleResize?: () => void };
    }).controls();
    controls.handleResize?.();
}

// ---------------------------------------------------------------------------
// Camera helpers
// ---------------------------------------------------------------------------

/** Fits the whole graph into the 3D view. */
export function recenter3D(fg: ForceGraphInstance, durationMs: number): void {
    (fg as unknown as ForceGraph3DInstance).zoomToFit(durationMs);
}

// comfortable standoff range (world units) kept between the camera and a
// focused node, so cycling matches never slams the camera right up against a
// node nor leaves it uselessly far away
const FOCUS_MIN_DISTANCE = 120;
const FOCUS_MAX_DISTANCE = 600;
// default focus distance when the current camera distance can't be derived
const FOCUS_FALLBACK_DISTANCE = 300;

/**
 * Glides the 3D camera to center the given node while preserving the user's
 * current viewing angle and zoom distance. Rather than snapping to a fixed
 * offset along the node's radial direction (which both over-zooms and whips the
 * camera to a new angle), it keeps the existing direction-to-target and
 * distance — only clamped into a comfortable range — so pressing Enter feels
 * like a smooth pan to the next match at the same zoom, preserving the user's
 * spatial orientation.
 */
export function focusNode3D(fg: ForceGraphInstance, node: FGNode, durationMs: number): void {
    const fg3d = fg as unknown as ForceGraph3DInstance;
    const camApi = fg as unknown as {
        cameraPosition(): { x: number; y: number; z: number };
        controls(): { target?: { x: number; y: number; z: number } };
    };

    const n = node as FGNode & { z?: number };
    const target = { x: node.x ?? 0, y: node.y ?? 0, z: n.z ?? 0 };

    const cam = camApi.cameraPosition();
    const lookAt = camApi.controls().target ?? { x: 0, y: 0, z: 0 };

    // current view direction (from look-at toward the camera) and distance
    let dx = cam.x - lookAt.x;
    let dy = cam.y - lookAt.y;
    let dz = cam.z - lookAt.z;
    let dist = Math.hypot(dx, dy, dz);

    if (dist < 1e-6) {
        // degenerate (camera sitting on its target): fall back to the node's
        // radial direction from the origin, or a fixed axis if that is zero too
        dx = target.x;
        dy = target.y;
        dz = target.z;
        dist = Math.hypot(dx, dy, dz);
        if (dist < 1e-6) {
            dx = 0;
            dy = 0;
            dz = 1;
            dist = 1;
        }
    }

    // preserve the user's zoom (current distance), only clamped so we never end
    // up jammed against the node or absurdly far out
    const standoff = Math.min(FOCUS_MAX_DISTANCE, Math.max(FOCUS_MIN_DISTANCE, dist || FOCUS_FALLBACK_DISTANCE));
    const k = standoff / dist;

    fg3d.cameraPosition(
        { x: target.x + dx * k, y: target.y + dy * k, z: target.z + dz * k },
        target,
        durationMs,
    );
}
