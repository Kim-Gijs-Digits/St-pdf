/* Shift-Tap PDF Export (Range-first) v3
   - Uses date-range picker (Van/Tot) as requested
   - Urenregistratie layout: single table with +/- uren + Info + Opmerkingen
   - Saldo overuren boven (vorige stand t.e.m. dag vóór Van)
   - Onderaan: Totaal uren, Totaal overuren maand/range, Saldo overuren
   - Language-aware (nl/en/fr) based on state.settings.lang
*/
(() => {
  "use strict";

  // Must match the app (try to pick it up from index.html)
  const STORE_KEY = (() => {
    if (window.SHIFTTAP_STORE_KEY) return String(window.SHIFTTAP_STORE_KEY);
    // fallback: find any key that looks like Shift-Tap state
    try{
      const keys = Object.keys(localStorage || {}).filter(k => /^shifttap_state_/i.test(k));
      // pick the longest (usually contains channel) or the first
      keys.sort((a,b)=>b.length-a.length);
      return keys[0] || "shifttap_state_try_outv1";
    }catch(_e){
      return "shifttap_state_try_outv1";
    }
  })();

  const $ = (id) => document.getElementById(id);

  // ---------- i18n (minimal, extend as you like) ----------
  const I18N = {
    nl: {
      title: (period) => `Shift-Tap - Urenregistratie - ${period}`,
      employer: "Werkgever",
      employee: "Werknemer",
      normDay: "Norm dag",
      prevSaldo: "Saldo overuren vorige maand",
      saldoOveruren: "Saldo overuren",
      totalsHours: "Totaal uren",
      totalsOverThis: "Totaal overuren deze periode",
      makePdf: "Maak PDF",
      cancel: "Annuleren",
      pdfPrompt: "Welke maand(en) en/of welke data wil je exporteren?",
      month: "Maand",
      dates: "Datums",
      from: "Van",
      to: "Tot",
      cols: ["Datum", "Starttijd", "Eindtijd", "Netto", "+/‑", "Info", "Opmerkingen"],
      types: { Werk:"Werk", Vakantie:"Vakantie", Ziekte:"Ziekte", Recup:"Recup", Feestdag:"Feestdag" },
      infoByType: { Werk:"", Vakantie:"Vakantiedag", Ziekte:"Ziekte", Recup:"Recupdag", Feestdag:"Feestdag" },
      unitsH: "u",
    },
    en: {
      title: (period) => `Shift-Tap - Timesheet - ${period}`,
      employer: "Employer",
      employee: "Employee",
      normDay: "Standard day",
      prevSaldo: "Overtime balance (prev. month)",
      saldoOveruren: "Overtime balance",
      totalsHours: "Total hours",
      totalsOverThis: "Overtime this period",
      makePdf: "Create PDF",
      cancel: "Cancel",
      pdfPrompt: "Which month(s) and/or dates do you want to export?",
      month: "Month",
      dates: "Dates",
      from: "From",
      to: "To",
      cols: ["Date", "Start", "End", "Net", "+/‑", "Info", "Remarks"],
      types: { Werk:"Work", Vakantie:"Vacation", Ziekte:"Sick", Recup:"Recup", Feestdag:"Holiday" },
      infoByType: { Werk:"", Vakantie:"Vacation day", Ziekte:"Sick day", Recup:"Recup day", Feestdag:"Holiday" },
      unitsH: "h",
    },
    fr: {
      title: (period) => `Shift-Tap - Releve d'heures - ${period}`,
      employer: "Employeur",
      employee: "Employé",
      normDay: "Journée normale",
      prevSaldo: "Solde heures sup. mois précédent",
      saldoOveruren: "Solde heures sup.",
      totalsHours: "Total heures",
      totalsOverThis: "Heures sup. période",
      makePdf: "Créer PDF",
      cancel: "Annuler",
      pdfPrompt: "Quel(s) mois et/ou quelles dates voulez‑vous exporter ?",
      month: "Mois",
      dates: "Dates",
      from: "De",
      to: "À",
      cols: ["Date", "Début", "Fin", "H nettes", "+/‑", "Info", "Remarques"],
      types: { Werk:"Travail", Vakantie:"Congé", Ziekte:"Maladie", Recup:"Récup", Feestdag:"Férié" },
      infoByType: { Werk:"", Vakantie:"Jour de congé", Ziekte:"Jour maladie", Recup:"Jour récup", Feestdag:"Jour férié" },
      unitsH: "h",
    },
  };

  function getLang(state){
    const l = (state?.settings?.lang || "nl").toLowerCase();
    if (l.startsWith("en")) return "en";
    if (l.startsWith("fr")) return "fr";
    return "nl";
  }

  // ---------- helpers ----------
  const pad2 = (n) => String(n).padStart(2, "0");

  function parseYMD(ymd){
    // ymd like "2026-02-09"
    const [y,m,d] = (ymd||"").split("-").map(Number);
    if(!y || !m || !d) return null;
    return new Date(y, m-1, d);
  }

  function dmy(ymd){
    const dt = parseYMD(ymd);
    if(!dt) return "";
    return `${pad2(dt.getDate())}/${pad2(dt.getMonth()+1)}/${dt.getFullYear()}`;
  }

  function monthLabelFromYMD(ymd){
    const dt = parseYMD(ymd);
    if(!dt) return "";
    return `${pad2(dt.getMonth()+1)}/${dt.getFullYear()}`;
  }

  function minutesToHM(min, unitH){
    const m = Math.max(0, Math.round(min || 0));
    const h = Math.floor(m/60);
    const r = m%60;
    return `${h}${unitH} ${pad2(r)}m`;
  }

  function minutesToClock(min){
    const m = Math.max(0, Math.round(min || 0));
    const h = Math.floor(m/60);
    const r = m%60;
    return `${h}:${pad2(r)}`;
  }

  function deltaOvertimeMinForDay(entriesForDay, normDayMin){
    // matches app logic: sum net work minus norm, and each recup counts -norm
    const workNet = entriesForDay.filter(e=>e.type==="Werk").reduce((a,e)=>a+(e.netMin||0),0);
    const hasWork = workNet > 0;
    const recups = entriesForDay.filter(e=>e.type==="Recup").length;
    let delta = 0;
    if(hasWork) delta += (workNet - normDayMin);
    if(recups)  delta += (-normDayMin * recups);
    return delta;
  }

  function groupByDate(entries){
    const map = new Map();
    for(const e of entries){
      if(e.deletedAt) continue;
      if(!e.date) continue;
      if(!map.has(e.date)) map.set(e.date, []);
      map.get(e.date).push(e);
    }
    return map;
  }

  function sortDatesAsc(a,b){
    return (a||"").localeCompare(b||"");
  }

  function loadState(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(_e){
      return null;
    }
  }

  // ---------- DOM wiring ----------
  const btnExportPdf = $("btnExportPdf");
  const dlg          = $("pdfDialog");
  const monthWrap    = $("pdfMonthWrap");
  const rangeWrap    = $("pdfRangeWrap");
  const monthSelect  = $("pdfMonthSelect");
  const fromInput    = $("pdfFrom");
  const toInput      = $("pdfTo");
  const btnCancel    = $("pdfCancel");
  const btnConfirm   = $("pdfConfirm");

  if(!btnExportPdf || !dlg || !monthSelect || !fromInput || !toInput || !btnConfirm) return;

  function getMode(){
    return (dlg.querySelector('input[name="pdfMode"]:checked')?.value) || "month";
  }

  function syncModeUI(){
    const mode = getMode();
    const isDates = (mode === "dates");
    if(monthWrap) monthWrap.style.display = isDates ? "none" : "block";
    if(rangeWrap) rangeWrap.style.display = isDates ? "block" : "none";
  }

  function fillMonthSelect(state){
    const entries = (state?.entries || []).filter(e=>!e.deletedAt && e.date);
    const months = new Set(entries.map(e => e.date.slice(0,7))); // "YYYY-MM"
    const sorted = [...months].sort();
    monthSelect.innerHTML = "";
    for(const ym of sorted){
      const opt = document.createElement("option");
      opt.value = ym;
      const [y,m] = ym.split("-");
      opt.textContent = `${m}/${y}`;
      monthSelect.appendChild(opt);
    }
    // default to current month if present, else last one
    const now = new Date();
    const cur = `${now.getFullYear()}-${pad2(now.getMonth()+1)}`;
    if(sorted.includes(cur)) monthSelect.value = cur;
    else if(sorted.length) monthSelect.value = sorted[sorted.length-1];
    else {
      // no data yet: still offer current month
      const opt = document.createElement("option");
      opt.value = cur;
      opt.textContent = `${pad2(now.getMonth()+1)}/${now.getFullYear()}`;
      monthSelect.appendChild(opt);
      monthSelect.value = cur;
    }
  }

  function defaultRangeToMonth(ym){
    // ym = "YYYY-MM"
    const [y,m] = ym.split("-").map(Number);
    if(!y || !m) return;
    const first = new Date(y, m-1, 1);
    const last  = new Date(y, m, 0);
    fromInput.value = `${y}-${pad2(m)}-01`;
    toInput.value   = `${y}-${pad2(m)}-${pad2(last.getDate())}`;
  }

  btnExportPdf.addEventListener("click", () => {
    const state = loadState();
    fillMonthSelect(state);

    // default = month mode
    const radios = [...dlg.querySelectorAll('input[name="pdfMode"]')];
    const rMonth = radios.find(r=>r.value==="month");
    if(rMonth) rMonth.checked = true;
    syncModeUI();

    // convenience: set range to selected month too
    defaultRangeToMonth(monthSelect.value || "");
    dlg.showModal();
  });

  btnCancel?.addEventListener("click", () => dlg.close());

  monthSelect.addEventListener("change", () => {
    // If user flips month, update range to that month for convenience
    defaultRangeToMonth(monthSelect.value || "");
  });

  // radio switch month/dates
  [...dlg.querySelectorAll('input[name="pdfMode"]')].forEach(r => {
    r.addEventListener("change", () => syncModeUI());
  });

  // ---------- PDF generation ----------
  async function ensureJsPdf(){
    // jsPDF UMD exposes window.jspdf.jsPDF
    const w = window;
    return (w && w.jspdf && w.jspdf.jsPDF) ? w.jspdf.jsPDF : null;
  }

  function headerFillColor(doc){
    // suede-ish
    doc.setFillColor(217,212,207); // #D9D4CF
  }

  function drawTable(doc, x, y, colW, rowH, headers, rows){
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();

    const tableW = colW.reduce((a,b)=>a+b,0);
    let cursorY = y;

    const drawHeader = () => {
      headerFillColor(doc);
      doc.rect(x, cursorY, tableW, rowH, "F");
      doc.setDrawColor(60);
      doc.setLineWidth(0.2);
      doc.rect(x, cursorY, tableW, rowH, "S");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      let cx = x;
      for(let i=0;i<headers.length;i++){
        doc.rect(cx, cursorY, colW[i], rowH, "S");
        doc.text(String(headers[i]||""), cx+2, cursorY + rowH*0.7, {maxWidth: colW[i]-4});
        cx += colW[i];
      }
      cursorY += rowH;
    };

    const drawRow = (cells) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      let cx = x;
      for(let i=0;i<cells.length;i++){
        doc.rect(cx, cursorY, colW[i], rowH, "S");

        const txt = (cells[i] ?? "").toString();
        // Right align numeric-ish columns 3 & 4 (Netto, +/-)
        if(i === 3 || i === 4){
          doc.text(txt, cx + colW[i] - 2, cursorY + rowH*0.7, {align:"right", maxWidth: colW[i]-4});
        }else{
          doc.text(txt, cx+2, cursorY + rowH*0.7, {maxWidth: colW[i]-4});
        }
        cx += colW[i];
      }
      cursorY += rowH;
    };

    drawHeader();

    for(const r of rows){
      if(cursorY + rowH > pageH - 18){
        doc.addPage();
        cursorY = 18;
        drawHeader();
      }
      drawRow(r);
    }

    return cursorY;
  }

  function formatPlusMinus(min, unitH){
    const v = Math.round(min||0);
    const sign = v>=0 ? "+" : "-"; // ASCII minus
    const a = Math.abs(v);
    const h = Math.floor(a/60);
    const m = a%60;
    // style like 0u05
    return `${sign}${h}${unitH}${pad2(m)}`;
  }

  function getPeriodLabel(lang, fromYmd, toYmd){
    const f = dmy(fromYmd);
    const t = dmy(toYmd);
    if(f && t) return `${f} – ${t}`;
    if(f) return f;
    return "";
  }

  btnConfirm.addEventListener("click", async () => {
    const state = loadState();
    if(!state) return;

    const jsPDF = await ensureJsPdf();
    if(!jsPDF){
      alert("jsPDF niet geladen.");
      return;
    }

    const lang = getLang(state);
    const L = I18N[lang] || I18N.nl;

    const normDayMin = state?.settings?.normDayMin ?? 450; // 7u30
    const employer = (state?.settings?.employerName || "").trim();
    const employee = (state?.settings?.employeeName || "").trim();

    // Mode: month / dates
    const mode = (dlg.querySelector('input[name="pdfMode"]:checked')?.value) || "month";

    let fromYmd = fromInput.value;
    let toYmd   = toInput.value;

    if(mode === "month"){
      const ym = (monthSelect.value || "");
      if(ym){
        const [y,m] = ym.split("-").map(Number);
        const last = new Date(y, m, 0).getDate();
        fromYmd = `${y}-${pad2(m)}-01`;
        toYmd   = `${y}-${pad2(m)}-${pad2(last)}`;
      }
    }

    if(!fromYmd || !toYmd){
      alert("Kies Van en Tot.");
      return;
    }
    if(fromYmd > toYmd){
      alert("Van mag niet na Tot.");
      return;
    }

    const fromDate = parseYMD(fromYmd);
    const toDate   = parseYMD(toYmd);
    if(!fromDate || !toDate) return;

    const allEntries = (state.entries || []).filter(e=>!e.deletedAt && e.date);
    const byDate = groupByDate(allEntries);
    const allDates = [...byDate.keys()].sort(sortDatesAsc);

    // compute saldo previous: startSaldo - paid + deltas for dates < fromYmd
    let saldoPrev = (state?.settings?.startSaldoMin || 0) - (state?.overtimePaidMinutes || 0);
    for(const day of allDates){
      if(day >= fromYmd) break;
      const delta = deltaOvertimeMinForDay(byDate.get(day) || [], normDayMin);
      saldoPrev += delta;
    }

    // rows for period
    const periodDates = allDates.filter(d => d >= fromYmd && d <= toYmd);

    // aggregate totals for period
    let totalWorkNet = 0;
    let overtimeThis = 0;

    const rows = [];
    for(const day of periodDates){
      const dayEntries = byDate.get(day) || [];
      // Build one row per entry (not per day) so it matches the detailed style
      for(const e of dayEntries){
        const type = e.type || "";
        const start = e.start || "";
        const end   = e.end || "";
        const netMin = e.netMin || 0;

        // totals
        if(type === "Werk") totalWorkNet += netMin;

        // +/- for this entry (daily logic is clearer, but employers expect per day; we show per entry row)
        let delta = 0;
        if(type === "Werk") delta = netMin - normDayMin; // if multiple work entries in a day, this is approximate; best is daily calc in totals
        else if(type === "Recup") delta = -normDayMin;
        else delta = 0;

        // Info/opmerkingen split
        const note = (e.note || "").trim();
        const shortLen = 36;
        let info = "";
        let remarks = "";

        if(note){
          if(note.length > shortLen){
            info = note.slice(0, shortLen).trimEnd() + "…";
            remarks = note;
          }else{
            info = note;
            remarks = "";
          }
        }else{
          info = L.infoByType[type] ?? (L.types[type] || type);
          remarks = "";
        }

        rows.push([
          dmy(day),
          start,
          end,
          minutesToHM(netMin, L.unitsH),
          formatPlusMinus(delta, L.unitsH),
          info,
          remarks
        ]);
      }

      // totals overtime should be daily accurate:
      overtimeThis += deltaOvertimeMinForDay(dayEntries, normDayMin);
    }

    const saldoNew = saldoPrev + overtimeThis;

    // ---- Create PDF ----
    const doc = new jsPDF({ unit:"mm", format:"a4", compress:true });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 16;

    // Title (keep previous Shift-Tap look: bold title + subtle subtitle)
    doc.setFont("helvetica","bold");
    doc.setFontSize(18);
    const periodLabel = getPeriodLabel(lang, fromYmd, toYmd);
    doc.text(L.title(periodLabel), margin, 18);

    doc.setFont("helvetica","normal");
    doc.setFontSize(10);

    // Meta block
    let y = 26;
    const lineGap = 5;
    if(employer){
      doc.text(`${L.employer}: ${employer}`, margin, y); y += lineGap;
    }
    if(employee){
      doc.text(`${L.employee}: ${employee}`, margin, y); y += lineGap;
    }
    doc.text(`${L.normDay}: ${minutesToHM(normDayMin, L.unitsH)}`, margin, y); y += lineGap;
    doc.text(`${L.prevSaldo}: ${minutesToHM(Math.abs(saldoPrev), L.unitsH).replace(/^(\d)/, (m)=>m)} ${saldoPrev>=0?"+":"-"}`
      .replace(/(\d+)([uh])\s(\d\d)m\s([+-])/, (m,hh,uh,mm,sgn)=>`${sgn}${hh}${uh}${mm}`), margin, y);

    // Top saldo line (single)
    y += 6;
    doc.setDrawColor(180);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageW - margin, y);
    y += 6;

    doc.setFont("helvetica","bold");
    doc.setFontSize(12);
    doc.text(`${L.saldoOveruren}: ${formatPlusMinus(saldoPrev, L.unitsH)}`, margin, y);
    y += 8;

    // Table
    doc.setFont("helvetica","normal");
    doc.setFontSize(9);

    const headers = L.cols;

    // BETERE widths: meer ruimte voor Netto en +/-
    // Datum  | Start | Eind | Netto | +/- | Info | Opmerkingen
    const availW = pageW - margin*2;
    const colW = [24, 18, 18, 24, 22, 28, Math.max(24, availW - (24+18+18+24+22+28))];
    const rowH = 7;

    y = drawTable(doc, margin, y, colW, rowH, headers, rows);

    // Bottom totals
    const bottomY = Math.min(y + 10, doc.internal.pageSize.getHeight() - 30);
    doc.setDrawColor(120);
    doc.setLineWidth(0.4);
    doc.line(margin, bottomY, pageW - margin, bottomY);

    doc.setFont("helvetica","bold");
    doc.setFontSize(11);
    const y2 = bottomY + 8;

    doc.text(`${L.totalsHours}: ${minutesToHM(totalWorkNet, L.unitsH)}`, margin, y2);
    doc.text(`${L.totalsOverThis}: ${formatPlusMinus(overtimeThis, L.unitsH)}`, margin, y2 + 6);
    doc.text(`${L.saldoOveruren}: ${formatPlusMinus(saldoNew, L.unitsH)}`, margin, y2 + 12);

    // Save
    const safePeriod = (periodLabel || monthLabelFromYMD(fromYmd)).replace(/[^\d\-_/]/g,"_");
    doc.save(`Shift-Tap_${safePeriod}.pdf`);

    dlg.close();
  });

})();
