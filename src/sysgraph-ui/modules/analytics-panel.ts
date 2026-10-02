import {
    ALGORITHMS,
    type AnalyticsResultModel,
    chooseAnalyticsNode,
    clearAnalytics,
    focusAnalyticsPathNode,
    getAlgorithm,
    type ParamSpec,
    runAlgorithm,
    selectAlgorithm,
    startPick,
} from './analytics.js';
import type { Community } from './analytics-communities.js';
import { validateEdgeWeightExpression } from './analytics-helpers.js';
import { findNodeCandidates } from './analytics-node-search.js';
import {
    EVT_ANALYTICS_UPDATED, EVT_NODE_CLICKED, EVT_SELECTION_CHANGED,
    EVT_VISIBLE_GRAPH_CHANGED, PANEL_ANALYTICS,
} from './constants.js';
import { emit, on } from './event-bus.js';
import { analyticsExpressionField } from './expression-fields.js';
import type { Graph, GraphNode } from './graph.js';
import { analyticsHeatmapColorScale, centerOnNode, communityColor, getVisibleGraph, refreshGraphColors } from './graph-ui.js';
import { closePanel, openPanel, registerPanel } from './layout.js';
import { SettingsForm, type ValueBinding } from './settings-form.js';
import { createSettingsTabScroller } from './settings-tab-scroll.js';
import { getGraph, setAnalyticsAwaitingPick, setAnalyticsParam, state } from './state.js';
import { exitAnalyticsTool } from './toolbar.js';
import { showError } from './util.js';

// ── cached DOM elements ─────────────────────────────────────
const body = document.getElementById('analyticsPanelBody') as HTMLElement;

// register the analytics panel with the dock layout; onOpen (re)renders so a
// restored-open panel shows content, and onClose reverts the analytics tool
registerPanel({
    id: PANEL_ANALYTICS,
    component: PANEL_ANALYTICS,
    title: 'Analytics',
    element: body,
    // bound to the analytics tool, which does not persist across reload; only
    // restore the panel if that tool is active, otherwise drop it
    restoreGuard: () => state.currentTool === 'analytics',
    onOpen: () => render(),
    onClose: () => { closePicker(); exitAnalyticsTool(); },
});

export function openAnalyticsPanel(): void {
    openPanel(PANEL_ANALYTICS);
}

export function closeAnalyticsPanel(): void {
    closePanel(PANEL_ANALYTICS);
}


// ── small DOM helpers ───────────────────────────────────────

function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    className?: string,
    text?: string,
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** Describes a short node by its label/name property, falling back to its id. */
function nodeLabel(nodeId: string): string {
    const node = getGraph().getNode(nodeId);
    if (!node) return nodeId;
    const props = node.properties ?? {};
    const label = (props.label ?? props.name) as string | undefined;
    return label ? `${label}` : nodeId;
}

// The navigation stays mounted while the active algorithm's controls change.
// This keeps horizontal tab position stable in narrow dock panels.
const navigation = el('nav', 'sg-settings-nav analytics-tabs');
navigation.setAttribute('aria-label', 'Analytics algorithms');
navigation.setAttribute('role', 'tablist');
const tabScroller = createSettingsTabScroller(navigation, 'analytics algorithms');
const content = el('div', 'analytics-content');
content.id = 'analyticsContent';
content.setAttribute('role', 'tabpanel');
body.append(tabScroller.element, content);

const sectionOpen = new Map<string, boolean>();
let previousAlgorithm: string | null = null;
let previousResult: AnalyticsResultModel | null = null;
let activePickerRole: string | null = null;
let pickerQuery = '';
let pickerGraph: Graph | null = null;
let refreshPicker: (() => void) | null = null;

function closePicker(): void {
    activePickerRole = null;
    pickerGraph = null;
    refreshPicker = null;
}

function focusPickButton(role: string): void {
    const field = [...content.querySelectorAll<HTMLElement>('.analytics-pick-field')]
        .find(element => element.dataset.role === role);
    field?.querySelector<HTMLButtonElement>('.analytics-pick-search')?.focus();
}

