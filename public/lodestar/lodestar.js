import { createMarketBridge } from "./adapter.js";
const market=createMarketBridge();

"use strict";
/* ═════════════ helpers ═════════════ */
const $=(s,r=document)=>r.querySelector(s), $$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const has=v=>v!==null&&v!==undefined&&!Number.isNaN(v);
const SYM={INR:"₹",USD:"$",EUR:"€",GBP:"£",JPY:"¥",CNY:"¥",HKD:"HK$",KRW:"₩",CAD:"C$",AUD:"A$",CHF:"CHF ",SGD:"S$",TWD:"NT$",BRL:"R$",SEK:"kr ",GBp:"p"};
const sym=c=>SYM[c]??(c?c+" ":"");
const loc=c=>c==="INR"?"en-IN":"en-US";
function money(v,c){
  if(!has(v))return "—";
  const a=Math.abs(v),s=v<0?"−":"",p=sym(c);
  if(c==="INR"){
    if(a>=1e12)return s+p+(a/1e12).toFixed(2)+"L Cr";
    if(a>=1e9)return s+p+Math.round(a/1e7).toLocaleString("en-IN")+" Cr";
    if(a>=1e7)return s+p+(a/1e7).toFixed(1)+" Cr";
    return s+p+Math.round(a).toLocaleString("en-IN");
  }
  if(a>=1e12)return s+p+(a/1e12).toFixed(2)+"T";
  if(a>=1e9)return s+p+(a/1e9).toFixed(a>=1e11?0:1)+"B";
  if(a>=1e6)return s+p+(a/1e6).toFixed(a>=1e8?0:1)+"M";
  return s+p+Math.round(a).toLocaleString("en-US");
}
function scaleFor(maxAbs,c){
  const p=sym(c).trim();
  if(c==="INR")return maxAbs>=1e12?{div:1e12,dp:2,unit:"₹ lakh crore"}:{div:1e7,dp:maxAbs>=1e10?0:1,unit:"₹ crore"};
  if(maxAbs>=1e12)return{div:1e12,dp:2,unit:p+" trillion"};
  if(maxAbs>=1e9)return{div:1e9,dp:maxAbs>=1e11?0:1,unit:p+" billion"};
  if(maxAbs>=1e6)return{div:1e6,dp:maxAbs>=1e8?0:1,unit:p+" million"};
  return{div:1,dp:0,unit:p};
}
const scaled=(sc,c)=>v=>(v/sc.div).toLocaleString(loc(c),{minimumFractionDigits:sc.dp,maximumFractionDigits:sc.dp}).replace("-","−");
const px=(v,c,dp)=>!has(v)?"—":(v<0?"−":"")+sym(c)+Math.abs(v).toLocaleString(loc(c),{minimumFractionDigits:dp??(Math.abs(v)>=1000?0:2),maximumFractionDigits:dp??(Math.abs(v)>=1000?0:2)});
const pc=(v,dp=1)=>!has(v)?"—":v.toFixed(dp).replace("-","−")+"%";
const spc=(v,dp=1)=>!has(v)?"—":(v>0?"+":v<0?"−":"")+Math.abs(v).toFixed(dp)+"%";
const mult=(v,dp=1)=>!has(v)?"—":v.toFixed(dp)+"×";
function unit(m){
  if(m.display)return m.display;
  const v=m.value; if(!has(v))return "—";
  switch(m.unit){
    case "pct":return pc(v); case "pct2":return pc(v,2); case "spct":return Math.abs(v)>=1000?"n/m":spc(v);
    case "pp":return (v>0?"+":v<0?"−":"")+Math.abs(v).toFixed(1)+" pts";
    case "x":return mult(v,2); case "x1":return mult(v,1); default:return (+v).toFixed(2);
  }
}
const band=s=>!has(s)?"none":s>=65?"good":s>=45?"warn":"bad";
const STAR='<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c.8 7 5 11.2 12 12-7 .8-11.200 5-12 12-.8-7-5-11.200-12-12 7-.8 11.200-5 12-12z"/></svg>';
const reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;
function countUp(el,to,dur=1500,fmt=v=>Math.round(v)){
  if(reduce||!has(to)){el.textContent=has(to)?fmt(to):"—";return}
  const t0=performance.now();
  (function f(t){const k=Math.min(1,(t-t0)/dur),e=1-Math.pow(1-k,4);el.textContent=fmt(to*e);if(k<1)requestAnimationFrame(f)})(t0);
}

/* ═════════════ tooltip ═════════════ */
const tip=$("#tip");
function showTip(ev,title,rows){
  tip.innerHTML=`<div class="tt">${esc(title)}</div>`+rows.filter(Boolean).map(r=>`<div class="tr"><span>${r[2]?`<i style="background:${r[2]}"></i>`:""}${esc(r[0])}</span><b>${esc(r[1])}</b></div>`).join("");
  tip.classList.add("on");
  const w=tip.offsetWidth,h=tip.offsetHeight;
  let x=ev.clientX+16,y=ev.clientY-h-14;
  if(x+w>innerWidth-10)x=ev.clientX-w-16; if(y<10)y=ev.clientY+18;
  tip.style.transform=`translate(${Math.max(8,x)}px,${y}px)`;
}
const hideTip=()=>tip.classList.remove("on");

