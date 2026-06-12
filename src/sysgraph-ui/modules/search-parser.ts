/**
 * Search expression parser with support for field specifiers, AND/OR logic,
 * parenthesized grouping, and double-quote escaping.
 *
 * Grammar:
 *   Expression  ::= OrExpr
 *   OrExpr      ::= AndExpr ('OR' AndExpr)*
 *   AndExpr     ::= Atom ('AND'? Atom)*         // implicit AND via adjacency
 *   Atom        ::= [FieldPath ':'] '(' Expression ')' | Term
 *   Term        ::= [FieldPath ':'] Value
 *   Value       ::= Segment+                    // adjacent segments, concatenated
 *   Segment     ::= QuotedString | BareWord
 *
 * Adjacent segments with no intervening whitespace are concatenated into a
 * single value, so a leading operator stays bound to a quoted phrase
 * (e.g. ="node 1" -> value '=node 1', name:="node 1" -> field 'name',
 * value '=node 1'). Quotes preserve internal whitespace and suppress the
 * special meaning of (, ), and the AND/OR keywords.
 *
 * A field specifier directly preceding a group (e.g. field:(A AND B)) scopes
 * the field onto every field-less term inside the group, equivalent to
 * (field:A AND field:B). Inner terms carrying their own field keep it.
 *
 * @module search-parser
 */

// ── error type ──────────────────────────────────────────────

/** Syntax error thrown when the search expression is malformed. */
export class SearchSyntaxError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SearchSyntaxError';
    }
}

// ── token types ─────────────────────────────────────────────

const TokenType = {
    LPAREN: 'LPAREN',
    RPAREN: 'RPAREN',
    AND: 'AND',
    OR: 'OR',
    TERM: 'TERM',
} as const;

type TokenTypeValue = typeof TokenType[keyof typeof TokenType];

export interface Token {
    type: TokenTypeValue;
    field?: string | null;
    pattern?: string;
}

// for an LPAREN token, an optional field scopes the group's terms

// ── AST node types ──────────────────────────────────────────

export interface TermNode {
    type: 'term';
    field: string | null;
    pattern: string;
}

export interface AndNode {
    type: 'and';
    children: AstNode[];
}

export interface OrNode {
    type: 'or';
    children: AstNode[];
}

export type AstNode = TermNode | AndNode | OrNode;

// ── tokenizer ───────────────────────────────────────────────

const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
export const INVERSE_PREFIX_RE = /^!/;

/**
 * Tokenize a search expression string into an array of tokens.
 */
function tokenize(input: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;

    while (i < input.length) {
        // skip whitespace
        if (input[i] === ' ' || input[i] === '\t') {
            i++;
            continue;
        }

        // parentheses
        if (input[i] === '(') {
            tokens.push({ type: TokenType.LPAREN });
            i++;
            continue;
        }
        if (input[i] === ')') {
            tokens.push({ type: TokenType.RPAREN });
            i++;
            continue;
        }

        // read a term: a run of adjacent bare/quoted segments with no
        // intervening whitespace, e.g. ="node 1" or name:="node 1". quoted
        // segments are concatenated into the value so the leading operator
        // (=, !, ^, ...) stays bound to the phrase, and spaces inside quotes
        // are preserved
        const seg = readSegments(input, i);
        i = seg.end;
        const parts = seg.parts;
        const raw = parts.map(p => p.value).join('');
        const hasQuoted = parts.some(p => p.quoted);
        const leadingBare = parts[0] && !parts[0].quoted ? parts[0].value : '';

        // AND/OR are only keywords as a lone, unquoted word
        if (parts.length === 1 && !hasQuoted && raw === 'AND') {
            tokens.push({ type: TokenType.AND });
            continue;
        }
        if (parts.length === 1 && !hasQuoted && raw === 'OR') {
            tokens.push({ type: TokenType.OR });
            continue;
        }

        const colonIdx = leadingBare.indexOf(':');
        const fieldCandidate = colonIdx === -1 ? '' : leadingBare.slice(0, colonIdx);

        // field-less term (no colon in the leading bare run, or invalid field)
        if (colonIdx === -1 || !FIELD_RE.test(fieldCandidate)) {
            assertNoFieldlessInverse(raw);
            tokens.push({ type: TokenType.TERM, field: null, pattern: raw });
            continue;
        }

        const bareAfterColon = leadingBare.slice(colonIdx + 1);
        const restAfterLeading = parts.slice(1).map(p => p.value).join('');

        // field:(grouped expression) - scope the field onto the group
        if (
            bareAfterColon === '' &&
            !hasQuoted &&
            parts.length === 1 &&
            i < input.length &&
            input[i] === '('
        ) {
            i++;
            tokens.push({ type: TokenType.LPAREN, field: fieldCandidate });
            continue;
        }

        // a second colon in the bare value is ambiguous (quoted colons are ok)
        if (bareAfterColon.includes(':')) {
            throw new SearchSyntaxError(
                `Ambiguous colon in "${raw}". Use quotes for values containing colons, e.g. ${fieldCandidate}:"${bareAfterColon}"`
            );
        }

        const value = bareAfterColon + restAfterLeading;
        if (value === '') {
            throw new SearchSyntaxError(
                `Missing value after "${fieldCandidate}:". Provide a search value, e.g. ${fieldCandidate}:some_value`
            );
        }

        tokens.push({ type: TokenType.TERM, field: fieldCandidate, pattern: value });
    }

    return tokens;
}

