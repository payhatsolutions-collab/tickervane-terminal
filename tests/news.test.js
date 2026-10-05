import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregateNews, dedupeNews, parseNews } from '../api/market.js';
const rss = (title='India earnings improve') => `<rss><channel><item><title>${title}</title><link>https://example.com/story</link><source>Reuters</source><pubDate>Mon, 05 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
test('a blocked feed does not discard healthy coverage', async () => {
 const result=await aggregateNews('^GSPC',null,async url => {if(url.includes('investing.com/rss'))throw Error('Blocked');return {ok:true,text:async()=>rss()};});
 assert.equal(result.items.length,1);assert.deepEqual(result.failedSources,['Investing.com']);assert.equal(result.items[0].source,'Reuters');
});
test('all failed sources produce a retryable error, not a successful empty feed',async()=>{
 await assert.rejects(aggregateNews('^NSEI',null,async()=>{throw Error('offline');}),/temporarily unavailable/);
});
test('HTML challenge pages are treated as failed feeds',async()=>{
 await assert.rejects(aggregateNews('^NSEI',null,async()=>({ok:true,text:async()=>'<html>challenge</html>'})),/temporarily unavailable/);
});
test('successful empty RSS is an honest empty result',async()=>{
 const result=await aggregateNews('^NSEI',null,async()=>({ok:true,text:async()=>'<rss><channel></channel></rss>'}));assert.deepEqual(result.items,[]);assert.deepEqual(result.failedSources,[]);
});
test('deduplicates syndicated headlines and tracked URLs',()=>{
 assert.equal(dedupeNews([{title:'Earnings rise - Reuters',source:'Reuters',url:'https://a.com/1'}, {title:'Earnings rise',source:'Reuters',url:'https://b.com/2'}, {title:'Another title',source:'Reuters',url:'https://a.com/1?utm_source=feed'}]).length,1);
});
test('publisher fallback is correct for Investing RSS',()=>{
 assert.equal(parseNews('<rss><item><title>Markets</title><link>https://www.investing.com/news/1</link></item></rss>','Investing.com')[0].source,'Investing.com');
});
test('company feed excludes other companies and retains filings on publisher failure',async()=>{
 const result=await aggregateNews('AAPL','Apple',async()=>({ok:true,text:async()=>rss('Microsoft earnings')}),async()=>[{title:'AAPL 8-K',source:'SEC EDGAR',filing:true,url:'https://www.sec.gov/a',date:'2026-10-05'}]);assert.equal(result.items.length,1);assert.equal(result.items[0].kind,'filing');
});
