import { useFeed } from './hooks.js';
import { companyMoney, companyResearch, ratioPercent } from './companyResearch.js';
import { fmt } from './format.js';

const safeLink = value => typeof value === 'string' && /^https:\/\//i.test(value) ? value : null;
export default function CompanyBrief({ symbol, industry, refresh }) {
  const feed = useFeed(`/api/market?op=fundamentals&symbol=${encodeURIComponent(symbol)}`, refresh);
  const fund = feed.data, company = fund?.company || {}, research = companyResearch(fund, industry);
  const source = safeLink(company.url), website = safeLink(company.website);
  const currency = company.currency || 'INR';
  const metrics = [[companyMoney(company.revenue, currency), `Revenue · ${company.period || 'period unavailable'}`],
    [companyMoney(company.netIncome, currency), `Net income · ${company.period || 'period unavailable'}`],
    [ratioPercent(company.roe), 'ROE · reported'], [ratioPercent(company.netMargin), 'Net profit margin'],
    [ratioPercent(company.operatingMargin), 'Operating margin'], [fund?.peTrailing > 0 ? `${fmt(fund.peTrailing, 1)}×` : '—', 'Trailing P/E'],
    [companyMoney(fund?.marketCap, currency), 'Market capitalization'], [ratioPercent(company.revenueGrowth), 'Revenue growth · YoY']];
  return <div className="company-brief" aria-label="Company fundamentals">
    {feed.loading && !fund ? <p role="status" className="company-loading">Loading company profile & financial statements…</p> : !fund ? <div className="company-unavailable"><h3>Company research unavailable</h3><p>{feed.error || 'The company data provider has not returned a financial statement.'}</p><p>Business details and financials will appear here when the source is available.</p></div> : <>
      {feed.error && <p className="negative">Financial data could not refresh. Showing the previously loaded snapshot.</p>}
      <div className="company-business"><div className="company-section-heading"><h3>What the company does</h3>{website && <a href={website} target="_blank" rel="noopener noreferrer">Company website ↗</a>}</div><p>{company.businessSummary || fund.businessSummary || 'A business description is unavailable from this provider. Open the company filings for details.'}</p></div>
      <div className="company-financial-strip">{metrics.map(([value, label]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      <p className="company-data-note">{company.basis || 'Provider reported'} · {company.period || 'Financial period unavailable'}{company.end ? ` ended ${company.end}` : ''} · {company.source || fund.source}. ROE uses the provider’s reported period. — = unavailable.</p>
      <div className="company-editorial-grid"><section><h3>Growth prospects</h3>{research.growth.map(text => <p key={text}>{text}</p>)}<p>{research.driver}</p><small>Business drivers to assess; historical growth is not a forecast or management guidance.</small></section><section><h3>Valuation & profitability</h3><p>{research.valuation}</p><p>{research.margin}</p><p>{Number.isFinite(company.netMargin) ? `${ratioPercent(company.netMargin)} of reported revenue remains as net profit. Review cash conversion, exceptional items and debt alongside accounting earnings.` : 'Net profit margin is unavailable. Review cash conversion, exceptional items and debt in the company filings.'}</p></section></div>
      {!!company.history?.length && <details className="company-financial-history"><summary>Financial track record · {company.history.length} periods</summary><div className="table-wrap"><table><thead><tr><th>Period</th><th>Revenue</th><th>Net income</th><th>Operating margin</th><th>Net margin</th></tr></thead><tbody>{company.history.map(row => <tr key={row.period}><th scope="row">{row.period}</th><td>{companyMoney(row.revenue, currency)}</td><td>{companyMoney(row.netIncome, currency)}</td><td>{ratioPercent(row.operatingMargin)}</td><td>{ratioPercent(row.netMargin)}</td></tr>)}</tbody></table></div></details>}
      <div className="company-source-links">{source && <a href={source} target="_blank" rel="noopener noreferrer">Financial statements & company disclosures ↗</a>}<span>Retrieved {fund.fetchedAt ? new Date(fund.fetchedAt).toLocaleDateString('en-GB') : 'date unavailable'}. Valuation uses provider prices and may differ from the session quote.</span></div>
    </>}
  </div>;
}
