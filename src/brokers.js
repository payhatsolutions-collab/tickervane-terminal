import {stockDirectory} from './stocks.js';

export const BROKERS = [
  {id:'zerodha', name:'Zerodha', url:'https://kite.zerodha.com/'},
  {id:'groww', name:'Groww', url:'https://groww.in/'},
  {id:'icici', name:'ICICI Direct', url:'https://www.icicidirect.com/'},
];
export const KITE_BASKET_URL = 'https://kite.zerodha.com/connect/basket';
const symbols = new Set(stockDirectory.map(stock => stock.symbol));

export function buildBrokerOrder({symbol, currency, side, product, entry, quantity}) {
  const tradingsymbol = typeof symbol === 'string' && symbol.endsWith('.NS') ? symbol.slice(0,-3) : '';
  if (currency !== 'INR' || !symbols.has(tradingsymbol)) return {error:'Broker handoff supports stocks in our NSE directory only.'};
  if (!['long','short'].includes(side)) return {error:'Choose a trade direction.'};
  if (!['delivery','intraday'].includes(product)) return {error:'Choose Delivery or Intraday to prepare a broker order.'};
  if (side === 'short' && product !== 'intraday') return {error:'Short plans require Intraday. Delivery selling needs a separate holdings check.'};
  if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isFinite(Number(entry)) || Number(entry) <= 0) return {error:'Complete a valid plan with a positive price and whole-share quantity.'};
  return {order:{variety:'regular', exchange:'NSE', tradingsymbol, transaction_type:side === 'short' ? 'SELL' : 'BUY', quantity, order_type:'LIMIT', price:Number(entry), product:product === 'delivery' ? 'CNC' : 'MIS', validity:'DAY', readonly:false}};
}

export function orderTicket(order, stop, target) {
  return `${order.transaction_type} ${order.tradingsymbol} · ${order.exchange}\nQuantity: ${order.quantity} shares\nLimit price: INR ${order.price}\nProduct: ${order.product === 'CNC' ? 'Delivery' : 'Intraday'} · Validity: DAY\nPlanning reference only — stop: ${stop}; target: ${target}\nStop and target are NOT included in this entry order. Verify the instrument, tick size, price and quantity at your broker before submitting.`;
}
