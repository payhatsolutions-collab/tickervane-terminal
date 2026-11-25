export const PRO_HEADLINE = 'Make the case for a trade before you take it.';
export const PRO_REASON = 'A stock can look promising on a screen. Pro helps you check what supports the idea, where it could fall apart, and whether it’s worth a closer look.';

// `example` is what a locked workspace shows free, without an account; the rest of it needs Pro.
export const PRO_WORKSPACE_COPY = {
  Fundamentals: {
    question: 'Does the business support the stock’s price?',
    preview: 'Look beyond the chart. Review sales, margins, earnings and return on equity, then compare the business’s track record with forward estimates and valuation.',
    benefit: 'Assess business performance and valuation with Lodestar’s financial statements and six-pillar analysis, where data is available.',
  },
  Markets: {
    question: 'Is the wider market backing your idea?',
    preview: 'Put a stock’s move in context. Check market breadth, sector rotation and volatility, then compare global indices, currencies and commodities.',
    benefit: 'See how broad a market move is, which sectors are leading and what global markets are doing alongside it.',
  },
  Forecast: {
    question: 'How far could the price move in 10 sessions?',
    preview: 'See the price range a tested model expects, then compare it with where the price would be if the recent trend continued.',
    benefit: 'See the likely 10-session price range from a tested, experimental model, with a what-if for the recent trend.',
    example: 'The 10-session range and trend what-if for Reliance.',
  },
  Analytics: {
    question: 'What risk came with those returns?',
    preview: 'Look past the headline return. Check how far the stock has fallen from a peak, how much it moves, and how closely it responds to Nifty 50.',
    benefit: 'Put returns in context with historical drawdowns, volatility, market breadth and sensitivity to Nifty 50.',
    example: 'Drawdown, volatility and Nifty 50 sensitivity for Reliance, with the market view.',
  },
  Breakouts: {
    question: 'Does the breakout hold up under a closer look?',
    preview: 'Check how far price cleared the 20-day high, whether volume picked up, and what risks could weaken the setup.',
    benefit: 'Check whether confirmed 20-day breakouts have volume behind them and see the risks you should weigh.',
    example: 'The full check for the latest session’s top breakout by turnover.',
  },
  FnO: {
    question: 'Where are derivatives positions concentrated?',
    preview: 'Compare open interest across strikes and expiries to see where positions cluster in NSE options and futures.',
    benefit: 'Find where positions cluster using NSE option chains and futures open interest.',
    example: 'The Nifty option chain for the nearest expiry.',
  },
  Flows: {
    question: 'Were institutions buying or selling?',
    preview: 'Compare net buying and selling by foreign and domestic institutions, then look at reported bulk and block deals alongside those flows.',
    benefit: 'See whether foreign and domestic institutions were net buyers or sellers, and review reported bulk and block deals.',
    example: 'FII and DII cash flows for the latest session, and its five largest bulk and block deals.',
  },
};
