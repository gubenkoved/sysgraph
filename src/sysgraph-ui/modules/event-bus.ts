// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any;

// --- pub/sub events (1:N, fire-and-forget) ---

const events: Record<string, AnyFn[]> = {};

/**
 * Registers a handler for the given event name.
 */
export function on<T = unknown>(event: string, handler: (data: T) => void): void {
    events[event] ??= [];
    events[event]!.push(handler as AnyFn);
}

/**
 * Emits an event, invoking all registered handlers with the supplied data.
 */
export function emit<T = unknown>(event: string, data: T): void {
    console.log('emiting event', event, data);
    const handlers = events[event] ?? [];
    for (const h of handlers) h(data);
}

// --- command handlers (1:1, awaitable) ---

const commandHandlers: Record<string, AnyFn> = {};

/**
 * Registers a single handler for a command. Overwrites with a warning if
 * a handler is already registered for the same command.
 */
export function registerHandler<TData = unknown, TResult = unknown>(
    command: string,
    handler: (data?: TData) => TResult,
): void {
    if (commandHandlers[command]) {
        console.warn(`overwriting handler for command "${command}"`);
    }
    commandHandlers[command] = handler as AnyFn;
}

/**
 * Invokes the registered handler for a command and returns its result.
 * Supports both sync and async handlers — callers can `await` the result.
 * Throws if no handler is registered.
 */
export function handle<TData = unknown, TResult = unknown>(
    command: string,
    data?: TData,
): TResult {
    console.log('handling command', command, data);
    const handler = commandHandlers[command];
    if (!handler) {
        throw new Error(`no handler registered for command "${command}"`);
    }
    return handler(data) as TResult;
}
