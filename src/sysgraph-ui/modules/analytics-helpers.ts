import type { EdgeWeightFn } from './analytics-algs.js';
import { buildScopedExpression } from './expression.js';
import { EDGE_WEIGHT_SCOPE } from './expression-scopes.js';
import type { GraphEdge } from './graph.js';

/**
 * Default edge-weight expression. Prefers a numeric `length`, then a numeric
 * `weight`, and falls back to 1 when neither is present, so unweighted graphs
 * still produce sensible results.
 */
export const DEFAULT_EDGE_WEIGHT_EXPRESSION =
    'Number(properties.length) || Number(properties.weight) || 1';

/**
 * Compiles an edge-weight expression into a weight function. The expression is
 * evaluated with `edge` and each of its `properties` exposed as bare
 * identifiers (mirroring the node/link expression mechanism); well-known edge
 * keys win over a same-named property. On any error the weight falls back to 1.
 */
export function makeEdgeWeightFn(expression: string): EdgeWeightFn {
    const expr = expression.trim() || DEFAULT_EDGE_WEIGHT_EXPRESSION;
    let compiled: ((...args: unknown[]) => unknown) | null = null;
    try {
        // properties < edge so well-known edge keys win over a same-named property
        compiled = buildScopedExpression(expr, EDGE_WEIGHT_SCOPE.params, EDGE_WEIGHT_SCOPE.spread);
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
        buildScopedExpression(expr, EDGE_WEIGHT_SCOPE.params, EDGE_WEIGHT_SCOPE.spread);
        return null;
    } catch (err) {
        return err instanceof Error ? err.message : 'invalid expression';
    }
}
