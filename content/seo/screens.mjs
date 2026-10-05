// Editorial content is deliberately curated. Rules are imported from the product at build time.
export const updated = '2026-10-03';
export const guides = [
  {
    id: 'accumulation', slug: 'delivery-accumulation', name: 'Delivery accumulation screener',
    description: 'Explore Alpha Nova’s NSE delivery accumulation screen: delivered quantity, delivery percentage and price-change rules, with examples and data limitations.',
    intro: 'Alpha Nova’s delivery accumulation screener finds stocks with unusually large delivered quantities, a delivery share of at least 45%, and a non-negative daily price change. It compares each stock with its own recent delivery history to create a shortlist for research. The label does not identify who bought the shares.',
    explanation: 'Delivered quantity measures shares marked for delivery in the exchange report. The delivery ratio divides the latest quantity by its average across available observations in the prior 20 sessions. A high delivery percentage alone is different: it describes delivery as a share of total traded quantity, without establishing an increase in participation.',
    example: 'Illustrative example: 180,000 delivered shares against a prior average of 100,000 gives a delivery ratio of 1.8×. If delivery represents 50% of traded shares and the daily price change is 0% or higher, the stock meets this preset. A 40% delivery share would fail the screen despite the same ratio.',
    checks: ['Compare the delivery report date with the price-history date before interpreting the combined screen.', 'Inspect absolute turnover and the number of available baseline observations; a small baseline can exaggerate a ratio.', 'Read company announcements and inspect several sessions of price and delivery history before drawing conclusions.'],
    caveat: 'This preset is different from the Delivery radar’s Accumulation classification, which also considers close location and its own delivery-share rules. Neither proves institutional buying, net buying, or future price appreciation.',
    question: 'Does high delivery mean institutional accumulation?',
    answer: 'No. The exchange delivery figures used here do not identify the buyer. High delivery can be a reason to investigate a stock, but it cannot establish that institutions are accumulating it.',
    related: ['volume', 'breakout20']
  },
  {
    id: 'volume', slug: 'volume-surge', name: 'Volume surge stock screener',
    description: 'Find how Alpha Nova screens for NSE volume surges: at least twice the prior 20-session average and a non-negative daily change, with a worked example.',
    intro: 'Alpha Nova’s volume surge screen selects stocks whose latest NSE traded quantity is at least twice the average across available observations in the prior 20 sessions, with a non-negative daily price change. It highlights unusual participation for further research; it does not measure buying pressure or predict the next price move.',
    explanation: 'The volume ratio uses total traded shares, including shares that are not marked for delivery. This differs from the delivery ratio, which uses delivered quantity. Comparing both can help distinguish a broad trading-volume spike from a simultaneous change in delivery activity, without attributing either to a particular investor group.',
    example: 'Illustrative example: 2.4 million traded shares against a 1 million-share baseline gives 2.4× volume. With a daily price change of +1%, this passes. The same volume with a −1% daily change fails this preset, even though the trading activity is still unusual.',
    checks: ['Check whether an earnings release, corporate action or other announcement coincides with the spike.', 'Compare absolute turnover and delivery quantity alongside the ratio.', 'Inspect the price chart to see whether the session extended a trend, reversed it or remained inside its recent range.'],
    caveat: 'The volume observation comes from NSE end-of-day reports, while price-change metrics may come from Yahoo Finance. These sources can have different timestamps. A flat daily change also passes because the rule is greater than or equal to zero.',
    question: 'Is this an intraday volume scanner?',
    answer: 'No. This preset uses NSE end-of-day traded quantity. It is not a streaming scanner and does not compare partial-session volume with the same elapsed portion of earlier sessions.',
    related: ['accumulation', 'high52']
  },
  {
    id: 'breakout20', slug: '20-day-breakout', name: '20-day breakout stock screener',
    description: 'Understand Alpha Nova’s 20-day breakout screen: NSE closing price above prior session highs with at least 1.3× volume, plus checks and limitations.',
    intro: 'Alpha Nova’s 20-day breakout screener looks for an NSE closing price above the highest high in the available prior 20 sessions, combined with traded volume of at least 1.3 times its recent baseline. It identifies a specific price-and-volume condition, rather than confirming that a breakout will continue.',
    explanation: 'The price test uses the latest bhavcopy close and prior daily highs, excluding the latest session from the comparison window. This is different from the near-52-week-high screen, which uses closing-price history. Where archive observations are missing, the breakout comparison may use fewer than 20 prior observations.',
    example: 'Illustrative example: if the highest prior daily high is ₹500, a latest close of ₹502 and volume ratio of 1.4× meet the preset. A close of exactly ₹500 fails the strict breakout test. A close of ₹502 on 1.2× volume fails the volume condition.',
    checks: ['Confirm that the latest archive session is the session you intend to study.', 'Inspect the prior highs on a chart and check for corporate actions or discontinuities.', 'Review turnover and subsequent price behavior before treating the shortlist as actionable.'],
    caveat: 'A closing breakout can reverse or gap lower in a later session. The preset includes no entry price, protective order, backtested win rate or guarantee that all 20 prior observations are available for each stock.',
    question: 'Does touching the previous high count as a breakout?',
    answer: 'No. The latest NSE close must be strictly greater than the highest available prior high. An intraday touch or a close equal to that high does not satisfy the condition.',
    related: ['high52', 'volume']
  },
  {
    id: 'high52', slug: 'near-52-week-high', name: 'Near 52-week high stock screener',
    description: 'See Alpha Nova’s near-52-week-high screen rules: within 3% of the highest available daily close and at least 1.5× volume, with calculation examples.',
    intro: 'Alpha Nova’s near-52-week-high preset filters for a latest price within 3% of the highest available daily close over up to 252 observations, together with at least 1.5 times normal volume. Its high reference is based on closing prices, so it can differ from an exchange’s official intraday 52-week high.',
    explanation: 'Distance from the high is calculated as (latest price ÷ highest available close − 1) × 100. A reading of −2% means the latest price is 2% below that closing-price reference. The screener uses about one year of provider history; a recently listed stock may have a shorter window.',
    example: 'Illustrative example: a highest close of ₹1,000 and latest price of ₹980 gives −2%. With a volume ratio of 1.6×, the stock passes. A price of ₹960 gives −4%, so it fails the distance rule even if volume is elevated.',
    checks: ['Compare the closing-price reference with the intraday highs visible on the chart.', 'Check listing age and history coverage before assuming the window spans a full year.', 'Review the volume report date and absolute liquidity alongside proximity to the high.'],
    caveat: 'Being near a past high does not establish fair value, a successful breakout or a favorable future return. This preset does not require the latest close to exceed the prior high.',
    question: 'Why can this high differ from NSE’s 52-week high?',
    answer: 'Alpha Nova derives this metric from available Yahoo Finance daily closes, rather than NSE’s official high-low report. Intraday extremes, corporate-action adjustments, coverage and source dates can produce different values.',
    related: ['breakout20', 'rs']
  },
  {
    id: 'rs', slug: 'relative-strength', name: 'Relative strength stock screener',
    description: 'Learn Alpha Nova’s relative strength screen: stock return minus Nifty 50 over 63 sessions, a 10-point threshold and non-negative one-month return.',
    intro: 'Alpha Nova’s relative strength screener selects stocks whose return over 63 trading observations exceeds the Nifty 50 return by at least 10 percentage points, while their return over 21 observations is non-negative. This is a benchmark-relative price comparison. It is different from the RSI momentum oscillator.',
    explanation: 'Three-month relative strength is the stock’s percentage return minus the benchmark’s percentage return over the same observation count. The one-month condition adds an absolute-return check, because a stock can outperform a falling benchmark while still losing value. Observation counts approximate calendar months and may not align perfectly when data is missing.',
    example: 'Illustrative example: a stock returning +15% while Nifty 50 returns +4% has relative strength of +11 percentage points. If the stock also returned +2% over 21 observations, it passes. If its one-month return is −2%, it fails despite that relative outperformance.',
    checks: ['Compare stock and benchmark coverage and source dates.', 'Separate absolute gains from outperformance of a weak benchmark.', 'Review sector behavior and company-specific announcements to understand what contributed to the difference.'],
    caveat: 'This is a return difference, not a percentile ranking, risk-adjusted alpha, or the proprietary relative-strength rating used by another provider. Missing benchmark data prevents the numeric relative-strength rule from matching.',
    question: 'Is relative strength the same as RSI?',
    answer: 'No. Relative strength here compares a stock’s return with Nifty 50. RSI measures the balance of a stock’s recent gains and losses on a 0–100 oscillator. The two metrics answer different questions.',
    related: ['high52', 'minervini']
  },
  {
    id: 'minervini', slug: 'minervini-trend-template', name: 'Minervini trend template screener',
    description: 'Review Alpha Nova’s adapted Minervini trend template: moving-average structure, rising 200 DMA, high-low distance and the app’s composite score filter.',
    intro: 'Alpha Nova’s adapted Minervini trend template screens for an ordered price and moving-average structure, a rising 200-day average, distance above the available yearly closing low and proximity to the closing high. It also requires a Alpha Nova composite score of at least 70. This is an adaptation with explicit data limits.',
    explanation: 'Price must be above the 50-day average, which must be above the 150-day average, which must be above the 200-day average. The 200-day average must exceed its value 21 observations earlier. Price must be at least 30% above the available closing low and within 25% of the closing high over up to 252 observations.',
    example: 'Illustrative example: price ₹130, 50 DMA ₹120, 150 DMA ₹110 and 200 DMA ₹100 satisfy the ordering. A prior 200 DMA of ₹98 satisfies the rising test. With an available low of ₹90 and high of ₹150, price also meets both range tests. A composite score of 75 would pass the remaining rule.',
    checks: ['Check there are enough observations for the 200-day average and its 21-observation lookback.', 'Review the chart for base structure and liquidity; this preset does not evaluate every discretionary trading criterion.', 'Read the composite-score methodology before comparing results with another platform’s template.'],
    caveat: 'Alpha Nova’s composite score substitutes for a separate relative-strength rating and is not equivalent to that rating. The high and low use closes, and no affiliation, endorsement or strategy performance is claimed.',
    question: 'Is this an exact implementation of every Minervini criterion?',
    answer: 'No. It is the app’s documented adaptation of the price and moving-average structure, with closing-price high-low references and a Alpha Nova composite-score threshold. It does not certify that a stock meets every discretionary or external-rating criterion.',
    related: ['rs', 'high52']
  }
];
