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
 * - AND/OR keywords are uppercase only.
 * - Double quotes suppress all special meaning inside (colons, keywords, parens).
 * - Bare terms with multiple colons (e.g. ip:dead:beef) are illegal — use ip:"dead:beef".
 * - Backslash escapes inside quotes: \" → literal "
 *
 * @module search-parser
 */

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

/** Syntax error thrown when the search expression is malformed. */
export class SearchSyntaxError extends Error {
    /** @param {string} message */
    constructor(message) {
        super(message);
        this.name = 'SearchSyntaxError';
    }
}

// ---------------------------------------------------------------------------
// Token types
// ---------------------------------------------------------------------------

/** @enum {string} */
const TokenType = {
    LPAREN: 'LPAREN',
    RPAREN: 'RPAREN',
    AND: 'AND',
    OR: 'OR',
    TERM: 'TERM', // { field: string|null, pattern: string }
};

/**
 * @typedef {Object} Token
 * @property {string} type - One of TokenType values.
 * @property {string|null} [field] - For TERM tokens: optional field path.
 * @property {string} [pattern] - For TERM tokens: the search pattern.
 */

// ---------------------------------------------------------------------------
// Tokenizer
// ---------------------------------------------------------------------------

const FIELD_RE = /^[a-zA-Z_][a-zA-Z0-9_.]*$/;

/**
 * Tokenize a search expression string into an array of tokens.
 * @param {string} input
 * @returns {Token[]}
 * @throws {SearchSyntaxError}
 */