/* ═════════════ charts (hand-rolled SVG) ═════════════ */
function niceTicks(lo,hi,n=4){
  if(lo===hi){lo-=1;hi+=1}
  const raw=(hi-lo)/n,mag=Math.pow(10,Math.floor(Math.log10(raw))),f=raw/mag;
  const step=(f<1.5?1:f<3?2:f<7?5:10)*mag;
  const a=Math.floor(lo/step)*step,b=Math.ceil(hi/step)*step,out=[];
  for(let v=a;v<=b+step*1e-6;v+=step)out.push(+v.toFixed(10));
  return out;
}
/* Columns: one series, reported vs estimate distinguished by tone + an "E" on the label. */
function colChart(host,d){
  const W=Math.max(260,host.clientWidth),H=248,m={t:30,r:4,b:30,l:4},n=d.vals.length;
  const live=d.vals.filter(has); if(!live.length){host.innerHTML='<p class="cnote">No data from Yahoo Finance for this view.</p>';return}
  const vmax=Math.max(0,...live),vmin=Math.min(0,...live),span=(vmax-vmin)||1;
  const ph=H-m.t-m.b-(vmin<0?20:0),y=v=>m.t+(vmax-v)/span*ph,y0=y(0);
  const bw=(W-m.l-m.r)/n,w=Math.min(24,bw*.5),lastRep=d.est?d.est.lastIndexOf(false):n-1;
  const every=bw<54?2:1;
  let s=`<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(d.aria||"")}">`;
  s+=`<line class="ax" x1="${m.l}" x2="${W-m.r}" y1="${y0}" y2="${y0}"/>`;
  d.vals.forEach((v,i)=>{
    const cx=m.l+bw*i+bw/2,est=d.est&&d.est[i];
    s+=`<text x="${cx}" y="${H-7}" text-anchor="middle">${esc(d.cats[i])}</text>`;
    if(!has(v)){s+=`<text x="${cx}" y="${y0-8}" text-anchor="middle">n/a</text>`;return}
    const yv=y(v),h=Math.abs(yv-y0),r=Math.min(4,h/2,w/2),x0=cx-w/2,x1=cx+w/2,up=v>=0;
    const p=up?`M${x0},${y0}V${yv+r}Q${x0},${yv} ${x0+r},${yv}H${x1-r}Q${x1},${yv} ${x1},${yv+r}V${y0}Z`
              :`M${x0},${y0}V${yv-r}Q${x0},${yv} ${x0+r},${yv}H${x1-r}Q${x1},${yv} ${x1},${yv-r}V${y0}Z`;
    s+=`<path class="bar" data-i="${i}" d="${p}" fill="var(--s1)" fill-opacity="${est?.36:1}" style="transform-origin:0 ${y0}px;transition-delay:${i*60}ms"/>`;
    if((n-1-i)%every===0||i===lastRep)
      s+=`<text class="cap${i===lastRep?" now":""}" x="${cx}" y="${up?yv-8:yv+15}" text-anchor="middle">${esc(d.fmt(v))}</text>`;
  });
  d.vals.forEach((v,i)=>{s+=`<rect data-i="${i}" x="${m.l+bw*i}" y="0" width="${bw}" height="${H}" fill="transparent"/>`});
  s+="</svg>";
  host.innerHTML=s;
  const svg=host.firstChild;
  $$("rect[data-i]",svg).forEach(r=>{
    const i=+r.dataset.i;
    r.addEventListener("pointermove",e=>{
      svg.classList.add("hov");$$(".bar",svg).forEach(b=>b.classList.toggle("hot",+b.dataset.i===i));
      showTip(e,d.cats[i]+(d.est&&d.est[i]?" · consensus":""),d.tip(i));
    });
    r.addEventListener("pointerleave",()=>{svg.classList.remove("hov");hideTip()});
  });
}
/* Lines: 1–3 series on one axis; the legend (outside) carries identity and latest values. */
function lineChart(host,d){
  const W=Math.max(260,host.clientWidth),H=248,m={t:12,r:14,b:30,l:42},n=d.cats.length;
  const all=d.series.flatMap(s=>s.vals).filter(has);
  if(all.length<2){host.innerHTML='<p class="cnote">Not enough data from Yahoo Finance to draw this.</p>';return}
  let lo=Math.min(...all),hi=Math.max(...all);const pad=(hi-lo||Math.abs(hi)||1)*.12;lo-=pad;hi+=pad;if(Math.min(...all)>=0&&lo<0)lo=0;
  const tk=niceTicks(lo,hi,4);lo=tk[0];hi=tk[tk.length-1];
  const pw=W-m.l-m.r,ph=H-m.t-m.b,x=i=>m.l+(n===1?pw/2:i*pw/(n-1)),y=v=>m.t+(hi-v)/(hi-lo)*ph;
  let s=`<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="${esc(d.aria||"")}">`;
  tk.forEach(t=>{s+=`<line class="${t===0?"ax":"gl"}" x1="${m.l}" x2="${W-m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l-8}" y="${y(t)+4}" text-anchor="end">${esc(d.tick(t))}</text>`});
  d.cats.forEach((c,i)=>{s+=`<text x="${x(i)}" y="${H-9}" text-anchor="${i===0&&n>1?"start":i===n-1&&n>1?"end":"middle"}">${esc(c)}</text>`});
  s+=`<line class="xh" y1="${m.t}" y2="${m.t+ph}"/>`;
  d.series.forEach(se=>{
    let p="",pen=false;
    se.vals.forEach((v,i)=>{if(!has(v)){pen=false;return}p+=(pen?"L":"M")+x(i).toFixed(1)+","+y(v).toFixed(1);pen=true});
    s+=`<path class="ln" pathLength="1" d="${p}" stroke="${se.color}"/>`;
    se.vals.forEach((v,i)=>{if(has(v))s+=`<circle class="pt" cx="${x(i)}" cy="${y(v)}" r="${i===n-1?5:4}" fill="${se.color}"/>`});
  });
  s+=`<rect class="hit" x="${m.l-10}" y="0" width="${pw+20}" height="${H}" fill="transparent"/></svg>`;
  host.innerHTML=s;
  const svg=host.firstChild,xh=$(".xh",svg),hit=$(".hit",svg);
  hit.addEventListener("pointermove",e=>{
    const b=svg.getBoundingClientRect(),rx=(e.clientX-b.left)*W/b.width,i=n===1?0:Math.max(0,Math.min(n-1,Math.round((rx-m.l)/(pw/(n-1)))));
    xh.setAttribute("x1",x(i));xh.setAttribute("x2",x(i));xh.style.opacity=.5;
    showTip(e,d.cats[i],d.series.map(se=>[se.name,d.fmt(se.vals[i]),se.color]));
  });
  hit.addEventListener("pointerleave",()=>{xh.style.opacity=0;hideTip()});
}
/* Price: weekly close with the mean analyst target as a labelled reference line. */
function priceChart(host,d){
  const W=Math.max(260,host.clientWidth),H=300,m={t:16,r:76,b:28,l:8},P=d.pts,n=P.length;
  if(n<10){host.innerHTML='<p class="cnote">No price history available.</p>';return}
  const vals=P.map(p=>p[1]);let lo=Math.min(...vals),hi=Math.max(...vals);
  if(has(d.target)){lo=Math.min(lo,d.target);hi=Math.max(hi,d.target)}
  const tk=niceTicks(lo*.97,hi*1.02,4);lo=tk[0];hi=tk[tk.length-1];
  const pw=W-m.l-m.r,ph=H-m.t-m.b,x=i=>m.l+i*pw/(n-1),y=v=>m.t+(hi-v)/(hi-lo)*ph;
  let s=`<svg viewBox="0 0 ${W} ${H}" height="${H}" role="img" aria-label="Weekly closing price, five years">`;
  s+=`<defs><linearGradient id="pw" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--s1)" stop-opacity=".22"/><stop offset="1" stop-color="var(--s1)" stop-opacity="0"/></linearGradient></defs>`;
  tk.forEach(t=>{s+=`<line class="gl" x1="${m.l}" x2="${W-m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${W-m.r+10}" y="${y(t)+4}">${esc(d.fmt(t))}</text>`});
  let yr=null;P.forEach((p,i)=>{const yy=p[0].slice(0,4);if(yy!==yr){if(yr!==null&&x(i)<W-m.r-30)s+=`<text x="${x(i)}" y="${H-8}" text-anchor="middle">${yy}</text>`;yr=yy}});
  const path=P.map((p,i)=>(i?"L":"M")+x(i).toFixed(1)+","+y(p[1]).toFixed(1)).join("");
  s+=`<path class="wash" d="${path}L${x(n-1)},${m.t+ph}L${x(0)},${m.t+ph}Z" fill="url(#pw)"/>`;
  if(has(d.target)){
    const ty=y(d.target),ly=Math.abs(ty-y(vals[n-1]))<16?(ty<y(vals[n-1])?ty-9:ty+15):ty-7;
    s+=`<line x1="${m.l}" x2="${W-m.r}" y1="${ty}" y2="${ty}" stroke="var(--ink-2)" stroke-width="1"/><text class="note" x="${m.l+4}" y="${ly}">Mean analyst target ${esc(d.fmt(d.target))}</text>`;
  }
  s+=`<path class="ln" pathLength="1" d="${path}" stroke="var(--s1)"/>`;
  s+=`<line class="xh" y1="${m.t}" y2="${m.t+ph}"/><circle class="xd" r="5" fill="var(--s1)" stroke="var(--surface)" stroke-width="2" opacity="0"/>`;
  s+=`<circle class="pt" cx="${x(n-1)}" cy="${y(vals[n-1])}" r="5" fill="var(--s1)"/>`;
  s+=`<rect class="hit" x="${m.l}" y="0" width="${pw}" height="${H}" fill="transparent"/></svg>`;
  host.innerHTML=s;
  const svg=host.firstChild,xh=$(".xh",svg),xd=$(".xd",svg);
  $(".hit",svg).addEventListener("pointermove",e=>{
    const b=svg.getBoundingClientRect(),rx=(e.clientX-b.left)*W/b.width,i=Math.max(0,Math.min(n-1,Math.round((rx-m.l)/(pw/(n-1)))));
    xh.setAttribute("x1",x(i));xh.setAttribute("x2",x(i));xh.style.opacity=.5;
    xd.setAttribute("cx",x(i));xd.setAttribute("cy",y(vals[i]));xd.setAttribute("opacity",1);
    const dt=new Date(P[i][0]+"T00:00:00").toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"});
    showTip(e,"Week of "+dt,[["Close",d.fmt(vals[i])],has(d.target)?["vs mean target",spc((d.target/vals[i]-1)*100)]:null]);
  });
  $(".hit",svg).addEventListener("pointerleave",()=>{xh.style.opacity=0;xd.setAttribute("opacity",0);hideTip()});
}

