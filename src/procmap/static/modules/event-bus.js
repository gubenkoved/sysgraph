// --- pub/sub events (1:N, fire-and-forget) ---

/** @type {Object<string, Function[]>} */
const events = {};

/**
 * Registers a handler for the given event name.
 * @param {string} event
 * @param {Function} handler
 */
export function on(event, handler) {
    events[event] ||= [];
    events[event].push(handler);
}

/**
 * Emits an event, invoking all registered handlers with the supplied data.
 * @param {string} event
 * @param {*} data
 */
export function emit(event, data) {
    console.log("emiting event", event, data);
    const handlers = events[event] || [];
    handlers.forEach(h => h(data));
}

// --- command handlers (1:1, awaitable) ---

/** @type {Object<string, Function>} */
const commandHandlers = {};

/**
 * Registers a single handler for a command. Overwrites with a warning if
 * a handler is already registered for the same command.
 * @param {string} command
 * @param {Function} handler
 */
export function registerHandler(command, handler) {
    if (commandHandlers[command]) {
        console.warn(`overwriting handler for command "${command}"`);
    }
    commandHandlers[command] = handler;
}

/**
 * Invokes the registered handler for a command and returns its result.
 * Supports both sync and async handlers — callers can `await` the result.
 * Throws if no handler is registered.
 * @param {string} command
 * @param {*} [data]
 * @returns {*}
 */
export function handle(command, data) {
    console.log("handling command", command, data);
    const handler = commandHandlers[command];
    if (!handler) {
        throw new Error(`no handler registered for command "${command}"`);
    }
    return handler(data);
}
