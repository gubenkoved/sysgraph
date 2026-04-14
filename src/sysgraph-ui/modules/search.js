import Fuse from 'fuse.js';
import { parse, SearchSyntaxError } from './search-parser.js';

export { SearchSyntaxError };


/**
 * Recursively extracts dot-separated key paths from an object.
 * @param {Object} object
 * @param {number} [maxDepth=1]
 * @returns {Set<string>}
 */
function extractKeys(object, maxDepth = 1) {
    const fields = new Set();

    if (maxDepth <= 0) {
        return fields;
    }

    for (const key in object) {
        const value = object[key]
        if (value && typeof value == 'object') {
            for (const subKey of extractKeys(value, maxDepth - 1)) {
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
    /**
     * @param {string} nodeId
     * @param {number} score - Lower is better (0 = exact match).
     */
    constructor(nodeId, score) {
        this.nodeId = nodeId;
        this.score = score;
    }
}


/**
 * Build a Fuse.js instance for the given graph nodes, discovering all
 * searchable keys at depth 2.
 * @param {import('./graph.js').Graph} graph
 * @returns {{ fuse: Fuse, allKeys: Set<string> }}
 */
function buildFuse(graph) {
    const allKeys = new Set();
    for (const node of graph.getNodes()) {
        for (const key of extractKeys(node, 2)) {
            allKeys.add(key);
        }
    }

    const fuseOptions = {
        includeScore: true,
        includeMatches: true,
        findAllMatches: true,
        threshold: 0,
        useExtendedSearch: true,
        ignoreLocation: true,
        keys: [...allKeys],
    };

    return { fuse: new Fuse(graph.getNodes(), fuseOptions), allKeys };
}


/**
 * Find all discovered keys that contain the field specifier
 * (case-insensitive substring match).
 *
 * Examples (specifier → matching keys):
 *   "role"  → "role", "properties.role"
 *   "ipv4"  → "properties.ipv4_subnet", "ipv4_address"
 *
 * @param {string} field
 * @param {Set<string>} allKeys
 * @returns {string[]}
 */
function resolveField(field, allKeys) {
    const fieldLower = field.toLowerCase();
    const matches = [];
    for (const k of allKeys) {
        if (k.toLowerCase().includes(fieldLower)) {
            matches.push(k);
        }
    }
    return matches;
}


/**
 * Convert our parsed AST into a Fuse.js Expression object.
 *
 * Fuse.js Expression types:
 *   - string                    → all-keys search
 *   - { [key]: string }         → field-specific search
 *   - { $and: Expression[] }    → logical AND
 *   - { $or:  Expression[] }    → logical OR
 *
 * @param {import('./search-parser.js').AstNode} node
 * @param {Set<string>} allKeys
 * @returns {Object} A Fuse.js Expression object.
 */
function astToFuseExpression(node, allKeys) {
    switch (node.type) {
        case 'term': {
            if (node.field) {
                const keys = resolveField(node.field, allKeys);
                if (keys.length === 0) {
                    // No matching keys — return an expression that matches nothing.
                    return { id: '=\x00__no_match__' };
                }
                if (keys.length === 1) {
                    return { [keys[0]]: node.pattern };
                }
                // Multiple matching keys — OR them
                return { $or: keys.map(k => ({ [k]: node.pattern })) };
            }
            // All-keys search: pass as plain string
            return node.pattern;
        }
        case 'and': {
            if (node.children.length === 1) {
                return astToFuseExpression(node.children[0], allKeys);
            }
            return { $and: node.children.map(c => astToFuseExpression(c, allKeys)) };
        }
        case 'or': {
            if (node.children.length === 1) {
                return astToFuseExpression(node.children[0], allKeys);
            }
            return { $or: node.children.map(c => astToFuseExpression(c, allKeys)) };
        }
        default:
            throw new Error(`Unknown AST node type: ${node.type}`);
    }
}


/**
 * Performs a search across all graph nodes using Fuse.js, supporting an
 * advanced expression grammar with field specifiers, AND/OR operators,
 * parenthesized grouping, and double-quote escaping.
 *
 * The parsed AST is converted into a Fuse.js logical Expression object
 * so that Fuse handles AND/OR evaluation and score computation natively.
 *
 * @param {import('./graph.js').Graph} graph
 * @param {string} expression
 * @returns {Match[]}
 * @throws {SearchSyntaxError} on malformed expressions.
 */
export function search(graph, expression) {
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
