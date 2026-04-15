import JSONFormatter from 'json-formatter-js';
import { on } from './event-bus.js';
import { EVT_NODE_CLICKED, EVT_LINK_CLICKED } from './constants.js';

// --- cached DOM elements (primary panel) ---
const panel = document.getElementById('detailsPanel') as HTMLElement;
const body = document.getElementById('detailsPanelBody') as HTMLElement;
const closeBtn = document.getElementById('detailsPanelClose') as HTMLElement;
const content = document.getElementById('content') as HTMLElement;

/** Counter used to cascade floating panel positions. */
let floatingPanelCount = 0;

interface NodeOrLink {
    id: string;
    type: string;
    kind: string;
    properties?: Record<string, unknown>;
}

function buildDetailsData(nodeOrLink: NodeOrLink): Record<string, unknown> {
    return {
        id: nodeOrLink.id,
        type: nodeOrLink.type,
        kind: nodeOrLink.kind,
        properties: nodeOrLink.properties ?? {},
    };
}

function showDetails(nodeOrLink: NodeOrLink): void {
    const formatter = new JSONFormatter(buildDetailsData(nodeOrLink), 2);
    body.innerHTML = '';
    body.appendChild(formatter.render());
    panel.classList.add('open');
}

function hideDetails(): void {
    panel.classList.remove('open');
}

closeBtn.addEventListener('click', () => hideDetails());

// --- drag support (reusable) ---

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

// attach drag to the primary panel
attachDrag(panel);

// --- floating (shift-click) panels ---

function createFloatingPanel(nodeOrLink: NodeOrLink): void {
    floatingPanelCount++;
    const offset = 8 + floatingPanelCount * 30;

    const el = document.createElement('div');
    el.className = 'details-panel open';
    el.style.top = `${offset}px`;
    el.style.left = `${offset}px`;

    const header = document.createElement('div');
    header.className = 'panel-header';

    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = 'Details';

    const closeButton = document.createElement('md-icon-button') as HTMLElement;
    const closeIcon = document.createElement('md-icon') as HTMLElement;
    closeIcon.textContent = 'close';
    closeButton.appendChild(closeIcon);
    closeButton.addEventListener('click', () => {
        el.remove();
        floatingPanelCount = Math.max(0, floatingPanelCount - 1);
    });

    header.appendChild(title);
    header.appendChild(closeButton);

    const panelBody = document.createElement('div');
    panelBody.className = 'panel-body';
    const formatter = new JSONFormatter(buildDetailsData(nodeOrLink), 2);
    panelBody.appendChild(formatter.render());

    el.appendChild(header);
    el.appendChild(panelBody);
    content.appendChild(el);

    attachDrag(el);
}

// --- event bus wiring ---

function handleClick(payload: { data: NodeOrLink; shiftKey: boolean }): void {
    if (payload.shiftKey) {
        createFloatingPanel(payload.data);
    } else {
        showDetails(payload.data);
    }
}

on(EVT_NODE_CLICKED, handleClick);
on(EVT_LINK_CLICKED, handleClick);
