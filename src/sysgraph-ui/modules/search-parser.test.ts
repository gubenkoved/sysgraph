import { describe, expect, it } from 'vitest';
import { parse, SearchSyntaxError } from './search-parser.js';

describe('parse() - basic terms', () => {
    it('parses a bare term', () => {
        expect(parse('node')).toEqual({
            type: 'term',
            field: null,
            pattern: 'node',
        });
    });

    it('parses a field:value term', () => {
        expect(parse('name:bash')).toEqual({
            type: 'term',
            field: 'name',
            pattern: 'bash',
        });
    });

    it('parses a quoted phrase as a single field-less term', () => {
        expect(parse('"node 1"')).toEqual({
            type: 'term',
            field: null,
            pattern: 'node 1',
        });
    });

    it('parses a field:"quoted phrase" term', () => {
        expect(parse('name:"node 1"')).toEqual({
            type: 'term',
            field: 'name',
            pattern: 'node 1',
        });
    });

    it('parses an empty expression as an empty AND', () => {
        expect(parse('')).toEqual({ type: 'and', children: [] });
    });
});

describe('parse() - logical operators', () => {
    it('treats adjacency as implicit AND', () => {
        expect(parse('a b')).toEqual({
            type: 'and',
            children: [
                { type: 'term', field: null, pattern: 'a' },
                { type: 'term', field: null, pattern: 'b' },
            ],
        });
    });

    it('parses explicit AND', () => {
        expect(parse('a AND b')).toEqual({
            type: 'and',
            children: [
                { type: 'term', field: null, pattern: 'a' },
                { type: 'term', field: null, pattern: 'b' },
            ],
        });
    });

    it('parses OR', () => {
        expect(parse('a OR b')).toEqual({
            type: 'or',
            children: [
                { type: 'term', field: null, pattern: 'a' },
                { type: 'term', field: null, pattern: 'b' },
            ],
        });
    });

    it('binds AND tighter than OR', () => {
        expect(parse('a b OR c')).toEqual({
            type: 'or',
            children: [
                {
                    type: 'and',
                    children: [
                        { type: 'term', field: null, pattern: 'a' },
                        { type: 'term', field: null, pattern: 'b' },
                    ],
                },
                { type: 'term', field: null, pattern: 'c' },
            ],
        });
    });
});

describe('parse() - grouping', () => {
    it('parses a parenthesized group', () => {
        expect(parse('(a OR b) c')).toEqual({
            type: 'and',
            children: [
                {
                    type: 'or',
                    children: [
                        { type: 'term', field: null, pattern: 'a' },
                        { type: 'term', field: null, pattern: 'b' },
                    ],
                },
                { type: 'term', field: null, pattern: 'c' },
            ],
        });
    });

    it('distributes a field specifier onto a group', () => {
        expect(parse('name:(a OR b)')).toEqual({
            type: 'or',
            children: [
                { type: 'term', field: 'name', pattern: 'a' },
                { type: 'term', field: 'name', pattern: 'b' },
            ],
        });
    });

    it('keeps inner explicit fields when scoping a group', () => {
        expect(parse('name:(a OR pid:b)')).toEqual({
            type: 'or',
            children: [
                { type: 'term', field: 'name', pattern: 'a' },
                { type: 'term', field: 'pid', pattern: 'b' },
            ],
        });
    });
});

describe('parse() - inverse match', () => {
    it('parses a field-scoped inverse term', () => {
        expect(parse('name:!bash')).toEqual({
            type: 'term',
            field: 'name',
            pattern: '!bash',
        });
    });

    it('rejects a field-less inverse term', () => {
        expect(() => parse('!bash')).toThrow(SearchSyntaxError);
    });

    it('rejects a field-less quoted inverse term', () => {
        expect(() => parse('"!bash"')).toThrow(SearchSyntaxError);
    });
});

describe('parse() - errors', () => {
    it('rejects an ambiguous double colon', () => {
        expect(() => parse('a:b:c')).toThrow(SearchSyntaxError);
    });

    it('rejects an unclosed quote', () => {
        expect(() => parse('"abc')).toThrow(SearchSyntaxError);
    });

    it('rejects a missing value after a field colon', () => {
        expect(() => parse('name:')).toThrow(SearchSyntaxError);
    });

    it('rejects a missing closing parenthesis', () => {
        expect(() => parse('(a OR b')).toThrow(SearchSyntaxError);
    });

    it('rejects an unexpected closing parenthesis', () => {
        expect(() => parse('a)')).toThrow(SearchSyntaxError);
    });
});

describe('parse() - exact match operator with quotes', () => {
    it('parses a bare exact-match term', () => {
        expect(parse('=node')).toEqual({
            type: 'term',
            field: null,
            pattern: '=node',
        });
    });

    it('binds the exact-match operator to a quoted phrase', () => {
        // ="node 1" should mean a single exact-match term on the phrase
        // "node 1" (quotes only used to include the space), not
        // (= AND "node 1")
        expect(parse('="node 1"')).toEqual({
            type: 'term',
            field: null,
            pattern: '=node 1',
        });
    });

    it('binds the exact-match operator to a field-scoped quoted phrase', () => {
        expect(parse('name:="node 1"')).toEqual({
            type: 'term',
            field: 'name',
            pattern: '=node 1',
        });
    });

    it('concatenates a prefix word directly followed by a quote', () => {
        expect(parse('foo"bar baz"')).toEqual({
            type: 'term',
            field: null,
            pattern: 'foobar baz',
        });
    });
});
