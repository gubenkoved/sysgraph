// Central registry describing each user-editable expression field: how to read
// and write its value, which scope it compiles against, what to suggest for
// autocomplete, and which sample entities to preview it on. The rich expression
// editor (expression-editor.ts) is driven entirely by these descriptors, and
// the scopes are shared with the real evaluators (see expression-scopes.ts) so
// preview results match what the graph actually does.

import { validateEdgeWeightExpression } from './analytics-helpers.js';
import {
    EVT_ANALYTICS_UPDATED,
    EVT_D3_PARAMS_CHANGED,
    EVT_FILTERS_UPDATED,
    EVT_SETTINGS_UPDATED,
} from './constants.js';
import { emit } from './event-bus.js';
import { buildScopedExpression } from './expression.js';
import {
    describeGraphVocabulary,
    type GraphVocabulary,
    type PropInfo,
    type PropKind,
} from './expression-properties.js';
import {
    EDGE_FILTER_SCOPE,
    EDGE_WEIGHT_SCOPE,
    type ExpressionScope,
    LINK_DISTANCE_SCOPE,
    NODE_FILTER_SCOPE,
    NODE_LABEL_SCOPE,
    NODE_SIZING_SCOPE,
} from './expression-scopes.js';
import type { GraphEdge, GraphNode } from './graph.js';
import { labelHelpers } from './graph-ui-helpers.js';
import { settings } from './settings.js';
import { getGraph, setAnalyticsParam, state } from './state.js';

// ── shared types ────────────────────────────────────────────

export type SuggestionKind = 'property' | 'helper' | 'key' | 'variable' | 'type';

export interface ExprSuggestion {
    // identifier shown in the list / chip
    label: string;
    // text actually inserted into the editor (defaults to label)
    insert: string;
    // grouping/category shown next to the label
    kind: SuggestionKind;
    // short description shown in the autocomplete detail line
    detail: string;
}

export interface ExpressionSample {
    // short identity shown in the preview table's first column
    label: string;
    // fuller identity shown on hover
    title: string;
    // positional args matching the field scope's `params`
    args: unknown[];
}

export interface ExpressionField {
    // stable id (aria / storage)
    id: string;
    // dialog title, e.g. "Node label"
    title: string;
    // whether this field ranges over nodes or edges (drives samples + props)
    kind: 'node' | 'edge';
    // compile scope shared with the real evaluator
    scope: ExpressionScope;
    // optional wrapper applied before compiling (node label wraps in String())
    wrap?: (expr: string) => string;
    // an empty expression is a valid no-op (filters), otherwise it is rejected
    allowEmpty: boolean;
    getValue(): string;
    setValue(value: string): void;
    validate(expr: string): string | null;
    suggestions(): ExprSuggestion[];
    samples(limit: number, random?: boolean): ExpressionSample[];
    formatResult(value: unknown): string;
    examples: { code: string; desc: string }[];
}

// ── pane refresh hook ───────────────────────────────────────

// settings-pane registers its refresh here so committing a value from the modal
// updates the tweakpane text input; kept as a hook to avoid an import cycle
let paneRefresh: (() => void) | null = null;

export function setExpressionPaneRefresh(fn: () => void): void {
    paneRefresh = fn;
}

// ── compile / validate ──────────────────────────────────────

function compileSource(field: ExpressionField, expr: string): string {
    return field.wrap ? field.wrap(expr) : expr;
}

/**
 * Compiles an expression against a field's scope, returning the callable on
 * success or a human-readable message on a syntax error. Reused by the editor
 * for both validation and live preview (compile once, run per sample).
 */
export function compileField(
    field: ExpressionField,
    expr: string,
): { fn?: (...args: unknown[]) => unknown; error?: string } {
    try {
        const fn = buildScopedExpression(
            compileSource(field, expr),
            field.scope.params,
            field.scope.spread,
        );
        return { fn };
    } catch (err) {
        return { error: err instanceof Error ? err.message : 'invalid expression' };
    }
}

