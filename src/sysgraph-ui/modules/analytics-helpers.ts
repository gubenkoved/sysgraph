import type { EdgeWeightFn } from './analytics-algs.js';
import type { GraphEdge } from './graph.js';

/**
 * Default edge-weight expression. Falls back to 1 when no numeric `weight`
 * property is present, so unweighted graphs still produce sensible results.
 */
export const DEFAULT_EDGE_WEIGHT_EXPRESSION = 'Number(properties.weight) || 1';

/**
 * Compiles an edge-weight expression into a weight function. The expression is
 * evaluated with `edge` and its `properties` in scope (mirroring the node-size
 * expression mechanism). On any error the weight falls back to 1.
 */
export function makeEdgeWeightFn(expression: string): EdgeWeightFn {
    const expr = expression.trim() || DEFAULT_EDGE_WEIGHT_EXPRESSION;
    let compiled: ((edge: GraphEdge, properties: Record<string, unknown>) => unknown) | null = null;
    try {
        compiled = new Function(
            'edge',
            'properties',
            `with(properties){return (${expr})}`,
        ) as (edge: GraphEdge, properties: Record<string, unknown>) => unknown;
    } catch {
        compiled = null;
    }

    return (edge: GraphEdge): number => {
        if (!compiled) return 1;
        try {
            const value = compiled(edge, edge.properties ?? {});
            const num = Number(value);
            return Number.isFinite(num) ? num : 1;
        } catch {
            return 1;
        }
    };
}

/**
 * Validates an edge-weight expression by attempting to compile it. Returns an
 * error message when the expression is syntactically invalid, otherwise null.
 */
export function validateEdgeWeightExpression(expression: string): string | null {
    const expr = expression.trim() || DEFAULT_EDGE_WEIGHT_EXPRESSION;
    try {
        new Function('edge', 'properties', `with(properties){return (${expr})}`);
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : 'invalid expression';
    }
}
