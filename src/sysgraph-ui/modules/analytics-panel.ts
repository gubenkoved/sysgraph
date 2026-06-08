import {
    ALGORITHMS,
    type AnalyticsResultModel,
    clearAnalytics,
    getAlgorithm,
    type ParamSpec,
    runAlgorithm,
    selectAlgorithm,
    startPick,
} from './analytics.js';
import type { Community } from './analytics-communities.js';
import { validateEdgeWeightExpression } from './analytics-helpers.js';
import { EVT_ANALYTICS_UPDATED, EVT_NODE_CLICKED, EVT_SELECTION_CHANGED } from './constants.js';
import { emit, on } from './event-bus.js';
import { analyticsHeatmapColorScale, centerOnNode, communityColor, refreshGraphColors } from './graph-ui.js';
import { getGraph, setAnalyticsParam, state } from './state.js';
import { showError } from './util.js';

// --- cached DOM elements ---
const panel = document.getElementById('analyticsPanel') as HTMLElement;
const body = document.getElementById('analyticsPanelBody') as HTMLElement;
const closeBtn = document.getElementById('analyticsPanelClose') as HTMLElement;

export function openAnalyticsPanel(): void {
    panel.classList.add('open');
    render();
}

export function closeAnalyticsPanel(): void {
    panel.classList.remove('open');
}

// ---------------------------------------------------------------------------
// small DOM helpers
// ---------------------------------------------------------------------------

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

/** Wraps content in a titled, visually separated block. */
function buildBlock(title: string, ...children: HTMLElement[]): HTMLElement {
    const block = el('div', 'analytics-block');
    block.appendChild(el('div', 'analytics-block-title', title));
    for (const child of children) block.appendChild(child);
    return block;
}

// ---------------------------------------------------------------------------
// rendering
// ---------------------------------------------------------------------------

function buildAlgorithmTabs(): HTMLElement {
    const tabs = el('div', 'analytics-tabs');
    for (const algo of ALGORITHMS) {
        const btn = el('button', 'analytics-tab');
        btn.classList.toggle('active', state.analytics.algorithmId === algo.id);
        const icon = document.createElement('md-icon');
        icon.textContent = algo.icon;
        btn.appendChild(icon);
        btn.appendChild(el('span', undefined, algo.label));
        btn.title = algo.description;
        btn.addEventListener('click', () => selectAlgorithm(algo.id));
        tabs.appendChild(btn);
    }
    return tabs;
}

function buildParamRow(param: ParamSpec): HTMLElement {
    // every param renders uniformly: label first, then the control
    const row = el('div', 'analytics-field');
    row.appendChild(el('label', 'analytics-field-label', param.label));

    if (param.type === 'boolean') {
        const sw = document.createElement('md-switch') as HTMLElement & {
            selected: boolean;
        };
        const stored = state.analytics.params[param.id] ?? param.defaultValue;
        sw.selected = stored === 'true';
        sw.addEventListener('change', () => {
            setAnalyticsParam(param.id, sw.selected ? 'true' : 'false');
        });
        row.appendChild(sw);
    } else if (param.type === 'slider') {
        const control = el('div', 'analytics-slider');
        const slider = el('input', 'analytics-slider-input');
        slider.type = 'range';
        if (param.min !== undefined) slider.min = String(param.min);
        if (param.max !== undefined) slider.max = String(param.max);
        if (param.step !== undefined) slider.step = String(param.step);
        slider.value = state.analytics.params[param.id] ?? param.defaultValue;

        const valueLabel = el('span', 'analytics-slider-value', slider.value);

        // updates the filled-track percentage (consumed by the WebKit track css)
        const syncFill = () => {
            const min = Number(slider.min || '0');
            const max = Number(slider.max || '100');
            const span = max - min;
            const pct = span > 0 ? ((Number(slider.value) - min) / span) * 100 : 0;
            slider.style.setProperty('--fill', String(pct));
        };
        syncFill();

        slider.addEventListener('input', () => {
            valueLabel.textContent = slider.value;
            syncFill();
            setAnalyticsParam(param.id, slider.value);
        });

        control.appendChild(slider);
        control.appendChild(valueLabel);
        row.appendChild(control);
    } else {
        const input = el('input', 'edit-form-input');
        if (param.type === 'expression') {
            input.classList.add('analytics-code-input');
            input.spellcheck = false;
            input.autocapitalize = 'off';
            input.autocomplete = 'off';
            input.setAttribute('autocorrect', 'off');
        }
        input.value = state.analytics.params[param.id] ?? param.defaultValue;
        if (param.placeholder) input.placeholder = param.placeholder;
        input.addEventListener('change', () => {
            if (param.type === 'expression') {
                const error = validateEdgeWeightExpression(input.value);
                input.classList.toggle('invalid', error !== null);
            }
            setAnalyticsParam(param.id, input.value);
        });
        row.appendChild(input);
    }
    return row;
}