function genericValidate(field: ExpressionField, expr: string): string | null {
    if (!expr.trim()) return field.allowEmpty ? null : 'expression is empty';
    return compileField(field, expr).error ?? null;
}

// ── suggestion helpers ──────────────────────────────────────

const NODE_KEYS = ['id', 'type', 'properties'];
const EDGE_KEYS = ['id', 'type', 'source_id', 'target_id', 'properties'];

function isValidIdent(name: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

// how a property is referenced in inserted text/examples: a bare identifier
// when valid, otherwise bracket access off `properties`
function accessProp(name: string): string {
    return isValidIdent(name) ? name : `properties[${JSON.stringify(name)}]`;
}

function propertySuggestions(props: PropInfo[]): ExprSuggestion[] {
    return props.map((prop) => ({
        label: prop.key,
        insert: accessProp(prop.key),
        kind: 'property' as const,
        detail: prop.kind === 'other' ? 'property' : `${prop.kind} property`,
    }));
}

function keySuggestions(kind: 'node' | 'edge'): ExprSuggestion[] {
    const keys = kind === 'node' ? NODE_KEYS : EDGE_KEYS;
    return keys.map((name) => ({
        label: name,
        insert: name,
        kind: 'key' as const,
        detail: 'well-known key',
    }));
}

function typeSuggestions(types: string[]): ExprSuggestion[] {
    return types.map((type) => ({
        label: type,
        // types are values, not identifiers, so insert a quoted string literal
        insert: JSON.stringify(type),
        kind: 'type' as const,
        detail: 'type value',
    }));
}

function helperSuggestions(): ExprSuggestion[] {
    return Object.keys(labelHelpers).map((name) => ({
        label: name,
        insert: `${name}()`,
        kind: 'helper' as const,
        detail: 'helper function',
    }));
}

function variableSuggestions(names: string[]): ExprSuggestion[] {
    return names.map((name) => ({
        label: name,
        insert: name,
        kind: 'variable' as const,
        detail: 'injected value',
    }));
}

function buildSuggestions(
    kind: 'node' | 'edge',
    props: PropInfo[],
    types: string[],
    extras: string[],
    hasHelpers: boolean,
): ExprSuggestion[] {
    return [
        ...propertySuggestions(props),
        ...keySuggestions(kind),
        ...typeSuggestions(types),
        ...variableSuggestions(extras),
        ...(hasHelpers ? helperSuggestions() : []),
    ];
}

// ── graph-aware example builders ────────────────────────────

interface ExampleSpec {
    code: string;
    desc: string;
}

// picks the first property matching a preferred name, else the first property
// of the wanted value kind, so examples reference real keys from any dataset
function pickProp(
    props: PropInfo[],
    kind: PropKind,
    preferred: string[],
): string | null {
    for (const name of preferred) {
        if (props.some((p) => p.key === name && p.kind === kind)) return name;
    }
    return props.find((p) => p.kind === kind)?.key ?? null;
}

function dedupeExamples(examples: ExampleSpec[]): ExampleSpec[] {
    const seen = new Set<string>();
    return examples.filter((ex) => {
        if (seen.has(ex.code)) return false;
        seen.add(ex.code);
        return true;
    });
}

function nodeLabelExamples(vocab: GraphVocabulary): ExampleSpec[] {
    const examples: ExampleSpec[] = [{ code: 'type', desc: 'show the node type' }];
    const str = pickProp(vocab.nodeProps, 'string', ['name', 'label', 'title', 'city']);
    if (str) {
        examples.push({ code: `${accessProp(str)} || id`, desc: `${str}, falling back to id` });
        examples.push({
            code: `type + "\\n" + (${accessProp(str)} || "")`,
            desc: `type, then ${str} on a new line`,
        });
    } else {
        examples.push({ code: 'id', desc: 'show the node id' });
    }
    const num = pickProp(vocab.nodeProps, 'number', ['population', 'size', 'value', 'weight']);
    if (num) examples.push({ code: `type + ": " + ${accessProp(num)}`, desc: `type with ${num}` });
    return dedupeExamples(examples);
}

function nodeSizingExamples(vocab: GraphVocabulary): ExampleSpec[] {
    const examples: ExampleSpec[] = [
        { code: 'Math.sqrt(Math.max(1, degree))', desc: 'scale by connection count' },
    ];
    const num = pickProp(vocab.nodeProps, 'number', ['population', 'size', 'value', 'weight', 'count']);
    if (num) examples.push({ code: `Number(${accessProp(num)}) || 1`, desc: `scale by ${num}` });
    examples.push({ code: 'degree', desc: 'raw degree' });
    return dedupeExamples(examples);
}

function linkDistanceExamples(vocab: GraphVocabulary): ExampleSpec[] {
    const examples: ExampleSpec[] = [];
    const num = pickProp(vocab.edgeProps, 'number', ['length', 'distance', 'weight', 'cost']);
    if (num) examples.push({ code: `Number(${accessProp(num)}) || 120`, desc: `use ${num}, else 120` });
    examples.push({ code: 'source.type === target.type ? 60 : 200', desc: 'closer within a type' });
    if (!num) examples.push({ code: '120', desc: 'a constant distance' });
    return dedupeExamples(examples);
}

function nodeFilterExamples(vocab: GraphVocabulary): ExampleSpec[] {
    const examples: ExampleSpec[] = [];
    const type = vocab.nodeTypes[0];
    if (type) examples.push({ code: `type === ${JSON.stringify(type)}`, desc: `keep only ${type} nodes` });
    examples.push({ code: 'degree > 0', desc: 'hide isolated nodes' });
    const num = pickProp(vocab.nodeProps, 'number', ['population', 'size', 'value', 'weight']);
    if (num) examples.push({ code: `Number(${accessProp(num)}) > 0`, desc: `keep nodes with ${num}` });
    return dedupeExamples(examples);
}

function edgeFilterExamples(vocab: GraphVocabulary): ExampleSpec[] {
    const examples: ExampleSpec[] = [];
    const type = vocab.edgeTypes[0];
    if (type) examples.push({ code: `type === ${JSON.stringify(type)}`, desc: `keep only ${type} edges` });
    const num = pickProp(vocab.edgeProps, 'number', ['weight', 'length', 'bytes', 'count', 'value']);
    if (num) examples.push({ code: `Number(${accessProp(num)}) > 0`, desc: `keep edges with ${num}` });
    if (examples.length === 0) examples.push({ code: 'source_id !== target_id', desc: 'hide self-loops' });
    return dedupeExamples(examples);
}

function edgeWeightExamples(vocab: GraphVocabulary): ExampleSpec[] {
    const examples: ExampleSpec[] = [];
    const num = pickProp(vocab.edgeProps, 'number', ['length', 'weight', 'distance', 'cost', 'value']);
    if (num) examples.push({ code: `Number(${accessProp(num)}) || 1`, desc: `use ${num}, else 1` });
    examples.push({ code: 'Number(properties.weight) || 1', desc: 'use a weight property, else 1' });
    examples.push({ code: '1', desc: 'treat every edge equally' });
    return dedupeExamples(examples);
}

// ── sample builders ─────────────────────────────────────────

// reservoir sampling (Algorithm R): a uniform random subset of up to k items in
// a single O(n) pass, so shuffling the preview never copies + sorts the graph
function sampleRandom<T>(items: T[], k: number): T[] {
    if (items.length <= k) return [...items];
    const result = items.slice(0, k);
    for (let i = k; i < items.length; i++) {
        const j = Math.floor(Math.random() * (i + 1));
        if (j < k) result[j] = items[i]!;
    }
    return result;
}

function nodeSamples(
    limit: number,
    buildArgs: (node: GraphNode, degree: number) => unknown[],
    random = false,
): ExpressionSample[] {
    const graph = getGraph();
    let ordered: GraphNode[];
    if (random) {
        // a genuinely different set on demand, drawn from the whole graph
        ordered = sampleRandom(graph.getNodes(), limit);
    } else {
        ordered = [];
        const seen = new Set<string>();
        // prefer the current selection so the preview reflects what the user is
        // looking at, then fill the rest with the first nodes in the graph
        for (const id of state.selection.selectedNodeIds) {
            const node = graph.getNode(id);
            if (node && !seen.has(id)) {
                ordered.push(node);
                seen.add(id);
            }
        }
        for (const node of graph.getNodes()) {
            if (ordered.length >= limit) break;
            if (!seen.has(node.id)) {
                ordered.push(node);
                seen.add(node.id);
            }
        }
    }
    return ordered.slice(0, limit).map((node) => {
        const degree = graph.getAdjacentEdges(node.id).length;
        return {
            label: node.id,
            title: `${node.type} · ${node.id}`,
            args: buildArgs(node, degree),
        };
    });
}

function edgeSamples(
    limit: number,
    buildArgs: (
        edge: GraphEdge,
        source: GraphNode | undefined,
        target: GraphNode | undefined,
    ) => unknown[],
    random = false,
): ExpressionSample[] {
    const graph = getGraph();
    const edges = random
        ? sampleRandom(graph.getEdges(), limit)
        : graph.getEdges().slice(0, limit);
    return edges.map((edge) => {
        const source = graph.getNode(edge.source_id);
        const target = graph.getNode(edge.target_id);
        return {
            label: `${edge.source_id} → ${edge.target_id}`,
            title: `${edge.type} · ${edge.id}`,
            args: buildArgs(edge, source, target),
        };
    });
}

// ── result formatting ───────────────────────────────────────

function formatNumber(value: unknown): string {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value);
    return Number.isInteger(num) ? String(num) : num.toFixed(3);
}

