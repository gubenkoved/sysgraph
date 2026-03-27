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