function buildPickRow(pick: { role: string; label: string }): HTMLElement {
    const row = el('div', 'analytics-field');
    row.appendChild(el('label', 'analytics-field-label', pick.label));

    const pickedId = state.analytics.pickedNodeIds[pick.role];
    const awaiting = state.analytics.awaitingPickRole === pick.role;

    const btn = el('button', 'analytics-pick-btn');
    btn.classList.toggle('awaiting', awaiting);
    btn.classList.toggle('picked', !awaiting && !!pickedId);
    btn.classList.toggle('empty', !awaiting && !pickedId);

    const icon = document.createElement('md-icon');
    icon.className = 'analytics-pick-icon';
    btn.appendChild(icon);
    const text = el('span', 'analytics-pick-text');
    if (awaiting) {
        icon.textContent = 'ads_click';
        text.textContent = 'click a node…';
    } else if (pickedId) {
        icon.textContent = 'my_location';
        text.textContent = nodeLabel(pickedId);
        btn.title = pickedId;
    } else {
        icon.textContent = 'touch_app';
        text.textContent = 'pick node';
    }
    btn.appendChild(text);
    btn.addEventListener('click', () => startPick(pick.role));
    row.appendChild(btn);
    return row;
}

/** Combined inputs block: node picks first, then scalar parameters. */
function buildInputsSection(algoId: string): HTMLElement | null {
    const algo = getAlgorithm(algoId as never);
    if (!algo || (algo.params.length === 0 && algo.picks.length === 0)) {
        return null;
    }

    const section = el('div', 'analytics-section');
    for (const pick of algo.picks) section.appendChild(buildPickRow(pick));
    for (const param of algo.params) section.appendChild(buildParamRow(param));
    return section;
}

function buildRunSection(): HTMLElement {
    const section = el('div', 'analytics-section');
    const row = el('div', 'analytics-run-row');

    const runBtn = document.createElement('md-filled-tonal-button') as HTMLElement;
    runBtn.className = 'analytics-run';
    runBtn.textContent = 'Run';
    runBtn.addEventListener('click', () => {
        const error = runAlgorithm();
        if (error) showError(error, { id: 'analytics-run' });
    });
    row.appendChild(runBtn);

    // reset picks, result and decoration for the current algorithm (keeps the
    // selected algorithm and its parameters)
    const resetBtn = document.createElement('md-text-button') as HTMLElement;
    resetBtn.className = 'analytics-reset';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', () => clearAnalytics());
    row.appendChild(resetBtn);

    section.appendChild(row);
    return section;
}

function statRow(label: string, value: string): HTMLElement {
    const row = el('div', 'analytics-stat-row');
    row.appendChild(el('span', 'analytics-stat-label', label));
    row.appendChild(el('span', 'analytics-stat-value', value));
    return row;
}