function formatBoolean(value: unknown): string {
    return value ? 'keep' : 'hide';
}

function formatString(value: unknown): string {
    return String(value);
}

// ── field factories ─────────────────────────────────────────

export function nodeLabelField(): ExpressionField {
    const vocab = describeGraphVocabulary();
    return {
        id: 'node-label',
        title: 'Node label',
        kind: 'node',
        scope: NODE_LABEL_SCOPE,
        wrap: (expr) => `String(${expr})`,
        allowEmpty: false,
        getValue: () => settings.nodeLabelExpression,
        setValue: (value) => {
            settings.nodeLabelExpression = value;
            emit(EVT_SETTINGS_UPDATED, null);
            paneRefresh?.();
        },
        validate(expr) {
            return genericValidate(this, expr);
        },
        suggestions: () => buildSuggestions('node', vocab.nodeProps, vocab.nodeTypes, [], true),
        samples: (limit, random) =>
            nodeSamples(limit, (node) => [node, node.properties ?? {}, labelHelpers], random),
        formatResult: formatString,
        examples: nodeLabelExamples(vocab),
    };
}

export function nodeSizingField(): ExpressionField {
    const vocab = describeGraphVocabulary();
    return {
        id: 'node-sizing',
        title: 'Node sizing',
        kind: 'node',
        scope: NODE_SIZING_SCOPE,
        allowEmpty: false,
        getValue: () => settings.nodeSizingExpression,
        setValue: (value) => {
            settings.nodeSizingExpression = value;
            emit(EVT_SETTINGS_UPDATED, null);
            paneRefresh?.();
        },
        validate(expr) {
            return genericValidate(this, expr);
        },
        suggestions: () => buildSuggestions('node', vocab.nodeProps, vocab.nodeTypes, ['degree'], false),
        samples: (limit, random) =>
            nodeSamples(limit, (node, degree) => [node, node.properties ?? {}, degree], random),
        formatResult: formatNumber,
        examples: nodeSizingExamples(vocab),
    };
}

