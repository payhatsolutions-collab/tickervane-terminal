import { track } from "@vercel/analytics";
import { GROWTH_KEY, visitTransition, activationTransition } from "./activation.js";

let memory = {};
function read() {
  try { return JSON.parse(localStorage.getItem(GROWTH_KEY)) || memory; }
  catch { return memory; }
}
function commit({ state, events }) {
  memory = state;
  try { localStorage.setItem(GROWTH_KEY, JSON.stringify(state)); } catch {}
  events.forEach(([name, properties]) => growthEvent(name, properties));
}
export function growthEvent(name, properties = {}) {
  try {
    // App effects can run before the Analytics sibling initializes its queue.
    if (typeof window.va !== "function") {
      window.vaq = window.vaq || [];
      window.vaq.push(["event", { name, data: { ...properties } }]);
    } else track(name, { ...properties });
  } catch {}
}
export function recordVisit(existing) {
  commit(visitTransition(read(), Date.now(), existing));
}
export function recordActivation(watch) {
  commit(activationTransition(read(), watch, Date.now()));
}
