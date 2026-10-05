import {useState} from 'react';
import {BROKERS, KITE_BASKET_URL, buildBrokerOrder, orderTicket} from './brokers';

const publisherKey = (import.meta.env.VITE_KITE_PUBLISHER_KEY || '').trim();

export default function BrokerTrade({symbol,currency,plan,result}) {
  const [brokerId,setBrokerId] = useState('zerodha');
  const [message,setMessage] = useState('');
  const broker = BROKERS.find(b => b.id === brokerId);
  const prepared = buildBrokerOrder({symbol,currency,...plan,quantity:result.error ? 0 : result.quantity});
  const error = result.error || prepared.error;
  const order = !error && prepared.order;
  const ticket = order ? orderTicket(order,plan.stop,plan.target) : '';
  const direct = brokerId === 'zerodha' && publisherKey;
  async function copy() {
    try { await navigator.clipboard.writeText(ticket); setMessage('Order details copied. Enter and verify them on your broker’s website.'); }
    catch { setMessage('Copy is unavailable. Select and copy the order details below.'); }
  }
  return <div className="broker-trade">
    <h3>Continue with your broker</h3>
    <p className="muted small">Log in and confirm on your broker’s website. Alpha Nova does not receive your password or sync your account.</p>
    <div className="segments broker-options" aria-label="Choose broker">{BROKERS.map(b => <button type="button" key={b.id} aria-pressed={brokerId===b.id} className={brokerId===b.id?'active':''} onClick={()=>{setBrokerId(b.id);setMessage('');}}>{b.name}</button>)}</div>
    <p className="small">{direct ? 'Prefilled entry order · review and submit in Kite.' : brokerId==='zerodha' ? 'Manual handoff · prefilled orders are not enabled yet.' : 'Manual handoff · copy the ticket, then enter the order at your broker.'}</p>
    {error ? <p className="notice">{error}</p> : <>
      <textarea className="broker-ticket" aria-label="Order details to copy" readOnly value={ticket} rows={7} onFocus={e=>e.target.select()}/>
      <p className="small broker-important">Only the entry order is prepared. Stop-loss and target orders must be placed separately at your broker. Check the current broker quote before submitting.</p>
      <div className="broker-actions">
        <button type="button" className="button" onClick={copy}>Copy order details</button>
        {direct ? <form method="post" action={KITE_BASKET_URL} target="_blank" rel="noopener noreferrer" onSubmit={()=>setMessage('Continue in Kite. Check its order book before retrying; this app cannot confirm submission or fills.')}>
          <input type="hidden" name="api_key" value={publisherKey}/>
          <input type="hidden" name="data" value={JSON.stringify([order])}/>
          <button className="button primary" type="submit">Review order in Zerodha ↗</button>
        </form> : <a className="button primary" href={broker.url} target="_blank" rel="noopener noreferrer">Open {broker.name} ↗</a>}
      </div>
    </>}
    <p className="small muted">Opens a new tab. No automatic order tracking; journal records stay manual.</p>
    {message && <p className="notice" role="status">{message}</p>}
  </div>;
}
