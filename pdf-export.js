(() => {
  "use strict";

  const STORE_KEY = "shifttap_state_try_outv1";
  const $ = (id) => document.getElementById(id);

  function pad2(n){ return String(n).padStart(2,"0"); }

  function ymdToDmy(ymd){
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
      if(e.date && e.date.length >= 7) set.add(e.date.slice(0,7)); // YYYY-MM
    }
    return Array.from(set).sort();
  }

  function monthLabel(ym){
    const [y,m] = (ym||"").split("-");
    if(!y||!m) return ym || "";
    return `${m}/${y}`;
  }

  function dateToMs(ymd){
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
    if(!fromY || !toY) return [];
    const a = dateToMs(fromY), b = dateToMs(toY);
    const from = a <= b ? fromY : toY;
    const to   = a <= b ? toY   : fromY;
    return entries.filter(e => inRange(e.date, from, to));
  }

  function splitByMonth(entries){
    const map = new Map();
    for(const e of entries){
      const ym = e.date.slice(0,7);
      if(!map.has(ym)) map.set(ym, []);
      map.get(ym).push(e);
    }
    for(const [ym, list] of map.entries()){
      list.sort((a,b)=> (a.date||"").localeCompare(b.date||"") || (a.createdAt||0)-(b.createdAt||0));
    }
    return Array.from(map.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
  }

  function daysInMonth(ym){
    const [y,m] = ym.split("-");
    const year = parseInt(y,10);
    const month = parseInt(m,10)-1;
    return new Date(year, month+1, 0).getDate();
  }

  function buildMonthDayRows(ym, monthEntries){
    const [y,m] = ym.split("-");
    const dim = daysInMonth(ym);

    const byDay = new Map();
    for(let day=1; day<=dim; day++){
      const ymd = `${y}-${m}-${pad2(day)}`;
      byDay.set(ymd, { dateYMD: ymd, workNetMin: 0, pauseMin: 0, types: new Set(), workCount: 0 });
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
      overtimeDeltaMin: 0,
      normDayMin: null
    };

    for(const e of entries){
      if((e.type||"") === "Werk"){
        totals.workNetMin += (e.netMin || 0);
        totals.workPauseMin += (e.pauseMin || 0);
        totals.workShifts += 1;
      }
    }

    const daySet = (type) => {
      const s = new Set();
      for(const e of entries) if((e.type||"") === type) s.add(e.date);
      return s.size;
    };

    totals.recupDays = daySet("Recup");
    totals.vacationDays = daySet("Vakantie");
    totals.sickDays = daySet("Ziekte");
    totals.holidayDays = daySet("Feestdag");

    return totals;
  }

  function computeOvertimeDeltaMin(state, entries){
    // per unique day in selection:
    // if has work: + (workNet - normDay)
    // each recup entry: - normDay
    const normDay = state?.settings?.normDayMin;
    if(typeof normDay !== "number"){
      return { overtimeDeltaMin: 0, normDayMin: null };
    }

    const days = [...new Set(entries.map(e => e.date))].sort();
    let sum = 0;

    for(const day of days){
      const works = entries.filter(e => e.date === day && (e.type||"") === "Werk");
      if(works.length){
        const workNet = works.reduce((a,e)=>a + (e.netMin||0), 0);
        sum += (workNet - normDay);
      }

      const recups = entries.filter(e => e.date === day && (e.type||"") === "Recup").length;
      if(recups) sum += (-normDay * recups);
    }

    return { overtimeDeltaMin: sum, normDayMin: normDay };
  }

  function ensureJsPDF(){
    const api = window.jspdf;
    if(!api || !api.jsPDF) return null;
    return api.jsPDF;
  }

  function pageWidth(doc){
    return doc.internal?.pageSize?.getWidth ? doc.internal.pageSize.getWidth() : 595;
  }

  function drawTableGrid(doc, x, yTop, colWs, rowHs){
    const w = colWs.reduce((a,b)=>a+b,0);
    const h = rowHs.reduce((a,b)=>a+b,0);

    doc.rect(x, yTop, w, h);

    let cx = x;
    for(let i=0;i<colWs.length-1;i++){
      cx += colWs[i];
      doc.line(cx, yTop, cx, yTop + h);
    }

    let cy = yTop;
    for(let i=0;i<rowHs.length-1;i++){
      cy += rowHs[i];
      doc.line(x, cy, x + w, cy);
    }
  }

  function fillHeader(doc, x, y, w, h){
    doc.setFillColor(238, 238, 238);
    doc.rect(x, y, w, h, "F");
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

    const dayRows = buildMonthDayRows(ym, monthEntries);

    // centered + a bit larger
    const colWs = [130, 100, 230]; // Datum, Uren, Type
    const tableW = colWs.reduce((a,b)=>a+b,0);
    const x = Math.max(24, (pageWidth(doc) - tableW) / 2);

    const headerH = 24;
    const rowH = 18;
    const rowHs = [headerH, ...dayRows.map(()=>rowH)];

    fillHeader(doc, x, y, tableW, headerH);
    drawTableGrid(doc, x, y, colWs, rowHs);

    // header text
    doc.setFont("helvetica","bold");
    doc.setFontSize(11);
    const hy = y + 16;
    doc.text("Datum", x + 6, hy);
    doc.text("Uren", x + colWs[0] + 6, hy);
    doc.text("Type", x + colWs[0] + colWs[1] + 6, hy);

    // body text
    doc.setFont("helvetica","normal");
    doc.setFontSize(10);
    let cy = y + headerH;

    for(const r of dayRows){
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

      cy += rowH;
    }

    y += rowHs.reduce((a,b)=>a+b,0);

    // totals
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
    const boxH = boxPad*2 + lines.length*lineH + 2;

    doc.rect(boxX, y, boxW, boxH);

    // main total highlighted
    let ty = y + boxPad + 16;
    doc.setFont("helvetica","bold");
    doc.setFontSize(14);
    doc.text(lines[0], boxX + boxPad, ty);

    doc.setDrawColor(120);
    doc.line(boxX + boxPad, ty + 6, boxX + boxW - boxPad, ty + 6);
    doc.setDrawColor(0);

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

    const totals = computeTotals(monthEntries);
    const ot = computeOvertimeDeltaMin(state, monthEntries);
    totals.overtimeDeltaMin = ot.overtimeDeltaMin;
    totals.normDayMin = ot.normDayMin;

    doc.setFont("helvetica","normal");
    doc.setFontSize(11);
    doc.text(`Vakantie: ${totals.vacationDays}   Ziekte: ${totals.sickDays}   Recup: ${totals.recupDays}   Feestdag: ${totals.holidayDays}`, left, y);
    y += 14;
    doc.text(`Overuren (maand): ${formatHM(totals.overtimeDeltaMin)}${totals.normDayMin!=null ? `   (Norm/dag: ${formatHM(totals.normDayMin)})` : ""}`, left, y);
    y += 18;

    // table
    const headers = ["Datum","Type","Start","Einde","Pauze","Netto","Opmerkingen"];
    const colWs = [85, 75, 48, 48, 48, 55, 210];
    const tableW = colWs.reduce((a,b)=>a+b,0);
    const x = Math.max(16, (pageWidth(doc) - tableW) / 2);
    const xs = [x];
    for(let i=0;i<colWs.length-1;i++) xs.push(xs[xs.length-1] + colWs[i]);

    const headerH = 24;
    const baseRowH = 18;

    function drawHeader(){
      fillHeader(doc, x, y, tableW, headerH);
      drawTableGrid(doc, x, y, colWs, [headerH]);

      doc.setFont("helvetica","bold");
      doc.setFontSize(10);
      const hy = y + 16;
      for(let i=0;i<headers.length;i++){
        doc.text(headers[i], xs[i] + 5, hy);
      }
      doc.setFont("helvetica","normal");
      doc.setFontSize(9);
      y += headerH;
    }

    drawHeader();

    const list = monthEntries
      .slice()
      .sort((a,b)=> (a.date||"").localeCompare(b.date||"") || (a.createdAt||0)-(b.createdAt||0));

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

        doc.setFont("helvetica","normal");
        doc.setFontSize(11);
        doc.text(`Vakantie: ${totals.vacationDays}   Ziekte: ${totals.sickDays}   Recup: ${totals.recupDays}   Feestdag: ${totals.holidayDays}`, left, y);
        y += 14;
        doc.text(`Overuren (maand): ${formatHM(totals.overtimeDeltaMin)}${totals.normDayMin!=null ? `   (Norm/dag: ${formatHM(totals.normDayMin)})` : ""}`, left, y);
        y += 18;

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
      alert("Geen entries gevonden voor deze selectie.");
      return;
    }

    const doc = new JsPDF({ unit:"pt", format:"a4" });

    for(let i=0;i<byMonth.length;i++){
      const [ym, list] = byMonth[i];

      if(i > 0) doc.addPage();
      addMonthSummaryPage(doc, state, ym, list);
      addMonthDetailPage(doc, state, ym, list);
    }

    const now = new Date();
    const fname = `Shift-Tap_${now.getFullYear()}-${pad2(now.getMonth()+1)}-${pad2(now.getDate())}.pdf`;
    doc.save(fname);
  }

  // UI hooks (expects your html already has the dialog + fields)
  function getMode(){
    const nodes = document.querySelectorAll('input[name="pdfMode"]');
    for(const n of nodes) if(n.checked) return n.value;
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
        sel.value = months[months.length-1];
      }
    }

    const now = new Date();
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const last  = new Date(now.getFullYear(), now.getMonth()+1, 0);
    if($("pdfFrom")) $("pdfFrom").value = `${first.getFullYear()}-${pad2(first.getMonth()+1)}-${pad2(first.getDate())}`;
    if($("pdfTo"))   $("pdfTo").value   = `${last.getFullYear()}-${pad2(last.getMonth()+1)}-${pad2(last.getDate())}`;

    if(typeof dlg.showModal === "function") dlg.showModal();
    else alert("Je browser ondersteunt dit export-venster niet. Update Chrome/WebView.");
  }

  function closeDialog(){
    const dlg = $("pdfDialog");
    if(dlg && dlg.open) dlg.close();
  }

  function runExport(){
    const state = loadState();
    const entries = entriesAll(state);

    const mode = getMode();
    const monthY = $("pdfMonthSelect")?.value || "";
    const fromY = $("pdfFrom")?.value || "";
    const toY = $("pdfTo")?.value || "";

    const filtered = filterEntries(entries, mode, monthY, fromY, toY);
    closeDialog();
    makePdfForSelection(state, filtered);
  }

  document.addEventListener("click", (e) => {
    const t = e.target;
    if(!t) return;
    if(t.id === "btnExportPdf") openDialog();
    if(t.id === "btnPdfCancel") closeDialog();
    if(t.id === "btnPdfMake") runExport();
  });
})();