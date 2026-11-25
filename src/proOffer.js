import { PRO_APP_TRIAL_DAYS, PRO_PRICE, PRO_TRIAL_MINUTES } from '../lib/proPlan.js';

// Subscribers and paused accounts see no offer.
export const proOffered = access => !!access && access.configured !== false && !access.active && !access.paused;
// Signed-out readers see the app trial; the server confirms it after sign-in.
export const appTrialOpen = access => proOffered(access) && (!access.signedIn || !!access.appTrialEligible);

// Which Pro offer a reader gets, and the wording on its button. The app trial is only for readers who have the app.
export function proOffer(access, hasApp) {
  if (hasApp && appTrialOpen(access)) return { offer: 'app_trial', label: `Start ${PRO_APP_TRIAL_DAYS} days of Pro free` };
  if (!access.signedIn || access.trialEligible) return { offer: 'trial', label: `Try Pro free for ${PRO_TRIAL_MINUTES} min` };
  return { offer: 'paid', label: `Get Pro · ₹${PRO_PRICE}` };
}
