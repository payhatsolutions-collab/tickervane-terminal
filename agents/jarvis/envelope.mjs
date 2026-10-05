// Signal and Task envelope validation — the whole integration surface between
// Jarvis, the sub-agents and the dashboard (blueprint §3).
//
// Two invariants are enforced HERE rather than trusted to each agent:
//
//   1. evidence[] must be non-empty, or the signal is rejected outright. This is
//      the defence against a model narrating a plausible market story with no data
//      behind it, and it mirrors the terminal's existing stance that unavailable
//      data stays unavailable.
//   2. action.requiresApproval is forced true for anything with money or an
//      outbound message attached, overwriting whatever the agent set. An agent
//      cannot opt itself out.
import { id } from './ulid.mjs';

export const AGENTS = ['jarvis', 'macro', 'options', 'momentum', 'errands'];
export const KINDS = ['observation', 'proposal', 'alert', 'task'];
export const SEVERITIES = ['routine', 'notable', 'elevated', 'urgent'];
export const SUBJECT_TYPES = ['instrument', 'theme', 'sector', 'symbol', 'person', 'bill', 'trip'];

/** Action types that always require your explicit approval. */
export const APPROVAL_REQUIRED_TYPES = [
  'options_strategy', 'equity_order', 'send_email', 'booking', 'payment'
];

export class EnvelopeError extends Error {
  constructor(errors) {
    super(`Invalid envelope: ${errors.join('; ')}`);
    this.name = 'EnvelopeError';
    this.errors = errors;
  }
}

const isIso = v => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const isText = v => typeof v === 'string' && v.trim().length > 0;

function checkEvidence(evidence, errors) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    errors.push('evidence[] is required and must be non-empty');
    return [];
  }
  return evidence.map((item, i) => {
    if (!item || typeof item !== 'object') {
      errors.push(`evidence[${i}] must be an object`);
      return item;
    }
    if (!isText(item.source)) errors.push(`evidence[${i}].source is required`);
    // A datapoint needs a value or a URL — something checkable. Prose alone is
    // not evidence, and letting it through would defeat the whole rule.
    if (item.value === undefined && !isText(item.url)) {
      errors.push(`evidence[${i}] needs a value or a url`);
    }
    if (item.url !== undefined && !/^https:\/\//.test(String(item.url))) {
      errors.push(`evidence[${i}].url must be https`);
    }
    return { ...item, fetchedAt: item.fetchedAt || new Date().toISOString() };
  });
}

function checkSubjects(subjects, errors) {
  if (subjects === undefined) return [];
  if (!Array.isArray(subjects)) {
    errors.push('subjects must be an array');
    return [];
  }
  return subjects.filter((s, i) => {
    if (!s || typeof s !== 'object' || !isText(s.ref)) {
      errors.push(`subjects[${i}] needs a ref`);
      return false;
    }
    if (!SUBJECT_TYPES.includes(s.type)) {
      errors.push(`subjects[${i}].type must be one of ${SUBJECT_TYPES.join('|')}`);
      return false;
    }
    return true;
  });
}

function checkAction(action, kind, errors) {
  if (action === undefined) {
    if (kind === 'proposal') errors.push('kind "proposal" requires an action');
    return undefined;
  }
  if (typeof action !== 'object') {
    errors.push('action must be an object');
    return undefined;
  }
  if (!isText(action.type)) errors.push('action.type is required');

  // Invariant 2. Deliberately an overwrite, not a validation error: an agent that
  // sets this false is not malformed, it is overruled.
  const requiresApproval = APPROVAL_REQUIRED_TYPES.includes(action.type)
    ? true
    : action.requiresApproval === true;

  return { ...action, requiresApproval };
}

/**
 * Validate and normalize a signal. Throws EnvelopeError listing every problem
 * found, rather than the first — an agent author fixing five issues should learn
 * about all five in one run.
 */
export function normalizeSignal(input) {
  const errors = [];
  if (!input || typeof input !== 'object') throw new EnvelopeError(['signal must be an object']);

  if (!AGENTS.includes(input.agent)) errors.push(`agent must be one of ${AGENTS.join('|')}`);
  if (!KINDS.includes(input.kind)) errors.push(`kind must be one of ${KINDS.join('|')}`);

  const severity = input.severity ?? 'routine';
  if (!SEVERITIES.includes(severity)) errors.push(`severity must be one of ${SEVERITIES.join('|')}`);

  if (!isText(input.title)) errors.push('title is required');
  if (input.title && input.title.length > 200) errors.push('title must be ≤200 characters');

  const confidence = input.confidence ?? null;
  if (confidence !== null && !(typeof confidence === 'number' && confidence >= 0 && confidence <= 1)) {
    errors.push('confidence must be a number in [0,1]');
  }

  const ts = input.ts ?? new Date().toISOString();
  if (!isIso(ts)) errors.push('ts must be an ISO timestamp');
  if (input.expiresAt !== undefined && !isIso(input.expiresAt)) {
    errors.push('expiresAt must be an ISO timestamp');
  }

  const evidence = checkEvidence(input.evidence, errors);
  const subjects = checkSubjects(input.subjects, errors);
  const action = checkAction(input.action, input.kind, errors);

  if (errors.length) throw new EnvelopeError(errors);

  return {
    id: input.id || id('sig'),
    ts: new Date(ts).toISOString(),
    agent: input.agent,
    kind: input.kind,
    severity,
    confidence,
    title: input.title.trim(),
    body: isText(input.body) ? input.body.trim() : '',
    subjects,
    evidence,
    ...(input.expiresAt ? { expiresAt: new Date(input.expiresAt).toISOString() } : {}),
    ...(input.supersedes ? { supersedes: input.supersedes } : {}),
    ...(action ? { action } : {})
  };
}

/** True when a signal's supporting evidence has aged out (drives §4.3c). */
export function isExpired(signal, now = new Date()) {
  return Boolean(signal.expiresAt) && Date.parse(signal.expiresAt) <= now.getTime();
}

const DEFAULT_BUDGET = { tokens: 40_000, wallSeconds: 120, toolCalls: 25 };

/** Validate and normalize a task envelope (Jarvis → agent, §3.2). */
export function normalizeTask(input) {
  const errors = [];
  if (!input || typeof input !== 'object') throw new EnvelopeError(['task must be an object']);

  if (!AGENTS.includes(input.agent)) errors.push(`agent must be one of ${AGENTS.join('|')}`);
  if (!isText(input.intent)) errors.push('intent is required');

  const budget = { ...DEFAULT_BUDGET, ...(input.budget || {}) };
  for (const key of ['tokens', 'wallSeconds', 'toolCalls']) {
    if (!(typeof budget[key] === 'number' && budget[key] > 0)) {
      errors.push(`budget.${key} must be a positive number`);
    }
  }
  if (input.context !== undefined && !Array.isArray(input.context)) {
    errors.push('context must be an array of signal ids');
  }
  if (errors.length) throw new EnvelopeError(errors);

  return {
    taskId: input.taskId || id('tsk'),
    agent: input.agent,
    intent: input.intent.trim(),
    params: input.params && typeof input.params === 'object' ? input.params : {},
    budget,
    context: input.context || [],
    deadline: input.deadline || new Date(Date.now() + budget.wallSeconds * 1000).toISOString(),
    trigger: input.trigger || { kind: 'manual' }
  };
}