interface TermSegment {
    quoted: boolean;
    value: string;
}

/**
 * Read a run of adjacent segments (bare words and quoted strings) with no
 * intervening whitespace or parentheses. Stops at whitespace, '(', ')', or
 * end of input.
 */
function readSegments(input: string, start: number): { parts: TermSegment[]; end: number } {
    const parts: TermSegment[] = [];
    let i = start;

    while (i < input.length) {
        const c = input[i];
        if (c === ' ' || c === '\t' || c === '(' || c === ')') {
            break;
        }
        if (c === '"') {
            const str = readQuotedString(input, i);
            parts.push({ quoted: true, value: str.value });
            i = str.end;
            continue;
        }
        const word = readBareWord(input, i);
        parts.push({ quoted: false, value: word.value });
        i = word.end;
    }

    return { parts, end: i };
}

function assertNoFieldlessInverse(pattern: string): void {
    if (INVERSE_PREFIX_RE.test(pattern)) {
        throw new SearchSyntaxError(
            `Inverse match "${pattern}" requires a field specifier, e.g. field:${pattern}`
        );
    }
}

function readQuotedString(input: string, start: number): { value: string; end: number } {
    let i = start + 1;
    let value = '';
    while (i < input.length) {
        if (input[i] === '\\' && i + 1 < input.length && input[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
        }
        if (input[i] === '"') {
            return { value, end: i + 1 };
        }
        value += input[i];
        i++;
    }
    throw new SearchSyntaxError('Unclosed double quote in search expression');
}

function readBareWord(input: string, start: number): { value: string; end: number } {
    let i = start;
    while (i < input.length && input[i] !== ' ' && input[i] !== '\t'
           && input[i] !== '(' && input[i] !== ')' && input[i] !== '"') {
        i++;
    }
    return { value: input.slice(start, i), end: i };
}

// ── recursive-descent parser ────────────────────────────────

/**
 * Parse a search expression string into an AST.
 */
export function parse(expression: string): AstNode {
    const tokens = tokenize(expression.trim());

    if (tokens.length === 0) {
        return { type: 'and', children: [] };
    }

    let pos = 0;

    function peek(): Token | undefined { return tokens[pos]; }
    function advance(): Token { return tokens[pos++]!; }

    function parseOrExpr(): AstNode {
        const children = [parseAndExpr()];
        while (peek()?.type === TokenType.OR) {
            advance();
            children.push(parseAndExpr());
        }
        return children.length === 1 ? children[0]! : { type: 'or', children };
    }

    function parseAndExpr(): AstNode {
        const children = [parseAtom()];
        while (true) {
            const next = peek();
            if (!next) break;
            if (next.type === TokenType.AND) {
                advance();
                children.push(parseAtom());
                continue;
            }
            if (next.type === TokenType.TERM || next.type === TokenType.LPAREN) {
                children.push(parseAtom());
                continue;
            }
            break;
        }
        return children.length === 1 ? children[0]! : { type: 'and', children };
    }

    function parseAtom(): AstNode {
        const tok = peek();
        if (!tok) {
            throw new SearchSyntaxError('Unexpected end of expression');
        }
        if (tok.type === TokenType.LPAREN) {
            advance();
            const expr = parseOrExpr();
            const closing = peek();
            if (!closing || closing.type !== TokenType.RPAREN) {
                throw new SearchSyntaxError('Missing closing parenthesis');
            }
            advance();
            const scope = tok.field ?? null;
            return scope ? applyFieldScope(expr, scope) : expr;
        }
        if (tok.type === TokenType.TERM) {
            advance();
            return { type: 'term', field: tok.field ?? null, pattern: tok.pattern ?? '' };
        }
        throw new SearchSyntaxError(`Unexpected token "${tok.type}" in expression`);
    }

    const ast = parseOrExpr();

    if (pos < tokens.length) {
        const leftover = tokens[pos];
        if (leftover?.type === TokenType.RPAREN) {
            throw new SearchSyntaxError('Unexpected closing parenthesis');
        }
        throw new SearchSyntaxError("Unexpected token at end of expression");
    }

    return ast;
}

/**
 * Distribute a field specifier onto every field-less term within a subtree.
 * Terms that already carry an explicit field are left untouched.
 */
function applyFieldScope(node: AstNode, field: string): AstNode {
    switch (node.type) {
        case 'term':
            return node.field === null ? { ...node, field } : node;
        case 'and':
        case 'or':
            return {
                type: node.type,
                children: node.children.map(c => applyFieldScope(c, field)),
            };
    }
}