/* A chart block: optional Annual/Quarterly modes, a legend, and a table twin for every chart. */
const blocks=[];
function chartBlock(host,cfg){
  const modes=Object.keys(cfg.modes);let mode=modes[0],table=false;
  host.innerHTML=`<div class="chead"><span class="ct"></span><span class="ctl">${modes.length>1?`<span class="seg" role="tablist">${modes.map((k,i)=>`<button role="tab" class="${i?"":"on"}" data-m="${esc(k)}">${esc(k)}</button>`).join("")}</span>`:""}<button class="tbtn" aria-pressed="false">Table</button></span></div><div class="legend"></div><div class="plot"></div><p class="cnote" hidden></p>`;
  const plot=$(".plot",host),leg=$(".legend",host),ct=$(".ct",host),note=$(".cnote",host),tb=$(".tbtn",host);
  function draw(){
    const c=cfg.modes[mode];
    ct.textContent=c.title||"";
    leg.innerHTML=(c.legend||[]).map(l=>`<span><i class="${l.sq?"sq":""}" style="--c:${l.color};${l.op?`opacity:${l.op}`:""}"></i>${esc(l.name)}${l.val?` <b>${esc(l.val)}</b>`:""}</span>`).join("");
    leg.hidden=!(c.legend||[]).length;
    note.hidden=!c.note;note.textContent=c.note||"";
    if(table){
      const t=c.table();
      plot.innerHTML=`<div class="tvwrap"><table class="tv"><thead><tr>${t.head.map(h=>`<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${t.rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    }else c.draw(plot);
  }
  $$(".seg button",host).forEach(b=>b.addEventListener("click",()=>{mode=b.dataset.m;$$(".seg button",host).forEach(x=>x.classList.toggle("on",x===b));draw()}));
  tb.addEventListener("click",()=>{table=!table;tb.classList.toggle("on",table);tb.setAttribute("aria-pressed",table);tb.textContent=table?"Chart":"Table";draw()});
  draw();blocks.push(draw);
}
let rsT;addEventListener("resize",()=>{clearTimeout(rsT);rsT=setTimeout(()=>blocks.forEach(f=>f()),160)});

/* ═════════════ report ═════════════ */
function trackPos(lo,hi){const s=(hi-lo)||1;return v=>Math.max(0,Math.min(100,(v-lo)/s*100)).toFixed(2)+"%"}

function scorecard(p){
  return `<div class="scard"><div class="hd"><span>Metric</span><span>Value</span><span>Score</span><span></span><span>Weight</span></div>`+
    p.metrics.map(m=>{const na=!has(m.score);return `<div class="mrow${na?" na":""}"><span class="ml">${esc(m.label)}</span><span class="mv">${esc(unit(m))}</span><span class="meter" data-band="${band(m.score)}"><i style="--w:${na?0:Math.max(3,m.score)}%"></i></span><span class="ms">${na?"—":Math.round(m.score)}</span><span class="mw">${has(m.weight)?m.weight+"%":"—"}</span></div>`}).join("")+`</div>`;
}
function pillarCard(p,i,extra="",cls=""){
  return `<article class="card pillar reveal ${cls}" id="p-${p.key}">
    <header><span class="idx">0${i+1}</span><h3>${esc(p.name)}</h3><span class="schip"><span class="dot" data-band="${band(p.score)}"></span><b>${has(p.score)?Math.round(p.score):"—"}</b>${esc(p.grade)}</span></header>
    <p class="headline">${esc(p.headline)}</p><p class="blurb">${esc(p.blurb)}</p>
    <div class="cb" data-chart="${p.key}"></div>${extra}${scorecard(p)}</article>`;
}

function render(j){
  const M=j.meta,V=j.verdict,F=j.forward,VA=j.valuation,fc=M.finCurrency,cur=M.currency,P=Object.fromEntries(j.pillars.map(p=>[p.key,p]));
  document.body.dataset.verdict=V.action;
  blocks.length=0;
  const callWord={BUY:"Buy",HOLD:"Hold",SELL:"Sell","NO CALL":"No call"}[V.action];
  const up=(M.changePct??0)>=0;
  const p52=has(M.low52)&&has(M.high52)&&M.high52>M.low52?trackPos(M.low52,M.high52)(M.price):null;
  const tags=[M.exchange,M.sector,M.industry].filter(Boolean);
  const eFmt=v=>px(v,F.estCurrency||fc,Math.abs(v)>=1000?0:2);

  /* dial geometry: 240° sweep */
  const cx=130,cy=128,R=100,a0=150,sw=240,pt=(deg,r=R)=>[cx+r*Math.cos(deg*Math.PI/180),cy+r*Math.sin(deg*Math.PI/180)];
  const [sx,sy]=pt(a0),[ex,ey]=pt(a0+sw),arc=`M${sx},${sy}A${R},${R} 0 1 1 ${ex},${ey}`;
  const tickAt=(v,l)=>{const d=a0+sw*v/100,[x1,y1]=pt(d,R+9),[x2,y2]=pt(d,R+16),[tx,ty]=pt(d,R+28);return `<line class="tick" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><text x="${tx}" y="${ty+3}" text-anchor="middle">${l}</text>`};

  /* forward panels */
  const ests=F.eps.filter(e=>has(e.avg));
  let estHtml='<p class="cnote">Yahoo Finance carries no consensus EPS estimates for this stock.</p>';
  if(ests.length){
    const all=[F.epsBase,...ests.flatMap(e=>[e.low,e.high,e.avg])].filter(has),lo=Math.min(...all),hi=Math.max(...all),padv=(hi-lo||Math.abs(hi)||1)*.08,tp=trackPos(lo-padv,hi+padv);
    estHtml=(has(F.epsBase)?`<div class="est"><span class="p">${esc(M.lastFY)} base</span><div class="trackx"><span class="mk" style="--p:${tp(F.epsBase)};--c:var(--ink-3)"></span></div><span class="v">${eFmt(F.epsBase)}<small>analysts' base year</small></span></div>`:"")+
      ests.map(e=>`<div class="est"><span class="p">${esc(e.period)}</span><div class="trackx">${has(e.low)&&has(e.high)?`<span class="rg" style="--a:${tp(e.low)};--b:${tp(e.high)}"></span>`:""}<span class="mk" style="--p:${tp(e.avg)}"></span></div><span class="v">${eFmt(e.avg)}<small>${has(e.growth)?spc(e.growth)+" · ":""}${has(e.analysts)?e.analysts+" analysts":""}</small></span></div>`).join("")+
      `<div class="legend" style="margin-top:12px"><span><i class="sq" style="--c:var(--s1);border-radius:50%"></i>Consensus mean</span><span><i class="sq" style="--c:var(--s1);opacity:.3;width:22px"></i>Lowest to highest estimate</span></div>`+
      (has(F.basisGap)?`<p class="cnote">Analysts' base-year EPS differs from reported EPS by ${spc(F.basisGap)} — typically standalone vs consolidated, or adjusted vs reported. Growth is measured on the analysts' own base.</p>`:"");
  }
  const R_=F.revisions;let revHtml='<p class="cnote">Too few revisions in the last 30 days to read a direction.</p>';
  if(has(R_.up30)&&has(R_.down30)){const t=R_.up30+R_.down30;
    revHtml=`<div class="rev">${R_.up30?`<i class="u" style="width:${R_.up30/t*100}%"></i>`:""}${R_.down30?`<i class="d" style="width:${R_.down30/t*100}%"></i>`:""}</div>
    <div class="kvs"><span><i style="background:var(--good);clip-path:polygon(50% 0,100% 100%,0 100%)"></i>Raised EPS estimates, 30 days</span><b>${R_.up30}</b><span><i style="background:var(--bad);clip-path:polygon(0 0,100% 0,50% 100%)"></i>Cut EPS estimates, 30 days</span><b>${R_.down30}</b>
    ${has(F.trend.d30)?`<span>Consensus EPS drift, 30 days</span><b>${spc(F.trend.d30)}</b>`:""}${has(F.trend.d90)?`<span>Consensus EPS drift, 90 days</span><b>${spc(F.trend.d90)}</b>`:""}</div>`}
  const T=F.target;let tgtHtml='<p class="cnote">No analyst price targets on Yahoo Finance.</p>';
  if(has(T.mean)){const all=[T.low,T.high,T.mean,M.price].filter(has),lo=Math.min(...all),hi=Math.max(...all),pd=(hi-lo||1)*.06,tp=trackPos(lo-pd,hi+pd);
    tgtHtml=`<div class="trackx">${has(T.low)&&has(T.high)?`<span class="rg neutral" style="--a:${tp(T.low)};--b:${tp(T.high)}"></span>`:""}<span class="tk" style="--p:${tp(T.mean)}"></span><span class="mk dia" style="--p:${tp(M.price)}"></span></div>
    <div class="kvs"><span><i style="background:var(--ink);transform:rotate(45deg) scale(.8)"></i>Price now</span><b>${px(M.price,cur)}</b><span><i style="background:var(--ink-2);width:2px;margin-left:4px;margin-right:12px"></i>Mean target</span><b>${px(T.mean,cur)} · ${spc(T.upside)}</b>${has(T.low)&&has(T.high)?`<span><i style="background:rgba(255,255,255,.2);border-radius:3px"></i>Lowest to highest target</span><b>${px(T.low,cur)} – ${px(T.high,cur)}</b>`:""}</div>`}
  const RT=F.rating;let rateHtml="";
  if(has(RT.mean))rateHtml=`<div class="panel"><h4>Analyst rating${has(RT.analysts)?` · ${RT.analysts} analysts`:""}</h4><div class="scale5"><i></i><i></i><i></i><i></i><i></i><b style="--p:${((RT.mean-1)/4*100).toFixed(1)}%"></b></div><div class="ends"><span>Strong buy</span><span>${RT.mean.toFixed(2)} — ${esc(String(RT.key||"").replace(/_/g," "))}</span><span>Sell</span></div></div>`;
  const fwdExtra=`<div class="panels"><div class="panel"><h4>Consensus EPS</h4>${estHtml}</div><div style="display:grid;gap:30px;align-content:start"><div class="panel"><h4>Estimate revisions</h4>${revHtml}</div><div class="panel"><h4>Price target</h4>${tgtHtml}</div>${rateHtml}</div></div>`;

  /* valuation panels */
  let peHtml='<p class="cnote">No positive earnings to build a P/E on.</p>';
  if(has(VA.pe)||has(VA.fwdPE)){const b=VA.band,all=[VA.pe,VA.fwdPE>0?VA.fwdPE:null,b&&b.low,b&&b.high].filter(has),lo=Math.min(...all),hi=Math.max(...all),pd=(hi-lo||hi*.2||1)*.1,tp=trackPos(Math.max(0,lo-pd),hi+pd);
    peHtml=`<div class="trackx" style="height:26px">${b?`<span class="rg neutral" style="--a:${tp(b.low)};--b:${tp(b.high)}"></span><span class="tk" style="--p:${tp(b.median)}"></span>`:""}${has(VA.fwdPE)&&VA.fwdPE>0?`<span class="mk" style="--p:${tp(VA.fwdPE)};--c:var(--s2)"></span>`:""}${has(VA.pe)?`<span class="mk" style="--p:${tp(VA.pe)}"></span>`:""}</div>
    <div class="kvs">${has(VA.pe)?`<span><i style="background:var(--s1);border-radius:50%"></i>Trailing P/E, underlying earnings</span><b>${mult(VA.pe)}</b>`:""}${has(VA.fwdPE)&&VA.fwdPE>0?`<span><i style="background:var(--s2);border-radius:50%"></i>Forward P/E, next 12 months</span><b>${mult(VA.fwdPE)}</b>`:""}${b?`<span><i style="background:var(--ink-2);width:2px;margin-left:4px;margin-right:12px"></i>Own 5-year median</span><b>${mult(b.median)}</b><span><i style="background:rgba(255,255,255,.2);border-radius:3px"></i>Typical range (10th–90th percentile)</span><b>${mult(b.low)} – ${mult(b.high)}</b>`:""}</div>`}
  const tile=(l,v,s)=>`<div class="tile"><span>${l}</span><b>${v}</b>${s?`<small>${s}</small>`:""}</div>`;
  const valExtra=`<div class="panels"><div class="panel"><h4>P/E against its own history</h4>${peHtml}</div><div class="panel"><h4>Other yardsticks</h4><div class="tiles">
    ${tile("PEG",has(VA.peg)?VA.peg.toFixed(2):"—",has(F.fwdCagr)?`on ${pc(F.fwdCagr)} EPS growth`:"")}${tile("Price / book",mult(VA.pb,2))}${M.isLender?"":tile("EV / EBITDA",mult(VA.evEbitda))}${M.isLender?"":tile("FCF yield",pc(VA.fcfYield),M.lastFY)}${tile("Dividend yield",pc(VA.divYield,2))}${has(VA.de)?tile("Debt / equity",mult(VA.de,2),M.lastFY):""}</div></div></div>`;

  const du=j.dupont,dupHtml=du?`<div class="label" style="margin-top:22px">Where the ROE comes from · ${esc(M.lastFY)}</div><div class="dupont"><div><b>${pc(du.netMargin)}</b><span>Net margin</span></div><em>×</em><div><b>${du.turnover.toFixed(2)}×</b><span>Asset turnover</span></div><em>×</em><div><b>${du.leverage.toFixed(2)}×</b><span>Leverage</span></div><em>=</em><div class="eq"><b>${pc(du.roe)}</b><span>ROE</span></div></div>`:"";

  $("#report").innerHTML=`
  <div class="hero">
    <div class="hero-main reveal">
      <div class="eyebrow"><b>${esc(M.symbol)}</b>${tags.map(t=>" &nbsp;·&nbsp; "+esc(t)).join("")}</div>
      <h1>${esc(M.name)}</h1>
      <div class="quote"><span class="px">${px(M.price,cur,2)}</span>
        ${has(M.changePct)?`<span class="delta ${up?"up":"dn"}"><i>${up?"▲":"▼"}</i>${spc(M.changePct,2)} today</span>`:""}
        ${has(M.marketCap)?`<span class="kv">Market cap <b>${money(M.marketCap,cur)}</b></span>`:""}</div>
      ${p52?`<div class="range52"><span>52w ${px(M.low52,cur)}</span><span class="bar"><i style="--p:${p52}"></i></span><span>${px(M.high52,cur)}</span></div>`:""}
      <p class="summary">${esc(V.summary)}</p>
      <div class="stamp">AS OF ${esc(M.asOf.toUpperCase())} · STATEMENTS TO ${esc(M.lastFY)} · ${esc(j.source || "YAHOO FINANCE")}</div>
    </div>
    <aside class="card verdict reveal" aria-label="Verdict">
      <div class="label">The call</div>
      <svg class="dial" viewBox="0 0 260 214" role="img" aria-label="Composite score ${has(V.score)?Math.round(V.score):"not available"} out of 100">
        <path class="trk" d="${arc}"/><path class="arc" id="arc" pathLength="100" d="${arc}"/>
        ${tickAt(V.sellBelow,V.sellBelow)}${tickAt(V.buyAt,V.buyAt)}
        <text class="num" id="score" x="${cx}" y="${cy+16}" text-anchor="middle">0</text>
        <text class="of" x="${cx}" y="${cy+42}" text-anchor="middle">OUT OF 100</text>
      </svg>
      <div class="call"><small>${V.action==="NO CALL"?"Insufficient data":"Lodestar says"}</small>${callWord}</div>
      <p class="why">${V.caps.length?esc(V.caps[0]):`Buy at ${V.buyAt} and above · sell below ${V.sellBelow} · hold between.`}</p>
      <div class="cov">${V.coverageText ? esc(V.coverageText) : "DATA COVERAGE " + Math.round(V.coverage*100) + "%"}${has(M.analysts)?` · ${M.analysts} ANALYSTS`:""}</div>
    </aside>
  </div>

  <nav class="strip reveal" aria-label="Pillar scores">
    ${j.pillars.map(p=>`<a href="#p-${p.key}"><div class="nm">${esc(p.name==="Earnings per share"?"EPS":p.name==="Return on equity"?"ROE":p.name==="Forward estimates"?"Forward":p.name)}<span>${p.weight}%</span></div>
      <div class="sc${has(p.score)?"":" na"}" data-to="${has(p.score)?p.score:""}">${has(p.score)?0:"—"}</div>
      <span class="meter" data-band="${band(p.score)}"><i style="--w:${has(p.score)?Math.max(3,p.score):0}%"></i></span>
      <div class="gr"><span class="dot" data-band="${band(p.score)}"></span>${esc(p.grade)}</div></a>`).join("")}
  </nav>

  <div class="grid2">
    <section class="card case for reveal"><div class="label">The case for</div><h3>What's working</h3>
      ${j.bull.length?`<ul>${j.bull.map(b=>`<li><i>+</i><div>${esc(b.text)}<small>${esc(b.pillar)}</small></div></li>`).join("")}</ul>`:`<div class="none">${j.extended?"A scored bull case is unavailable for this company.":"Nothing in the numbers scores high enough to argue for it."}</div>`}</section>
    <section class="card case against reveal"><div class="label">The case against</div><h3>What isn't</h3>
      ${j.bear.length?`<ul>${j.bear.map(b=>`<li><i>−</i><div>${esc(b.text)}<small>${esc(b.pillar)}</small></div></li>`).join("")}</ul>`:`<div class="none">${j.extended?"A scored bear case is unavailable for this company.":"No metric scores low enough to count against it."}</div>`}</section>
  </div>
  ${j.flags.length?`<section class="card flags reveal"><div class="label">Red flags</div><ul>${j.flags.map(f=>`<li><b class="${f.level}">${f.level==="high"?"HIGH":f.level==="med"?"WATCH":"NOTE"}</b><span>${esc(f.text)}</span></li>`).join("")}</ul></section>`:""}

  <section class="card pillar reveal" style="margin-top:18px">
    <header><span class="idx">00</span><h3>Five years of price</h3></header>
    <div class="cb" data-chart="price"></div>
  </section>

  <div class="grid2">
    ${pillarCard(P.sales,0)}${pillarCard(P.margins,1)}
    ${pillarCard(P.eps,2)}${pillarCard(P.returns,3,dupHtml)}
    ${pillarCard(P.forward,4,fwdExtra,"span2 nochart")}
    ${pillarCard(P.valuation,5,valExtra,"span2 nochart")}
  </div>

  <details class="card method reveal">
    <summary>How the call is made</summary>
    <div class="body">
      <div>
        <h5>The score</h5>
        <p>Each pillar is a weighted set of metrics. Every metric is mapped to 0–100 through a fixed hurdle table — for example, ${fc==="INR"?"15% sales growth scores 72 and 20% ROE scores 80":"about 10% sales growth scores 72 and 20% ROE scores 80"}. Pillar scores are then weighted: Sales 15, Margins 15, EPS 20, ROE 15, Forward 20, Valuation 15.</p>
        <p><b>Buy</b> at ${V.buyAt} and above, <b>sell</b> below ${V.sellBelow}, <b>hold</b> in between. Three guard-rails cap a buy at hold: a valuation pillar under 30, a forward pillar under 35, or losses with no forecast profit.</p>
        <h5>What it is not</h5>
        <p>The hurdles are judgment, not a backtest — nobody has measured whether a score of 70 outperforms a score of 50. Growth hurdles are ${fc==="INR"?"set for a ~10–11% nominal-growth economy":"scaled down for a lower nominal-growth economy"}. Margins are scored on absolute levels, with no peer comparison, so structurally thin-margin businesses (retail, distribution, contract manufacturing) score low on that pillar by construction. Sell-side targets and ratings lean bullish; they carry a quarter of the forward pillar.</p>
      </div>
      <div>
        <h5>Data handling</h5>
        <ul><li>Statements, estimates and prices come from Yahoo Finance and are used as published — they are sometimes wrong, especially for Indian banks and recently restructured companies.</li>
        <li>Profit and EPS are taken before one-offs and discontinued operations where Yahoo reports them.</li>
        <li>ROE uses average equity; ROCE is EBIT over average equity plus debt.</li>
        <li>Forward P/E uses a 12-month blend of the two consensus years. PEG divides it by the two-year consensus EPS growth rate.</li>
        <li>The P/E history uses each year's EPS from 75 days after year-end.</li></ul>
        ${j.notes.length?`<h5>Notes on this stock</h5><ul>${j.notes.map(n=>`<li>${esc(n)}</li>`).join("")}</ul>`:""}
      </div>
    </div>
  </details>`;

  /* ── charts ── */
  const A=j.annual,Q=j.quarterly,cats=A.map(r=>r.fy),last=A.length-1;
  const revF=F.revenue.filter(e=>has(e.avg)),epsF=F.eps.filter(e=>has(e.avg));
  const epsFmt=v=>px(v,fc,Math.abs(v)>=100?1:2),epsCap=v=>!has(v)?"—":v.toLocaleString(loc(fc),{minimumFractionDigits:Math.abs(v)>=100?1:2,maximumFractionDigits:Math.abs(v)>=100?1:2}).replace("-","−");
  const sq=(name,op)=>({name,color:"var(--s1)",sq:true,op});
  const scA=scaleFor(Math.max(...A.map(r=>Math.abs(r.revenue||0)),...revF.map(e=>Math.abs(e.avg))),fc),scQ=scaleFor(Math.max(0,...Q.map(q=>Math.abs(q.revenue||0))),fc);
  const salesModes={Annual:{
      title:"Revenue · "+scA.unit,legend:revF.length?[sq("Reported"),sq("Consensus estimate",.36)]:[],
      draw:h=>colChart(h,{cats:[...cats,...revF.map(e=>e.period)],vals:[...A.map(r=>r.revenue),...revF.map(e=>e.avg)],est:[...A.map(()=>false),...revF.map(()=>true)],fmt:scaled(scA,fc),aria:"Annual revenue",
        tip:i=>i<=last?[["Revenue",money(A[i].revenue,fc)],["Growth",spc(A[i].revGrowth)]]:[["Consensus revenue",money(revF[i-last-1].avg,fc)],["Growth",spc(revF[i-last-1].growth)]]}),
      table:()=>({head:["Year","Revenue","Growth"],rows:[...A.map(r=>[r.fy,money(r.revenue,fc),spc(r.revGrowth)]),...revF.map(e=>[e.period,money(e.avg,fc),spc(e.growth)])]})}};
  if(Q.length>=4)salesModes.Quarterly={title:"Revenue · "+scQ.unit,
      draw:h=>colChart(h,{cats:Q.map(q=>q.label),vals:Q.map(q=>q.revenue),fmt:scaled(scQ,fc),aria:"Quarterly revenue",tip:i=>[["Revenue",money(Q[i].revenue,fc)],["vs year ago",spc(Q[i].revYoY)]]}),
      table:()=>({head:["Quarter","Revenue","YoY"],rows:Q.map(q=>[q.label,money(q.revenue,fc),spc(q.revYoY)])})};
  const epsModes={Annual:{
      title:"EPS · "+sym(fc).trim()+(A.some(r=>r.oneoff)?" before one-offs":""),legend:epsF.length?[sq("Reported"),sq("Consensus estimate",.36)]:[],
      note:has(F.basisGap)?"Consensus bars are on the analysts' basis, which differs from reported EPS for this company.":"",
      draw:h=>colChart(h,{cats:[...cats,...epsF.map(e=>e.period)],vals:[...A.map(r=>r.eps),...epsF.map(e=>e.avg)],est:[...A.map(()=>false),...epsF.map(()=>true)],fmt:epsCap,aria:"Annual EPS",
        tip:i=>i<=last?[["EPS",epsFmt(A[i].eps)],A[i].oneoff?["As reported",epsFmt(A[i].epsReported)]:null,["Growth",spc(A[i].epsGrowth)]]:[["Consensus EPS",epsFmt(epsF[i-last-1].avg)],["Growth",spc(epsF[i-last-1].growth)],["Range",epsFmt(epsF[i-last-1].low)+" – "+epsFmt(epsF[i-last-1].high)]]}),
      table:()=>({head:["Year","EPS","Growth"],rows:[...A.map(r=>[r.fy,epsFmt(r.eps),spc(r.epsGrowth)]),...epsF.map(e=>[e.period,epsFmt(e.avg),spc(e.growth)])]})}};
  if(Q.filter(q=>has(q.eps)).length>=4)epsModes.Quarterly={title:"EPS · "+sym(fc).trim()+(A.some(r=>r.oneoff)?" before one-offs":""),
      draw:h=>colChart(h,{cats:Q.map(q=>q.label),vals:Q.map(q=>q.eps),fmt:epsCap,aria:"Quarterly EPS",tip:i=>[["EPS",epsFmt(Q[i].eps)],["vs year ago",spc(Q[i].epsYoY)]]}),
      table:()=>({head:["Quarter","EPS","YoY"],rows:Q.map(q=>[q.label,epsFmt(q.eps),spc(q.epsYoY)])})};
  const mk=(defs)=>defs.filter(d=>A.some(r=>has(r[d.k]))).map((d,i)=>({name:d.n,color:`var(--s${i+1})`,vals:A.map(r=>r[d.k])}));
  const lineMode=(title,series,aria)=>({title,legend:series.map(s=>({name:s.name,color:s.color,val:pc(s.vals[last])})),
      draw:h=>lineChart(h,{cats,series,fmt:v=>pc(v),tick:v=>v+"%",aria}),
      table:()=>({head:["Year",...series.map(s=>s.name)],rows:A.map((r,i)=>[r.fy,...series.map(s=>pc(s.vals[i]))])})});
  const mSeries=mk(M.isLender?[{k:"netMargin",n:"Net margin"}]:[{k:"grossMargin",n:"Gross margin"},{k:"opMargin",n:"Operating margin"},{k:"netMargin",n:"Net margin"}]);
  const rSeries=mk(M.isLender?[{k:"roe",n:"ROE"}]:[{k:"roe",n:"ROE"},{k:"roce",n:"ROCE"}]);
  const charts={sales:{modes:salesModes},eps:{modes:epsModes},
    margins:{modes:{Annual:lineMode("Margins · % of sales",mSeries,"Margins by year")}},
    returns:{modes:{Annual:lineMode("Returns · %",rSeries,"Returns by year")}},
    price:{modes:{Weekly:{title:"Weekly close"+(has(T.mean)?" against the mean analyst target":""),
      draw:h=>priceChart(h,{pts:j.price,target:T.mean,fmt:v=>px(v,cur,M.price>=200?0:2)}),
      table:()=>{const rows=[];j.price.forEach((p,i)=>{if(i%26===0||i===j.price.length-1)rows.push([p[0],px(p[1],cur,2)])});return{head:["Week","Close"],rows}}}}}};
  $$(".cb").forEach(h=>{const c=charts[h.dataset.chart];if(c)chartBlock(h,c);else h.remove()});

  /* ── motion ── */
  const io=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add("in");io.unobserve(e.target)}}),{threshold:.08,rootMargin:"0px 0px -6% 0px"});
  $$("#report .reveal").forEach((el,i)=>{el.style.transitionDelay=Math.min(i,4)*70+"ms";io.observe(el)});
  setTimeout(()=>{
    if(has(V.score)){$("#arc").style.strokeDasharray=`${Math.max(.5,V.score)} 100`;countUp($("#score"),V.score,1700)}else $("#score").textContent="—";
    $$(".strip .sc[data-to]").forEach(el=>{if(el.dataset.to!=="")countUp(el,+el.dataset.to,1300)});
  },reduce?0:260);
}

