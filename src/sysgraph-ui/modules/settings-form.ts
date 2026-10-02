import { createExpressionEditTrigger } from './expression-editor.js';
import type { ExpressionField } from './expression-fields.js';
import { closeSettingsSelect, createSettingsSelect } from './settings-select.js';

export interface ValueBinding<T> {
    get(): T;
    set(value: T): void;
    onChange(): void;
}

export interface FormControl {
    element: HTMLElement;
    sync(): void;
}

let nextControlId = 0;

function createElement<K extends keyof HTMLElementTagNameMap>(
    tag: K, className: string, text?: string,
): HTMLElementTagNameMap[K] {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function field(body: HTMLElement, label: string, inputId: string): HTMLElement {
    const element = createElement('div', 'sg-setting-field');
    const labelElement = createElement('label', 'sg-setting-label', label);
    labelElement.htmlFor = inputId;
    element.appendChild(labelElement);
    body.appendChild(element);
    return element;
}

export class SettingsForm {
    private controls: FormControl[] = [];

    constructor(readonly element: HTMLElement) {}

    clear(): void {
        closeSettingsSelect();
        this.element.replaceChildren();
        this.controls = [];
    }

    sync(): void {
        for (const control of this.controls) control.sync();
    }

    register(control: FormControl): void {
        this.element.appendChild(control.element);
        this.controls.push(control);
    }

    actions(): HTMLElement {
        const element = createElement('div', 'sg-setting-actions');
        this.element.appendChild(element);
        return element;
    }

    button(title: string, action: () => void, parent: HTMLElement = this.element): HTMLButtonElement {
        const button = createElement('button', 'sg-setting-button', title);
        button.type = 'button';
        button.addEventListener('click', action);
        parent.appendChild(button);
        return button;
    }

    range(
        label: string, binding: ValueBinding<number>, min: number, max: number, step: number,
        title?: string,
    ): FormControl {
        const id = `sg-setting-${++nextControlId}`;
        const row = field(this.element, label, id);
        row.classList.add('sg-setting-range-field');
        const number = createElement('input', 'sg-setting-number');
        number.type = 'number';
        number.min = String(min);
        number.max = String(max);
        number.step = String(step);
        number.setAttribute('aria-label', `${label} value`);
        const numberWrap = createElement('span', 'sg-setting-number-wrap');
        const numberUnderline = createElement('span', 'sg-setting-number-underline');
        numberUnderline.setAttribute('aria-hidden', 'true');
        numberWrap.append(numberUnderline, number);
        const head = createElement('div', 'sg-setting-range-head');
        head.append(row.firstElementChild!, numberWrap);
        row.appendChild(head);
        const slider = createElement('input', 'sg-setting-range');
        slider.id = id;
        slider.type = 'range';
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        const rangeWrap = createElement('div', 'sg-setting-range-wrap');
        rangeWrap.appendChild(slider);
        const intervals = step > 0 ? Math.round((max - min) / step) : 0;
        const aligned = step > 0 && Math.abs(min + intervals * step - max) < step * 0.00001;
        if (step > 0 && intervals >= 2 && intervals <= 30 && aligned) {
            const stops = createElement('div', 'sg-setting-range-stops');
            stops.setAttribute('aria-hidden', 'true');
            for (let index = 0; index <= intervals; index++) {
                const stop = createElement('span', 'sg-setting-range-stop');
                stop.style.left = `${index / intervals * 100}%`;
                stops.appendChild(stop);
            }
            rangeWrap.appendChild(stops);
        }
        row.appendChild(rangeWrap);
        if (title) row.title = title;

        const sync = (): void => {
            const value = binding.get();
            slider.value = String(value);
            number.value = String(value);
            numberUnderline.textContent = number.value;
            const fill = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
            slider.style.setProperty('--fill', `${fill}%`);
        };
        const apply = (raw: number): void => {
            if (!Number.isFinite(raw)) { sync(); return; }
            const clamped = Math.max(min, Math.min(max, raw));
            const value = Number((min + Math.round((clamped - min) / step) * step).toFixed(5));
            binding.set(Math.max(min, Math.min(max, value)));
            sync();
            binding.onChange();
        };
        slider.addEventListener('input', () => apply(Number(slider.value)));
        number.addEventListener('input', () => { numberUnderline.textContent = number.value || '0'; });
        number.addEventListener('change', () => apply(number.value.trim() ? Number(number.value) : NaN));
        const control = { element: row, sync };
        this.controls.push(control);
        sync();
        return control;
    }

    select<T extends string>(
        label: string, binding: ValueBinding<T>, options: ReadonlyArray<{ text: string; value: T }>,
    ): FormControl {
        const id = `sg-setting-${++nextControlId}`;
        const row = field(this.element, label, id);
        row.classList.add('sg-setting-select-field');
        const labelElement = row.firstElementChild as HTMLLabelElement;
        const { button, sync } = createSettingsSelect(
            id, labelElement, options, binding.get, binding.set,
        );
        row.appendChild(button);
        button.addEventListener('change', binding.onChange);
        const control = { element: row, sync };
        this.controls.push(control);
        sync();
        return control;
    }

    text(label: string, binding: ValueBinding<string>): FormControl {
        const id = `sg-setting-${++nextControlId}`;
        const row = field(this.element, label, id);
        row.classList.add('sg-setting-text-field');
        const input = createElement('input', 'sg-setting-text');
        input.id = id;
        input.type = 'text';
        row.appendChild(input);
        const sync = (): void => { input.value = binding.get(); };
        input.addEventListener('input', () => binding.set(input.value));
        input.addEventListener('change', binding.onChange);
        const control = { element: row, sync };
        this.controls.push(control);
        sync();
        return control;
    }

    expression(
        label: string, binding: ValueBinding<string>, makeField: () => ExpressionField,
        validate: (value: string) => string | null,
    ): FormControl {
        const id = `sg-setting-${++nextControlId}`;
        const row = field(this.element, label, id);
        row.classList.add('sg-setting-expression-field');
        const line = createElement('div', 'sg-setting-expression-line');
        const input = createElement('input', 'sg-setting-text');
        input.id = id;
        input.type = 'text';
        line.append(input, createExpressionEditTrigger(makeField));
        row.appendChild(line);
        const error = createElement('div', 'sg-setting-error');
        error.id = `${id}-error`;
        row.appendChild(error);
        input.setAttribute('aria-describedby', error.id);
        const check = (): void => {
            const message = validate(input.value);
            error.textContent = message ?? '';
            input.setAttribute('aria-invalid', String(message !== null));
            row.classList.toggle('sg-binding-invalid', message !== null);
        };
        const sync = (): void => { input.value = binding.get(); check(); };
        let timer = 0;
        input.addEventListener('input', () => {
            binding.set(input.value);
            check();
            window.clearTimeout(timer);
            timer = window.setTimeout(binding.onChange, 180);
        });
        input.addEventListener('change', () => {
            window.clearTimeout(timer);
            binding.onChange();
        });
        const control = { element: row, sync };
        this.controls.push(control);
        sync();
        return control;
    }

    toggle(label: string, binding: ValueBinding<boolean>, badge?: string): FormControl {
        const row = createElement('label', 'sg-setting-toggle');
        const name = createElement('span', 'sg-setting-toggle-label', label);
        const trailing = createElement('span', 'sg-setting-toggle-trailing');
        if (badge) trailing.appendChild(createElement('span', 'type-count-badge', badge));
        const input = createElement('input', 'sg-setting-checkbox');
        input.type = 'checkbox';
        trailing.appendChild(input);
        row.append(name, trailing);
        this.element.appendChild(row);
        const sync = (): void => { input.checked = binding.get(); };
        input.addEventListener('change', () => {
            binding.set(input.checked);
            binding.onChange();
        });
        const control = { element: row, sync };
        this.controls.push(control);
        sync();
        return control;
    }
}
