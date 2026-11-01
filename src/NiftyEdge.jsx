export default function NiftyEdge() {
  return <section className="panel" aria-label="NIFTY EDGE options research">
    <div className="panel-foot" style={{ justifyContent: 'space-between' }}>
      <span>NIFTY EDGE · volatility, risk sizing & evidence lab</span>
      <a href="/nifty-edge/index.html" target="_blank" rel="noreferrer">Open full screen ↗</a>
    </div>
    <iframe title="NIFTY EDGE measured options desk" src="/nifty-edge/index.html"
      style={{ width: '100%', height: '82vh', minHeight: 620, border: 0, display: 'block', borderRadius: 12 }} />
  </section>;
}
