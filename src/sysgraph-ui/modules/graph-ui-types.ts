import type { ForceGraph3DInstance as ForceGraph3DGenericInstance } from '3d-force-graph';
import type { ForceGraphGeneric, LinkObject, NodeObject } from 'force-graph';

// ── custom node / link types shared by the 2D and 3D renderers ─

export interface FGNode extends NodeObject {
    id: string;
    type: string;
    properties?: Record<string, unknown>;
    kind?: string;
    val?: number;
    source_id?: string;
    target_id?: string;
}

export interface FGLink extends LinkObject<FGNode> {
    id: string;
    type: string;
    properties?: Record<string, unknown>;
    kind?: string;
    curvature?: number;
    source_id?: string;
    target_id?: string;
}

// Force-graph exposes d3ReheatSimulation / d3VelocityDecay / refresh / d3AlphaTarget /
// cooldownTime at runtime but some are absent from its shipped .d.ts. We extend it here.
type FGBaseType<N extends NodeObject, L extends LinkObject<N>> = ForceGraphGeneric<FGBaseType<N, L>, N, L>;
export type ForceGraphInstance = FGBaseType<FGNode, FGLink> & {
    refresh(): ForceGraphInstance;
    d3AlphaTarget(target: number): ForceGraphInstance;
    cooldownTime(ms: number): ForceGraphInstance;
};

// 3d-force-graph instance specialized to our node/link shapes. Its accessor API
// overlaps heavily with the 2D force-graph, so the shared accessor/handler
// functions are reused by both renderers.
export type ForceGraph3DInstance = ForceGraph3DGenericInstance<FGNode, FGLink>;

/**
 * Interaction callbacks both renderers wire to their pointer events. The
 * orchestrator (graph-ui.ts) owns the implementations — they touch the active
 * instance, context menus and app state — and passes them into each renderer
 * builder so the builders stay free of those dependencies.
 */
export interface RendererHandlers {
    onNodeClick(node: FGNode, event?: MouseEvent): void;
    onLinkClick(link: FGLink, event?: MouseEvent): void;
    onLinkRightClick(link: FGLink, event: MouseEvent): void;
    onNodeDrag(node: FGNode): void;
    onNodeHover(node: FGNode | null): void;
    onNodeRightClick(node: FGNode, event: MouseEvent): void;
    onBackgroundRightClick(event: MouseEvent): void;
    onBackgroundClick(event: MouseEvent): void;
}
