const events = {};

export function on(event, handler) {
    events[event] ||= [];
    events[event].push(handler);
}

export function emit(event, data) {
    console.log("emiting event", event, data);
    const handlers = events[event] || [];
    handlers.forEach(h => h(data));
}