for (const algo of ALGORITHMS) {
    const button = el('button', `analytics-tab analytics-tab-${algo.id}`, algo.label);
    button.type = 'button';
    button.id = `analytics-tab-${algo.id}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', content.id);
    button.dataset.appTooltip = algo.description;
    button.addEventListener('click', () => selectAlgorithm(algo.id));
    button.addEventListener('keydown', event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.preventDefault();
        const index = ALGORITHMS.findIndex(item => item.id === algo.id);
        const next = ALGORITHMS[(index + (event.key === 'ArrowRight' ? 1 : -1) + ALGORITHMS.length) % ALGORITHMS.length];
        if (next) {
            selectAlgorithm(next.id);
            document.getElementById(`analytics-tab-${next.id}`)?.focus();
        }
    });
    navigation.appendChild(button);
}

function section(key: string, title: string, child: HTMLElement, defaultOpen = true): HTMLDetailsElement {
    const details = el('details', 'sg-settings-section analytics-section') as HTMLDetailsElement;
    const stateKey = `${state.analytics.algorithmId}:${key}`;
    details.open = sectionOpen.get(stateKey) ?? defaultOpen;
    details.append(el('summary', undefined, title), child);
    details.addEventListener('toggle', () => sectionOpen.set(stateKey, details.open));
    return details;
}

function sectionBody(...children: HTMLElement[]): HTMLElement {
    const element = el('div', 'sg-settings-section-body analytics-section-body');
    element.append(...children);
    return element;
}

function paramBinding(param: ParamSpec): ValueBinding<string> {
    return {
        get: () => state.analytics.params[param.id] ?? param.defaultValue,
        set: value => setAnalyticsParam(param.id, value),
        onChange: () => param.onInput?.(state.analytics.params[param.id] ?? param.defaultValue),
    };
}

function buildParamRow(param: ParamSpec, form: SettingsForm): void {
    const stored = paramBinding(param);
    const label = param.label.replace(/^./, first => first.toUpperCase());
    if (param.type === 'boolean') {
        form.toggle(label, {
            get: () => stored.get() === 'true',
            set: value => stored.set(String(value)),
            onChange: stored.onChange,
        });
    } else if (param.type === 'slider') {
        form.range(label, {
            get: () => Number(stored.get()),
            set: value => stored.set(String(value)),
            onChange: stored.onChange,
        }, param.min ?? 0, param.max ?? 100, param.step ?? 1);
    } else {
        form.expression(label, stored,
            () => analyticsExpressionField(param.id, param.label, param.defaultValue),
            validateEdgeWeightExpression);
    }
}

function nodeDisplayName(node: GraphNode): string {
    const label = node.properties?.label ?? node.properties?.name;
    return label == null || String(label) === '' ? node.id : String(label);
}

function pickerResults(role: string, list: HTMLElement, status: HTMLElement): void {
    const { nodes, total, error } = findNodeCandidates(pickerGraph ?? getVisibleGraph(), pickerQuery);
    list.replaceChildren();
    if (error) {
        status.textContent = error;
        status.classList.add('is-error');
        return;
    }
    status.classList.remove('is-error');
    const count = pickerQuery.trim() ? `${total} ${total === 1 ? 'match' : 'matches'}` :
        `${total} visible ${total === 1 ? 'node' : 'nodes'}`;
    status.textContent = total === 0 ? 'No matching visible nodes' :
        total > nodes.length ? `${count} · showing ${nodes.length}; refine the search` : count;
    for (const node of nodes) {
        const option = el('button', 'analytics-node-option');
        option.type = 'button';
        const current = state.analytics.pickedNodeIds[role] === node.id;
        option.classList.toggle('is-current', current);
        if (current) option.setAttribute('aria-current', 'true');
        option.append(el('span', 'analytics-node-option-name', nodeDisplayName(node)),
            el('span', 'analytics-node-option-meta', `${node.type} · ${node.id}`));
        option.addEventListener('click', () => {
            closePicker();
            chooseAnalyticsNode(role, node.id);
            focusPickButton(role);
        });
        list.appendChild(option);
    }
}

function buildPickerSearch(role: string): HTMLElement {
    const chooser = el('div', 'analytics-node-chooser');
    chooser.id = `analytics-picker-${role}`;
    const input = el('input', 'sg-setting-text analytics-node-search');
    input.type = 'search';
    input.setAttribute('aria-label', `Search ${role} nodes`);
    input.placeholder = 'Filter visible nodes…';
    input.value = pickerQuery;
    input.autocomplete = 'off';
    input.spellcheck = false;
    const status = el('div', 'analytics-node-status');
    status.setAttribute('aria-live', 'polite');
    const list = el('div', 'analytics-node-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', `Matching ${role} nodes`);
    refreshPicker = () => pickerResults(role, list, status);
    input.addEventListener('input', () => {
        pickerQuery = input.value;
        refreshPicker?.();
    });
    input.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            closePicker();
            render();
            focusPickButton(role);
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            list.querySelector<HTMLButtonElement>('button')?.focus();
        } else if (event.key === 'Enter') {
            event.preventDefault();
            list.querySelector<HTMLButtonElement>('button')?.click();
        }
    });
    list.addEventListener('keydown', event => {
        if (!(event.target instanceof HTMLButtonElement)) return;
        if (event.key === 'Escape') {
            input.focus();
        } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            const options = [...list.querySelectorAll<HTMLButtonElement>('button')];
            const next = options[options.indexOf(event.target) + (event.key === 'ArrowDown' ? 1 : -1)];
            (next ?? input).focus();
        }
    });
    chooser.append(input, status, list);
    refreshPicker();
    return chooser;
}

function buildPickRow(pick: { role: string; label: string }): HTMLElement {
    const field = el('div', 'analytics-pick-field');
    field.dataset.role = pick.role;
    field.appendChild(el('div', 'sg-setting-label', pick.label.replace(/^./, first => first.toUpperCase())));
    const row = el('div', 'analytics-pick-row');
    const pickedId = state.analytics.pickedNodeIds[pick.role];
    const awaiting = state.analytics.awaitingPickRole === pick.role;
    const searching = activePickerRole === pick.role;

    const searchButton = el('button', 'analytics-pick-button analytics-pick-search');
    searchButton.type = 'button';
    searchButton.classList.toggle('is-selected', Boolean(pickedId));
    searchButton.setAttribute('aria-expanded', String(searching));
    searchButton.setAttribute('aria-label', `${pick.label}: ${pickedId ? nodeLabel(pickedId) : 'search for a node'}`);
    searchButton.dataset.appTooltip = pickedId ?? 'Filter visible nodes by name, ID, type, or search expression';
    if (searching) searchButton.setAttribute('aria-controls', `analytics-picker-${pick.role}`);
    searchButton.append(el('span', 'analytics-pick-value', pickedId ? nodeLabel(pickedId) : 'Search for a node'),
        el('span', 'analytics-pick-hint', 'Search'));
    searchButton.addEventListener('click', () => {
        closePicker();
        activePickerRole = searching ? null : pick.role;
        pickerQuery = '';
        pickerGraph = activePickerRole ? getVisibleGraph() : null;
        setAnalyticsAwaitingPick(null);
        render();
        if (activePickerRole) content.querySelector<HTMLInputElement>('.analytics-node-search')?.focus();
    });
    row.appendChild(searchButton);

    const graphButton = el('button', 'analytics-pick-button analytics-pick-graph', awaiting ? 'Picking…' : 'Graph');
    graphButton.type = 'button';
    graphButton.classList.toggle('is-awaiting', awaiting);
    graphButton.setAttribute('aria-pressed', String(awaiting));
    graphButton.setAttribute('aria-label', `${pick.label}: ${awaiting ? 'cancel graph pick' : 'pick from graph'}`);
    graphButton.dataset.appTooltip = 'Choose by clicking a node in the 2D or 3D graph';
    graphButton.addEventListener('click', () => {
        closePicker();
        startPick(pick.role);
    });
    row.appendChild(graphButton);
    field.appendChild(row);
    if (awaiting) field.appendChild(el('div', 'analytics-pick-instruction', 'Click a node in the graph. Click Graph again to cancel.'));
    if (searching) field.appendChild(buildPickerSearch(pick.role));
    return field;
}

function buildRunSection(): HTMLElement {
    const row = el('div', 'analytics-run-row');
    const runButton = el('button', 'analytics-action analytics-run', 'Run analysis');
    runButton.type = 'button';
    runButton.addEventListener('click', () => {
        const error = runAlgorithm();
        if (error) showError(error, { id: 'analytics-run' });
    });
    const resetButton = el('button', 'analytics-action analytics-reset', 'Reset');
    resetButton.type = 'button';
    resetButton.addEventListener('click', () => {
        closePicker();
        clearAnalytics();
    });
    row.append(runButton, resetButton);
    return row;
}

function statRow(label: string, value: string): HTMLElement {
    const row = el('div', 'analytics-stat-row');
    row.appendChild(el('span', 'analytics-stat-label', label));
    row.appendChild(el('span', 'analytics-stat-value', value));
    return row;
}

/** Builds a clickable node row that centers the camera on the node. */
function buildPathNodeRow(nodeId: string, index: number, distance: number): HTMLElement {
    const row = el('button', 'analytics-path-row');
    row.type = 'button';
    row.dataset.appTooltip = `Center on ${nodeLabel(nodeId)}`;
    row.appendChild(el('span', 'analytics-path-index', String(index)));

    const content = el('span', 'analytics-path-node');
    const decoration = state.analytics.decoration;
    const active = decoration?.kind === 'subset' && decoration.focusedNodeId === nodeId;
    row.classList.toggle('active', active);
    if (active) row.setAttribute('aria-current', 'step');
    const icon = document.createElement('md-icon');
    icon.textContent = 'my_location';
    content.appendChild(icon);
    content.appendChild(el('span', 'analytics-path-node-label', nodeLabel(nodeId)));
    row.addEventListener('click', () => {
        centerOnNode(nodeId);
        focusAnalyticsPathNode(nodeId);
    });
    row.appendChild(content);

    row.appendChild(el('span', 'analytics-path-dist', distance.toFixed(2)));
    return row;
}

/** Live result controls use the same full-width controls as inputs. */
function buildResultTweakers(result: AnalyticsResultModel): HTMLElement[] {
    const tweakers = getAlgorithm(result.kind)?.resultTweakers ?? [];
    if (tweakers.length === 0) return [];
    const body = sectionBody();
    const form = new SettingsForm(body);
    for (const tweaker of tweakers) buildParamRow(tweaker, form);
    return Array.from(body.children) as HTMLElement[];
}

function buildResultsSections(result: AnalyticsResultModel): { summary: HTMLElement[]; detail: HTMLElement[] } {
    const sections: { summary: HTMLElement[]; detail: HTMLElement[] } = { summary: [], detail: [] };
    if (result.kind === 'stats') {
        const s = result.stats;
        sections.summary.push(section('result-overview', 'Overview', sectionBody(
            statRow('Nodes', String(s.nodeCount)),
            statRow('Edges', String(s.edgeCount)),
            statRow('Isolated nodes', String(s.isolatedCount)),
            statRow('Components', String(s.componentCount)),
            statRow('Largest component', String(s.largestComponentSize)),
            statRow('Degree min / avg / max', `${s.degreeMin} / ${s.degreeAvg.toFixed(2)} / ${s.degreeMax}`),
        )));
        if (s.nodeTypeCounts.length > 0) {
            sections.summary.push(section('result-node-types', 'Node types', sectionBody(
                ...s.nodeTypeCounts.map(([type, count]) => statRow(type, String(count))),
            ), false));
        }
        if (s.edgeTypeCounts.length > 0) {
            sections.detail.push(section('result-edge-types', 'Edge types', sectionBody(
                ...s.edgeTypeCounts.map(([type, count]) => statRow(type, String(count))),
            ), false));
        }
    } else if (result.kind === 'shortest-path') {
        if (result.result.found) {
            sections.summary.push(section('result-overview', 'Overview', sectionBody(
                statRow('Total weight', result.result.totalWeight.toFixed(4)),
                statRow('Hops', String(result.result.edgeIds.length)),
            )));
            const list = el('div', 'analytics-path-list');
            const header = el('div', 'analytics-path-head');
            header.append(el('span', 'analytics-path-index', '#'),
                el('span', 'analytics-path-node-label', 'Node'),
                el('span', 'analytics-path-dist', 'Distance'));
            list.appendChild(header);
            result.result.nodeIds.forEach((nodeId, index) => {
                list.appendChild(buildPathNodeRow(nodeId, index, result.result.nodeDistances[index] ?? 0));
            });
            sections.detail.push(section('result-path', 'Path', sectionBody(list)));
            const tweakers = buildResultTweakers(result);
            if (tweakers.length > 0) sections.summary.push(section('result-display', 'Display', sectionBody(...tweakers)));
        } else {
            sections.summary.push(section('result-overview', 'Result', sectionBody(
                el('div', 'analytics-empty', 'No path found between the selected nodes.'),
            )));
        }
    } else if (result.kind === 'mst') {
        sections.summary.push(section('result-overview', 'Overview', sectionBody(
            statRow('Tree edges', String(result.result.edgeIds.length)),
            statRow('Total weight', result.result.totalWeight.toFixed(4)),
            statRow('Components', String(result.result.components)),
        )));
    } else if (result.kind === 'degree') {
        const r = result.result;
        sections.summary.push(section('result-overview', 'Overview', sectionBody(
            statRow('Nodes ranked', String(r.entries.length)),
            statRow('Degree min / max', `${r.minDegree} / ${r.maxDegree}`),
        )));
        sections.detail.push(section('result-ranked', 'Ranked nodes', sectionBody(buildRankList(
            r.entries.map(entry => ({
                nodeId: entry.nodeId,
                primary: String(entry.degree),
                secondary: r.respectDirection ? `in ${entry.inDegree} · out ${entry.outDegree}` : undefined,
            })),
        ))));
        sections.summary.push(section('result-display', 'Display', sectionBody(
            buildHeatmapLegend(r.minDegree, r.maxDegree),
            ...buildResultTweakers(result),
        )));
    } else if (result.kind === 'distance') {
        const r = result.result;
        sections.summary.push(section('result-overview', 'Overview', sectionBody(
            statRow('Source', nodeLabel(r.sourceId)),
            statRow('Reachable nodes', String(r.reachableCount)),
            statRow('Max distance', formatDistance(r.maxDistance)),
        )));
        sections.detail.push(section('result-ranked', 'Ranked nodes', sectionBody(buildRankList(
            r.entries.map(entry => ({ nodeId: entry.nodeId, primary: formatDistance(entry.distance) })),
        ))));
        sections.summary.push(section('result-display', 'Display', sectionBody(
            buildHeatmapLegend(0, r.maxDistance, { reversed: true }),
            ...buildResultTweakers(result),
        )));
    } else if (result.kind === 'community') {
        const r = result.result;
        sections.summary.push(section('result-overview', 'Overview', sectionBody(
            statRow('Communities', String(r.communityCount)),
            statRow('Modularity', r.modularity.toFixed(4)),
        )));
        sections.detail.push(section('result-communities', 'Communities', sectionBody(buildCommunityLegend(r.communities))));
    }
    return sections;
}

// maximum number of ranked rows rendered to keep the panel responsive
const RANK_LIST_LIMIT = 100;

/** Formats a distance value, dropping the decimals when it is a whole number. */
function formatDistance(value: number): string {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Builds a cold-to-hot gradient legend with min/max value labels. When
 * reversed, the hot end is drawn on the left (used by distance, where the near
 * end is hot).
 */
function buildHeatmapLegend(min: number, max: number, options?: { reversed?: boolean }): HTMLElement {
    const reversed = options?.reversed ?? false;
    const wrap = el('div', 'analytics-legend');

    // sample the shared scale so the bar matches the canvas colors exactly
    const samples = 12;
    const stops: string[] = [];
    for (let i = 0; i < samples; i++) {
        const f = samples > 1 ? i / (samples - 1) : 0;
        const t = reversed ? 1 - f : f;
        stops.push(analyticsHeatmapColorScale.getColor(t));
    }
    const bar = el('div', 'analytics-legend-bar');
    bar.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    wrap.appendChild(bar);

    const labels = el('div', 'analytics-legend-labels');
    labels.appendChild(el('span', 'analytics-legend-min', formatDistance(min)));
    labels.appendChild(el('span', 'analytics-legend-max', formatDistance(max)));
    wrap.appendChild(labels);

    return wrap;
}

// maximum number of community swatches rendered to keep the panel responsive
const COMMUNITY_LEGEND_LIMIT = 50;

/** Adds every node of a community to the current selection. */
function addCommunityToSelection(community: Community): void {
    for (const nodeId of community.nodeIds) {
        state.selection.selectedNodeIds.add(nodeId);
    }
    emit(EVT_SELECTION_CHANGED, null);
}

/**
 * Toggles isolation of a community: when one or more are focused, every other
 * community and unassigned nodes are dimmed so the chosen ones stand out.
 * Multiple communities can be focused at once.
 */
function toggleCommunityFocus(communityId: number): void {
    const decoration = state.analytics.decoration;
    if (!decoration || decoration.kind !== 'community') {
        return;
    }
    const focused = decoration.focusedCommunities ?? new Set<number>();
    if (focused.has(communityId)) {
        focused.delete(communityId);
    } else {
        focused.add(communityId);
    }
    decoration.focusedCommunities = focused;
    refreshGraphColors();
    emit(EVT_ANALYTICS_UPDATED, null);
}

/** Builds a color-swatch legend listing each community and its size. */
function buildCommunityLegend(communities: Community[]): HTMLElement {
    const wrap = el('div', 'analytics-community-legend');

    const decoration = state.analytics.decoration;
    const focused =
        decoration && decoration.kind === 'community' ? decoration.focusedCommunities : undefined;

    const shown = communities.slice(0, COMMUNITY_LEGEND_LIMIT);
    for (const community of shown) {
        const row = el('div', 'analytics-community-row');

        // main clickable area centers the camera on the community
        const main = el('button', 'analytics-community-main');
        main.type = 'button';

        const swatch = el('span', 'analytics-community-swatch');
        swatch.style.background = communityColor(community.id);
        main.appendChild(swatch);

        main.appendChild(el('span', 'analytics-community-label', `community ${community.id}`));
        main.appendChild(el('span', 'analytics-community-size', String(community.size)));

        // center on the first node so the user can locate the community
        const firstNode = community.nodeIds[0];
        if (firstNode) {
            main.addEventListener('click', () => centerOnNode(firstNode));
        }
        row.appendChild(main);

        // focus control: isolate this community and dim everything else
        const focusBtn = el('button', 'analytics-community-focus');
        focusBtn.type = 'button';
        const isFocused = focused?.has(community.id) ?? false;
        if (isFocused) {
            focusBtn.classList.add('is-active');
        }
        focusBtn.dataset.appTooltip = isFocused ? 'Stop highlighting this community' : 'Highlight this community';
        focusBtn.setAttribute('aria-label', isFocused ? 'Stop highlighting this community' : 'Highlight this community');
        const focusIcon = document.createElement('md-icon');
        focusIcon.textContent = isFocused ? 'visibility' : 'visibility_off';
        focusBtn.appendChild(focusIcon);
        focusBtn.addEventListener('click', () => toggleCommunityFocus(community.id));
        row.appendChild(focusBtn);

        // subtle add-to-selection control
        const addBtn = el('button', 'analytics-community-add');
        addBtn.type = 'button';
        addBtn.dataset.appTooltip = 'Add community to selection';
        addBtn.setAttribute('aria-label', 'Add community to selection');
        const addIcon = document.createElement('md-icon');
        addIcon.textContent = 'add_circle';
        addBtn.appendChild(addIcon);
        addBtn.addEventListener('click', () => addCommunityToSelection(community));
        row.appendChild(addBtn);

        wrap.appendChild(row);
    }

    if (communities.length > shown.length) {
        wrap.appendChild(
            el('div', 'analytics-note', `showing ${shown.length} of ${communities.length} communities`),
        );
    }

    return wrap;
}

interface RankRow {
    nodeId: string;
    // headline value shown on the right (e.g. degree)
    primary: string;
    // optional supporting detail (e.g. in/out split)
    secondary?: string;
}

/**
 * Builds a ranked, clickable node list. Each row centers the camera on its
 * node. Long lists are capped at RANK_LIST_LIMIT with a "showing top N" note.
 */
function buildRankList(rows: RankRow[]): HTMLElement {
    const list = el('div', 'analytics-rank-list');

    const header = el('div', 'analytics-rank-head');
    header.appendChild(el('span', 'analytics-rank-index', '#'));
    header.appendChild(el('span', 'analytics-rank-node-label', 'node'));
    header.appendChild(el('span', 'analytics-rank-value', 'value'));
    list.appendChild(header);

    const shown = rows.slice(0, RANK_LIST_LIMIT);
    shown.forEach((row, i) => {
        const item = el('div', 'analytics-rank-row');
        item.appendChild(el('span', 'analytics-rank-index', String(i + 1)));

        const btn = el('button', 'analytics-rank-node');
        btn.dataset.appTooltip = `Center on ${row.nodeId}`;
        const icon = document.createElement('md-icon');
        icon.textContent = 'my_location';
        btn.appendChild(icon);
        btn.appendChild(el('span', 'analytics-rank-node-label', nodeLabel(row.nodeId)));
        btn.addEventListener('click', () => centerOnNode(row.nodeId));
        item.appendChild(btn);

        const value = el('span', 'analytics-rank-value');
        value.appendChild(el('span', 'analytics-rank-value-primary', row.primary));
        if (row.secondary) {
            value.appendChild(el('span', 'analytics-rank-value-secondary', row.secondary));
        }
        item.appendChild(value);
        list.appendChild(item);
    });

    if (rows.length > shown.length) {
        list.appendChild(
            el('div', 'analytics-rank-note', `showing top ${shown.length} of ${rows.length}`),
        );
    }

    return list;
}

function render(): void {
    const algoId = state.analytics.algorithmId;
    body.dataset.algorithm = algoId ?? '';
    const algo = algoId ? getAlgorithm(algoId) : undefined;
    const result = state.analytics.result as AnalyticsResultModel | null;
    const algorithmChanged = previousAlgorithm !== algoId;
    if (algorithmChanged) {
        previousAlgorithm = algoId;
        closePicker();
    }
    if (result && result !== previousResult) {
        for (const key of ['result-overview', 'result-path', 'result-ranked', 'result-display', 'result-communities']) {
            sectionOpen.set(`${algoId}:${key}`, true);
        }
    }
    previousResult = result;

    for (const button of navigation.querySelectorAll<HTMLButtonElement>('[role="tab"]')) {
        const selected = button.id === `analytics-tab-${algoId}`;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        if (selected) {
            content.setAttribute('aria-labelledby', button.id);
            tabScroller.reveal(button);
        }
    }

    const scrollTop = algorithmChanged ? 0 : content.scrollTop;
    content.replaceChildren();
    if (!algo) {
        content.appendChild(el('div', 'analytics-empty', 'Select an algorithm above.'));
        return;
    }
    content.appendChild(el('p', 'analytics-description', algo.description));

    const grid = el('div', 'analytics-grid');
    if (algo.picks.length > 0) {
        grid.appendChild(section('nodes', 'Nodes', sectionBody(...algo.picks.map(buildPickRow))));
    }
    if (algo.params.length > 0) {
        const optionsBody = sectionBody();
        const form = new SettingsForm(optionsBody);
        for (const param of algo.params) buildParamRow(param, form);
        grid.appendChild(section('options', 'Options', optionsBody));
    }
    if (grid.childElementCount > 0) content.appendChild(grid);
    content.appendChild(buildRunSection());

    if (result) {
        content.appendChild(el('div', 'analytics-results-label', 'Results'));
        const resultGrid = el('div', 'analytics-grid analytics-result-grid');
        const { summary, detail } = buildResultsSections(result);
        const summaryColumn = el('div', 'analytics-result-column');
        summaryColumn.append(...summary);
        resultGrid.appendChild(summaryColumn);
        if (detail.length > 0) {
            const detailColumn = el('div', 'analytics-result-column');
            detailColumn.append(...detail);
            resultGrid.appendChild(detailColumn);
        }
        content.appendChild(resultGrid);
    }
    content.scrollTop = scrollTop;
}

// ── initialization ──────────────────────────────────────────

/** Wires the analytics panel event subscriptions. */
export function initAnalyticsPanel(): void {
    on(EVT_ANALYTICS_UPDATED, render);
    on(EVT_VISIBLE_GRAPH_CHANGED, () => {
        if (activePickerRole) {
            pickerGraph = getVisibleGraph();
            refreshPicker?.();
        } else if (state.analytics.active) {
            render();
        }
    });
    // clicking a node toggles its community focus when a community result is shown
    on<{ data: { id: string } }>(EVT_NODE_CLICKED, ({ data }) => {
        const decoration = state.analytics.decoration;
        if (!state.analytics.active || !decoration || decoration.kind !== 'community') {
            return;
        }
        const community = decoration.nodeCommunity.get(data.id);
        if (community !== undefined) {
            toggleCommunityFocus(community);
        }
    });
    // re-render results/labels when the graph changes underneath us
    emit(EVT_ANALYTICS_UPDATED, null);
}
