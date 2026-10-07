// Source: https://nsearchives.nseindia.com/content/circulars/CMTR71775.pdf
// Additional election closure: https://nsearchives.nseindia.com/content/circulars/CMTR72260.pdf
const nse2026 = new Set(['01-15','01-26','03-03','03-26','03-31','04-03','04-14','05-01','05-28','06-26','09-14','10-02','10-20','11-10','11-24','12-25'].map(d => `2026-${d}`));
export function forecastDates(lastTime, horizon, symbol = '') {
  const date = typeof lastTime === 'number' ? new Date(lastTime * 1000) : new Date(`${lastTime}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid history date.');
  const nse = symbol.endsWith('.NS') || ['^NSEI', '^NSEBANK', '^CNXIT', '^INDIAVIX'].includes(symbol);
  const crypto = /-(USD|INR|EUR)$/.test(symbol);
  const dates = [];
  let covered = nse;
  while (dates.length < horizon) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.toISOString().slice(0, 10);
    if (date.getUTCFullYear() !== 2026) covered = false;
    const special = nse && day === '2026-11-08';
    if (crypto || special || (![0, 6].includes(date.getUTCDay()) && !(nse && nse2026.has(day)))) dates.push(day);
  }
  return { dates, note: crypto ? 'Calendar days · market trades seven days a week' : covered ? 'NSE 2026 calendar · holidays excluded; includes Muhurat session' : 'Estimated session dates · weekdays only outside the supported NSE 2026 calendar' };
}