/* ═════════════ app shell ═════════════ */
const EXAMPLES=["RELIANCE","HDFCBANK","TITAN","INFY","ITC","NVDA","AAPL"];
let reqId=0,ldTimer,shown=null;   // shown = symbol of the report on screen

/* ═════════════ data source ═════════════
   Local (app.py): live Yahoo pull per request.
   Hosted (GitHub Pages, window.LODESTAR_STATIC): pre-computed snapshot in data/, built by build_static.py. */
const STATIC=true;
let IDX=null;
async function snapIndex(){return market.index()}
/* What people actually paste: "TCS.NS", "infy.ns", " $AAPL ", "NSE:M_M", "reliance.bo", "BRK.B".
   clean() tidies the string; bare() reduces it to the symbol/name to match on, dropping the exchange. */
const clean=s=>String(s??"").replace(/\s+/g," ").replace(/^[\s"'“”‘’`$]+|[\s"'“”‘’`,;]+$/g,"");
function bare(s){
  let u=clean(s).toUpperCase();
  const m=u.match(/^(NSE|BSE|NASDAQ|NYSE)\s*:\s*(.*)$/);
  if(m)u=m[1]==="NSE"?m[2].replace(/_/g,"&"):m[2];
  return u.replace(/\.(NS|NSE|BO|BSE)$/,"").trim();
}
function snapMatch(items,q,limit=7){
  const Q=bare(q),Qd=Q.replace(/\./g,"-"),ql=Q.toLowerCase();if(!Q)return[];
  const rank=it=>{const s=it.symbol.toUpperCase(),b=s.replace(/\.(NS|BO)$/,""),n=(it.name||"").toLowerCase(),aka=it.aka||[];
    if(s===Q||b===Q||b===Qd||aka.includes(Q))return 0;if(b.startsWith(Q)||aka.some(a=>a.startsWith(Q)))return 1;if(n.startsWith(ql))return 2;if(n.split(/[\s.&-]+/).some(w=>w.startsWith(ql)))return 3;if(n.includes(ql)||b.includes(Q))return 4;return 9};
  return items.map(it=>[rank(it),it]).filter(x=>x[0]<9).sort((a,b)=>a[0]-b[0]||a[1].symbol.localeCompare(b[1].symbol)).slice(0,limit).map(x=>({...x[1],rank:x[0]}));
}
async function apiSearch(q){
  if(!STATIC){const r=await fetch("/api/search?q="+encodeURIComponent(q));return (await r.json()).results||[]}
  return snapMatch((await snapIndex()).items,q).map(it=>({symbol:it.symbol,name:it.name,exchange:it.exchange}));
}
async function apiAnalyze(t){
  if(!STATIC){const r=await fetch("/api/analyze?ticker="+encodeURIComponent(t)),j=await r.json();if(!r.ok||j.error)throw new Error(j.error||"Something went wrong.");return j}
  const ix=await snapIndex(),near=snapMatch(ix.items,t,4),hit=near[0];
  // exact symbol (or a known old name) always; otherwise only a prefix match on symbol / name / name-word, and only for 3+ characters
  if(!hit||(hit.rank>0&&(hit.rank>3||bare(t).length<3))){
    const e=new Error(`“${t}” did not match the ${ix.items.length} companies in this directory. Try a ticker or company name.`);
    e.suggest=near.map(x=>x.symbol);throw e;
  }
  return market.analyze(hit);
}
async function initStatic(){
  if(!STATIC)return;
  try{const ix=await snapIndex(),c=$("#cover");
    c.textContent=`${ix.items.length} companies · ${ix.fullCount} published reports · on-demand six-pillar analysis for other companies`;c.hidden=false;
    $("#s-main input").placeholder="RELIANCE, TCS, NVDA — or a company name";
    $(".src").textContent="Yahoo Finance · daily snapshot";
  }catch(e){}
}
function show(v){document.body.dataset.view=v;["landing","loading","error","report"].forEach(id=>$("#"+id).hidden=id!==v);$("#foot").hidden=v!=="report";if(v!=="report")document.body.dataset.verdict="none";hideTip()}
function chipRow(host,label,items){host.innerHTML=`<span>${label}</span>`+items.map(t=>`<button class="chip" data-t="${esc(t)}">${esc(t.replace(/\.NS$/,""))}</button>`).join("");$$(".chip",host).forEach(b=>b.addEventListener("click",()=>run(b.dataset.t)))}
function recent(){try{return JSON.parse(localStorage.getItem("lodestar.recent")||"[]")}catch(e){return[]}}
function landingChips(){const r=recent();chipRow($("#chips"),r.length?"Recent":"Try",r.length?[...new Set([...r,...EXAMPLES])].slice(0,7):EXAMPLES)}
function nudge(){
  const root=$(document.body.dataset.view==="landing"?"#s-main":"#s-top"),f=$("form",root);
  f.classList.remove("nudge");void f.offsetWidth;f.classList.add("nudge");setTimeout(()=>f.classList.remove("nudge"),900);$("input",root).focus();
}
function toHash(){
  if(location.hash.length<2)return;let el=null;
  try{el=document.getElementById(decodeURIComponent(location.hash.slice(1)))}catch(e){}
  if(el)el.scrollIntoView();   // layout is already final here; no rAF, which never fires in a background tab
}
async function run(t,push=true){
  t=clean(t);if(!t){nudge();return}
  const id=++reqId;shown=null;
  $$(".search input").forEach(i=>{i.value="";i.blur()});$$(".suggest").forEach(s=>s.hidden=true);
  show("loading");scrollTo({top:0});
  $("#ld-t").textContent="Reading "+t.toUpperCase().replace(/\.NS$|\.BO$/,"");
  const steps=["FINDING THE LISTING","PULLING FIVE YEARS OF STATEMENTS","COLLECTING CONSENSUS ESTIMATES","WEIGHING PRICE AGAINST EARNINGS","SCORING SIX PILLARS"];let k=0;
  clearInterval(ldTimer);$("#ld-s").textContent=steps[0];ldTimer=setInterval(()=>{k=Math.min(k+1,steps.length-1);$("#ld-s").textContent=steps[k]},850);
  try{
    const j=await apiAnalyze(t);
    if(id!==reqId)return;
    show("report");render(j);if(j.stale){const p=document.createElement("p");p.className="cnote";p.textContent=j.warning||"Showing the last available snapshot.";$("#report").prepend(p);}$(".src").textContent=(j.source||"Yahoo Finance")+" · "+(j.extended?"reported financials":"dated snapshot");
    document.title=`${j.meta.short} — ${j.verdict.action} · Lodestar`;
    const url="?t="+encodeURIComponent(j.meta.symbol);
    if(push){history.replaceState({t:j.meta.symbol},"",url);parent.postMessage({type:"lodestar:select",symbol:j.meta.symbol},location.origin);}
    else{history.replaceState({t:j.meta.symbol},"",url+location.hash);toHash()}   // ?t=tcs#p-sales -> ?t=TCS.NS#p-sales, then jump
    shown=j.meta.symbol;
    try{localStorage.setItem("lodestar.recent",JSON.stringify([j.meta.symbol,...recent().filter(x=>x!==j.meta.symbol)].slice(0,5)))}catch(e){}
  }catch(e){
    if(id!==reqId)return;
    show("error");$("#err-msg").textContent=e.message&&!/Failed to fetch|NetworkError/.test(e.message)?e.message:(STATIC?"Couldn't load the data just now. Check your connection and try again.":"The Lodestar server isn't responding. Check that app.py is still running.");
    if(e.suggest&&e.suggest.length)chipRow($("#err-chips"),"Did you mean",e.suggest);else chipRow($("#err-chips"),"Try",EXAMPLES);
  }finally{if(id===reqId)clearInterval(ldTimer)}
}
function wireSearch(root){
  const form=$("form",root),input=$("input",root),box=$(".suggest",root);let items=[],on=-1,t,seq=0,viaKey=false;
  const submit=()=>{seq++;clearTimeout(t);run(on>=0&&items[on]?items[on].symbol:input.value)};
  const close=()=>{box.hidden=true;on=-1};
  const paint=()=>{box.innerHTML=items.map((r,i)=>`<button type="button" class="${i===on?"on":""}" data-i="${i}"><span class="sy">${esc(r.symbol)}</span><span class="nm">${esc(r.name)}</span><span class="ex">${esc(r.exchange)}</span></button>`).join("");box.hidden=!items.length;
    $$("button",box).forEach(b=>b.addEventListener("mousedown",e=>{e.preventDefault();run(items[+b.dataset.i].symbol)}))};
  input.addEventListener("input",()=>{clearTimeout(t);const q=input.value.trim();if(q.length<2){items=[];close();return}
    t=setTimeout(async()=>{const s=++seq;try{const res=await apiSearch(q);if(s!==seq||input.value.trim()!==q)return;items=res;on=-1;paint()}catch(e){}},190)});
  input.addEventListener("keydown",e=>{
    if(e.key==="Enter"||e.keyCode===13){if(e.isComposing||e.keyCode===229)return;e.preventDefault();viaKey=true;setTimeout(()=>viaKey=false,0);submit();return}
    if(box.hidden)return;if(e.key==="ArrowDown"||e.key==="ArrowUp"){e.preventDefault();on=(on+(e.key==="ArrowDown"?1:-1)+items.length)%items.length;paint()}else if(e.key==="Escape")close()});
  input.addEventListener("blur",()=>setTimeout(close,120));
  form.addEventListener("submit",e=>{e.preventDefault();if(!viaKey)submit()});   // viaKey: this Enter was already handled on keydown
}
wireSearch($("#s-main"));wireSearch($("#s-top"));
$("#home").addEventListener("click",()=>{reqId++;shown=null;show("landing");landingChips();history.replaceState({},"",location.pathname);document.title="Lodestar — fundamental verdicts";$("#s-main input").focus()});
addEventListener("scroll",()=>$("#top").classList.toggle("stuck",scrollY>8),{passive:true});
addEventListener("popstate",()=>{const t=new URLSearchParams(location.search).get("t");
  // Clicking a pillar link (#p-sales) fires popstate as well. Same report already on screen: leave it alone and let the browser scroll.
  if(t&&t===shown&&document.body.dataset.view==="report")return;
  if(t)run(t,false);else{reqId++;shown=null;show("landing");landingChips()}});
landingChips();initStatic();
{const t=new URLSearchParams(location.search).get("t");if(t)run(t,false)}

addEventListener("message",e=>{if(e.origin!==location.origin||e.source!==parent||e.data?.type!=="alphanova:select"||typeof e.data.symbol!=="string"||!/^[A-Z0-9][A-Z0-9.&_-]{0,24}$/.test(e.data.symbol))return;run(e.data.symbol,false);});
