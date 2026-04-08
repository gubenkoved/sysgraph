import JSONFormatter from 'json-formatter-js';
import { on } from './event-bus.js';

// --- cached DOM elements (primary panel) ---
const panel = document.getElementById('detailsPanel');
const body = document.getElementById('detailsPanelBody');
const closeBtn = document.getElementById('detailsPanelClose');
const content = document.getElementById('content');

/** Counter used to cascade floating panel positions. */
let floatingPanelCount = 0;

/**
 * Builds the JSON data object shown in a details panel.
 * @param {{ id: string, type: string, kind: string, properties?: Object }} nodeOrLink
 */
function buildDetailsData(nodeOrLink) {
    return {
        id: nodeOrLink.id,
        type: nodeOrLink.type,
        kind: nodeOrLink.kind,
        properties: nodeOrLink.properties || {},
    };
}

/**
 * Renders the properties of a node or link in the primary details panel.
 * @param {{ id: string, type: string, kind: string, properties?: Object }} nodeOrLink
 */
function showDetails(nodeOrLink) {
    const formatter = new JSONFormatter(buildDetailsData(nodeOrLink), 2);
    body.innerHTML = '';
    body.appendChild(formatter.render());
    panel.classList.add('open');
}

/** Hides the primary details panel. */
function hideDetails() {
    panel.classList.remove('open');
}

closeBtn.addEventListener('click', () => hideDetails());

// --- drag support (reusable) ---

/**
 * Attaches pointer-based drag behavior to a panel via its header.
 * @param {HTMLElement} panelEl
 */
function attachDrag(panelEl) {
    const header = panelEl.querySelector('.panel-header');
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header.addEventListener('pointerdown', (e) => {
        if (e.target.closest('md-icon-button')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = panelEl.offsetLeft;
        startTop = panelEl.offsetTop;
        header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const parent = panelEl.parentElement;
        const x = Math.max(0, Math.min(startLeft + e.clientX - startX, parent.clientWidth - panelEl.offsetWidth));
        const y = Math.max(0, Math.min(startTop + e.clientY - startY, parent.clientHeight - panelEl.offsetHeight));
        panelEl.style.left = x + 'px';
        panelEl.style.top = y + 'px';
    });

    header.addEventListener('pointerup', () => { dragging = false; });
}

// attach drag to the primary panel
attachDrag(panel);

// --- floating (shift-click) panels ---

/**
 * Creates a new independent floating details panel for the given node or link.
 * @param {{ id: string, type: string, kind: string, properties?: Object }} nodeOrLink
 */
function createFloatingPanel(nodeOrLink) {
    floatingPanelCount++;
    const offset = 8 + floatingPanelCount * 30;

    const el = document.createElement('div');
    el.className = 'details-panel open';
    el.style.top = offset + 'px';
    el.style.left = offset + 'px';

    // header
    const header = document.createElement('div');
    header.className = 'panel-header';

    const title = document.createElement('span');
    title.className = 'panel-title';
    title.textContent = 'Details';

    const closeButton = document.createElement('md-icon-button');
    const closeIcon = document.createElement('md-icon');
    closeIcon.textContent = 'close';
    closeButton.appendChild(closeIcon);
    closeButton.addEventListener('click', () => {
        el.remove();
        floatingPanelCount = Math.max(0, floatingPanelCount - 1);
    });

    header.appendChild(title);
    header.appendChild(closeButton);

    // body
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

/**
 * @param {{ data: Object, shiftKey: boolean }} payload
 */
function handleClick(payload) {
    if (payload.shiftKey) {
        createFloatingPanel(payload.data);
    } else {
        showDetails(payload.data);
    }
}

on("node-clicked", handleClick);
on("link-clicked", handleClick);
