type Option<T extends string> = { text: string; value: T };

let closeOpenSelect: (() => void) | null = null;

export function closeSettingsSelect(): void {
    closeOpenSelect?.();
}

/** A small listbox whose popup stays visible outside the scrollable dock pane. */
export function createSettingsSelect<T extends string>(
    id: string,
    label: HTMLLabelElement,
    options: ReadonlyArray<Option<T>>,
    getValue: () => T,
    setValue: (value: T) => void,
): { button: HTMLButtonElement; sync: () => void } {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.className = 'sg-setting-select';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('aria-expanded', 'false');
    button.disabled = options.length === 0;

    label.id = `${id}-label`;
    const value = document.createElement('span');
    value.id = `${id}-value`;
    value.className = 'sg-setting-select-value';
    button.setAttribute('aria-labelledby', `${label.id} ${value.id}`);
    const chevron = document.createElement('span');
    chevron.className = 'sg-setting-select-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    button.append(value, chevron);

    let menu: HTMLDivElement | null = null;
    let activeIndex = 0;
    let typeahead = '';
    let typeaheadTimer = 0;
    const optionElements: HTMLDivElement[] = [];

    const selectedIndex = (): number => Math.max(0, options.findIndex(option => option.value === getValue()));
    const sync = (): void => {
        const selected = options.find(option => option.value === getValue());
        value.textContent = selected?.text ?? getValue();
        for (let index = 0; index < optionElements.length; index++) {
            optionElements[index].setAttribute('aria-selected', String(options[index].value === getValue()));
        }
    };

    const close = (restoreFocus = false): void => {
        if (!menu) return;
        menu.remove();
        menu = null;
        optionElements.length = 0;
        window.clearTimeout(typeaheadTimer);
        typeahead = '';
        button.setAttribute('aria-expanded', 'false');
        button.removeAttribute('aria-controls');
        document.removeEventListener('pointerdown', onOutsidePointer, true);
        document.removeEventListener('focusin', onOutsideFocus, true);
        document.removeEventListener('scroll', onScroll, true);
        window.removeEventListener('resize', onResize);
        if (closeOpenSelect === close) closeOpenSelect = null;
        if (restoreFocus) button.focus();
    };

    const onOutsidePointer = (event: PointerEvent): void => {
        if (event.target instanceof Node && (button.contains(event.target) || menu?.contains(event.target))) return;
        close();
    };
    const onOutsideFocus = (event: FocusEvent): void => {
        if (event.target instanceof Node && (button.contains(event.target) || menu?.contains(event.target))) return;
        close();
    };
    const onScroll = (event: Event): void => {
        if (event.target instanceof Node && menu?.contains(event.target)) return;
        close();
    };
    const onResize = (): void => close();

    const setActive = (index: number): void => {
        if (!menu || options.length === 0) return;
        activeIndex = (index + options.length) % options.length;
        for (let i = 0; i < optionElements.length; i++) {
            optionElements[i].classList.toggle('is-active', i === activeIndex);
        }
        menu.setAttribute('aria-activedescendant', optionElements[activeIndex].id);
        const option = optionElements[activeIndex];
        if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop;
        else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
            menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight;
        }
    };

    const commit = (index: number): void => {
        const option = options[index];
        if (!option) return;
        const changed = option.value !== getValue();
        if (changed) setValue(option.value);
        sync();
        close(true);
        if (changed) button.dispatchEvent(new Event('change', { bubbles: true }));
    };

    const open = (initialIndex = selectedIndex()): void => {
        if (menu || options.length === 0) return;
        closeSettingsSelect();
        menu = document.createElement('div');
        menu.id = `${id}-listbox`;
        menu.className = 'sg-setting-select-menu';
        menu.setAttribute('role', 'listbox');
        menu.setAttribute('aria-labelledby', label.id);
        menu.tabIndex = -1;
        menu.style.setProperty('--sg-accent', getComputedStyle(button).getPropertyValue('--sg-accent').trim() || 'var(--accent-primary)');
        for (let index = 0; index < options.length; index++) {
            const option = document.createElement('div');
            option.id = `${id}-option-${index}`;
            option.className = 'sg-setting-select-option';
            option.setAttribute('role', 'option');
            option.setAttribute('aria-selected', String(options[index].value === getValue()));
            option.textContent = options[index].text;
            option.addEventListener('pointermove', () => setActive(index));
            option.addEventListener('click', () => commit(index));
            menu.appendChild(option);
            optionElements.push(option);
        }
        menu.addEventListener('keydown', event => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setActive(activeIndex + (event.key === 'ArrowDown' ? 1 : -1));
            } else if (event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                setActive(event.key === 'Home' ? 0 : options.length - 1);
            } else if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                commit(activeIndex);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                close(true);
            } else if (event.key === 'Tab') {
                event.preventDefault();
                const focusable = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]')]
                    .filter(element => element.getClientRects().length > 0 && !menu?.contains(element));
                const next = focusable[focusable.indexOf(button) + (event.shiftKey ? -1 : 1)];
                close();
                next?.focus();
            } else if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
                typeahead += event.key.toLocaleLowerCase();
                window.clearTimeout(typeaheadTimer);
                typeaheadTimer = window.setTimeout(() => { typeahead = ''; }, 700);
                const match = options.findIndex(option => option.text.toLocaleLowerCase().startsWith(typeahead));
                if (match >= 0) setActive(match);
            }
        });
        document.body.appendChild(menu);
        const rect = button.getBoundingClientRect();
        const width = Math.max(0, Math.min(rect.width, window.innerWidth - 16));
        menu.style.width = `${width}px`;
        const naturalHeight = menu.getBoundingClientRect().height;
        const below = window.innerHeight - rect.bottom - 12;
        const above = rect.top - 12;
        const placeAbove = naturalHeight > below && above > below;
        const available = placeAbove ? above : below;
        const height = Math.min(naturalHeight, Math.max(40, available), Math.max(40, window.innerHeight - 16));
        if (height < naturalHeight - 1) {
            menu.style.maxHeight = `${height}px`;
            menu.classList.add('is-scrollable');
        }
        const top = placeAbove ? rect.top - height - 4 : rect.bottom + 4;
        menu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))}px`;
        menu.style.top = `${Math.max(8, Math.min(top, window.innerHeight - height - 8))}px`;
        button.setAttribute('aria-expanded', 'true');
        button.setAttribute('aria-controls', menu.id);
        closeOpenSelect = close;
        document.addEventListener('pointerdown', onOutsidePointer, true);
        document.addEventListener('focusin', onOutsideFocus, true);
        document.addEventListener('scroll', onScroll, true);
        window.addEventListener('resize', onResize);
        menu.focus({ preventScroll: true });
        setActive(initialIndex);
    };

    button.addEventListener('click', () => { if (menu) close(); else open(); });
    button.addEventListener('keydown', event => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        open(selectedIndex() + (event.key === 'ArrowDown' ? 1 : -1));
    });
    sync();
    return { button, sync };
}
