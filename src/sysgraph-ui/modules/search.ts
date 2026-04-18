import Fuse from 'fuse.js';
import type { IFuseOptions, Expression as FuseExpression } from 'fuse.js';
import { parse, SearchSyntaxError } from './search-parser.js';
import type { AstNode } from './search-parser.js';
import type { Graph, GraphNode } from './graph.js';

export { SearchSyntaxError };

/**
 * Recursively extracts dot-separated key paths from an object.
 */
function extractKeys(object: Record<string, unknown>, maxDepth = 1): Set<string> {
    const fields = new Set<string>();

    if (maxDepth <= 0) {
        return fields;
    }

    for (const key in object) {
        const value = object[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            for (const subKey of extractKeys(value as Record<string, unknown>, maxDepth - 1)) {
                fields.add(`${key}.${subKey}`);
            }
        } else {
            fields.add(key);
        }
    }
    return fields;
}

/** Represents a single search match for a node. */
export class Match {
    readonly nodeId: string;
    /** Lower is better (0 = exact match). */
    readonly score: number;

    constructor(nodeId: string, score: number) {
        this.nodeId = nodeId;
        this.score = score;
    }
}

/**
 * Build a Fuse.js instance for the given graph nodes, discovering all
 * searchable keys at depth 2.
 */
function buildFuse(graph: Graph): { fuse: Fuse<GraphNode>; allKeys: Set<string> } {
    const allKeys = new Set<string>();
    for (const node of graph.getNodes()) {
        for (const key of extractKeys(node as unknown as Record<string, unknown>, 2)) {
            allKeys.add(key);
        }
    }

    const fuseOptions: IFuseOptions<GraphNode> = {
        includeScore: true,
        includeMatches: true,
        findAllMatches: true,
        // controls fuzziness - 0 = exact match, higher = more fuzzy
        threshold: 0.1,
        useExtendedSearch: true,
        ignoreLocation: true,
        keys: [...allKeys],
    };

    return { fuse: new Fuse(graph.getNodes(), fuseOptions), allKeys };
}

/**
 * Find all discovered keys that contain the field specifier
 * (case-insensitive substring match).
 */
function resolveField(field: string, allKeys: Set<string>): string[] {
    const fieldLower = field.toLowerCase();
    const matches: string[] = [];
    for (const k of allKeys) {
        if (k.toLowerCase().includes(fieldLower)) {
            matches.push(k);
        }
    }
    return matches;
}

/**
 * Convert our parsed AST into a Fuse.js Expression object.
 */
function astToFuseExpression(node: AstNode, allKeys: Set<string>): FuseExpression {
    switch (node.type) {
        case 'term': {
            if (node.field) {
                const keys = resolveField(node.field, allKeys);
                if (keys.length === 0) {
                    return { id: '=\x00__no_match__' };
                }
                if (keys.length === 1) {
                    return { [keys[0]!]: node.pattern } as FuseExpression;
                }
                return { $or: keys.map(k => ({ [k]: node.pattern } as FuseExpression)) };
            }
            return node.pattern;
        }
        case 'and': {
            if (node.children.length === 1) {
                return astToFuseExpression(node.children[0]!, allKeys);
            }
            return { $and: node.children.map(c => astToFuseExpression(c, allKeys)) };
        }
        case 'or': {
            if (node.children.length === 1) {
                return astToFuseExpression(node.children[0]!, allKeys);
            }
            return { $or: node.children.map(c => astToFuseExpression(c, allKeys)) };
        }
        default: {
            const _exhaustive: never = node;
            throw new Error(`Unknown AST node type: ${(_exhaustive as AstNode).type}`);
        }
    }
}

/**
 * Performs a search across all graph nodes using Fuse.js, supporting an
 * advanced expression grammar with field specifiers, AND/OR operators,
 * parenthesized grouping, and double-quote escaping.
 */
export function search(graph: Graph, expression: string): Match[] {
    const { fuse, allKeys } = buildFuse(graph);
    const ast = parse(expression);

    console.log('search AST', ast);

    const fuseExpr = astToFuseExpression(ast, allKeys);

    console.log('fuse expression', fuseExpr);

    const results = fuse.search(fuseExpr);
    const matches = results.map(r => new Match(r.item.id, r.score ?? 0));

    console.log('search matches', matches);

    return matches;
}
