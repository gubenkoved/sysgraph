/**
 * Search expression parser with support for field specifiers, AND/OR logic,
 * parenthesized grouping, and double-quote escaping.
 *
 * Grammar:
 *   Expression  ::= OrExpr
 *   OrExpr      ::= AndExpr ('OR' AndExpr)*
 *   AndExpr     ::= Atom ('AND'? Atom)*         // implicit AND via adjacency
 *   Atom        ::= '(' Expression ')' | Term
 *   Term        ::= [FieldPath ':'] Value
 *   Value       ::= QuotedString | BareWord
 *
 * @module search-parser
 */

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** Syntax error thrown when the search expression is malformed. */
export class SearchSyntaxError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SearchSyntaxError';
    }
}

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// AST node types
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;
const INVERSE_PREFIX_RE = /^!/;

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

        if (input[i] === '"') {
            const str = readQuotedString(input, i);
            i = str.end;
            assertNoFieldlessInverse(str.value);
            tokens.push({ type: TokenType.TERM, field: null, pattern: str.value });
            continue;
        }

        // bare word (or field:value)
        const word = readBareWord(input, i);
        i = word.end;
        const raw = word.value;

        if (raw === 'AND') {
            tokens.push({ type: TokenType.AND });
            continue;
        }
        if (raw === 'OR') {
            tokens.push({ type: TokenType.OR });
            continue;
        }

        const colonIdx = raw.indexOf(':');
        if (colonIdx === -1) {
            assertNoFieldlessInverse(raw);
            tokens.push({ type: TokenType.TERM, field: null, pattern: raw });
            continue;
        }

        const fieldCandidate = raw.slice(0, colonIdx);
        const valueAfterColon = raw.slice(colonIdx + 1);

        if (!FIELD_RE.test(fieldCandidate)) {
            assertNoFieldlessInverse(raw);
            tokens.push({ type: TokenType.TERM, field: null, pattern: raw });
            continue;
        }

        // case 1: field:"quoted value"
        if (valueAfterColon === '' && i < input.length && input[i] === '"') {
            const str = readQuotedString(input, i);
            i = str.end;
            tokens.push({ type: TokenType.TERM, field: fieldCandidate, pattern: str.value });
            continue;
        }

        // case 2: field:bareValue
        if (valueAfterColon.includes(':')) {
            throw new SearchSyntaxError(
                `Ambiguous colon in "${raw}". Use quotes for values containing colons, e.g. ${fieldCandidate}:"${valueAfterColon}"`
            );
        }

        if (valueAfterColon === '') {
            throw new SearchSyntaxError(
                `Missing value after "${fieldCandidate}:". Provide a search value, e.g. ${fieldCandidate}:some_value`
            );
        }

        tokens.push({ type: TokenType.TERM, field: fieldCandidate, pattern: valueAfterColon });
    }

    return tokens;
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

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------

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
            return expr;
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
