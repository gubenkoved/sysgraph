/** Gives an overflowing settings tablist visible controls without covering tabs. */
export function createSettingsTabScroller(navigation: HTMLElement, label = 'settings tabs'): {
    element: HTMLElement;
    update: () => void;
    reveal: (button: HTMLElement) => void;
} {
    const shell = document.createElement('div');
    shell.className = 'sg-settings-nav-shell';

    const scrollTabs = (left: number): void => {
        navigation.scrollBy({
            left,
            behavior: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'auto'
                : 'smooth',
        });
    };

    const scrollButton = (direction: 'left' | 'right'): HTMLButtonElement => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `sg-settings-scroll-button sg-settings-scroll-${direction}`;
        button.setAttribute('aria-label', `Scroll ${label} ${direction}`);
        button.dataset.appTooltip = `Show more ${label} ${direction === 'left' ? 'to the left' : 'to the right'}`;
        button.addEventListener('click', () => {
            scrollTabs((direction === 'left' ? -1 : 1) * Math.max(80, navigation.clientWidth - 60));
            update();
        });
        return button;
    };
    const previous = scrollButton('left');
    const next = scrollButton('right');
    shell.append(previous, navigation, next);

    const update = (): void => {
        if (shell.clientWidth === 0) return;
        // Compare with the whole shell, not the temporarily narrowed viewport:
        // controls disappear again as soon as every tab fits without them.
        const overflowing = navigation.scrollWidth > shell.clientWidth + 1;
        shell.classList.toggle('is-overflowing', overflowing);
        const maxScroll = navigation.scrollWidth - navigation.clientWidth;
        previous.disabled = !overflowing || navigation.scrollLeft <= 1;
        next.disabled = !overflowing || navigation.scrollLeft >= maxScroll - 1;
    };

    const reveal = (button: HTMLElement): void => {
        update();
        if (!shell.classList.contains('is-overflowing')) return;
        const viewport = navigation.getBoundingClientRect();
        const tab = button.getBoundingClientRect();
        if (tab.left < viewport.left + 6) scrollTabs(-(viewport.left + 6 - tab.left));
        else if (tab.right > viewport.right - 6) scrollTabs(tab.right - viewport.right + 6);
        update();
    };

    navigation.addEventListener('scroll', update);
    navigation.addEventListener('wheel', event => {
        if (!shell.classList.contains('is-overflowing') || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
        const before = navigation.scrollLeft;
        navigation.scrollLeft += event.deltaY;
        if (navigation.scrollLeft !== before) {
            event.preventDefault();
            update();
        }
    }, { passive: false });
    new ResizeObserver(update).observe(shell);
    void document.fonts.ready.then(update);
    return { element: shell, update, reveal };
}
