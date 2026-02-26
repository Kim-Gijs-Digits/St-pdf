
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
      otherDays: 0,
      overtimeDeltaMin: 0,
      normDayMin: null
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

  function computeOvertimeDeltaMin(state, entries){
    // Month delta (not global saldo):
    // For each unique day in this selection:
    //   if has work -> + (workNet - normDay)
    //   for each recup entry -> -normDay
    // Uses same principle as overtimeSaldoMin() in your main app.
    const normDay = state?.settings?.normDayMin;
    if(typeof normDay !== "number"){
      return { overtimeDeltaMin: 0, normDayMin: null };
    }

    const days = [...new Set(entries.map(e => e.date))].sort();
    let sum = 0;
    for(const day of days){
      const hasWork = entries.some(e => e.date === day && (e.type||"") === "Werk");
      if(hasWork){
        const workNet = entries
          .filter(e => e.date === day && (e.type||"") === "Werk")
          .reduce((a,e)=>a + (e.netMin||0), 0);
        sum += (workNet - normDay);
      }

      const recups = entries.filter(e => e.date === day && (e.type||"") === "Recup").length;
      if(recups > 0) sum += (-normDay * recups);
    }

    return { overtimeDeltaMin: sum, normDayMin: normDay };
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

  function pageWidth(doc){
    return doc.internal?.pageSize?.getWidth ? doc.internal.pageSize.getWidth() : 595;
  }

  function drawTableGrid(doc, x, yTop, colWs, rowHs){
    const w = colWs.reduce((a,b)=>a+b,0);
    const h = rowHs.reduce((a,b)=>a+b,0);

    // outer
    doc.rect(x, yTop, w, h);

    // verticals
    let cx = x;
    for(let i=0;i<colWs.length-1;i++){
      cx += colWs[i];
      doc.line(cx, yTop, cx, yTop + h);
    }

    // horizontals
    let cy = yTop;
    for(let i=0;i<rowHs.length-1;i++){
      cy += rowHs[i];
      doc.line(x, cy, x + w, cy);
    }
  }

  function addMonthSummaryPage(doc, state, ym, monthEntries){
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

    // === GRID TABLE (centered + bigger) ===
    const dayRows = buildMonthDayRows(ym, monthEntries);

    const colWs = [120, 90, 200]; // Datum, Uren, Type
    const tableW = colWs.reduce((a,b)=>a+b,0);
    const x = Math.max(30, (pageWidth(doc) - tableW) / 2);

    const headerH = 22;
    const baseRowH = 18;
    const rowHs = [headerH, ...dayRows.map(()=>baseRowH)];

    drawTableGrid(doc, x, y, colWs, rowHs);

    // header text
    doc.setFont("helvetica","bold");
    doc.setFontSize(11);
    const hy = y + 15;
    doc.text("Datum", x + 6, hy);
    doc.text("Uren", x + colWs[0] + 6, hy);
    doc.text("Type", x + colWs[0] + colWs[1] + 6, hy);

    // body text
    doc.setFont("helvetica","normal");
    doc.setFontSize(10);
    let cy = y + headerH;
    for(let i=0;i<dayRows.length;i++){
      const r = dayRows[i];
      const ty = cy + 13;

      const dateTxt = ymdToDmy(r.dateYMD);
      let hoursTxt = "";
      let typeTxt = "";

      if(r.workNetMin > 0){
        hoursTxt = formatHM(r.workNetMin);
      }else{
        const types = Array.from(r.types).filter(Boolean);
        if(types.length === 1 && types[0] !== "Werk"){
          typeTxt = types[0].toUpperCase();
        }else if(types.length > 0 && !(types.length === 1 && types[0] === "Werk")){
          typeTxt = types.filter(t=>t!=="Werk").join(", ").toUpperCase();
        }
      }

      doc.text(dateTxt, x + 6, ty);
      doc.text(hoursTxt, x + colWs[0] + 6, ty);
      doc.text(typeTxt, x + colWs[0] + colWs[1] + 6, ty);

      cy += baseRowH;
    }

    y += rowHs.reduce((a,b)=>a+b,0);

    // Totals block (boxed, centered)
    const totals = computeTotals(monthEntries);
    const ot = computeOvertimeDeltaMin(state, monthEntries);
    totals.overtimeDeltaMin = ot.overtimeDeltaMin;
    totals.normDayMin = ot.normDayMin;

    y += 18;

    doc.setFont("helvetica","bold");
    doc.setFontSize(13);
    doc.text("Totalen", x, y);
    y += 10;

    const boxX = x;
    const boxW = tableW;
    const boxPad = 10;
    const lineH = 15;
    const lines = [
      `Gewerkte uren: ${formatHM(totals.workNetMin)}`,
      `Pauze: ${formatHM(totals.workPauseMin)}`,
      `Aantal werkshiften: ${totals.workShifts}`,
      `Vakantie: ${totals.vacationDays}   Ziekte: ${totals.sickDays}   Recup: ${totals.recupDays}   Feestdag: ${totals.holidayDays}`,
      `Overuren (maand): ${formatHM(totals.overtimeDeltaMin)}${totals.normDayMin!=null ? `   (Norm/dag: ${formatHM(totals.normDayMin)})` : ""}`
    ];
    const boxH = boxPad*2 + lines.length*lineH;

    doc.rect(boxX, y, boxW, boxH);

    let ty = y + boxPad + 12;
    doc.setFont("helvetica","bold");
    doc.setFontSize(12);
    doc.text(lines[0], boxX + boxPad, ty);

    doc.setFont("helvetica","normal");
    doc.setFontSize(11);
    for(let i=1;i<lines.length;i++){
      ty += lineH;
      doc.text(lines[i], boxX + boxPad, ty);
    }
  }

  function addMonthDetailPage(doc, state, ym, monthEntries){
    doc.addPage();

    const left = 40;
    let y = 54;

    doc.setFont("helvetica","bold");
    doc.setFontSize(16);
    doc.text(`Detaillijst (met Opmerkingen) — ${monthLabel(ym)}`, left, y);
    y += 16;

    // Extra info (counts + overtime)
    const totals = computeTotals(monthEntries);
    const ot = computeOvertimeDeltaMin(state, monthEntries);
    totals.overtimeDeltaMin = ot.overtimeDeltaMin;
    totals.normDayMin = ot.normDayMin;

    doc.setFontSize(11);
    doc.text(`Vakantie: ${totals.vacationDays}   Ziekte: ${totals.sickDays}   Recup: ${totals.recupDays}   Feestdag: ${totals.holidayDays}`, left, y);
    y += 14;
    doc.text(`Overuren (maand): ${formatHM(totals.overtimeDeltaMin)}${totals.normDayMin!=null ? `   (Norm/dag: ${formatHM(totals.normDayMin)})` : ""}`, left, y);
    y += 18;

    doc.setFont("helvetica","normal");
    doc.setFontSize(9);

    // Bigger + centered grid table
    const headers = ["Datum","Type","Start","Einde","Pauze","Netto","Opmerkingen"];
    const colWs = [80, 70, 45, 45, 45, 55, 210];
    const tableW = colWs.reduce((a,b)=>a+b,0);
    const x = Math.max(22, (pageWidth(doc) - tableW) / 2);
    const xs = [x];
    for(let i=0;i<colWs.length-1;i++) xs.push(xs[xs.length-1] + colWs[i]);

    const headerH = 22;
    const baseRowH = 18;

    function drawHeader(){
      drawTableGrid(doc, x, y, colWs, [headerH]);
      doc.setFont("helvetica","bold");
      doc.setFontSize(10);
      const hy = y + 15;
      for(let i=0;i<headers.length;i++) doc.text(headers[i], xs[i] + 5, hy);
      doc.setFont("helvetica","normal");
      doc.setFontSize(9);
      y += headerH;
    }

    drawHeader();

    const list = monthEntries.slice().sort((a,b)=> (a.date||"").localeCompare(b.date||"") || (a.createdAt||0)-(b.createdAt||0));

    for(const e of list){
      const noteTxt = (e.note || "").replace(/\s+/g," ").trim();
      const noteLines = doc.splitTextToSize(noteTxt, colWs[6] - 10);
      const lineH = 11;
      const needH = Math.max(baseRowH, Math.max(1, noteLines.length) * lineH + 6);

      if(y + needH > 800){
        doc.addPage();
        y = 54;
        doc.setFont("helvetica","bold");
        doc.setFontSize(16);
        doc.text(`Detaillijst (met Opmerkingen) — ${monthLabel(ym)}`, left, y);
        y += 16;
        doc.setFontSize(11);
        doc.text(`Vakantie: ${totals.vacationDays}   Ziekte: ${totals.sickDays}   Recup: ${totals.recupDays}   Feestdag: ${totals.holidayDays}`, left, y);
        y += 14;
        doc.text(`Overuren (maand): ${formatHM(totals.overtimeDeltaMin)}${totals.normDayMin!=null ? `   (Norm/dag: ${formatHM(totals.normDayMin)})` : ""}`, left, y);
        y += 18;
        doc.setFont("helvetica","normal");
        doc.setFontSize(9);
        drawHeader();
      }

      drawTableGrid(doc, x, y, colWs, [needH]);

      const dateTxt = ymdToDmy(e.date);
      const typeTxt = (e.type || "");
      const startTxt = e.start || "";
      const endTxt = e.end || "";
      const pauseTxt = (e.pauseMin ? `${e.pauseMin}m` : "");
      const netTxt = (typeof e.netMin === "number") ? formatHM(e.netMin) : "";

      const ty = y + 13;
      doc.text(dateTxt, xs[0] + 5, ty);
      doc.text(typeTxt, xs[1] + 5, ty);
      doc.text(startTxt, xs[2] + 5, ty);
      doc.text(endTxt, xs[3] + 5, ty);
      doc.text(pauseTxt, xs[4] + 5, ty);
      doc.text(netTxt, xs[5] + 5, ty);
      if(noteLines.length) doc.text(noteLines, xs[6] + 5, ty);

      y += needH;
    }
  }

  function makePdfForSelection(state, filteredEntries){
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
      addMonthSummaryPage(doc, state, ym, monthEntries);
      addMonthDetailPage(doc, state, ym, monthEntries);
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
    makePdfForSelection(state, filtered);
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
