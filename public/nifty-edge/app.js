import { updateJournal } from "./journal.js";
/* NIFTY EDGE front end — vanilla JS + ECharts. */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const C = {
    text: css("--text-primary"), sec: css("--text-secondary"), muted: css("--text-muted"),
    s1: css("--series-1"), s2: css("--series-2"), s3: css("--series-3"), s4: css("--series-4"),
    good: css("--good"), crit: css("--critical"), surface: css("--surface-1"),
    hair: "rgba(255,255,255,.06)", hair2: "rgba(255,255,255,.14)",
  };
  const ok = (n) => n !== null && n !== undefined && Number.isFinite(Number(n));
  const fmt = (n, d = 0) => ok(n) ? Number(n).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";
  const pct = (n, d = 1) => ok(n) ? (n * 100).toFixed(d) + "%" : "—";
  const sgn = (n, d = 1) => ok(n) ? (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(d) : "—";
  const inr = (n) => ok(n) ? (n < 0 ? "−₹" : "₹") + Math.abs(Math.round(n)).toLocaleString("en-IN") : "—";
  const cls = (n) => !ok(n) ? "" : n > 0 ? "up" : n < 0 ? "down" : "";
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ICON = {
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5 9-10"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18v.5"/></svg>',
    up: "▲", down: "▼",
  };

  // ------------------------------------------------------------ settings
  const DEF = { capital: 1000000, risk_pct: 2.5, max_lots: 10 };
  let settings = { ...DEF };
  try { settings = { ...DEF, ...JSON.parse(localStorage.getItem("niftyedge.settings") || "{}") }; } catch (e) { /* private mode */ }
  const saveSettings = () => { try { localStorage.setItem("niftyedge.settings", JSON.stringify(settings)); } catch (e) { } };

  // ------------------------------------------------------------ charts
  const charts = {};
  function chart(id) {
    const el = document.getElementById(id);
    if (!el || !window.echarts) return null;
    if (charts[id] && charts[id].getDom() !== el) { charts[id].dispose(); delete charts[id]; }
    if (!charts[id]) {
      charts[id] = echarts.init(el, null, { renderer: "canvas" });
      new ResizeObserver(() => charts[id].resize()).observe(el);
    }
    return charts[id];
  }
  const tip = (o = {}) => ({
    trigger: "axis", confine: true,
    backgroundColor: "rgba(16,20,28,.96)", borderColor: C.hair2, borderWidth: 1, padding: [8, 11],
    textStyle: { color: C.text, fontFamily: "JetBrains Mono", fontSize: 12 },
    axisPointer: { type: "line", lineStyle: { color: "rgba(255,255,255,.28)", width: 1 } },
    ...o,
  });
  const ax = (o = {}) => ({
    axisLine: { lineStyle: { color: C.hair2 } }, axisTick: { show: false },
    axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 11 },
    splitLine: { lineStyle: { color: C.hair } }, ...o,
  });
  const base = (o) => ({
    backgroundColor: "transparent", animationDuration: 700, animationEasing: "cubicOut",
    textStyle: { fontFamily: "Inter, system-ui", color: C.sec },
    grid: { left: 54, right: 18, top: 28, bottom: 30, containLabel: false },
    legend: { show: false }, ...o,
  });
  const legend = (data) => ({ show: true, data, top: 0, right: 0, icon: "roundRect", itemWidth: 12, itemHeight: 4, textStyle: { color: C.sec, fontSize: 11.5 } });

  // ------------------------------------------------------------ state
  let snap = null, lab = null, journalData = null, lastFetch = 0, busy = false;

  async function getJSON(url, opt) {
    const r = await fetch(url, opt);
    const j = await r.json().catch(() => ({}));
    return { status: r.status, body: j };
  }

  async function loadSnapshot(force = false) {
    if (busy) return;
    busy = true;
    $("#refresh").classList.add("spin");
    try {
      const q = new URLSearchParams({ capital: settings.capital, risk_pct: settings.risk_pct, max_lots: settings.max_lots, force: force ? 1 : 0 });
      const { status, body } = await getJSON("/api/nifty_edge?op=snapshot&" + q);
      if (status !== 200) throw new Error(body.error || "HTTP " + status);
      snap = body; lastFetch = Date.now();
      renderAll();
      if (lab) renderLab();
      updateBrowserJournal();
      loadJournal();
    } catch (e) {
      $("#verdict").textContent = "Data unavailable";
      $("#verdict-sub").innerHTML = `<span class="err">${esc(e.message)}</span> — NSE may be throttling; retrying shortly.`;
      $("#hero-body").innerHTML = "";
    } finally {
      busy = false;
      $("#refresh").classList.remove("spin");
    }
  }

  async function loadLab() {
    const { status, body } = await getJSON("/api/nifty_edge?op=lab");
    if (status === 200) { $('#hosting-note').textContent = `Live quotes refresh while open. Evidence lab built ${String(body.built_at || 'unknown').slice(0,10)}; updated separately from live quotes. Paper journal is saved only in this browser.`; lab = body; renderLab(); if (snap) renderAll(); return; }
    $("#p-vol").textContent = "Evidence lab unavailable. Refresh to retry."; return;

  }

  const JOURNAL_KEY = "alphanova.niftyedge.journal.v1";
  let journalRows = [];
  try { const saved = JSON.parse(localStorage.getItem(JOURNAL_KEY) || "[]"); if (Array.isArray(saved)) journalRows = saved; } catch {}
  function updateBrowserJournal() {
    journalRows = updateJournal(journalRows, snap);
    try { localStorage.setItem(JOURNAL_KEY, JSON.stringify(journalRows)); }
    catch { $('#hosting-note').textContent = 'Browser storage unavailable: this paper journal will not survive a reload.'; }
  }
  function loadJournal() {
    const agg = rows => {
      const settled=rows.filter(r=>r.status==='settled'), sum=settled.reduce((a,r)=>a+r.pnl_pts,0);
      const rs=settled.filter(r=>Number.isFinite(r.R));
      return {n:rows.length, settled:settled.length, open:rows.length-settled.length,
        wins:settled.filter(r=>r.pnl_pts>0).length, total_pts:sum,
        avg_pts:settled.length ? sum/settled.length : null,
        avg_R:rs.length ? rs.reduce((a,r)=>a+r.R,0)/rs.length : null};
    };
    journalData={traded:agg(journalRows.filter(r=>!r.shadow)), stood_aside:agg(journalRows.filter(r=>r.shadow)), rows:[...journalRows].reverse().slice(0,60)};
    renderJournal();
  }

  // ------------------------------------------------------------ render
  function renderAll() {
    if (!snap) return;
    renderTop();
    renderHero();
    renderGate();
    renderAnatomy();
    renderVol();
    renderPrice();
    renderPositioning();
  }

  function renderTop() {
    const L = snap.levels, r = snap.rec, f = snap.expiries[0] || {};
    const chip = (k, v, d, dc) => `<div class="chip"><span class="k">${k}</span><span class="v">${v}</span>${d ? `<span class="d ${dc || ""}">${d}</span>` : ""}</div>`;
    $("#tickers").innerHTML =
      chip("Nifty", fmt(L.spot, 2), `${L.pchg >= 0 ? ICON.up : ICON.down} ${sgn(L.chg, 1)} (${sgn(L.pchg, 2)}%)`, cls(L.pchg)) +
      chip("India VIX", fmt(L.vix, 2), `${sgn(L.vix_pchg, 1)}%`, cls(-L.vix_pchg)) +
      chip("ATM IV", pct(f.atm_iv, 1), f.expiry ? f.expiry.slice(0, 6) : "") +
      chip("IV / RV", fmt(r.iv_rv, 2), r.iv_rv >= 1 ? "rich" : "cheap", r.iv_rv >= 1 ? "up" : "") +
      chip("Straddle", fmt(f.straddle, 0), `±${pct(f.straddle_pct, 2)}`) +
      chip("Data", snap.data_time.slice(11, 16), snap.data_time.slice(0, 10));
    const live = snap.quotes_fresh;
    const pill = $("#mstatus");
    pill.className = "status-pill" + (live ? " live" : "");
    pill.innerHTML = `<span class="dot"></span><span>${live ? "Live" : "Closed"}</span>`;
    $("#hero-time").textContent = `· as of ${snap.data_time.replace("T", " ").slice(0, 16)} IST`;
  }

  function legsTable(legs, expiry) {
    return `<table class="legs"><thead><tr><th>Leg</th><th>Strike</th><th>Mid</th><th>Bid / Ask</th><th>Δ</th><th>IV</th><th>OI</th></tr></thead><tbody>` +
      legs.map((l) => `<tr>
        <td><span class="side ${l.side}">${l.side}</span></td>
        <td><span class="strike">${fmt(l.strike)}</span><span class="right-${l.right.toLowerCase()}">${l.right}</span> <span class="muted" style="font-size:11px">${esc(expiry.slice(0, 6))}</span></td>
        <td>${fmt(l.price, 2)}</td>
        <td class="sec">${ok(l.bid) && l.bid > 0 ? fmt(l.bid, 2) + " / " + fmt(l.ask, 2) : "—"}</td>
        <td>${sgn(l.delta, 2)}</td>
        <td>${pct(l.iv, 1)}</td>
        <td class="sec">${fmt(l.oi)}</td></tr>`).join("") + "</tbody></table>";
  }

  function tilesFor(m, r, trade) {
    const lot = r.lot;
    const credit = m.credit > 0;
    const t = (k, v, s, c = "") => `<div class="tile"><div class="k">${k}</div><div class="v ${c}">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
    let h = "";
    h += t(credit ? "Net credit" : "Net debit", fmt(Math.abs(m.credit), 1), `${inr(Math.abs(m.credit) * lot)} / lot` + (m.natural_credit ? ` · nat ${fmt(Math.abs(m.natural_credit), 1)}` : ""));
    h += t("Max loss", fmt(m.max_loss, 0), `${inr(m.max_loss_rupees)} / lot`, "down");
    h += t("Max profit", fmt(m.max_profit, 0), `${inr(m.max_profit_rupees)} / lot`, "up");
    h += t("Breakevens", m.breakevens.map((b) => fmt(b, 0)).join(" · ") || "—", `width ${fmt(m.width)} pts`);
    h += t("Prob. of profit", pct(m.pop_market, 0), `market · model ${pct(m.pop_model, 0)}`);
    h += t("Model EV", sgn(m.ev_model_pts, 1), `${inr(m.ev_model_rupees)} / lot, after costs`, cls(m.ev_model_pts));
    if (trade) h += t("Size", `${r.lots} lot${r.lots === 1 ? "" : "s"}`, `risk ${inr(r.lots * m.max_loss_rupees)} · lot ${lot}`);
    return `<div class="tiles">${h}</div>`;
  }

  function renderHero() {
    const r = snap.rec;
    const trade = r.action === "TRADE";
    $("#hero").classList.toggle("notrade", !trade);
    $("#verdict").textContent = r.headline;
    $("#verdict-sub").innerHTML = trade
      ? `${esc(r.label)} · <b>${esc(r.expiry)}</b> expiry · ${fmt(r.h, 1)} sessions left`
      : `${esc(r.label)} · front tradable expiry <b>${esc(r.expiry)}</b>`;
    let h = "";
    const legs = trade ? r.legs : r.shadow && r.shadow.legs;
    const m = trade ? r.metrics : r.shadow && r.shadow.metrics;
    if (!trade && legs) h += `<div class="mini-h" style="margin-top:0">Shadow trade — what the condor looks like right now (not recommended)</div>`;
    if (legs) h += legsTable(legs, r.expiry);
    if (m) h += tilesFor(m, r, trade);
    h += `<div class="cols2"><div><div class="mini-h">Why</div><ul class="bullets">${r.rationale.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    h += trade && r.plan ? `<div><div class="mini-h">Execution plan</div><ul class="bullets plan">${r.plan.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div></div>` : `<div><div class="mini-h">What changes the answer</div><ul class="bullets plan">
        <li>IV/RV must reach ${fmt(snap.lab_built ? (lab && lab.vol.gate.iv_rv_min) || 1 : 1, 2)} — now ${fmt(r.iv_rv, 2)}.</li>
        ${r.need_straddle ? `<li>i.e. ATM straddle ≥ ${fmt(r.need_straddle, 0)} pts (now ${fmt(r.straddle, 0)}), or realised vol cooling.</li>` : ""}
        <li>No directional signal is trusted, so a debit spread needs one to pass testing first.</li></ul></div></div>`;
    for (const w of r.warnings || []) h += `<div class="warn">${ICON.warn}<span>${esc(w)}</span></div>`;
    $("#hero-body").innerHTML = h;
  }

  function renderGate() {
    const r = snap.rec;
    const g = chart("gauge");
    const v = Math.max(0.4, Math.min(1.6, r.iv_rv || 0));
    const thr = (lab && lab.vol.gate.iv_rv_min) || 1.0;
    g && g.setOption({
      series: [{
        type: "gauge", min: 0.4, max: 1.6, startAngle: 200, endAngle: -20, radius: "96%", center: ["50%", "60%"],
        splitNumber: 6,
        axisLine: { lineStyle: { width: 12, color: [[(thr - 0.4) / 1.2, "#2a3142"], [1, C.s3]] } },
        progress: { show: false },
        pointer: { length: "52%", width: 4, offsetCenter: [0, "-8%"], itemStyle: { color: C.text } },
        anchor: { show: true, size: 10, itemStyle: { color: C.text, borderColor: C.surface, borderWidth: 3 } },
        axisTick: { show: false }, splitLine: { length: 6, distance: -12, lineStyle: { color: C.surface, width: 2 } },
        axisLabel: { distance: 16, color: C.muted, fontFamily: "JetBrains Mono", fontSize: 10, formatter: (x) => x.toFixed(1) },
        title: { offsetCenter: [0, "62%"], color: C.muted, fontSize: 11, fontFamily: "Inter" },
        detail: { offsetCenter: [0, "34%"], fontFamily: "JetBrains Mono", fontSize: 26, fontWeight: 700, color: C.text, formatter: () => fmt(r.iv_rv, 2) },
        data: [{ value: v, name: `IV/RV · gate opens at ${thr.toFixed(2)}` }],
      }],
    });
    $("#checks").innerHTML = r.checks.map((c) => `<div class="check ${c.pass ? "pass" : "fail"}">
      <div class="ic">${c.pass ? ICON.check : ICON.x}</div>
      <div><div class="nm">${esc(c.name)}</div><div class="lbl">${c.pass ? "PASS" : "FAIL"}</div></div>
      <div class="val">${esc(c.value)}</div></div>`).join("");
    const st = r.structure || "iron_condor";
    const c = (r.conditional || {})[st] || {};
    const cell = c.cell || {};
    $("#labsays").innerHTML = cell.n ? `<div class="labsays">
      <div class="muted" style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Days like today · ${esc(labelShort(st))}</div>
      <div class="big ${cls(cell.mean)}">${sgn(cell.mean, 1)} <span style="font-size:13px;color:var(--text-secondary)">pts / trade</span></div>
      <div class="row"><span>win <b>${pct(cell.win, 0)}</b></span><span>expiries <b>${cell.n_clusters}</b></span><span>t <b>${fmt(cell.t, 2)}</b></span><span>shrunk est. <b>${sgn(c.estimate_pts, 1)}</b></span></div>
      <div class="muted" style="font-size:11.5px;margin-top:6px">Same IV/RV quintile (${["bottom", "2nd", "middle", "4th", "top"][c.quintile] || "?"}) and ${c.dte_bucket} sessions to expiry, 2021–26, after costs.</div></div>`
      : `<div class="labsays"><div class="muted">Lab history not available yet.</div></div>`;
  }
  const labelShort = (s) => ({ iron_condor: "iron condor", bull_put: "bull put spread", bear_call: "bear call spread", bull_call_debit: "bull call spread", bear_put_debit: "bear put spread", short_straddle: "short straddle" }[s] || s);

  function renderAnatomy() {
    const r = snap.rec, f = snap.expiries.find((e) => e.expiry === r.expiry) || snap.expiries[0];
    const m = r.action === "TRADE" ? r.metrics : r.shadow && r.shadow.metrics;
    const legs = r.action === "TRADE" ? r.legs : r.shadow && r.shadow.legs;
    $("#anat-sub").textContent = `${r.action === "TRADE" ? "recommended" : "shadow"} structure · ${r.expiry}`;
    if (m) {
      const x = m.payoff.x, y = m.payoff.y;
      const lo = f.F - f.sd_move, hi = f.F + f.sd_move;
      const xmin = f.F - 3.2 * f.sd_move, xmax = f.F + 3.2 * f.sd_move;
      const data = x.map((v, i) => [v, y[i]]).filter((p) => p[0] >= xmin && p[0] <= xmax);
      const p = chart("payoff");
      p.setOption(base({
        grid: { left: 54, right: 18, top: 18, bottom: 30 },
        tooltip: tip({ formatter: (a) => { const q = a.find((s) => s.seriesName === "P&L") || a[0]; return `NIFTY ${fmt(q.value[0], 0)}<br>P&L <b>${sgn(q.value[1], 1)}</b> pts · ${inr(q.value[1] * r.lot)}/lot`; } }),
        xAxis: ax({ type: "value", min: Math.round(xmin), max: Math.round(xmax), splitLine: { show: false }, axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 11, formatter: (v) => fmt(v) } }),
        yAxis: ax({ type: "value", axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 11 } }),
        series: [
          { name: "profit", type: "line", data: data.map((p) => [p[0], Math.max(p[1], 0)]), showSymbol: false, silent: true, lineStyle: { width: 0 }, areaStyle: { color: C.good, opacity: 0.16, origin: "auto" }, tooltip: { show: false } },
          { name: "loss", type: "line", data: data.map((p) => [p[0], Math.min(p[1], 0)]), showSymbol: false, silent: true, lineStyle: { width: 0 }, areaStyle: { color: C.crit, opacity: 0.16, origin: "auto" }, tooltip: { show: false } },
          {
          name: "P&L", type: "line", data, showSymbol: false, lineStyle: { width: 2, color: C.text }, itemStyle: { color: C.text },
          markArea: { silent: true, itemStyle: { color: "rgba(57,135,229,0.07)" }, data: [[{ xAxis: lo }, { xAxis: hi }]] },
          markLine: {
            symbol: "none", silent: true, label: { color: C.sec, fontFamily: "JetBrains Mono", fontSize: 10.5 },
            data: [
              { xAxis: f.spot, lineStyle: { color: C.text, width: 1.2, type: "solid" }, label: { formatter: "spot", position: "end" } },
              ...m.breakevens.map((b) => ({ xAxis: b, lineStyle: { color: "rgba(255,255,255,.3)", width: 1, type: "solid" }, label: { formatter: fmt(b, 0), position: "end" } })),
              { yAxis: 0, lineStyle: { color: C.hair2, width: 1, type: "solid" }, label: { show: false } },
            ],
          },
        }],
      }), true);
      const d = chart("dist");
      const mk = m.payoff.x.map((v, i) => [v, m.payoff.pdf_market[i]]).filter((q) => q[0] >= xmin && q[0] <= xmax);
      const md = m.model_hist.x.map((v, i) => [v, m.model_hist.y[i]]).filter((q) => q[0] >= xmin && q[0] <= xmax);
      d.setOption(base({
        grid: { left: 54, right: 18, top: 22, bottom: 22 },
        legend: legend(["Market (option-implied)", "Model (fat-tailed sim)"]),
        tooltip: tip({ formatter: (a) => `NIFTY ${fmt(a[0].value[0], 0)}` + a.map((s) => `<br>${s.marker}${s.seriesName.split(" (")[0]}`).join("") }),
        xAxis: ax({ type: "value", min: Math.round(xmin), max: Math.round(xmax), splitLine: { show: false }, axisLabel: { show: false } }),
        yAxis: ax({ type: "value", show: false }),
        series: [
          { name: "Market (option-implied)", type: "line", data: mk, showSymbol: false, smooth: true, lineStyle: { width: 2, color: C.s1 }, itemStyle: { color: C.s1 }, areaStyle: { color: C.s1, opacity: 0.12 } },
          { name: "Model (fat-tailed sim)", type: "line", data: md, showSymbol: false, smooth: true, lineStyle: { width: 2, color: C.s3 }, itemStyle: { color: C.s3 } },
        ],
      }), true);
    }
    // OI profile
    const o = f.oi_profile;
    const oc = chart("oi");
    const shorts = (legs || []).filter((l) => l.qty < 0).map((l) => l.strike);
    const step = o.strike.length > 1 ? Math.min(...o.strike.slice(1).map((v, i) => v - o.strike[i])) : 50;
    oc.setOption(base({
      grid: { left: 58, right: 18, top: 30, bottom: 30 },
      legend: legend(["Call OI", "Put OI"]),
      tooltip: tip({ trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: "rgba(255,255,255,.04)" } },
        formatter: (a) => `Strike <b>${fmt(a[0].value[0])}</b>` + a.map((s) => `<br>${s.marker}${s.seriesName} ${fmt(s.value[1])} <span style="color:${C.muted}">Δ ${sgn(s.value[2], 0)}</span>`).join("") }),
      xAxis: ax({ type: "value", min: o.strike[0] - step, max: o.strike[o.strike.length - 1] + step, splitLine: { show: false }, axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 11, formatter: (v) => fmt(v) } }),
      yAxis: ax({ type: "value", axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 11, formatter: (v) => v >= 1e5 ? (v / 1e5).toFixed(1) + "L" : v >= 1e3 ? (v / 1e3).toFixed(0) + "k" : v } }),
      series: [
        { name: "Call OI", type: "bar", barGap: "8%", barMaxWidth: 9, data: o.strike.map((k, i) => [k, o.ce_oi[i], o.ce_doi[i]]), itemStyle: { color: C.s2, borderRadius: [3, 3, 0, 0] },
          markLine: { symbol: "none", silent: true, label: { color: C.sec, fontFamily: "JetBrains Mono", fontSize: 10.5 },
            data: [{ xAxis: f.spot, lineStyle: { color: C.text, width: 1.2, type: "solid" }, label: { formatter: `spot ${fmt(f.spot, 0)}` } },
              ...shorts.map((k) => ({ xAxis: k, lineStyle: { color: C.s3, width: 1.4, type: "solid" }, label: { formatter: `short ${fmt(k)}`, position: "insideEndTop" } }))] },
          markArea: { silent: true, itemStyle: { color: "rgba(57,135,229,0.06)" }, data: [[{ xAxis: f.F - f.sd_move }, { xAxis: f.F + f.sd_move }]] } },
        { name: "Put OI", type: "bar", barMaxWidth: 9, data: o.strike.map((k, i) => [k, o.pe_oi[i], o.pe_doi[i]]), itemStyle: { color: C.s1, borderRadius: [3, 3, 0, 0] } },
      ],
    }), true);
    $("#oi-sub").textContent = `${f.expiry} · calls vs puts · shaded = ±1σ implied`;
    const t = (k, v, s) => `<div class="tile"><div class="k">${k}</div><div class="v" style="font-size:16px">${v}</div>${s ? `<div class="s">${s}</div>` : ""}</div>`;
    $("#oi-stats").innerHTML =
      t("PCR (OI)", fmt(f.pcr_oi, 2), `±5% band ${fmt(f.pcr_band, 2)}`) +
      t("Max pain", fmt(f.max_pain), `${sgn((f.max_pain / f.spot - 1) * 100, 2)}% from spot`) +
      t("Call wall", f.call_walls[0] ? fmt(f.call_walls[0].strike) : "—", "max call OI above") +
      t("Put wall", f.put_walls[0] ? fmt(f.put_walls[0].strike) : "—", "max put OI below");
  }

  function renderVol() {
    const s = chart("smile");
    const cols = [C.s1, C.s2, C.s3];
    const names = snap.expiries.map((e) => `${e.expiry.slice(0, 6)} · ${fmt(e.h, 0)}s`);
    s.setOption(base({
      grid: { left: 46, right: 14, top: 30, bottom: 30 },
      legend: legend(names),
      tooltip: tip({ formatter: (a) => `Strike ${fmt(a[0].value[0])}` + a.map((q) => `<br>${q.marker}${q.seriesName} ${fmt(q.value[1], 1)}%`).join("") }),
      xAxis: ax({ type: "value", scale: true, splitNumber: 4, splitLine: { show: false }, axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 11, formatter: (v) => (v / 1000).toFixed(1) + "k" } }),
      yAxis: ax({ type: "value", scale: true, axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 11, formatter: "{value}%" } }),
      series: snap.expiries.map((e, i) => ({
        name: names[i], type: "line", connectNulls: true, showSymbol: i === 0, symbolSize: 4,
        data: e.smile.strike.map((k, j) => [k, e.smile.iv[j]]).filter((p) => p[1] !== null),
        lineStyle: { width: 2, color: cols[i] }, itemStyle: { color: cols[i] },
        markLine: i === 0 ? { symbol: "none", silent: true, label: { show: false }, data: [{ xAxis: e.spot, lineStyle: { color: C.hair2, type: "solid" } }] } : undefined,
      })),
    }), true);

    if (lab && lab.series && lab.series.vrp) {
      const v = lab.series.vrp;
      const c = chart("vrp");
      const n = v.dates.length;
      c.setOption(base({
        grid: { left: 40, right: 14, top: 30, bottom: 54 },
        legend: legend(["India VIX (implied)", "Realised 21d"]),
        tooltip: tip({ formatter: (a) => `${echarts.time.format(a[0].value[0], "{dd} {MMM} {yyyy}")}` + a.map((q) => `<br>${q.marker}${q.seriesName.split(" (")[0]} ${fmt(q.value[1], 1)}`).join("") }),
        xAxis: ax({ type: "time", splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 10.5, fontFamily: "JetBrains Mono", hideOverlap: true } }),
        yAxis: ax({ type: "value", axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 11 } }),
        dataZoom: [{ type: "inside", startValue: v.dates[Math.max(0, n - 750)] }, { type: "slider", height: 16, bottom: 8, borderColor: C.hair, backgroundColor: "transparent", fillerColor: "rgba(57,135,229,.15)", dataBackground: { lineStyle: { color: C.hair2 }, areaStyle: { color: "transparent" } }, handleStyle: { color: C.s1 }, textStyle: { color: C.muted }, startValue: v.dates[Math.max(0, n - 750)] }],
        series: [
          { name: "India VIX (implied)", type: "line", data: v.dates.map((d, i) => [d, v.vix[i]]), showSymbol: false, lineStyle: { width: 1.6, color: C.s2 }, itemStyle: { color: C.s2 } },
          { name: "Realised 21d", type: "line", data: v.dates.map((d, i) => [d, v.rv21[i]]), showSymbol: false, lineStyle: { width: 1.6, color: C.s1 }, itemStyle: { color: C.s1 } },
        ],
      }), true);
    }

    const L = snap.levels, r = snap.rec, f = snap.expiries[0], n2 = snap.expiries[1];
    const k = (key, v, s) => `<div class="kpi"><div class="k">${key}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
    $("#volkpis").innerHTML =
      k("Front ATM IV", pct(f.atm_iv, 1), `${f.expiry} · calendar-time`) +
      k("Forecast RV", pct(r.fc_vol, 1), `HAR model to ${r.expiry}`) +
      k("Realised vol 21d", pct(L.rv21, 1), `10d ${pct(L.rv10, 1)} · 63d ${pct(L.rv63, 1)}`) +
      k("VIX percentile (1y)", pct(L.vix_pct_1y, 0), `VIX ${fmt(L.vix, 2)}`) +
      k("Term structure", n2 ? sgn((f.atm_iv - n2.atm_iv) * 100, 1) : "—", "front − next, vol pts (+ = stress)") +
      k("25Δ skew", ok(f.rr25) ? sgn(f.rr25 * 100, 1) : "—", "put IV − call IV, vol pts") +
      (lab ? k("IV > realised", pct(lab.vol.vrp.pct_imp_gt_real, 0), `of ${lab.vol.vrp.n} sessions, 2021–26`) : "");
  }

  function sma(a, n) { return a.map((_, i) => i + 1 < n ? null : a.slice(i + 1 - n, i + 1).reduce((x, y) => x + y, 0) / n); }

  function renderPrice() {
    const sp = snap.levels.spark, L = snap.levels;
    const s20 = sma(sp.close, 20), s50 = sma(sp.close, 50);
    const k0 = Math.max(0, sp.close.length - 126);
    const dates = sp.dates.slice(k0), cl = sp.close.slice(k0);
    const p = chart("price");
    p.setOption(base({
      grid: { left: 58, right: 18, top: 30, bottom: 30 },
      legend: legend(["NIFTY", "20-DMA", "50-DMA"]),
      tooltip: tip({ formatter: (a) => `${a[0].axisValue}` + a.map((q) => `<br>${q.marker}${q.seriesName} ${fmt(q.value, 1)}`).join("") }),
      xAxis: ax({ type: "category", data: dates, boundaryGap: false, splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 10.5, fontFamily: "JetBrains Mono", formatter: (d) => d.slice(5) } }),
      yAxis: ax({ type: "value", scale: true, axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 11, formatter: (v) => fmt(v) } }),
      series: [
        { name: "NIFTY", type: "line", data: cl, showSymbol: false, lineStyle: { width: 2, color: C.s1 }, itemStyle: { color: C.s1 },
          areaStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "rgba(57,135,229,.28)" }, { offset: 1, color: "rgba(57,135,229,0)" }]) },
          markPoint: { symbol: "circle", symbolSize: 8, itemStyle: { color: C.s1, borderColor: C.surface, borderWidth: 2 }, label: { show: false }, data: [{ coord: [dates.length - 1, cl[cl.length - 1]] }] } },
        { name: "20-DMA", type: "line", data: s20.slice(k0), showSymbol: false, lineStyle: { width: 1.4, color: C.s3 }, itemStyle: { color: C.s3 } },
        { name: "50-DMA", type: "line", data: s50.slice(k0), showSymbol: false, lineStyle: { width: 1.4, color: C.s4 }, itemStyle: { color: C.s4 } },
      ],
    }), true);
    const trend = L.spot > L.sma50 && L.sma50 > L.sma200 ? "uptrend" : L.spot < L.sma50 && L.sma50 < L.sma200 ? "downtrend" : "mixed";
    $("#pa-tags").innerHTML = `<span class="tag context">${trend} · 5d ${sgn(L.ret5 * 100, 1)}% · 20d ${sgn(L.ret20 * 100, 1)}%</span>`;

    // ladder
    const f = snap.expiries.find((e) => e.expiry === snap.rec.expiry) || snap.expiries[0];
    const legs = snap.rec.legs || (snap.rec.shadow || {}).legs || [];
    const rungs = [
      { n: "52-week high", v: L.year_high, c: C.muted },
      { n: "200-DMA", v: L.sma200, c: C.muted },
      { n: "50-DMA", v: L.sma50, c: C.s4 },
      { n: "20-DMA", v: L.sma20, c: C.s3 },
      { n: "Day high", v: L.high, c: C.muted },
      { n: "Day low", v: L.low, c: C.muted },
      { n: `+1σ to ${f.expiry.slice(0, 6)}`, v: f.F + f.sd_move, c: C.s1, band: true },
      { n: `−1σ to ${f.expiry.slice(0, 6)}`, v: f.F - f.sd_move, c: C.s1, band: true },
      ...f.call_walls.slice(0, 1).map((w) => ({ n: "Call-OI wall", v: w.strike, c: C.s2 })),
      ...f.put_walls.slice(0, 1).map((w) => ({ n: "Put-OI wall", v: w.strike, c: C.s1 })),
      ...legs.filter((l) => l.qty < 0).map((l) => ({ n: `Short ${l.right}${snap.rec.action === "TRADE" ? "" : " (shadow)"}`, v: l.strike, c: C.s3 })),
      { n: "NIFTY spot", v: L.spot, spot: true },
      { n: "52-week low", v: L.year_low, c: C.muted },
    ].filter((r) => ok(r.v)).sort((a, b) => b.v - a.v);
    $("#ladder").innerHTML = rungs.map((r) => `<div class="rung ${r.spot ? "spot" : ""} ${r.band ? "band" : ""}">
      <span class="nm">${r.spot ? "" : `<span class="sw" style="background:${r.c}"></span>`}${esc(r.n)}</span>
      <span class="lv">${fmt(r.v, 0)}</span><span class="dist">${r.spot ? "" : sgn((r.v / L.spot - 1) * 100, 2) + "%"}</span></div>`).join("");
  }

  function renderPositioning() {
    const P = snap.positioning;
    if (P && P.rows) {
      $("#pos-date").textContent = `as of ${P.date}`;
      $("#pos-table").innerHTML = `<thead><tr><th>Participant</th><th>Fut long</th><th>Fut short</th><th>Net</th><th>Δ day</th><th>Long share · 1y rank</th><th>Calls net</th><th>Puts net</th></tr></thead><tbody>` +
        P.rows.map((r) => `<tr><td class="name">${r.who === "Pro" ? "Prop desks" : r.who === "Client" ? "Retail / clients" : r.who}</td>
          <td>${fmt(r.fut_long)}</td><td>${fmt(r.fut_short)}</td>
          <td class="${cls(r.fut_net)}">${sgn(r.fut_net, 0)}</td><td class="${cls(r.fut_net_chg)}">${sgn(r.fut_net_chg, 0)}</td>
          <td>${pct(r.long_ratio, 0)}<span class="pctbar" title="${pct(r.ratio_pct_1y, 0)} percentile vs last year"><i style="left:calc(${(r.ratio_pct_1y * 100).toFixed(0)}% - 1px)"></i></span></td>
          <td class="${cls(r.call_net)}">${sgn(r.call_net, 0)}</td><td class="${cls(r.put_net)}">${sgn(r.put_net, 0)}</td></tr>`).join("") + "</tbody>";
    }
    const F = snap.flows || {};
    const rows = Object.entries(F);
    const mx = Math.max(1, ...rows.map(([, v]) => Math.abs(v.net || 0)));
    $("#flow-date").textContent = rows.length ? `FII / DII provisional, ₹ crore · ${rows[0][1].date}` : "no data";
    $("#flows").innerHTML = rows.map(([k, v]) => {
      const w = Math.abs(v.net) / mx * 50;
      const left = v.net >= 0 ? 50 : 50 - w;
      return `<div class="flow"><span class="name" style="font-weight:600">${k.replace("/FPI", "")}</span>
        <div class="bar"><span class="mid"></span><i style="left:${left}%;width:${w}%;background:${v.net >= 0 ? C.good : C.crit}"></i></div>
        <span class="mono ${cls(v.net)}" style="text-align:right">${sgn(v.net, 0)}</span></div>
        <div class="muted mono" style="font-size:11px;margin:-4px 0 6px 80px">buy ${fmt(v.buy, 0)} · sell ${fmt(v.sell, 0)}</div>`;
    }).join("");
    if (lab) {
      const sig = Object.fromEntries((lab.direction["5"].signals || []).map((s) => [s.key, s]));
      const line = (k) => sig[k] ? `<div style="display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-bottom:1px solid var(--hair)"><span>${esc(sig[k].name)}</span><span>${vtag(sig[k].verdict)} <span class="mono muted" style="font-size:11.5px">t ${fmt(sig[k].t, 2)}</span></span></div>` : "";
      $("#pos-evidence").innerHTML = ["fii_fut_ratio", "fii_fut_chg5", "fii_opt_net", "client_fut_ratio", "pro_opt_net"].map(line).join("") +
        `<div class="muted" style="font-size:12px;margin-top:10px">Tested against NIFTY's next-5-session return from the next open, ${esc((lab.ranges.participant || [""])[0].slice(0, 4))}–today. None passes both halves of history, so positioning is shown as context and never drives the call.</div>`;
      const fv = sig.fii_fut_ratio;
      $("#pos-verdict").outerHTML = `<span id="pos-verdict">${vtag(fv ? fv.verdict : "NOISE")}</span>`;
      const fs = lab.series.fii;
      const c = chart("fii");
      c && fs.dates.length && c.setOption(base({
        grid: { left: 40, right: 14, top: 10, bottom: 26 },
        tooltip: tip({ formatter: (a) => `${echarts.time.format(a[0].value[0], "{dd} {MMM} {yyyy}")}<br>FII long share ${fmt(a[0].value[1], 1)}%` }),
        xAxis: ax({ type: "time", splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 10.5, fontFamily: "JetBrains Mono", hideOverlap: true } }),
        yAxis: ax({ type: "value", min: 0, max: 100, interval: 25, axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 10.5, formatter: "{value}%" } }),
        series: [{ type: "line", data: fs.dates.map((d, i) => [d, fs.ratio[i]]), showSymbol: false, lineStyle: { width: 1.5, color: C.s1 }, areaStyle: { color: "rgba(57,135,229,.08)" },
          markLine: { symbol: "none", silent: true, label: { show: false }, data: [{ yAxis: 50, lineStyle: { color: C.hair2, type: "solid" } }] } }],
      }), true);
    }
  }

  const vtag = (v) => {
    const m = { EDGE: "edge", WEAK: "weak", NOISE: "noise", "PRICED IN": "priced", INSUFFICIENT: "noise" };
    return `<span class="tag ${m[v] || "noise"}">${esc(v === "INSUFFICIENT" ? "too little data" : v)}</span>`;
  };

  // ------------------------------------------------------------ lab
  let curveDte = "2", dirH = "5";
  function renderLab() {
    if (!lab) return;
    const V = lab.vol, R = lab.ranges;
    $("#lab-range").textContent = `options ${R.options[0].slice(0, 4)}–${R.options[1].slice(0, 4)} · ${R.n_expiries} expiries · ${fmt(R.n_snapshots)} chain snapshots · rebuilt ${lab.built_at.replace("T", " ").slice(0, 16)}`;
    const S = V.strategies, ic = S.iron_condor, st = S.short_straddle;
    const row = (k, s) => {
      const a = s.all, g = s.gated;
      return `<tr><td class="name">${esc(s.label)}</td>
        <td class="${cls(a.mean)}">${sgn(a.mean, 1)}</td><td>${fmt(a.t, 2)}</td><td>${pct(a.win, 0)}</td>
        <td class="${cls(g.mean)}" style="border-left:1px solid var(--hair-2)">${sgn(g.mean, 1)}</td><td>${fmt(g.t, 2)}</td><td>${pct(g.win, 0)}</td><td>${g.n_clusters}</td></tr>`;
    };
    $("#p-vol").innerHTML = `
      <div class="callout">Implied variance beat realised on <b>${pct(V.vrp.pct_imp_gt_real, 0)}</b> of sessions (median ratio <b>${fmt(V.vrp.imp_over_real_median, 2)}×</b>) — the premium is real.
        But selling it every week earned <b class="${cls(ic.all.mean)}">${sgn(ic.all.mean, 1)} pts</b> per condor after costs.
        Selling only when the pre-committed gate is open (IV/RV ≥ ${V.gate.iv_rv_min}, no +${V.gate.vix_spike_max * 100}% VIX day) earned
        <b class="${cls(ic.gated.mean)}">${sgn(ic.gated.mean, 1)} pts</b> (condor) and <b class="${cls(st.gated.mean)}">${sgn(st.gated.mean, 1)} pts</b> (straddle, t ${fmt(st.gated.t, 2)}).
        That gate was fixed before looking — the tables below show whether it earns its keep.</div>
      <div class="grid g-2" style="margin-top:16px">
        <div><div class="mini-h">Condor P&L by IV/RV quintile · pts per trade</div><div id="lab-q" class="chart sm"></div></div>
        <div><div class="card-head"><div class="mini-h">Condor equity · one entry per expiry</div>
          <div class="tabs" id="dte-tabs" style="margin:10px 0 0;padding:3px">${Object.keys(V.curves).map((d) => `<button class="tab ${d === curveDte ? "on" : ""}" data-dte="${d}" style="padding:4px 10px">${d}s</button>`).join("")}</div></div>
          <div id="lab-curve" class="chart sm"></div></div>
      </div>
      <div class="mini-h">All structures · ungated vs gated (pts per trade, after costs; t clustered by expiry)</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Structure</th><th>All · mean</th><th>t</th><th>win</th><th style="border-left:1px solid var(--hair-2)">Gated · mean</th><th>t</th><th>win</th><th>expiries</th></tr></thead>
        <tbody>${Object.entries(S).map(([k, s]) => row(k, s)).join("")}</tbody></table></div>
      <div class="mini-h">Condor year by year</div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Year</th><th>Gate open</th><th>Gated mean</th><th>win</th><th>expiries</th><th>Ungated mean</th></tr></thead>
        <tbody>${(V.by_year.iron_condor || []).map((y) => `<tr><td class="name">${y.year}</td><td>${pct(y.gate_rate, 0)}</td>
          <td class="${cls(y.gated.mean)}">${sgn(y.gated.mean, 1)}</td><td>${pct(y.gated.win, 0)}</td><td>${y.gated.n_clusters || 0}</td>
          <td class="${cls(y.all.mean)}">${sgn(y.all.mean, 1)}</td></tr>`).join("")}</tbody></table></div>`;
    const q = chart("lab-q");
    const qs = V.by_ivrv.iron_condor;
    const edges = V.ivrv_edges;
    const qlab = ["< " + edges[0].toFixed(2), edges[0].toFixed(2) + "–" + edges[1].toFixed(2), edges[1].toFixed(2) + "–" + edges[2].toFixed(2), edges[2].toFixed(2) + "–" + edges[3].toFixed(2), "≥ " + edges[3].toFixed(2)];
    const curQ = (snap && snap.rec.conditional && snap.rec.conditional.iron_condor) ? snap.rec.conditional.iron_condor.quintile : -1;
    q.setOption(base({
      grid: { left: 44, right: 10, top: 14, bottom: 34 },
      tooltip: tip({ trigger: "item", formatter: (p) => `IV/RV ${qlab[p.dataIndex]}<br>mean <b>${sgn(qs[p.dataIndex].mean, 1)}</b> pts · t ${fmt(qs[p.dataIndex].t, 2)}<br>win ${pct(qs[p.dataIndex].win, 0)} · ${qs[p.dataIndex].n_clusters} expiries` }),
      xAxis: ax({ type: "category", data: qlab, splitLine: { show: false }, axisLabel: { color: C.muted, fontFamily: "JetBrains Mono", fontSize: 10, interval: 0 } }),
      yAxis: ax({ type: "value" }),
      series: [{ type: "bar", barWidth: "46%", data: qs.map((x, i) => ({ value: x.mean, itemStyle: { color: x.mean >= 0 ? C.good : C.crit, borderRadius: x.mean >= 0 ? [4, 4, 0, 0] : [0, 0, 4, 4], opacity: i === curQ ? 1 : 0.6, borderColor: i === curQ ? C.text : "transparent", borderWidth: i === curQ ? 1.5 : 0 } })),
        label: { show: true, position: "top", color: C.sec, fontFamily: "JetBrains Mono", fontSize: 10.5, formatter: (p) => (p.dataIndex === curQ ? "today ▸ " : "") + sgn(p.value, 1) } }],
    }), true);
    drawCurve();
    document.querySelectorAll("#dte-tabs .tab").forEach((b) => b.onclick = () => { curveDte = b.dataset.dte; document.querySelectorAll("#dte-tabs .tab").forEach((x) => x.classList.toggle("on", x === b)); drawCurve(); });

    renderDir();

    $("#p-folk").innerHTML = `<div class="callout" style="margin-bottom:16px">The popular OI tells, tested on ${R.n_expiries} NIFTY expiries. <b>“Priced in”</b> means the option market already assigned the right probability — the wall tells you nothing the premium didn't.</div>
      <div class="folk">${lab.folklore.map((f) => `<div class="card"><div class="card-head"><span class="muted" style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;font-weight:700">${esc(f.name)}</span>${vtag(f.verdict)}</div>
        <div class="claim">${esc(f.claim)}</div><div class="test">${esc(f.test)}</div><div class="stat">${esc(f.stat)}</div></div>`).join("")}</div>`;

    const H = lab.har || {}, Co = lab.costs;
    $("#p-method").innerHTML = `<div class="grid g-2">
      <div class="sec" style="font-size:13.5px;line-height:1.7">
        <div class="mini-h" style="margin-top:0">How a call is made</div>
        <ol style="padding-left:18px;margin:6px 0">
          <li>Live NIFTY chain → own Black-76 IVs from bid/ask mids, forward from put-call parity, skew-aware probabilities from a fitted smile.</li>
          <li>Realised vol forecast to expiry with a HAR model (out-of-sample R² <b class="mono">${fmt(H.r2_har, 2)}</b> vs <b class="mono">${fmt(H.r2_naive, 2)}</b> for a 22-day average).</li>
          <li>IV/RV = implied variance ÷ forecast variance over the exact sessions to expiry.</li>
          <li>Gate (fixed before testing): IV/RV ≥ ${V.gate.iv_rv_min} and no +${V.gate.vix_spike_max * 100}% VIX day.</li>
          <li>Look up past days in the same IV/RV quintile and DTE bucket; trade only if that history is positive (shrunk toward the quintile mean when thin).</li>
          <li>Direction only from signals that pass split-half and out-of-sample tests — currently none.</li>
          <li>Strikes by delta (short 20Δ / long 5Δ for condors), sized so max loss ≤ your risk budget.</li>
        </ol></div>
      <div class="sec" style="font-size:13.5px;line-height:1.7">
        <div class="mini-h" style="margin-top:0">Costs &amp; honesty</div>
        <ul style="padding-left:18px;margin:6px 0">
          <li>${Co.fixed_pts_per_leg} pt per leg (half-spread + brokerage) + ${(Co.prop_of_premium * 100).toFixed(1)}% of premium (STT, exchange, GST, stamp), plus ${(Co.exercise_stt * 100).toFixed(3)}% STT on in-the-money long legs at expiry.</li>
          <li>Entries at EOD closes; expiry settled on the NIFTY close. Stale quotes that imply free money are discarded.</li>
          <li>Overlapping entries on the same expiry share one outcome, so t-stats are clustered by expiry.</li>
          <li>Direction signals use the return from the <i>next</i> open — EOD data can't be traded at the close it describes.</li>
          <li>Every session's call — including NO TRADE days — is journaled and settled, building a live out-of-sample record.</li>
        </ul></div></div>`;
  }

  function drawCurve() {
    const cv = lab.vol.curves[curveDte];
    if (!cv) return;
    const c = chart("lab-curve");
    c.setOption(base({
      grid: { left: 50, right: 12, top: 26, bottom: 26 },
      legend: legend(["Gated", "Every expiry"]),
      tooltip: tip({ formatter: (a) => `${echarts.time.format(a[0].value[0], "{dd} {MMM} {yyyy}")}` + a.map((q) => `<br>${q.marker}${q.seriesName} ${sgn(q.value[1], 0)} pts`).join("") }),
      xAxis: ax({ type: "time", splitLine: { show: false }, axisLabel: { color: C.muted, fontSize: 10.5, fontFamily: "JetBrains Mono", hideOverlap: true } }),
      yAxis: ax({ type: "value" }),
      series: [
        { name: "Gated", type: "line", step: "end", data: cv.dates.map((d, i) => [d, cv.iron_condor_gated[i]]), showSymbol: false, lineStyle: { width: 2, color: C.s3 }, itemStyle: { color: C.s3 }, areaStyle: { color: "rgba(25,158,112,.10)" } },
        { name: "Every expiry", type: "line", step: "end", data: cv.dates.map((d, i) => [d, cv.iron_condor[i]]), showSymbol: false, lineStyle: { width: 1.6, color: C.s2 }, itemStyle: { color: C.s2 } },
      ],
    }), true);
  }

  function renderDir() {
    const D = lab.direction[dirH];
    const now = (snap && snap.signals_now) || {};
    const fmtNow = (k, v) => !ok(v) ? "—" : ["mom20", "rev5", "trend200", "vix_chg5", "mp_gap"].includes(k) ? sgn(v * 100, 2) + "%" : k === "vix_pct" ? pct(v, 0) : k === "pcr_oi" ? fmt(v, 2) : sgn(v, 2) + "σ";
    $("#p-dir").innerHTML = `
      <div class="card-head" style="margin-bottom:12px"><div class="callout" style="flex:1">${D.usable.length
        ? `<b>${D.usable.length}</b> signal(s) pass both halves; the selection procedure scored out-of-sample t = <b class="mono">${fmt(D.oos.t, 2)}</b> → ${D.trusted ? "<b>trusted</b>" : "<b>not trusted</b>"}.`
        : `<b>No directional signal survives.</b> Every candidate below was tested against NIFTY's next-${dirH}-session return from the next open. None holds up in both halves of history, so the engine stays delta-neutral and never leans on them.`}</div>
        <div class="tabs" style="margin:0 0 0 12px"><button class="tab ${dirH === "5" ? "on" : ""}" data-h="5">5-day</button><button class="tab ${dirH === "1" ? "on" : ""}" data-h="1">1-day</button></div></div>
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Signal</th><th>Now</th><th>Rank IC</th><th>t (NW)</th><th>t · 1st half</th><th>t · 2nd half</th><th>Top−bottom quintile</th><th>Since</th><th>Verdict</th></tr></thead><tbody>
      ${D.signals.map((s) => s.verdict === "INSUFFICIENT" ? `<tr><td class="name">${esc(s.name)}</td><td colspan="7" class="muted">n=${s.n}</td><td>${vtag(s.verdict)}</td></tr>` :
        `<tr><td class="name">${esc(s.name)}<span class="desc">${esc(s.desc)}</span></td><td>${fmtNow(s.key, now[s.key])}</td><td>${sgn(s.ic, 3)}</td><td>${sgn(s.t, 2)}</td><td class="sec">${sgn(s.t1, 2)}</td><td class="sec">${sgn(s.t2, 2)}</td><td class="${cls(s.q_spread_pct)}">${sgn(s.q_spread_pct, 2)}%</td><td class="sec">${s.start.slice(0, 4)}</td><td>${vtag(s.verdict)}</td></tr>`).join("")}
      </tbody></table></div>
      <div class="muted" style="font-size:12px;margin-top:10px">EDGE = |t| ≥ 2 overall, same sign and |t| ≥ 1 in each half. WEAK = |t| ≥ 1.5 with a stable sign. Newey-West errors for overlapping returns.</div>`;
    document.querySelectorAll("#p-dir [data-h]").forEach((b) => b.onclick = () => { dirH = b.dataset.h; renderDir(); });
  }

  // ------------------------------------------------------------ journal
  function renderJournal() {
    const J = journalData;
    if (!J) return;
    const T = J.traded, A = J.stood_aside;
    const k = (key, v, s, c = "") => `<div class="kpi"><div class="k">${key}</div><div class="v ${c}">${v}</div><div class="s">${s}</div></div>`;
    let h = `<div class="kpis">
      ${k("Calls traded", T.n, `${T.settled} settled · ${T.open} open`)}
      ${k("Win rate", T.settled ? pct(T.wins / T.settled, 0) : "—", `${T.wins} of ${T.settled}`)}
      ${k("Traded P&L", T.settled ? sgn(T.total_pts, 1) + " pts" : "—", T.avg_pts !== null ? `avg ${sgn(T.avg_pts, 1)} · ${sgn(T.avg_R, 2)} R` : "per-unit points, after costs", cls(T.total_pts))}
      ${k("Days stood aside", A.n, `${A.settled} settled`)}
      ${k("Shadow condor on those days", A.settled ? sgn(A.total_pts, 1) + " pts" : "—", A.settled ? (A.total_pts < 0 ? "what standing aside avoided" : "what standing aside cost") : "settles at expiry", cls(A.total_pts))}
    </div>`;
    if (J.rows.length) {
      h += `<div class="scroll-x" style="margin-top:14px"><table class="tbl"><thead><tr><th>Session</th><th>Call</th><th>Expiry</th><th>Strikes</th><th>Credit</th><th>IV/RV</th><th>Settle</th><th>P&L pts</th></tr></thead><tbody>` +
        J.rows.map((r) => `<tr><td class="name">${r.date}</td><td>${r.shadow ? '<span class="tag noise">no trade · shadow</span>' : `<span class="tag measured">${esc(labelShort(r.structure))}</span>`}</td>
          <td>${esc(r.expiry)}</td><td class="sec">${r.legs.map((l) => (l.qty < 0 ? "−" : "+") + fmt(l.strike) + l.right[0]).join(" ")}</td>
          <td>${sgn(r.credit, 1)}</td><td>${fmt(r.iv_rv, 2)}</td><td>${r.status === "settled" ? fmt(r.settle, 0) : '<span class="muted">open</span>'}</td>
          <td class="${cls(r.pnl_pts)}">${r.status === "settled" ? sgn(r.pnl_pts, 1) : "—"}</td></tr>`).join("") + "</tbody></table></div>";
    } else {
      h += `<div class="muted" style="margin-top:12px">Nothing logged yet — the first call of each session is recorded automatically.</div>`;
    }
    $("#journal").innerHTML = h;
  }

  // ------------------------------------------------------------ wiring
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2400); }
  $("#refresh").onclick = () => loadSnapshot(true);
  const drawer = $("#drawer"), bg = $("#drawer-bg");
  const openDrawer = () => { $("#s-capital").value = settings.capital; $("#s-risk").value = settings.risk_pct; $("#s-maxlots").value = settings.max_lots; drawer.classList.add("open"); bg.classList.add("open"); };
  const closeDrawer = () => { drawer.classList.remove("open"); bg.classList.remove("open"); };
  $("#open-settings").onclick = openDrawer;
  bg.onclick = closeDrawer;
  $("#save-settings").onclick = () => {
    settings = { capital: Math.max(0, +$("#s-capital").value || DEF.capital), risk_pct: Math.min(10, Math.max(0.1, +$("#s-risk").value || DEF.risk_pct)), max_lots: Math.max(1, Math.round(+$("#s-maxlots").value || DEF.max_lots)) };
    saveSettings(); closeDrawer(); toast("Saved — recomputing size"); loadSnapshot(true);
  };
  document.querySelectorAll("#lab-tabs .tab").forEach((b) => b.onclick = () => {
    document.querySelectorAll("#lab-tabs .tab").forEach((x) => x.classList.toggle("on", x === b));
    document.querySelectorAll(".pane").forEach((p) => p.classList.toggle("on", p.id === b.dataset.pane));
    Object.values(charts).forEach((c) => c.resize());
  });
  if (!["127.0.0.1", "localhost"].includes(location.hostname)) $("#rebuild").style.display = "none";
  $("#rebuild").hidden = true;
  try { const a = localStorage.getItem("niftyedge.auto"); if (a !== null) $("#auto").checked = a === "1"; } catch (e) { }
  $("#auto").onchange = (e) => { try { localStorage.setItem("niftyedge.auto", e.target.checked ? "1" : "0"); } catch (x) { } };
  setInterval(() => {
    if (!$("#auto").checked || document.hidden) return;
    const every = snap && snap.market_open ? 60e3 : 300e3;
    if (Date.now() - lastFetch >= every) loadSnapshot();
  }, 5000);
  document.addEventListener("keydown", (e) => { if (e.key === "r" && !e.metaKey && !e.ctrlKey && document.activeElement.tagName !== "INPUT") loadSnapshot(true); if (e.key === "Escape") closeDrawer(); });

  loadLab().catch(() => { $("#p-vol").textContent = "Evidence lab unavailable. Refresh to retry."; });
  loadJournal();
  loadSnapshot();
})();