/** Builds a clickable node row that centers the camera on the node. */
function buildPathNodeRow(nodeId: string, index: number, distance: number): HTMLElement {
    const row = el('div', 'analytics-path-row');
    row.appendChild(el('span', 'analytics-path-index', String(index)));

    const btn = el('button', 'analytics-path-node');
    btn.title = `Center on ${nodeId}`;
    const icon = document.createElement('md-icon');
    icon.textContent = 'my_location';
    btn.appendChild(icon);
    btn.appendChild(el('span', 'analytics-path-node-label', nodeLabel(nodeId)));
    btn.addEventListener('click', () => centerOnNode(nodeId));
    row.appendChild(btn);

    row.appendChild(el('span', 'analytics-path-dist', distance.toFixed(2)));
    return row;
}

function buildResultsSection(result: AnalyticsResultModel): HTMLElement {
    const section = el('div', 'analytics-section analytics-results');

    if (result.kind === 'stats') {
        const s = result.stats;
        section.appendChild(statRow('nodes', String(s.nodeCount)));
        section.appendChild(statRow('edges', String(s.edgeCount)));
        section.appendChild(statRow('isolated nodes', String(s.isolatedCount)));
        section.appendChild(statRow('components', String(s.componentCount)));
        section.appendChild(statRow('largest component', String(s.largestComponentSize)));
        section.appendChild(statRow('degree (min/avg/max)', `${s.degreeMin} / ${s.degreeAvg.toFixed(2)} / ${s.degreeMax}`));

        if (s.nodeTypeCounts.length > 0) {
            section.appendChild(el('div', 'analytics-subtitle', 'node types'));
            for (const [type, count] of s.nodeTypeCounts) {
                section.appendChild(statRow(type, String(count)));
            }
        }
        if (s.edgeTypeCounts.length > 0) {
            section.appendChild(el('div', 'analytics-subtitle', 'edge types'));
            for (const [type, count] of s.edgeTypeCounts) {
                section.appendChild(statRow(type, String(count)));
            }
        }
    } else if (result.kind === 'shortest-path') {
        if (result.result.found) {
            section.appendChild(statRow('total weight', result.result.totalWeight.toFixed(4)));
            section.appendChild(statRow('hops', String(result.result.edgeIds.length)));

            const list = el('div', 'analytics-path-list');
            const header = el('div', 'analytics-path-head');
            header.appendChild(el('span', 'analytics-path-index', '#'));
            header.appendChild(el('span', 'analytics-path-node-label', 'node'));
            header.appendChild(el('span', 'analytics-path-dist', 'dist'));
            list.appendChild(header);

            result.result.nodeIds.forEach((nodeId, i) => {
                const distance = result.result.nodeDistances[i] ?? 0;
                list.appendChild(buildPathNodeRow(nodeId, i, distance));
            });
            section.appendChild(list);
        } else {
            section.appendChild(el('div', 'analytics-empty', 'No path found between the selected nodes.'));
        }
    } else if (result.kind === 'mst') {
        section.appendChild(statRow('tree edges', String(result.result.edgeIds.length)));
        section.appendChild(statRow('total weight', result.result.totalWeight.toFixed(4)));
        section.appendChild(statRow('components', String(result.result.components)));
    } else if (result.kind === 'degree') {
        const r = result.result;
        section.appendChild(statRow('nodes ranked', String(r.entries.length)));
        section.appendChild(statRow('degree (min/max)', `${r.minDegree} / ${r.maxDegree}`));

        section.appendChild(buildHeatmapLegend(r.minDegree, r.maxDegree));

        const directed = r.respectDirection;
        section.appendChild(
            buildRankList(
                r.entries.map(e => ({
                    nodeId: e.nodeId,
                    primary: String(e.degree),
                    secondary: directed ? `in ${e.inDegree} · out ${e.outDegree}` : undefined,
                })),
            ),
        );
    } else if (result.kind === 'community') {
        const r = result.result;
        section.appendChild(statRow('communities', String(r.communityCount)));
        section.appendChild(statRow('modularity', r.modularity.toFixed(4)));
        section.appendChild(buildCommunityLegend(r.communities));
    }

    return section;
}

