import {
    ALGORITHMS,
    type AnalyticsResultModel,
    getAlgorithm,
    type ParamSpec,
    runAlgorithm,
    selectAlgorithm,
    startPick,
} from './analytics.js';
import { validateEdgeWeightExpression } from './analytics-helpers.js';
import { EVT_ANALYTICS_UPDATED } from './constants.js';
import { emit, on } from './event-bus.js';
import { centerOnNode } from './graph-ui.js';
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
    const runBtn = document.createElement('md-filled-tonal-button') as HTMLElement;
    runBtn.className = 'analytics-run';
    runBtn.textContent = 'Run';
    runBtn.addEventListener('click', () => {
        const error = runAlgorithm();
        if (error) showError(error, { id: 'analytics-run' });
    });
    section.appendChild(runBtn);
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
    }

    return section;
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
    // re-render results/labels when the graph changes underneath us
    emit(EVT_ANALYTICS_UPDATED, null);
}