function tokenize(input) {
    /** @type {Token[]} */
    const tokens = [];
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

        // quoted string — could be a bare quoted term or the value part of
        // a field:\"...\" token (handled below when we encounter a bare word
        // followed by colon followed by quote). When we see a leading quote
        // without a prior field, it is a full quoted term (no field).
        if (input[i] === '"') {
            const str = readQuotedString(input, i);
            i = str.end;
            tokens.push({ type: TokenType.TERM, field: null, pattern: str.value });
            continue;
        }

        // bare word (or field:value)
        const word = readBareWord(input, i);
        i = word.end;
        const raw = word.value; // never empty — readBareWord guarantees ≥1 char

        // check for AND / OR keywords (uppercase only, standalone words)
        if (raw === 'AND') {
            tokens.push({ type: TokenType.AND });
            continue;
        }
        if (raw === 'OR') {
            tokens.push({ type: TokenType.OR });
            continue;
        }

        // check for field:value pattern
        const colonIdx = raw.indexOf(':');
        if (colonIdx === -1) {
            // plain term, no colon at all
            tokens.push({ type: TokenType.TERM, field: null, pattern: raw });
            continue;
        }

        const fieldCandidate = raw.slice(0, colonIdx);
        const valueAfterColon = raw.slice(colonIdx + 1);

        if (!FIELD_RE.test(fieldCandidate)) {
            // left side of colon is not a valid field name → treat whole thing
            // as a plain term (e.g. Fuse operator patterns "=foo:bar" won't hit
            // this because they don't start with a letter/underscore)
            tokens.push({ type: TokenType.TERM, field: null, pattern: raw });
            continue;
        }

        // field is valid — now determine the value

        // case 1: field:"quoted value" — the value portion is empty in the
        // bare word and the next char in input is a quote
        if (valueAfterColon === '' && i < input.length && input[i] === '"') {
            const str = readQuotedString(input, i);
            i = str.end;
            tokens.push({ type: TokenType.TERM, field: fieldCandidate, pattern: str.value });
            continue;
        }

        // case 2: field:bareValue — ensure no more colons in the value
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

/**
 * Read a double-quoted string starting at position `start` (which must be '"').
 * Supports backslash escaping: \" → literal "
 * @param {string} input
 * @param {number} start
 * @returns {{ value: string, end: number }} value without quotes; end is index after closing quote.
 * @throws {SearchSyntaxError}
 */
function readQuotedString(input, start) {
    let i = start + 1; // skip opening quote
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

/**
 * Read a bare (unquoted) word — everything up to whitespace, '(', ')', or '"'.
 * Bare words may contain colons (validated later).
 * @param {string} input
 * @param {number} start
 * @returns {{ value: string, end: number }}
 */
function readBareWord(input, start) {
    let i = start;
    while (i < input.length && input[i] !== ' ' && input[i] !== '\t'
           && input[i] !== '(' && input[i] !== ')' && input[i] !== '"') {
        i++;
    }
    return { value: input.slice(start, i), end: i };
}

// ---------------------------------------------------------------------------
// AST node types
// ---------------------------------------------------------------------------

/**
 * @typedef {{ type: 'term', field: string|null, pattern: string }} TermNode
 * @typedef {{ type: 'and', children: AstNode[] }} AndNode
 * @typedef {{ type: 'or', children: AstNode[] }} OrNode
 * @typedef {TermNode | AndNode | OrNode} AstNode
 */

// ---------------------------------------------------------------------------
// Recursive-descent parser
// ---------------------------------------------------------------------------

/**
 * Parse a search expression string into an AST.
 * @param {string} expression
 * @returns {AstNode}
 * @throws {SearchSyntaxError}
 */
export function parse(expression) {
    const tokens = tokenize(expression.trim());

    if (tokens.length === 0) {
        return { type: 'and', children: [] };
    }

    let pos = 0;

    /** @returns {Token|undefined} */
    function peek() { return tokens[pos]; }
    /** @returns {Token} */
    function advance() { return tokens[pos++]; }

    /**
     * OrExpr ::= AndExpr ('OR' AndExpr)*
     * @returns {AstNode}
     */
    function parseOrExpr() {
        const children = [parseAndExpr()];
        while (peek()?.type === TokenType.OR) {
            advance(); // consume OR
            children.push(parseAndExpr());
        }
        return children.length === 1 ? children[0] : { type: 'or', children };
    }

    /**
     * AndExpr ::= Atom ('AND'? Atom)*
     * Implicit AND: two adjacent atoms without an explicit keyword.
     * @returns {AstNode}
     */
    function parseAndExpr() {
        const children = [parseAtom()];
        while (true) {
            const next = peek();
            if (!next) break;
            // explicit AND keyword
            if (next.type === TokenType.AND) {
                advance(); // consume AND
                children.push(parseAtom());
                continue;
            }
            // implicit AND: next token is a TERM or LPAREN (not OR, RPAREN, or end)
            if (next.type === TokenType.TERM || next.type === TokenType.LPAREN) {
                children.push(parseAtom());
                continue;
            }
            break;
        }
        return children.length === 1 ? children[0] : { type: 'and', children };
    }

    /**
     * Atom ::= '(' Expression ')' | Term
     * @returns {AstNode}
     */
    function parseAtom() {
        const tok = peek();
        if (!tok) {
            throw new SearchSyntaxError('Unexpected end of expression');
        }
        if (tok.type === TokenType.LPAREN) {
            advance(); // consume '('
            const expr = parseOrExpr();
            const closing = peek();
            if (!closing || closing.type !== TokenType.RPAREN) {
                throw new SearchSyntaxError('Missing closing parenthesis');
            }
            advance(); // consume ')'
            return expr;
        }
        if (tok.type === TokenType.TERM) {
            advance();
            return { type: 'term', field: tok.field, pattern: tok.pattern };
        }
        throw new SearchSyntaxError(`Unexpected token "${tok.type}" in expression`);
    }

    const ast = parseOrExpr();

    if (pos < tokens.length) {
        const leftover = tokens[pos];
        if (leftover.type === TokenType.RPAREN) {
            throw new SearchSyntaxError('Unexpected closing parenthesis');
        }
        throw new SearchSyntaxError(`Unexpected token at end of expression`);
    }

    return ast;
}