export function linkDistanceField(): ExpressionField {
    const vocab = describeGraphVocabulary();
    return {
        id: 'link-distance',
        title: 'Link distance',
        kind: 'edge',
        scope: LINK_DISTANCE_SCOPE,
        allowEmpty: false,
        getValue: () => settings.d3LinkDistanceExpression,
        setValue: (value) => {
            settings.d3LinkDistanceExpression = value;
            emit(EVT_D3_PARAMS_CHANGED, null);
            paneRefresh?.();
        },
        validate(expr) {
            return genericValidate(this, expr);
        },
        suggestions: () =>
            buildSuggestions('edge', vocab.edgeProps, vocab.edgeTypes, ['source', 'target'], false),
        samples: (limit, random) =>
            edgeSamples(
                limit,
                (edge, source, target) => [edge, edge.properties ?? {}, source, target],
                random,
            ),
        formatResult: formatNumber,
        examples: linkDistanceExamples(vocab),
    };
}

export function nodeFilterField(): ExpressionField {
    const vocab = describeGraphVocabulary();
    return {
        id: 'node-filter',
        title: 'Node filter',
        kind: 'node',
        scope: NODE_FILTER_SCOPE,
        allowEmpty: true,
        getValue: () => settings.nodeFilterExpression,
        setValue: (value) => {
            settings.nodeFilterExpression = value;
            emit(EVT_FILTERS_UPDATED, null);
            paneRefresh?.();
        },
        validate(expr) {
            return genericValidate(this, expr);
        },
        suggestions: () => buildSuggestions('node', vocab.nodeProps, vocab.nodeTypes, ['degree'], true),
        samples: (limit, random) =>
            nodeSamples(
                limit,
                (node, degree) => [node, node.properties ?? {}, degree, labelHelpers],
                random,
            ),
        formatResult: formatBoolean,
        examples: nodeFilterExamples(vocab),
    };
}

