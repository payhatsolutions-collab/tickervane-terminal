export const GROWTH_KEY = "an2-growth-v1";
export const SESSION_GAP = 30 * 60 * 1000;
export const RETURN_WINDOW = 7 * 24 * 60 * 60 * 1000;

// Pure transitions keep the funnel deterministic across reloads and StrictMode.
export function visitTransition(previous, now, existing = false) {
  const state = { ...previous };
  const events = [];
  if (!state.firstVisit) {
    state.firstVisit = now;
    state.cohort = new Date(now).toISOString().slice(0, 10);
    state.existing = existing;
    events.push(["first_visit", { cohort: state.cohort, existing_user: existing }]);
  }
  if (!state.lastSeen || now - state.lastSeen >= SESSION_GAP) {
    state.sessionStarted = now;
    events.push(["visit_started", { cohort: state.cohort, existing_user: state.existing }]);
    if (state.activatedAt && !state.returnedAt &&
        now > state.activationSession && now - state.activatedAt <= RETURN_WINDOW) {
      state.returnedAt = now;
      events.push(["activated_return_within_7d", {
        cohort: state.cohort, activation_cohort: state.activationCohort,
        hours_since_activation: Math.round((now - state.activatedAt) / 3600000),
      }]);
    }
  }
  state.lastSeen = now;
  return { state, events };
}

export function activationTransition(previous, watch, now) {
  const state = { ...previous };
  if (state.existing || state.activatedAt || new Set(watch).size < 3)
    return { state, events: [] };
  state.activatedAt = now;
  state.activationSession = state.sessionStarted;
  state.activationCohort = new Date(now).toISOString().slice(0, 10);
  return { state, events: [["watchlist_activated", {
    cohort: state.cohort, activation_cohort: state.activationCohort,
    seconds_to_activation: Math.max(0, Math.round((now - state.firstVisit) / 1000)),
    stock_count: new Set(watch).size,
  }]] };
}
