// One source of truth for the HTML build and in-app navigation metadata.
export const SITE_ORIGIN = 'https://alphanova48.in';
export const SEO_UPDATED = '2026-10-12';
export const WORKSPACE_SEO = {
  Today: {path:'/', title:'Alpha Nova | Indian Stock Market Overview & NSE Screener', heading:'Alpha Nova: Indian Stock Market Overview', description:'Explore Indian stock markets with Alpha Nova (AlphaNova). Track NSE share prices, screen Nifty 500 stocks, and research charts, delivery volume and news.'},
  Terminal: {path:'/charts', title:'Stock Charts, Technical Analysis & Trade Plans | Alpha Nova', heading:'Stock Charts & Technical Analysis', description:'Explore stock price charts, volume and technical indicators with Alpha Nova. Plan entries, stops and position sizes, then review research before trading.'},
  Forecast: {path:'/forecast', title:'Stock Price Forecast & Market Research | Alpha Nova', heading:'Stock Price Forecast', description:'Explore stock price forecasts with Alpha Nova using adjusted daily price history. Compare statistical projections with current prices for market research.'},
  Markets: {path:'/markets', title:'Indian & Global Stock Market Overview | Alpha Nova', heading:'Indian & Global Stock Markets', description:'Explore Indian and global markets with Alpha Nova. Compare stock prices, market indices, sector rotation and index valuations in one research workspace.'},
  Screener: {path:'/screener', title:'Nifty 500 Screener: Momentum & Delivery | Alpha Nova', heading:'Nifty 500 Stock Screener', description:'Filter Nifty 500 stocks by momentum, relative strength, volume and delivery in Alpha Nova. Apply presets, build filters, save screens and export results.'},
  Delivery: {path:'/delivery', title:'NSE Stock Delivery Spikes & Volume Radar | Alpha Nova', heading:'NSE Delivery Volume & Percentage Analysis', description:'Compare NSE stock delivery percentages, delivered quantities and volume with recent averages. Explore delivery activity with Alpha Nova research tools.'},
  FnO: {path:'/futures-options', title:'NSE Option Chain & Futures Open Interest | Alpha Nova', heading:'NSE Option Chain & Futures Open Interest', description:'Explore NSE option chains and futures with Alpha Nova. Review available prices, open interest, expiries and positioning metrics with source timestamps.'},
  Flows: {path:'/institutional-flows', title:'FII DII Flows, Bulk Deals & Derivatives | Alpha Nova', heading:'FII DII Data & NSE Bulk and Block Deals', description:'Review available FII and DII cash flows, participant derivatives positions, and bulk and block deals with Alpha Nova. Check source dates and coverage.'},
  News: {path:'/news', title:'Stock Market News & Company Headlines | Alpha Nova', heading:'Stock Market News', description:'Explore stock market news and company headlines with Alpha Nova. Find stories for your selected stock, check publication times and open original sources.'},
  Watchlist: {noindex:true, path:'/watchlist', title:'Stock Watchlist, Charts & Technical Signals | Alpha Nova', heading:'Stock Watchlist', description:'Build a stock watchlist in Alpha Nova. Track available quotes, review chart snapshots and technical signals, and keep companies saved in this browser.'},
  Portfolio: {noindex:true, path:'/portfolio', title:'Stock Portfolio Tracker & Holdings Tools | Alpha Nova', heading:'Stock Portfolio Tracker', description:'Track holdings in Alpha Nova with available market quotes. Review your portfolio, manage local records and export a backup to move data between browsers.'},
  Journal: {noindex:true, path:'/trade-journal', title:'Trading Journal & Stock Trade Review Tools | Alpha Nova', heading:'Stock Trading Journal', description:'Record and review trades in the Alpha Nova trading journal. Keep manual trade records in your browser and revisit entries, exits and trading decisions.'},
  Alerts: {noindex:true, path:'/price-alerts', title:'Stock Price Alerts & Watchlist Notifications | Alpha Nova', heading:'Stock Price Alerts', description:'Set stock price alerts with Alpha Nova and manage alert levels for watched stocks. Enable optional push notifications on supported browsers and devices.'},
};

export const robotsForPage = seo => seo.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large';

export function updatePageMetadata(page, doc = document) {
  const seo = WORKSPACE_SEO[page] || WORKSPACE_SEO.Today;
  const url = SITE_ORIGIN + seo.path;
  doc.title = seo.title;
  for (const [selector, value] of [
    ['meta[name="description"]', seo.description],
    ['meta[name="robots"]', robotsForPage(seo)],
    ['meta[property="og:title"]', seo.title],
    ['meta[property="og:description"]', seo.description],
    ['meta[property="og:url"]', url],
    ['meta[name="twitter:title"]', seo.title],
    ['meta[name="twitter:description"]', seo.description],
  ]) doc.querySelector(selector)?.setAttribute('content', value);
  doc.querySelector('link[rel="canonical"]')?.setAttribute('href', url);
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
    const schema = JSON.parse(script.textContent);
    for (const node of schema['@graph'] || []) {
      if (node['@type'] === 'WebPage') Object.assign(node, {
        '@id': url+'#webpage', url, name: seo.title, description: seo.description, dateModified: SEO_UPDATED,
      });
    }
    script.textContent = JSON.stringify(schema).replaceAll('<', '\\u003c');
  }
}