export function edgeFilterField(): ExpressionField {
    const vocab = describeGraphVocabulary();
    return {
        id: 'edge-filter',
        title: 'Edge filter',
        kind: 'edge',
        scope: EDGE_FILTER_SCOPE,
        allowEmpty: true,
        getValue: () => settings.edgeFilterExpression,
        setValue: (value) => {
            settings.edgeFilterExpression = value;
            emit(EVT_FILTERS_UPDATED, null);
            paneRefresh?.();
        },
        validate(expr) {
            return genericValidate(this, expr);
        },
        suggestions: () => buildSuggestions('edge', vocab.edgeProps, vocab.edgeTypes, [], true),
        samples: (limit, random) =>
            edgeSamples(limit, (edge) => [edge, edge.properties ?? {}, labelHelpers], random),
        formatResult: formatBoolean,
        examples: edgeFilterExamples(vocab),
    };
}

/**
 * Descriptor for an analytics edge-weight expression param. The same edit
 * button serves every analytics `expression` param (edge weight, distance
 * heatmap weight, …) by binding to the given param id.
 */
export function analyticsExpressionField(
    paramId: string,
    title: string,
    defaultValue: string,
): ExpressionField {
    const vocab = describeGraphVocabulary();
    return {
        id: `analytics-${paramId}`,
        title,
        kind: 'edge',
        scope: EDGE_WEIGHT_SCOPE,
        allowEmpty: false,
        getValue: () => state.analytics.params[paramId] ?? defaultValue,
        setValue: (value) => {
            setAnalyticsParam(paramId, value);
            emit(EVT_ANALYTICS_UPDATED, null);
        },
        validate: (expr) => validateEdgeWeightExpression(expr),
        suggestions: () => buildSuggestions('edge', vocab.edgeProps, vocab.edgeTypes, [], false),
        samples: (limit, random) =>
            edgeSamples(limit, (edge) => [edge, edge.properties ?? {}], random),
        formatResult: formatNumber,
        examples: edgeWeightExamples(vocab),
    };
}
