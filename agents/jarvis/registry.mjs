// Agent registry and the containment boundary (blueprint §10.2).
//
// An agent is a plain object:
//   { name, intents: {intent: async (ctx) => ({signals, tokens, toolCalls})}, tools }
//
// `tools` is the allowlist. It is the primary containment mechanism: the options
// agent never receives a place_order tool, so a prompt injection arriving in a
// news headline has nothing to reach for. Enforced here, not in a prompt.

/** Declared allowlists. Phase 1 registers no agents; these are the contract they bind to. */
export const ALLOWLISTS = {
  jarvis: ['bus', 'ingest', 'push'],
  macro: ['market'],
  options: ['market', 'kite:read', 'options-analyzer'],
  momentum: ['market', 'watchlist:read'],
  errands: ['gmail:read', 'gmail:draft', 'calendar:read']
};

/** Tools that must never appear in any allowlist, whatever an agent module asks for. */
export const FORBIDDEN = [
  'kite:place_order', 'kite:place_gtt_order', 'kite:modify_order', 'kite:cancel_order',
  'gmail:send', 'gmail:delete', 'payment'
];

export class Registry {
  constructor() { this.agents = new Map(); }

  register(agent) {
    if (!agent?.name) throw new Error('Agent needs a name');
    if (!ALLOWLISTS[agent.name]) throw new Error(`No declared allowlist for agent "${agent.name}"`);

    const requested = agent.tools || [];
    const forbidden = requested.filter(t => FORBIDDEN.includes(t));
    if (forbidden.length) {
      throw new Error(`Agent "${agent.name}" requested forbidden tools: ${forbidden.join(', ')}`);
    }
    const undeclared = requested.filter(t => !ALLOWLISTS[agent.name].includes(t));
    if (undeclared.length) {
      throw new Error(`Agent "${agent.name}" requested tools outside its allowlist: ${undeclared.join(', ')}`);
    }
    this.agents.set(agent.name, agent);
    return agent;
  }

  get(name) { return this.agents.get(name) || null; }
  has(name) { return this.agents.has(name); }
  names() { return [...this.agents.keys()]; }

  /** The handler for a task, or null when the agent or intent is not registered yet. */
  handler(task) {
    const agent = this.get(task.agent);
    return agent?.intents?.[task.intent] || null;
  }
}
