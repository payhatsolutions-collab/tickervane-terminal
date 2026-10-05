// Jarvis's own handlers: the housekeeping and composition it does for itself
// (blueprint §4.1 items 4 and 5). Deliberately narrow — anything that fetches
// data or analyses a market belongs in a sub-agent.
import { compose, render, save, BRIEFS } from '../brief.mjs';

export const jarvisSelf = {
  name: 'jarvis',
  tools: ['bus'],
  intents: {
    /** Fold the bus into a brief, print it, and persist it for the dashboard. */
    compose_brief: async ({ task, store, bus }) => {
      const kind = task.params?.brief;
      if (!BRIEFS[kind]) throw new Error(`compose_brief needs params.brief in ${Object.keys(BRIEFS).join('|')}`);

      // Read wider than the window so compose() decides the cutoff, keeping the
      // window definition in exactly one place.
      const hours = BRIEFS[kind].hours + 2;
      const since = new Date(Date.now() - hours * 3600_000).toISOString();
      const brief = compose(kind, store.listSignals({ since, limit: 500 }));

      process.stdout.write(render(brief, { colour: process.stdout.isTTY }) + '\n');
      const { latest } = save(brief);

      // The brief itself is a signal, so it appears in the stream and the
      // dashboard can link to it like anything else.
      bus.tryEmit({
        agent: 'jarvis', kind: 'observation', severity: 'routine',
        title: `${brief.label} brief composed — ${brief.total} signal(s)`,
        body: brief.coverage === 'complete'
          ? `${Object.entries(brief.counts).filter(([, n]) => n).map(([k, n]) => `${n} ${k}`).join(', ')}`
          : brief.coverage,
        subjects: [{ type: 'theme', ref: `brief.${kind}` }],
        evidence: [{ source: 'jarvis/brief', value: brief.total, path: latest }]
      });

      // Returned so the tick publishes this brief to the dashboard alongside
      // the signal stream, rather than the dashboard waiting for the next one.
      return { signals: 1, tokens: 0, toolCalls: 0, brief };
    },

    /** Retention: signals 180 days, runs 30 (§3.3). */
    prune_memory: async ({ store }) => {
      const { signals, runs } = store.prune();
      return { signals: 0, tokens: 0, toolCalls: 0, pruned: { signals, runs } };
    }
  }
};

export default jarvisSelf;
