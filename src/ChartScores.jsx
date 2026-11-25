import React from 'react';
import { Activity, BarChart3, Sparkles } from 'lucide-react';
import { chartScores } from './chartScores.js';
import './chart-scores.css';

export default function ChartScores({ signal, fund, dailyLoading, fundLoading, dailyError, fundError }) {
  const scores = chartScores(signal, fund);
  const items = [
    { key: 'alphaNova', label: 'AlphaNova score', icon: Sparkles, note: 'Technical + fundamental', loading: dailyLoading || fundLoading, error: dailyError || fundError },
    { key: 'technical', label: 'Technical score', icon: Activity, note: 'Trend & momentum', loading: dailyLoading, error: dailyError },
    { key: 'fundamental', label: 'Fundamental score', icon: BarChart3, note: 'Growth & profitability', loading: fundLoading, error: fundError },
  ];
  return <section className="chart-scores" aria-label="Stock scores">
    <div className="chart-scores-grid">
      {items.map(({ key, label, icon: Icon, note, loading, error }) => {
        const value = scores[key];
        const available = Number.isFinite(value);
        const tone = !available ? 'unavailable' : value >= 70 ? 'strong' : value <= 30 ? 'weak' : 'mixed';
        const status = loading ? (available ? 'Updating…' : 'Loading…') : error ? (available ? 'Cached data' : 'Unavailable') : !available ? 'Unavailable' : key === 'fundamental' && scores.fundamentalInputs < 3 ? 'Partial data · 2 of 3 metrics' : note;
        return <div className={`chart-score chart-score-${key} chart-score-${tone}`} key={key}>
          <div className="chart-score-label"><Icon size={14} aria-hidden="true" /><span>{label}</span></div>
          <div className="chart-score-value"><strong>{available ? value : '—'}</strong><span>/ 100</span></div>
          <div className="chart-score-meter" aria-hidden="true"><span style={{ width: `${available ? value : 0}%` }} /></div>
          <small>{status}</small>
        </div>;
      })}
    </div>
    <details className="chart-scores-method">
      <summary>How scores are calculated</summary>
      <p><strong>AlphaNova:</strong> equal-weight average of technical and fundamental scores; requires both.</p>
      <p><strong>Technical:</strong> the five daily indicator rules below, mapped from −5…+5 to 0…100. Uses at least 70 completed daily closes, regardless of chart range.</p>
      <p><strong>Fundamental:</strong> average of available revenue growth, earnings growth and return on equity (ROE), with at least two metrics required. Growth scales from 0 points at −10% to 100 at +20%; ROE scales from 0 points at 0% to 100 at 25%. Values outside these ranges are capped. Provider-reported periods may differ.</p>
      <p>Research heuristics, not sector-adjusted ratings or probabilities of return. Missing data is never scored as zero.</p>
    </details>
  </section>;
}
