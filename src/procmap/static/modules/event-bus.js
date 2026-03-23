const events = {};

export function on(event, handler) {
    (events[event] ||= []).push(handler);
}

export function emit(event, data) {
    console.log("emiting event", event, data);
    (events[event] || []).forEach(h => h(data));
}
