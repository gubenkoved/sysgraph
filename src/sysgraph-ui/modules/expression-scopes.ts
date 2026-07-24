// Shared scope definitions for the six user expression fields. Each scope is
// the (params, spread) pair handed to buildScopedExpression: `params` are the
// values injected in order, `spread` are the object names whose keys are
// exposed as bare identifiers (later names win). These MUST stay identical
// between the real evaluators (graph-ui-appearance.ts, analytics-helpers.ts)
// and the expression editor's preview/autocomplete so the two never drift.

export interface ExpressionScope {
    // ordered names of the values passed to the compiled function
    readonly params: readonly string[];
    // entity/injected object names whose keys become bare identifiers
    readonly spread: readonly string[];
}

// node label — helpers < properties < node so a well-known node key always wins
export const NODE_LABEL_SCOPE: ExpressionScope = {
    params: ['node', 'properties', 'helpers'],
    spread: ['helpers', 'properties', 'node'],
};

// node sizing — properties < node; the computed degree is injected
export const NODE_SIZING_SCOPE: ExpressionScope = {
    params: ['node', 'properties', 'degree'],
    spread: ['properties', 'node'],
};

// link distance — properties < edge; resolved endpoint nodes are injected
export const LINK_DISTANCE_SCOPE: ExpressionScope = {
    params: ['edge', 'properties', 'source', 'target'],
    spread: ['properties', 'edge'],
};

// node filter — helpers < properties < node; the computed degree is injected
export const NODE_FILTER_SCOPE: ExpressionScope = {
    params: ['node', 'properties', 'degree', 'helpers'],
    spread: ['helpers', 'properties', 'node'],
};

// edge filter — helpers < properties < edge
export const EDGE_FILTER_SCOPE: ExpressionScope = {
    params: ['edge', 'properties', 'helpers'],
    spread: ['helpers', 'properties', 'edge'],
};

// edge weight — properties < edge; no helpers injected
export const EDGE_WEIGHT_SCOPE: ExpressionScope = {
    params: ['edge', 'properties'],
    spread: ['properties', 'edge'],
};
