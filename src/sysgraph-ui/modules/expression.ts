// Shared, dependency-free compiler for the user-supplied expressions used
// across the app (node label, node sizing, link distance, edge weight). Kept
// free of any rendering/settings imports so both the appearance layer and the
// analytics layer can reuse it without coupling.

/**
 * Compiles a user-supplied expression into a callable with a shadow-safe scope.
 *
 * `params` names the injected values (the callable takes them in this order).
 * Names in `spread` additionally expose their object's keys as bare identifiers
 * via `with` (e.g. a `length` property becomes usable as `length`); when several
 * names are spread, later ones shadow earlier ones, so list the well-known
 * entity (`node`/`edge`) last to make its keys win over any same-named property.
 * Every injected name is then re-bound with `const` *inside* the innermost
 * `with`, so a property that happens to share an injected name (e.g. a `node`
 * property) can never shadow the injected value itself. Throws when the
 * expression does not compile.
 */
export function buildScopedExpression(
    expr: string,
    params: readonly string[],
    spread: readonly string[] = [],
): (...args: unknown[]) => unknown {
    const mangled = params.map((n) => `__${n}`);
    const rebind = `const ${params.map((n) => `${n}=__${n}`).join(',')};`;
    let body = `${rebind}return (${expr});`;
    for (let i = spread.length - 1; i >= 0; i--) {
        body = `with(__${spread[i]}){${body}}`;
    }
    return new Function(...mangled, body) as (...args: unknown[]) => unknown;
}