// maximum number of ranked rows rendered to keep the panel responsive
const RANK_LIST_LIMIT = 100;

/** Builds a cold-to-hot gradient legend with min/max value labels. */
function buildHeatmapLegend(min: number, max: number): HTMLElement {
    const wrap = el('div', 'analytics-legend');

    // sample the shared scale so the bar matches the canvas colors exactly
    const samples = 12;
    const stops: string[] = [];
    for (let i = 0; i < samples; i++) {
        const t = samples > 1 ? i / (samples - 1) : 0;
        stops.push(analyticsHeatmapColorScale.getColor(t));
    }
    const bar = el('div', 'analytics-legend-bar');
    bar.style.background = `linear-gradient(to right, ${stops.join(', ')})`;
    wrap.appendChild(bar);

    const labels = el('div', 'analytics-legend-labels');
    labels.appendChild(el('span', 'analytics-legend-min', String(min)));
    labels.appendChild(el('span', 'analytics-legend-max', String(max)));
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
        focusBtn.title = isFocused ? 'stop highlighting this community' : 'highlight this community';
        const focusIcon = document.createElement('md-icon');
        focusIcon.textContent = isFocused ? 'visibility' : 'visibility_off';
        focusBtn.appendChild(focusIcon);
        focusBtn.addEventListener('click', () => toggleCommunityFocus(community.id));
        row.appendChild(focusBtn);

        // subtle add-to-selection control
        const addBtn = el('button', 'analytics-community-add');
        addBtn.type = 'button';
        addBtn.title = 'add community to selection';
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
        btn.title = `Center on ${row.nodeId}`;
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
    body.innerHTML = '';

    const algoId = state.analytics.algorithmId;
    const algo = algoId ? getAlgorithm(algoId) : undefined;

    const algoChildren: HTMLElement[] = [buildAlgorithmTabs()];
    if (algo) {
        algoChildren.push(el('div', 'analytics-description', algo.description));
    }
    body.appendChild(buildBlock('algorithm', ...algoChildren));

    if (!algoId) {
        body.appendChild(el('div', 'analytics-empty', 'Select an algorithm above.'));
        return;
    }

    const params = buildInputsSection(algoId);
    if (params) body.appendChild(buildBlock('parameters', params));

    body.appendChild(buildRunSection());

    const result = state.analytics.result as AnalyticsResultModel | null;
    if (result) {
        body.appendChild(buildBlock('results', buildResultsSection(result)));
    }
}

// ---------------------------------------------------------------------------
// drag support (mirrors the details panel)
// ---------------------------------------------------------------------------

function attachDrag(panelEl: HTMLElement): void {
    const header = panelEl.querySelector('.panel-header') as HTMLElement;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    header.addEventListener('pointerdown', (e) => {
        if ((e.target as Element).closest('md-icon-button')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = panelEl.offsetLeft;
        startTop = panelEl.offsetTop;
        header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const parent = panelEl.parentElement!;
        const x = Math.max(0, Math.min(startLeft + e.clientX - startX, parent.clientWidth - panelEl.offsetWidth));
        const y = Math.max(0, Math.min(startTop + e.clientY - startY, parent.clientHeight - panelEl.offsetHeight));
        panelEl.style.left = `${x}px`;
        panelEl.style.top = `${y}px`;
    });

    header.addEventListener('pointerup', () => { dragging = false; });
}

/** Wires the analytics panel close button, drag and event subscriptions. */
export function initAnalyticsPanel(onClose: () => void): void {
    closeBtn.addEventListener('click', () => {
        onClose();
    });
    attachDrag(panel);
    on(EVT_ANALYTICS_UPDATED, render);
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
