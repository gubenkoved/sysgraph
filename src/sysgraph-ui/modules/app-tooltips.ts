import './app-tooltips.css';

interface Rect {
    left: number;
    top: number;
    width: number;
    height: number;
    bottom: number;
}

export function tooltipPosition(anchor: Rect, width: number, height: number,
    viewportWidth: number, viewportHeight: number): { left: number; top: number; placement: 'top' | 'bottom' } {
    const margin = 8;
    const gap = 9;
    const availableBelow = viewportHeight - anchor.bottom - gap - margin;
    const availableAbove = anchor.top - gap - margin;
    const placement = height > availableBelow && availableAbove > availableBelow ? 'top' : 'bottom';
    const preferredTop = placement === 'top' ? anchor.top - height - gap : anchor.bottom + gap;
    return {
        left: Math.max(margin, Math.min(anchor.left + anchor.width / 2 - width / 2,
            viewportWidth - width - margin)),
        top: Math.max(margin, Math.min(preferredTop, viewportHeight - height - margin)),
        placement,
    };
}

let started = false;

/** Convert native title bubbles, including titles added later by panels, into one app tooltip. */
export function initAppTooltips(): void {
    if (started) return;
    started = true;

    const tooltip = document.createElement('div');
    tooltip.className = 'app-tooltip';
    tooltip.id = 'app-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);

    let active: Element | null = null;
    let showTimer = 0;
    let keyboardInput = false;
    const generatedNames = new WeakMap<Element, { attribute: 'aria-label' | 'aria-description'; value: string }>();

    const hide = (): void => {
        window.clearTimeout(showTimer);
        showTimer = 0;
        active = null;
        tooltip.classList.remove('is-visible');
    };

    const place = (anchor: Element): void => {
        const rect = anchor.getBoundingClientRect();
        const position = tooltipPosition(rect, tooltip.offsetWidth, tooltip.offsetHeight,
            window.innerWidth, window.innerHeight);
        tooltip.style.left = `${position.left}px`;
        tooltip.style.top = `${position.top}px`;
        tooltip.dataset.placement = position.placement;
    };

    const retainAccessibleText = (element: Element, value: string): void => {
        const previous = generatedNames.get(element);
        if (previous) {
            if (element.getAttribute(previous.attribute) === previous.value) {
                element.setAttribute(previous.attribute, value);
                generatedNames.set(element, { ...previous, value });
            }
            return;
        }
        if (element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby')) return;
        const tag = element.localName;
        const iconControl = tag.includes('icon-button') ||
            (tag === 'button' && element.textContent?.trim().length <= 2);
        const attribute = iconControl ? 'aria-label' : 'aria-description';
        if (element.hasAttribute(attribute)) return;
        element.setAttribute(attribute, value);
        generatedNames.set(element, { attribute, value });
    };

    const clearAccessibleText = (element: Element): void => {
        const previous = generatedNames.get(element);
        if (!previous) return;
        if (element.getAttribute(previous.attribute) === previous.value) {
            element.removeAttribute(previous.attribute);
        }
        generatedNames.delete(element);
    };

    const consumeTitle = (element: Element): void => {
        if (!element.hasAttribute('title')) return;
        const value = (element.getAttribute('title') ?? '').trim();
        element.removeAttribute('title');
        if (value) {
            element.setAttribute('data-app-tooltip', value);
            retainAccessibleText(element, value);
        } else {
            element.removeAttribute('data-app-tooltip');
            clearAccessibleText(element);
        }
        if (element === active) {
            if (!value) hide();
            else if (tooltip.classList.contains('is-visible')) {
                tooltip.textContent = value;
                place(element);
            }
        }
    };

    const consumeTree = (root: Element): void => {
        consumeTitle(root);
        for (const element of root.querySelectorAll('[title]')) consumeTitle(element);
    };
    for (const element of document.querySelectorAll('[title]')) consumeTitle(element);

    const observer = new MutationObserver(records => {
        for (const record of records) {
            if (record.type === 'attributes') {
                if (record.target instanceof Element) consumeTitle(record.target);
            } else for (const node of record.addedNodes) {
                if (node instanceof Element) consumeTree(node);
            }
        }
        if (active && !active.isConnected) hide();
    });
    observer.observe(document.documentElement, { subtree: true, childList: true,
        attributes: true, attributeFilter: ['title'] });

    const findTarget = (event: Event): Element | null => {
        for (const item of event.composedPath()) {
            if (!(item instanceof Element)) continue;
            consumeTitle(item); // also catches titles inside open shadow roots
            if (item.hasAttribute('data-app-tooltip')) return item;
        }
        return null;
    };

    const show = (anchor: Element, delay: number): void => {
        if (active === anchor && (showTimer || tooltip.classList.contains('is-visible'))) return;
        hide();
        active = anchor;
        showTimer = window.setTimeout(() => {
            showTimer = 0;
            if (active !== anchor || !anchor.isConnected) return;
            const value = anchor.getAttribute('data-app-tooltip');
            if (!value) return;
            tooltip.textContent = value;
            place(anchor);
            tooltip.classList.add('is-visible');
        }, delay);
    };

    const withinAnchor = (node: Node | null, anchor: Element): boolean => {
        let current: Node | null = node;
        while (current) {
            if (current === anchor) return true;
            current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
        }
        return false;
    };

    document.addEventListener('pointerover', event => {
        if (event.pointerType === 'touch') return;
        const target = findTarget(event);
        if (target) show(target, 350);
        else if (active) hide();
    }, true);
    document.addEventListener('pointerout', event => {
        if (!active) return;
        const next = event.relatedTarget;
        if (next instanceof Node && withinAnchor(next, active)) return;
        hide();
    }, true);
    document.addEventListener('pointerdown', () => { keyboardInput = false; hide(); }, true);
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') hide();
        else if (event.key === 'Tab') keyboardInput = true;
    }, true);
    document.addEventListener('focusin', event => {
        if (!keyboardInput) return;
        const target = findTarget(event);
        if (target) show(target, 0);
    }, true);
    document.addEventListener('focusout', () => { if (keyboardInput) hide(); }, true);
    document.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('visibilitychange', () => { if (document.hidden) hide(); });
}
