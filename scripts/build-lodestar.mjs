import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
// UI from yashsarda31/lodestar commit 4d172b4775fbd8c16768d52ca81012a738ab77b2.
// Keep its markup and CSS intact. Only data transport and parent navigation differ.
const original = await readFile('vendor/lodestar/index.html', 'utf8');
const css = original.match(/<style>([\s\S]*?)<\/style>/)[1];
let js = original.match(/<script>([\s\S]*?)<\/script>/)[1];
const replace = (from, to) => {
  if (!js.includes(from)) throw new Error('Lodestar integration point changed: ' + from.slice(0, 60));
  js = js.replace(from, to);
};
replace('const STATIC=!!window.LODESTAR_STATIC;', 'const STATIC=true;');
replace('async function snapIndex(){if(!IDX){const r=await fetch("data/index.json",{cache:"no-cache"});if(!r.ok)throw new Error("The snapshot index didn\'t load.");IDX=await r.json()}return IDX}', 'async function snapIndex(){return market.index()}');
replace('const r=await fetch("data/"+hit.file,{cache:"no-cache"});if(!r.ok)throw new Error("That company\'s snapshot file didn\'t load. Try again in a moment.");\n  return await r.json();', 'return market.analyze(hit);');
replace('Hosted snapshot · ${ix.items.length} companies (NIFTY 200 + large US names) · refreshed ${ix.builtAt}', '${ix.items.length} companies · ${ix.fullCount} published reports · on-demand six-pillar analysis for other companies');
replace('“${t}” isn\'t in this hosted snapshot. It covers ${ix.items.length} companies (the NIFTY 200 plus large US names). Run Lodestar locally to analyse any ticker.', '“${t}” did not match the ${ix.items.length} companies in this directory. Try a ticker or company name.');
replace('if(push)history.pushState({t:j.meta.symbol},"",url);', 'if(push){history.replaceState({t:j.meta.symbol},"",url);parent.postMessage({type:"lodestar:select",symbol:j.meta.symbol},location.origin);}');
replace('history.pushState({},"",location.pathname)', 'history.replaceState({},"",location.pathname)');
// Preserve source identity for statements obtained outside the published score universe.
replace(' · YAHOO FINANCE</div>', ' · ${esc(j.source || "YAHOO FINANCE")}</div>');
replace('DATA COVERAGE ${Math.round(V.coverage*100)}%', '${V.coverageText ? esc(V.coverageText) : "DATA COVERAGE " + Math.round(V.coverage*100) + "%"}');
replace('<span class="mw">${m.weight}%</span>', '<span class="mw">${has(m.weight)?m.weight+"%":"—"}</span>');
replace("'<div class=\"none\">Nothing in the numbers scores high enough to argue for it.</div>'", '`<div class="none">${j.extended?"A scored bull case is unavailable for this company.":"Nothing in the numbers scores high enough to argue for it."}</div>`');
replace("'<div class=\"none\">No metric scores low enough to count against it.</div>'", '`<div class="none">${j.extended?"A scored bear case is unavailable for this company.":"No metric scores low enough to count against it."}</div>`');
replace('show("report");render(j);', 'show("report");render(j);if(j.stale){const p=document.createElement("p");p.className="cnote";p.textContent=j.warning||"Showing the last available snapshot.";$("#report").prepend(p);}$(".src").textContent=(j.source||"Yahoo Finance")+" · "+(j.extended?"reported financials":"dated snapshot");');
js = 'import { createMarketBridge } from "./adapter.js";\nconst market=createMarketBridge();\n' + js;
js += '\naddEventListener("message",e=>{if(e.origin!==location.origin||e.source!==parent||e.data?.type!=="alphanova:select"||typeof e.data.symbol!=="string"||!/^[A-Z0-9][A-Z0-9.&_-]{0,24}$/.test(e.data.symbol))return;run(e.data.symbol,false);});\n';
const html = original.replace(/<style>[\s\S]*?<\/style>/, '<link rel="stylesheet" href="./lodestar.css">').replace(/<script>[\s\S]*?<\/script>/, '<script type="module" src="./lodestar.js"></script>').replace('</head>', '<meta name="robots" content="noindex, follow">\n</head>');
await mkdir('public/lodestar', { recursive: true });
await Promise.all([writeFile('public/lodestar/index.html', html), writeFile('public/lodestar/lodestar.css', css), writeFile('public/lodestar/lodestar.js', js)]);
console.log('Lodestar original UI built; CSS sha256 ' + createHash('sha256').update(css).digest('hex'));
