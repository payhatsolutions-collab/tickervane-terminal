// Agent registration. Adding an agent is one import and one line here; the
// Registry rejects it at startup if it asks for a tool outside its allowlist.
import { macro } from './macro.mjs';
import { jarvisSelf } from './jarvis-self.mjs';

export const AVAILABLE = [jarvisSelf, macro];

/** Register every implemented agent. Phases 4, 6 and 7 extend AVAILABLE. */
export function registerAll(registry) {
  for (const agent of AVAILABLE) registry.register(agent);
  return registry;
}
