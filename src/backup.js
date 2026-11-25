import {cleanPersonalRule} from './personalAlerts.js';
import {cleanScreen} from './screens.js';
import {cleanJournalEntries} from './tradeMath.js';
import { cleanSymbols } from './watchlistTools.js';
import { validSavedSymbol, cleanPositions, cleanPriceAlerts, cleanDeliveryHistory } from './savedRecords.js';
export function buildBackup({symbol,watch,positions,alerts,deliveryHistory,alertPrefs,savedScreens,journal,personalRules}){return{app:'alphanova-terminal',version:5,exportedAt:new Date().toISOString(),data:{symbol,watch,positions,alerts,deliveryHistory:deliveryHistory||[],alertPrefs:alertPrefs||{},savedScreens:savedScreens||[],journal:journal||[],personalRules:personalRules||[]}};}
export function parseBackup(json) {
  const object = typeof json === 'string' ? JSON.parse(json) : json;
  const data = object?.data || object;
  if (!data || ![data.watch, data.positions, data.alerts].every(Array.isArray)) {
    throw new Error('This file does not look like an Alpha Nova backup.');
  }
  return {
    symbol: validSavedSymbol(data.symbol) ? data.symbol : null,
    watch: cleanSymbols(data.watch), positions: cleanPositions(data.positions), alerts: cleanPriceAlerts(data.alerts),
    deliveryHistory: cleanDeliveryHistory(data.deliveryHistory),
    alertPrefs: data.alertPrefs && typeof data.alertPrefs === 'object' && !Array.isArray(data.alertPrefs)
      ? Object.fromEntries(Object.entries(data.alertPrefs).filter(([, value]) => typeof value === 'boolean')) : {},
    personalRules: Array.isArray(data.personalRules) ? data.personalRules.map(cleanPersonalRule).filter(Boolean).slice(0, 20) : null,
    journal: Array.isArray(data.journal) ? cleanJournalEntries(data.journal) : null,
    savedScreens: Array.isArray(data.savedScreens) ? data.savedScreens.map(cleanScreen).filter(Boolean).slice(0, 5) : [],
  };
}
