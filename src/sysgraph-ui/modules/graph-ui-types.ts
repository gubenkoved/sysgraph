import type { GraphEdge, GraphNode } from './graph.js';

export interface FGNode extends GraphNode {
    kind?: string;
    x?: number;
    y?: number;
    z?: number;
    fx?: number;
    fy?: number;
    fz?: number;
    val?: number;
}

export interface FGLink extends GraphEdge {
    kind?: string;
    source?: string | FGNode;
    target?: string | FGNode;
    curvature?: number;
}

export interface RendererHandlers {
    onNodeClick(node: FGNode, event?: MouseEvent): void;
    onLinkClick(link: FGLink, event?: MouseEvent): void;
    onLinkRightClick(link: FGLink, event: MouseEvent): void;
    onNodeHover(node: FGNode | null): void;
    onNodeRightClick(node: FGNode, event: MouseEvent): void;
    onBackgroundRightClick(event: MouseEvent): void;
    onBackgroundClick(event: MouseEvent): void;
}
