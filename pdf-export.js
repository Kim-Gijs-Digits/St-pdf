
(() => {
  "use strict";

  const STORE_KEY = "shifttap_state_try_outv1";

  const $ = (id) => document.getElementById(id);

  function pad2(n){ return String(n).padStart(2,"0"); }

  function ymdToDmy(ymd){
    // "YYYY-MM-DD" -> "DD/MM/YYYY"
    const [y,m,d] = (ymd||"").split("-");
    if(!y||!m||!d) return ymd || "";
    return `${d}/${m}/${y}`;
  }

  function dmyToday(){
    const d = new Date();
    return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)}/${d.getFullYear()}`;
  }

  function formatHM(min){
    const sign = min < 0 ? "-" : "";
    const a = Math.abs(min || 0);
    const h = Math.floor(a/60);
    const m = a % 60;
    return `${sign}${h}:${pad2(m)}`;
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    }catch(e){
      return null;
    }
  }

  function entriesAll(state){
    const list = Array.isArray(state?.entries) ? state.entries : [];
    return list.filter(e => e && !e.deletedAt && typeof e.date === "string");
  }

  function uniqueMonthsFromEntries(entries){
    const set = new Set();
    for(const e of entries){
      // date: YYYY-MM-DD
      if(e.date && e.date.length >= 7){
        set.add(e.date.slice(0,7)); // YYYY-MM
      }
    }
    return Array.from(set).sort();
  }

  function monthLabel(ym){
    // "2026-02" -> "02/2026"
    const [y,m] = (ym||"").split("-");
    if(!y||!m) return ym || "";
    return `${m}/${y}`;
  }

  function getMode(){
    const nodes = document.querySelectorAll('input[name="pdfMode"]');
    for(const n of nodes){
      if(n.checked) return n.value;
    }
    return "month";
  }

  function openDialog(){
    const dlg = $("pdfDialog");
    if(!dlg) return;

    const state = loadState();
    const entries = entriesAll(state);

    const months = uniqueMonthsFromEntries(entries);
    const sel = $("pdfMonthSelect");
    if(sel){
      sel.innerHTML = "";
      if(months.length === 0){
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "(geen data)";
        sel.appendChild(opt);
      }else{
        for(const ym of months){
          const opt = document.createElement("option");
          opt.value = ym;
          opt.textContent = monthLabel(ym);
          sel.appendChild(opt);
        }
        // default = laatste maand (meest recent)
        sel.value = months[months.length-1];
      }
    }

    // default range = huidige maand
    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last = new Date(now.getFullYear(), now.getMonth()+1, 0);
    if($("pdfFrom")) $("pdfFrom").value = `${first.getFullYear()}-${pad2(first.getMonth()+1)}-${pad2(first.getDate())}`;
    if($("pdfTo"))   $("pdfTo").value   = `${last.getFullYear()}-${pad2(last.getMonth()+1)}-${pad2(last.getDate())}`;

    // open
    if(typeof dlg.showModal === "function"){
      dlg.showModal();
    }else{
      alert("Je browser ondersteunt dit export-venster niet. Update Chrome/WebView.");
    }
  }

  function closeDialog(){
    const dlg = $("pdfDialog");
    if(dlg && dlg.open) dlg.close();
  }

  function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

  function dateToMs(ymd){
    // safe parse at midnight local
    return new Date(ymd + "T00:00:00").getTime();
  }

  function inRange(dateYMD, fromYMD, toYMD){
    const t = dateToMs(dateYMD);
    return t >= dateToMs(fromYMD) && t <= dateToMs(toYMD);
  }

  function filterEntries(entries, mode, monthY, fromY, toY){
    if(mode === "month"){
      if(!monthY) return [];
      return entries.filter(e => e.date.startsWith(monthY + "-"));
    }
    // range
    if(!fromY || !toY) return [];
    const a = dateToMs(fromY);
    const b = dateToMs(toY);
    const from = a <= b ? fromY : toY;
    const to   = a <= b ? toY : fromY;
    return entries.filter(e => inRange(e.date, from, to));
  }

  function splitByMonth(entries){
    const map = new Map();
    for(const e of entries){
      const ym = e.date.slice(0,7);
      if(!map.has(ym)) map.set(ym, []);
      map.get(ym).push(e);
    }
    // sort by date within month
    for(const [ym, list] of map.entries()){
      list.sort((a,b) => (a.date||"").localeCompare(b.date||"") || (a.createdAt||0)-(b.createdAt||0));
    }
    return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  }

  function daysInMonth(ym){
    const [y,m] = ym.split("-");
    const year = parseInt(y,10);
    const month = parseInt(m,10)-1;
    const d = new Date(year, month+1, 0).getDate();
    return d;
  }

  function buildMonthDayRows(ym, monthEntries){
    // returns rows: {dateYMD, label, workNetMin, pauseMin, types:Set}
    const [y,m] = ym.split("-");
    const year = parseInt(y,10);
    const month = parseInt(m,10)-1;
    const dim = daysInMonth(ym);

    const byDay = new Map();
    for(let day=1; day<=dim; day++){
      const ymd = `${y}-${m}-${pad2(day)}`;
      byDay.set(ymd, { dateYMD: ymd, workNetMin: 0, pauseMin: 0, types: new Set(), workCount:0 });
    }

    for(const e of monthEntries){
      const row = byDay.get(e.date);
      if(!row) continue;
      row.types.add(e.type || "");
      if((e.type||"") === "Werk"){
        row.workNetMin += (e.netMin || 0);
        row.pauseMin += (e.pauseMin || 0);
        row.workCount += 1;
      }
    }

    return Array.from(byDay.values());
  }

  function computeTotals(entries){
    const totals = {
      workNetMin: 0,
      workPauseMin: 0,
      workShifts: 0,
      recupDays: 0,
      vacationDays: 0,
      sickDays: 0,
      holidayDays: 0,
      otherDays: 0
    };

    // count unique days for non-work types
    const daySet = (type) => {
      const s = new Set();
      for(const e of entries){
        if((e.type||"") === type) s.add(e.date);
      }
      return s.size;
    };

    for(const e of entries){
      if((e.type||"") === "Werk"){
        totals.workNetMin += (e.netMin || 0);
        totals.workPauseMin += (e.pauseMin || 0);
        totals.workShifts += 1;
      }
    }

    totals.recupDays = daySet("Recup");
    totals.vacationDays = daySet("Vakantie");
    totals.sickDays = daySet("Ziekte");
    totals.holidayDays = daySet("Feestdag");

    return totals;
  }

  function ensureJsPDF(){
    const api = window.jspdf;
    if(!api || !api.jsPDF) return null;
    return api.jsPDF;
  }

  function safeText(doc, text, x, y, maxW){
    const t = String(text ?? "");
    if(!maxW){
      doc.text(t, x, y);
      return;
    }
    const lines = doc.splitTextToSize(t, maxW);
    doc.text(lines, x, y);
  }

  function addMonthSummaryPage(doc, ym, monthEntries){
    const left = 40;
    let y = 54;

    doc.setFont("helvetica","bold");
    doc.setFontSize(18);
    doc.text("Shift-Tap", left, y);

    doc.setFont("helvetica","normal");
    doc.setFontSize(10);
    y += 16;
    doc.text(`Samenvatting (Maandstaat) — ${monthLabel(ym)}`, left, y);
    y += 12;
    doc.text(`Gegenereerd: ${dmyToday()}`, left, y);

    y += 18;

    // Table headers
    const colDateW = 110;
    const colHoursW = 90;
    const colTypeW = 120;
    const tableW = colDateW + colHoursW + colTypeW;

    doc.setFont("helvetica","bold");
    doc.setFontSize(10);
    doc.text("Datum", left, y);
    doc.text("Uren", left + colDateW, y);
    doc.text("Type", left + colDateW + colHoursW, y);
    y += 6;
    doc.line(left, y, left + tableW, y);
    y += 14;

    doc.setFont("helvetica","normal");
    doc.setFontSize(9);

    const dayRows = buildMonthDayRows(ym, monthEntries);
    for(const r of dayRows){
      if(y > 740){
        doc.addPage();
        y = 54;
      }

      const dateTxt = ymdToDmy(r.dateYMD);
      let hoursTxt = "";
      let typeTxt = "";

      if(r.workNetMin > 0){
        hoursTxt = formatHM(r.workNetMin);
      }else{
        // show a clean label if it's a non-work day with a known type
        const types = Array.from(r.types).filter(Boolean);
        if(types.length === 1 && types[0] !== "Werk"){
          typeTxt = types[0].toUpperCase();
        }else if(types.length > 0 && !(types.length === 1 && types[0] === "Werk")){
          typeTxt = types.filter(t=>t!=="Werk").join(", ").toUpperCase();
        }
      }

      doc.text(dateTxt, left, y);
      doc.text(hoursTxt, left + colDateW, y);
      doc.text(typeTxt, left + colDateW + colHoursW, y);
      y += 14;
    }

    // Totals block
    const totals = computeTotals(monthEntries);
    y += 10;
    doc.line(left, y, left + tableW, y);
    y += 18;

    doc.setFont("helvetica","bold");
    doc.setFontSize(12);
    doc.text("Totalen", left, y);
    y += 18;

    doc.setFontSize(11);
    doc.text(`Gewerkte uren: ${formatHM(totals.workNetMin)}`, left, y); y += 16;
    doc.text(`Pauze: ${formatHM(totals.workPauseMin)}`, left, y); y += 16;
    doc.text(`Aantal werkshiften: ${totals.workShifts}`, left, y); y += 16;

    // smaller extras
    doc.setFont("helvetica","normal");
    doc.setFontSize(10);
    doc.text(`Recup-dagen: ${totals.recupDays}   Vakantie: ${totals.vacationDays}   Ziekte: ${totals.sickDays}   Feestdag: ${totals.holidayDays}`, left, y);
  }

  function addMonthDetailPage(doc, ym, monthEntries){
    doc.addPage();

    const left = 40;
    let y = 54;

    doc.setFont("helvetica","bold");
    doc.setFontSize(16);
    doc.text(`Detaillijst (met Opmerkingen) — ${monthLabel(ym)}`, left, y);
    y += 16;

    doc.setFont("helvetica","normal");
    doc.setFontSize(9);

    // Column widths (A4 portrait ~ 595pt wide, margins)
    const colW = {
      date: 70,
      type: 60,
      start: 40,
      end: 40,
      pause: 40,
      net: 45,
      note: 240
    };

    const headers = ["Datum","Type","Start","Einde","Pauze","Netto","Opmerkingen"];
    const xs = [left];
    xs.push(xs[xs.length-1] + colW.date);
    xs.push(xs[xs.length-1] + colW.type);
    xs.push(xs[xs.length-1] + colW.start);
    xs.push(xs[xs.length-1] + colW.end);
    xs.push(xs[xs.length-1] + colW.pause);
    xs.push(xs[xs.length-1] + colW.net);

    // header row
    doc.setFont("helvetica","bold");
    doc.text(headers[0], xs[0], y);
    doc.text(headers[1], xs[1], y);
    doc.text(headers[2], xs[2], y);
    doc.text(headers[3], xs[3], y);
    doc.text(headers[4], xs[4], y);
    doc.text(headers[5], xs[5], y);
    doc.text(headers[6], xs[6], y);
    y += 6;
    doc.line(left, y, left + colW.date+colW.type+colW.start+colW.end+colW.pause+colW.net+colW.note, y);
    y += 14;

    doc.setFont("helvetica","normal");

    // Sort by date then createdAt
    const list = monthEntries.slice().sort((a,b)=> (a.date||"").localeCompare(b.date||"") || (a.createdAt||0)-(b.createdAt||0));

    const rowGap = 4;

    for(const e of list){
      if(y > 760){
        doc.addPage();
        y = 54;
        doc.setFont("helvetica","bold");
        doc.text(headers[0], xs[0], y);
        doc.text(headers[1], xs[1], y);
        doc.text(headers[2], xs[2], y);
        doc.text(headers[3], xs[3], y);
        doc.text(headers[4], xs[4], y);
        doc.text(headers[5], xs[5], y);
        doc.text(headers[6], xs[6], y);
        y += 6;
        doc.line(left, y, left + colW.date+colW.type+colW.start+colW.end+colW.pause+colW.net+colW.note, y);
        y += 14;
        doc.setFont("helvetica","normal");
      }

      const dateTxt = ymdToDmy(e.date);
      const typeTxt = (e.type || "");
      const startTxt = e.start || "";
      const endTxt = e.end || "";
      const pauseTxt = (e.pauseMin ? `${e.pauseMin}m` : "");
      const netTxt = (typeof e.netMin === "number") ? formatHM(e.netMin) : "";
      const noteTxt = (e.note || "").replace(/\s+/g," ").trim();

      // note can wrap -> compute height
      const noteLines = doc.splitTextToSize(noteTxt, colW.note);
      const lineH = 11;
      const rowH = Math.max(lineH, noteLines.length * lineH);

      doc.text(dateTxt, xs[0], y);
      doc.text(typeTxt, xs[1], y);
      doc.text(startTxt, xs[2], y);
      doc.text(endTxt, xs[3], y);
      doc.text(pauseTxt, xs[4], y);
      doc.text(netTxt, xs[5], y);
      if(noteLines.length){
        doc.text(noteLines, xs[6], y);
      }

      y += rowH + rowGap;
    }
  }

  function makePdfForSelection(filteredEntries){
    const JsPDF = ensureJsPDF();
    if(!JsPDF){
      alert("jsPDF niet gevonden. Zet 'jspdf.umd.min.js' naast je HTML en laad het mee.");
      return;
    }

    const byMonth = splitByMonth(filteredEntries);
    if(byMonth.length === 0){
      alert("Geen entries in deze selectie.");
      return;
    }

    const doc = new JsPDF({ unit:"pt", format:"a4" });

    // We'll render first month on first page of the document,
    // subsequent months start on a new page.
    let firstMonth = true;

    for(const [ym, monthEntries] of byMonth){
      if(!firstMonth){
        doc.addPage();
      }
      // When we addPage here, we need to be careful: summary draws on current page.
      // For the very first month, doc already has page 1.
      addMonthSummaryPage(doc, ym, monthEntries);
      addMonthDetailPage(doc, ym, monthEntries);
      firstMonth = false;
    }

    const now = new Date();
    const fname = `Shift-Tap_${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}.pdf`;
    doc.save(fname);
  }

  function onConfirm(){
    const state = loadState();
    const all = entriesAll(state);
    if(all.length === 0){
      alert("Geen data gevonden om te exporteren.");
      return;
    }

    const mode = getMode();

    const monthY = $("pdfMonthSelect")?.value || "";
    const fromY  = $("pdfFrom")?.value || "";
    const toY    = $("pdfTo")?.value || "";

    const filtered = filterEntries(all, mode, monthY, fromY, toY);

    if(filtered.length === 0){
      alert("Geen entries in deze selectie.");
      return;
    }

    closeDialog();
    makePdfForSelection(filtered);
  }

  function wire(){
    // main button (history tab)
    const btn = $("btnExportPdf");
    if(btn){
      btn.addEventListener("click", openDialog);
    }

    const cancel = $("pdfCancel");
    if(cancel) cancel.addEventListener("click", closeDialog);

    const ok = $("pdfConfirm");
    if(ok) ok.addEventListener("click", onConfirm);

    // auto-switch radio when interacting with controls
    const sel = $("pdfMonthSelect");
    if(sel){
      sel.addEventListener("focus", () => {
        const r = document.querySelector('input[name="pdfMode"][value="month"]');
        if(r) r.checked = true;
      });
      sel.addEventListener("change", () => {
        const r = document.querySelector('input[name="pdfMode"][value="month"]');
        if(r) r.checked = true;
      });
    }

    for(const id of ["pdfFrom","pdfTo"]){
      const el = $(id);
      if(el){
        el.addEventListener("focus", () => {
          const r = document.querySelector('input[name="pdfMode"][value="range"]');
          if(r) r.checked = true;
        });
        el.addEventListener("change", () => {
          const r = document.querySelector('input[name="pdfMode"][value="range"]');
          if(r) r.checked = true;
        });
      }
    }
  }

  // init when DOM ready
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", wire);
  }else{
    wire();
  }
})();
