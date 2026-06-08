import { describe, expect, it } from 'vitest';
import { Graph } from './graph.js';
import { SearchSyntaxError, search } from './search.js';

// small fixture exercising exact-match, phrases, fields, inverse and logic
function makeGraph(): Graph {
    return new Graph([
        { id: 'n1', type: 'process', properties: { name: 'node 1', pid: 100, user: 'root' } },
        { id: 'n2', type: 'process', properties: { name: 'node 2', pid: 200, user: 'root' } },
        { id: 'n10', type: 'process', properties: { name: 'node 10', pid: 300, user: 'alice' } },
        { id: 'bash', type: 'process', properties: { name: 'bash', pid: 400, user: 'alice' } },
    ]);
}

function ids(graph: Graph, expression: string): string[] {
    return search(graph, expression)
        .map(m => m.nodeId)
        .sort();
}

describe('search() - exact match', () => {
    it('matches a multi-word phrase exactly on any field', () => {
        // the reported case: ="node 1" should match only "node 1", not "node 10"
        expect(ids(makeGraph(), '="node 1"')).toEqual(['n1']);
    });

    it('matches a multi-word phrase exactly on a named field', () => {
        expect(ids(makeGraph(), 'name:="node 1"')).toEqual(['n1']);
    });

    it('matches a single-word exact term', () => {
        expect(ids(makeGraph(), '=bash')).toEqual(['bash']);
    });

    it('is case-insensitive', () => {
        expect(ids(makeGraph(), '="NODE 1"')).toEqual(['n1']);
    });

    it('matches an exact numeric field value', () => {
        expect(ids(makeGraph(), 'pid:=100')).toEqual(['n1']);
    });

    it('returns nothing when no field equals the phrase', () => {
        expect(ids(makeGraph(), '="node 99"')).toEqual([]);
    });
});

describe('search() - fuzzy and field terms', () => {
    it('matches a bare term across fields', () => {
        expect(ids(makeGraph(), 'bash')).toEqual(['bash']);
    });

    it('matches a field:value term', () => {
        expect(ids(makeGraph(), 'user:root')).toEqual(['n1', 'n2']);
    });

    it('matches a non-exact phrase fuzzily (substring tokens)', () => {
        // without the exact operator, "node 1" matches both "node 1" and
        // "node 10" because the phrase is tokenized into node AND 1
        expect(ids(makeGraph(), '"node 1"')).toEqual(['n1', 'n10']);
    });
});

describe('search() - logical operators', () => {
    it('combines terms with implicit AND (intersection)', () => {
        expect(ids(makeGraph(), 'user:alice =bash')).toEqual(['bash']);
    });

    it('combines terms with OR (union)', () => {
        expect(ids(makeGraph(), '="node 1" OR =bash')).toEqual(['bash', 'n1']);
    });

    it('supports a field-scoped inverse term', () => {
        // alice nodes whose name is not exactly bash -> n10
        expect(ids(makeGraph(), 'user:alice name:!bash')).toEqual(['n10']);
    });

    it('supports parenthesized grouping', () => {
        expect(ids(makeGraph(), '(="node 1" OR =bash) user:alice')).toEqual(['bash']);
    });
});

describe('search() - errors', () => {
    it('throws on an unknown field', () => {
        expect(() => search(makeGraph(), 'nonexistent_field:x')).toThrow(SearchSyntaxError);
    });

    it('throws on a syntax error', () => {
        expect(() => search(makeGraph(), '"unclosed')).toThrow(SearchSyntaxError);
    });
});
