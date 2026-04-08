import JSONFormatter from 'json-formatter-js';
import { on } from './event-bus.js';

// --- cached DOM elements ---
const panel = document.getElementById('detailsPanel');
const body = document.getElementById('detailsPanelBody');
const closeBtn = document.getElementById('detailsPanelClose');

/**
 * Renders the properties of a node or link in the details panel.
 * @param {{ id: string, type: string, kind: string, properties?: Object }} nodeOrLink
 */
function showDetails(nodeOrLink) {
    const data = {
        id: nodeOrLink.id,
        type: nodeOrLink.type,
        kind: nodeOrLink.kind,
        properties: nodeOrLink.properties || {},
    };

    const formatter = new JSONFormatter(data, 2);
    body.innerHTML = '';
    body.appendChild(formatter.render());
    panel.classList.add('open');
}

/** Hides the details panel. */
function hideDetails() {
    panel.classList.remove('open');
}

closeBtn.addEventListener('click', () => hideDetails());

// --- drag support ---
{
    const header = panel.querySelector('.panel-header');
    let dragging = false, startX = 0, startY = 0, startLeft = 0, startTop = 0;

    header.addEventListener('pointerdown', (e) => {
        if (e.target.closest('md-icon-button')) return;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        startLeft = panel.offsetLeft;
        startTop = panel.offsetTop;
        header.setPointerCapture(e.pointerId);
    });

    header.addEventListener('pointermove', (e) => {
        if (!dragging) return;
        const parent = panel.parentElement;
        const x = Math.max(0, Math.min(startLeft + e.clientX - startX, parent.clientWidth - panel.offsetWidth));
        const y = Math.max(0, Math.min(startTop + e.clientY - startY, parent.clientHeight - panel.offsetHeight));
        panel.style.left = x + 'px';
        panel.style.top = y + 'px';
    });

    header.addEventListener('pointerup', () => { dragging = false; });
}

// --- event bus wiring ---
on("node-clicked", node => showDetails(node));
on("link-clicked", link => showDetails(link));
on("background-click", () => hideDetails());
