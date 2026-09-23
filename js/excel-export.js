(() => {
  'use strict';

  const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
  const DAY_SHORT = ['L', 'M', 'M', 'J', 'V'];

  const STYLE = {
    DEFAULT: 0,
    TITLE: 1,
    SUBTITLE: 2,
    META_LABEL: 3,
    META_VALUE: 4,
    HEADER_YELLOW: 5,
    TASK_HEADER: 6,
    DAY_HEADER: 7,
    BODY_TEXT_BLUE: 8,
    BODY_NUMBER_BLUE: 9,
    TOTAL: 10,
    DARK_TITLE: 11,
    ABSENCE: 12,
    SIGNATURE_HEADER: 13,
    SIGNATURE_BOX: 14,
    TABLE_TEXT: 15,
    TABLE_NUMBER: 16,
    TABLE_HEADER: 17,
    LIGHT_LABEL: 18,
    LIGHT_VALUE: 19,
    WRAP_TEXT: 20,
    DATE: 21,
    SUMMARY_SECTION: 22,
    KPI_LABEL: 23,
    KPI_VALUE: 24,
    BODY_TEXT_GCC: 25,
    BODY_NUMBER_GCC: 26,
    TASK_HEADER_ALT: 27,
    DAY_HEADER_ALT: 28,
    SUBTOTAL_GCC: 29,
    SUBTOTAL_INTERIM: 30,
    PERCENT: 31,
    STATUS_LOCKED: 32,
    STATUS_DRAFT: 33,
    TABLE_SUBHEADER: 34,
    MUTED_TEXT: 35,
    HOURS_ALERT: 36,
    TOTAL_STRONG: 37
  };

  function escapeXml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&apos;');
  }

  function colLetter(index) {
    let value = Number(index);
    let result = '';
    while (value > 0) {
      value -= 1;
      result = String.fromCharCode(65 + (value % 26)) + result;
      value = Math.floor(value / 26);
    }
    return result;
  }

  function cellRef(row, col) {
    return `${colLetter(col)}${row}`;
  }

  function excelSerial(date) {
    return (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000;
  }

  function isoWeekMonday(year, week) {
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const day = jan4.getUTCDay() || 7;
    const monday = new Date(jan4);
    monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
    return monday;
  }

  function dateForDay(year, week, day) {
    const date = isoWeekMonday(year, week);
    date.setUTCDate(date.getUTCDate() + day);
    return date;
  }

  function formatDateFr(date) {
    return date.toLocaleDateString('fr-FR', { timeZone: 'UTC' });
  }

  function isInterim(person) {
    return String(person?.type || '').toLocaleLowerCase('fr').startsWith('int');
  }

  function isLoan(person) {
    const value = String(person?.type || '').toLocaleLowerCase('fr');
    return value.startsWith('prêt') || value.startsWith('pret');
  }

  function personCategory(person) {
    if (isInterim(person)) return 'Intérim';
    if (isLoan(person)) return 'Prêt de MO';
    return 'GCC';
  }

  function personTypeCode(person) {
    return personCategory(person) === 'GCC' ? 'S' : (personCategory(person) === 'Intérim' ? 'I' : 'P');
  }

  function isExternal(person) {
    return personCategory(person) !== 'GCC';
  }


  function parseIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    const [year, month, day] = String(value).split('-').map(Number);
    return new Date(Date.UTC(year, month - 1, day));
  }

  function contractCurrentEnd(contract) {
    const renewalEnds = (contract?.renewals || []).map(item => item.endDate).filter(Boolean).sort();
    return renewalEnds.at(-1) || contract?.initialEndDate || '';
  }

  function contractDurationDays(contract) {
    const start = parseIsoDate(contract?.startDate);
    const end = parseIsoDate(contractCurrentEnd(contract));
    return start && end ? Math.max(0, Math.floor((end - start) / 86400000) + 1) : 0;
  }

  function contractCarenceDays(contract, rules) {
    if (!contract || contract.carenceExempt || rules?.carenceMode === 'none') return 0;
    const duration = contractDurationDays(contract);
    return Math.ceil(duration >= 14 ? duration / 3 : duration / 2);
  }

  function contractStatus(contract, referenceDate = new Date().toISOString().slice(0, 10), rules = {}) {
    if (!contract) return 'Sans contrat';
    const end = contractCurrentEnd(contract);
    if (contract.closed) return 'Clôturé';
    if (!contract.startDate || !end) return 'À compléter';
    if (referenceDate < contract.startDate) return 'À venir';
    const remaining = Math.floor((parseIsoDate(end) - parseIsoDate(referenceDate)) / 86400000);
    if (remaining < 0) return 'Expiré';
    const threshold = Math.max(...(rules.alertDays || [21, 14, 7, 2]), 0);
    if (remaining <= threshold) return remaining === 0 ? 'Dernier jour' : `J-${remaining}`;
    return 'En cours';
  }

  function personEntries(week, personId, day = null) {
    return (week.entries || []).filter(entry => entry.personId === personId && (day === null || Number(entry.day) === Number(day)));
  }

  function personDayTotal(week, personId, day) {
    return personEntries(week, personId, day).reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  }

  function personWeekTotal(week, personId) {
    return personEntries(week, personId).reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  }

  function personAbsence(week, personId, day) {
    return (week.absences || []).find(item => item.personId === personId && Number(item.day) === Number(day)) || null;
  }

  function personLate(week, personId, day) {
    return (week.lates || []).find(item => item.personId === personId && Number(item.day) === Number(day)) || null;
  }

  function taskTotal(week, taskId, day = null) {
    return (week.entries || [])
      .filter(entry => entry.taskId === taskId && (day === null || Number(entry.day) === Number(day)))
      .reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  }

  function weekTotal(week) {
    return (week.entries || []).reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  }

  function noteSummary(week, personId, day = null) {
    const notes = personEntries(week, personId, day)
      .map(entry => String(entry.note || '').trim())
      .filter(Boolean);
    const absences = (week.absences || [])
      .filter(item => item.personId === personId && (day === null || Number(item.day) === Number(day)))
      .map(item => String(item.note || '').trim())
      .filter(Boolean);
    const lates = (week.lates || [])
      .filter(item => item.personId === personId && (day === null || Number(item.day) === Number(day)))
      .map(item => `Retard${String(item.note || '').trim() ? ` : ${String(item.note || '').trim()}` : ''}`);
    return [...new Set([...notes, ...absences, ...lates])].join(' / ');
  }

  function taskSummary(week, tasksById, personId, day) {
    const grouped = new Map();
    personEntries(week, personId, day).forEach(entry => {
      grouped.set(entry.taskId, (grouped.get(entry.taskId) || 0) + Number(entry.hours || 0));
    });
    return [...grouped.entries()].map(([taskId, value]) => {
      const taskName = tasksById.get(taskId)?.name || 'Tâche supprimée';
      return `${taskName} (${formatNumber(value)} h)`;
    }).join(' / ');
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('fr-FR', { maximumFractionDigits: 2 });
  }

  function safeSheetName(raw, used) {
    const base = String(raw || 'Feuille')
      .replace(/[\\/?*\[\]:]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31) || 'Feuille';
    let name = base;
    let index = 2;
    while (used.has(name.toLocaleLowerCase('fr'))) {
      const suffix = ` (${index})`;
      name = `${base.slice(0, 31 - suffix.length)}${suffix}`;
      index += 1;
    }
    used.add(name.toLocaleLowerCase('fr'));
    return name;
  }

  function makeCell(row, col, value = '', style = STYLE.DEFAULT, type = null) {
    return { row, col, value, style, type };
  }

  function makeFormulaCell(row, col, formula, cachedValue = 0, style = STYLE.DEFAULT) {
    return { row, col, value: cachedValue, style, type: 'number', formula: String(formula || '').replace(/^=/, '') };
  }

  function rowCells(row, startCol, values, style) {
    return values.map((value, index) => makeCell(row, startCol + index, value, style));
  }

  function fillRange(cells, startRow, endRow, startCol, endCol, style, value = '') {
    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        cells.push(makeCell(row, col, value, style));
      }
    }
  }

  function xlsxCellXml(cell) {
    const ref = cellRef(cell.row, cell.col);
    const style = Number.isInteger(cell.style) && cell.style > 0 ? ` s="${cell.style}"` : '';
    const value = cell.value;
    if (cell.formula) {
      const cached = Number.isFinite(Number(value)) ? Number(value) : 0;
      return `<c r="${ref}"${style}><f>${escapeXml(cell.formula)}</f><v>${cached}</v></c>`;
    }
    if (value === null || value === undefined || value === '') {
      return `<c r="${ref}"${style}/>`;
    }
    if (cell.type === 'date' && value instanceof Date) {
      return `<c r="${ref}"${style}><v>${excelSerial(value)}</v></c>`;
    }
    if (cell.type === 'number' || (cell.type !== 'string' && typeof value === 'number' && Number.isFinite(value))) {
      return `<c r="${ref}"${style}><v>${Number(value)}</v></c>`;
    }
    if (cell.type === 'boolean' || typeof value === 'boolean') {
      return `<c r="${ref}" t="b"${style}><v>${value ? 1 : 0}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  }

  function worksheetXml(sheet) {
    // Une seule cellule XML par coordonnée : les cellules ajoutées en dernier
    // (formules, totaux ou libellés) remplacent proprement les fonds préformatés.
    const byRow = new Map();
    (sheet.cells || []).forEach(cell => {
      if (!byRow.has(cell.row)) byRow.set(cell.row, new Map());
      byRow.get(cell.row).set(cell.col, cell);
    });
    const rowHeights = sheet.rowHeights || {};
    const rowXml = [...byRow.keys()].sort((a, b) => a - b).map(row => {
      const cells = [...byRow.get(row).values()].sort((a, b) => a.col - b.col).map(xlsxCellXml).join('');
      const height = rowHeights[row];
      return `<row r="${row}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`;
    }).join('');
    const mergeExtents = (sheet.merges || []).map(ref => {
      const end = String(ref).split(':').pop() || 'A1';
      const match = /^([A-Z]+)(\d+)$/.exec(end);
      if (!match) return { row: 1, col: 1 };
      let col = 0;
      for (const char of match[1]) col = col * 26 + char.charCodeAt(0) - 64;
      return { row: Number(match[2]), col };
    });
    const maxRow = Math.max(1, ...[...byRow.keys()], ...mergeExtents.map(item => item.row));
    const maxCol = Math.max(1, ...(sheet.cells || []).map(cell => cell.col), ...mergeExtents.map(item => item.col));
    const colsXml = (sheet.columns || []).length
      ? `<cols>${sheet.columns.map(column => `<col min="${column.min}" max="${column.max || column.min}" width="${column.width}" customWidth="1"${column.hidden ? ' hidden="1"' : ''}/>`).join('')}</cols>`
      : '';
    const freeze = sheet.freeze
      ? `<pane${sheet.freeze.xSplit ? ` xSplit="${sheet.freeze.xSplit}"` : ''}${sheet.freeze.ySplit ? ` ySplit="${sheet.freeze.ySplit}"` : ''} topLeftCell="${sheet.freeze.topLeftCell || 'A1'}" activePane="${sheet.freeze.activePane || 'bottomRight'}" state="frozen"/>`
      : '';
    const merges = (sheet.merges || []).length ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>` : '';
    const autoFilter = sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : '';
    const orientation = sheet.orientation || 'landscape';
    const paperSize = sheet.paperSize || (orientation === 'landscape' ? 8 : 9);
    const fitToHeight = Number.isInteger(sheet.fitToHeight) ? sheet.fitToHeight : 0;
    const margins = sheet.margins || { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 };
    const headerFooter = sheet.headerFooter
      ? `<headerFooter><oddHeader>${escapeXml(sheet.headerFooter.header || '')}</oddHeader><oddFooter>${escapeXml(sheet.headerFooter.footer || '')}</oddFooter></headerFooter>`
      : '';
    const tabColor = sheet.tabColor ? `<tabColor rgb="${sheet.tabColor}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetPr>${tabColor}<pageSetUpPr fitToPage="1" autoPageBreaks="0"/></sheetPr>
  <dimension ref="A1:${cellRef(maxRow, maxCol)}"/>
  <sheetViews><sheetView workbookViewId="0" showGridLines="${sheet.showGridLines === false ? 0 : 1}">${freeze}</sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="15"/>
  ${colsXml}
  <sheetData>${rowXml}</sheetData>
  ${autoFilter}${merges}
  <printOptions horizontalCentered="1" verticalCentered="0"/>
  <pageMargins left="${margins.left}" right="${margins.right}" top="${margins.top}" bottom="${margins.bottom}" header="${margins.header}" footer="${margins.footer}"/>
  <pageSetup paperSize="${paperSize}" orientation="${orientation}" fitToWidth="1" fitToHeight="${fitToHeight}" horizontalDpi="300" verticalDpi="300"/>
  ${headerFooter}
</worksheet>`;
  }

  function stylesXml() {
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="0.0%"/></numFmts>
  <fonts count="11">
    <font><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="16"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="12"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FF7A3D00"/><sz val="10"/><name val="Arial"/><family val="2"/></font>
    <font><sz val="9"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="20"/><name val="Arial"/><family val="2"/></font>
    <font><b/><sz val="11"/><name val="Arial"/><family val="2"/></font>
    <font><i/><color rgb="FF666666"/><sz val="9"/><name val="Arial"/><family val="2"/></font>
    <font><b/><color rgb="FFFFFFFF"/><sz val="12"/><name val="Arial"/><family val="2"/></font>
  </fonts>
  <fills count="20">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFD600"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFA9D18E"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFBDD7EE"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF292A2D"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFE5CC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF8D6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE9EFF7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE2F0D9"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFF4B8"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF4CCCC"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="6">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border><left style="thin"><color rgb="FF7F7F7F"/></left><right style="thin"><color rgb="FF7F7F7F"/></right><top style="thin"><color rgb="FF7F7F7F"/></top><bottom style="thin"><color rgb="FF7F7F7F"/></bottom><diagonal/></border>
    <border><left style="medium"><color rgb="FF000000"/></left><right style="medium"><color rgb="FF000000"/></right><top style="medium"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FFD9D9D9"/></left><right style="thin"><color rgb="FFD9D9D9"/></right><top style="thin"><color rgb="FFD9D9D9"/></top><bottom style="thin"><color rgb="FFD9D9D9"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FF7F7F7F"/></left><right style="thin"><color rgb="FF7F7F7F"/></right><top style="medium"><color rgb="FF000000"/></top><bottom style="medium"><color rgb="FF000000"/></bottom><diagonal/></border>
    <border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="medium"><color rgb="FF000000"/></bottom><diagonal/></border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="38">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="10" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="19" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="5" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="6" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="5" fillId="8" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="4" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="19" borderId="2" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="19" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="19" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="9" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="6" fillId="19" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>
    <xf numFmtId="165" fontId="0" fillId="19" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="4" fillId="7" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="2" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="7" fillId="7" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="10" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="0" fillId="10" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="11" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="12" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="3" fillId="10" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="3" fillId="18" borderId="4" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="166" fontId="0" fillId="19" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="0" fontId="3" fillId="13" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="14" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="9" fillId="19" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
    <xf numFmtId="164" fontId="3" fillId="15" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
    <xf numFmtId="164" fontId="10" fillId="16" borderId="2" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
  <dxfs count="0"/>
  <tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;
  }

  function peopleByIdMap(people) {
    return new Map((people || []).map(person => [person.id, person]));
  }

  function normalizeCategoryFilter(category) {
    if (category === true) return 'Intérim';
    if (category === false) return 'GCC';
    return category;
  }

  function typeHours(week, people, category, day = null) {
    const expected = normalizeCategoryFilter(category);
    const byId = peopleByIdMap(people);
    return (week.entries || []).filter(entry => {
      const person = byId.get(entry.personId);
      return person && personCategory(person) === expected && (day === null || Number(entry.day) === Number(day));
    }).reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  }

  function taskTypeTotal(week, taskId, people, category) {
    const expected = normalizeCategoryFilter(category);
    const byId = peopleByIdMap(people);
    return (week.entries || []).filter(entry => entry.taskId === taskId && byId.has(entry.personId) && personCategory(byId.get(entry.personId)) === expected)
      .reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
  }

  function dayPresentCount(week, people, day, category = null) {
    const expected = normalizeCategoryFilter(category);
    return people.filter(person => (expected === null || expected === undefined || personCategory(person) === expected) && personDayTotal(week, person.id, day) > 0).length;
  }

  function dayAbsenceCount(week, people, day) {
    const ids = new Set(people.map(person => person.id));
    return (week.absences || []).filter(item => ids.has(item.personId) && Number(item.day) === Number(day)).length;
  }

  function personExpectedTotal(person) {
    return (Array.isArray(person?.schedule) ? person.schedule : []).slice(0, 5).reduce((sum, value) => sum + Number(value || 0), 0);
  }

  function makeSummarySheet(context) {
    const { project, weekInfo, week, people, tasks } = context;
    const cells = [];
    const merges = [];
    const total = weekTotal(week);
    const gccHours = typeHours(week, people, 'GCC');
    const interimHours = typeHours(week, people, 'Intérim');
    const loanHours = typeHours(week, people, 'Prêt de MO');
    const roster = new Set(Array.isArray(week.rosterIds) ? week.rosterIds : people.map(person => person.id));
    const rosterPeople = people.filter(person => roster.has(person.id));
    const lockedLabel = week.locked ? 'VALIDÉE / VERROUILLÉE' : 'BROUILLON';

    cells.push(makeCell(1, 1, 'SYNTHÈSE HEBDOMADAIRE DES POINTAGES', STYLE.TITLE));
    merges.push('A1:L1');
    cells.push(makeCell(2, 1, 'PILOTAGE DE LA MAIN-D’ŒUVRE CHANTIER', STYLE.SUBTITLE));
    merges.push('A2:L2');

    cells.push(makeCell(4, 1, 'CHANTIER', STYLE.META_LABEL));
    cells.push(makeCell(4, 3, project.name || '', STYLE.META_VALUE));
    merges.push('A4:B4', 'C4:F4');
    cells.push(makeCell(4, 7, 'CODE', STYLE.META_LABEL));
    cells.push(makeCell(4, 9, project.code || '', STYLE.META_VALUE));
    merges.push('G4:H4', 'I4:L4');
    cells.push(makeCell(5, 1, 'SEMAINE', STYLE.META_LABEL));
    cells.push(makeCell(5, 3, Number(weekInfo.week), STYLE.META_VALUE, 'number'));
    merges.push('A5:B5');
    cells.push(makeCell(5, 4, 'DU', STYLE.META_LABEL));
    cells.push(makeCell(5, 5, dateForDay(weekInfo.year, weekInfo.week, 0), STYLE.DATE, 'date'));
    merges.push('E5:F5');
    cells.push(makeCell(5, 7, 'AU', STYLE.META_LABEL));
    cells.push(makeCell(5, 8, dateForDay(weekInfo.year, weekInfo.week, 4), STYLE.DATE, 'date'));
    merges.push('H5:I5');
    cells.push(makeCell(5, 10, lockedLabel, week.locked ? STYLE.STATUS_LOCKED : STYLE.STATUS_DRAFT));
    merges.push('J5:L5');

    const kpis = [
      { start: 1, end: 2, label: 'HEURES TOTALES', value: total },
      { start: 3, end: 4, label: 'HEURES GCC', value: gccHours },
      { start: 5, end: 6, label: 'HEURES INTÉRIM', value: interimHours },
      { start: 7, end: 9, label: 'PRÊT DE MO', value: loanHours },
      { start: 10, end: 12, label: 'EFFECTIF SEMAINE', value: String(rosterPeople.length), type: 'string' }
    ];
    kpis.forEach(kpi => {
      cells.push(makeCell(7, kpi.start, kpi.label, STYLE.KPI_LABEL));
      merges.push(`${cellRef(7, kpi.start)}:${cellRef(7, kpi.end)}`);
      cells.push(makeCell(8, kpi.start, kpi.value, STYLE.KPI_VALUE, kpi.type || 'number'));
      merges.push(`${cellRef(8, kpi.start)}:${cellRef(9, kpi.end)}`);
    });

    cells.push(makeCell(11, 1, 'RÉPARTITION JOURNALIÈRE', STYLE.SUMMARY_SECTION));
    merges.push('A11:G11');
    const dayHeaders = ['Indicateur', ...DAY_NAMES.map((name, day) => `${name}
${formatDateFr(dateForDay(weekInfo.year, weekInfo.week, day)).slice(0, 5)}`), 'Total'];
    dayHeaders.forEach((value, index) => cells.push(makeCell(12, index + 1, value, STYLE.TABLE_HEADER)));
    const dailyRows = [
      ['Heures GCC', ...DAY_NAMES.map((_, day) => typeHours(week, people, 'GCC', day)), gccHours],
      ['Heures intérim', ...DAY_NAMES.map((_, day) => typeHours(week, people, 'Intérim', day)), interimHours],
      ['Prêt de MO', ...DAY_NAMES.map((_, day) => typeHours(week, people, 'Prêt de MO', day)), loanHours],
      ['Total heures', ...DAY_NAMES.map((_, day) => (week.entries || []).filter(entry => Number(entry.day) === day).reduce((sum, entry) => sum + Number(entry.hours || 0), 0)), total],
      ['Présents', ...DAY_NAMES.map((_, day) => dayPresentCount(week, rosterPeople, day)), ''],
      ['Absents', ...DAY_NAMES.map((_, day) => dayAbsenceCount(week, rosterPeople, day)), (week.absences || []).length]
    ];
    dailyRows.forEach((rowValues, rIndex) => {
      const row = 13 + rIndex;
      rowValues.forEach((value, cIndex) => cells.push(makeCell(row, cIndex + 1, value, cIndex === 0 ? STYLE.LIGHT_LABEL : STYLE.TABLE_NUMBER, typeof value === 'number' ? 'number' : 'string')));
    });

    cells.push(makeCell(11, 9, 'RÉPARTITION INTÉRIM PAR AGENCE', STYLE.SUMMARY_SECTION));
    merges.push('I11:L11');
    ['Agence', 'Effectif', 'Heures', '% intérim'].forEach((value, index) => cells.push(makeCell(12, 9 + index, value, STYLE.TABLE_HEADER)));
    const agencies = new Map();
    people.filter(isInterim).forEach(person => {
      const key = person.company || 'Agence non renseignée';
      if (!agencies.has(key)) agencies.set(key, { people: 0, hours: 0 });
      const item = agencies.get(key);
      item.people += 1;
      item.hours += personWeekTotal(week, person.id);
    });
    [...agencies.entries()].sort((a, b) => b[1].hours - a[1].hours).forEach(([agency, values], index) => {
      const row = 13 + index;
      cells.push(makeCell(row, 9, agency, STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 10, values.people, STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 11, values.hours, STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 12, interimHours ? values.hours / interimHours : 0, STYLE.PERCENT, 'number'));
    });

    const taskStart = Math.max(20, 14 + agencies.size);
    cells.push(makeCell(taskStart, 1, 'RÉPARTITION DES HEURES PAR TÂCHE', STYLE.SUMMARY_SECTION));
    merges.push(`A${taskStart}:L${taskStart}`);
    ['Tâche', 'GCC', 'Intérim', 'Prêt MO', 'Total', '% semaine', 'Personnes'].forEach((value, index) => {
      const col = [1, 5, 6, 7, 8, 9, 10][index];
      cells.push(makeCell(taskStart + 1, col, value, STYLE.TABLE_HEADER));
    });
    merges.push(`A${taskStart + 1}:D${taskStart + 1}`, `J${taskStart + 1}:L${taskStart + 1}`);
    tasks.map(task => ({
      task,
      gcc: taskTypeTotal(week, task.id, people, 'GCC'),
      interim: taskTypeTotal(week, task.id, people, 'Intérim'),
      loan: taskTypeTotal(week, task.id, people, 'Prêt de MO'),
      total: taskTotal(week, task.id),
      people: new Set((week.entries || []).filter(entry => entry.taskId === task.id).map(entry => entry.personId)).size
    })).sort((a, b) => b.total - a.total).forEach((item, index) => {
      const row = taskStart + 2 + index;
      cells.push(makeCell(row, 1, item.task.name || '', STYLE.TABLE_TEXT));
      merges.push(`A${row}:D${row}`);
      cells.push(makeCell(row, 5, item.gcc, STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 6, item.interim, STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 7, item.loan, STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 8, item.total, STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 9, total ? item.total / total : 0, STYLE.PERCENT, 'number'));
      cells.push(makeCell(row, 10, item.people, STYLE.TABLE_NUMBER, 'number'));
      merges.push(`J${row}:L${row}`);
    });
    const noteRow = taskStart + 3 + tasks.length;
    cells.push(makeCell(noteRow, 1, 'OBSERVATIONS DE LA SEMAINE', STYLE.SUMMARY_SECTION));
    merges.push(`A${noteRow}:L${noteRow}`);
    cells.push(makeCell(noteRow + 1, 1, week.notes || 'Aucune observation générale renseignée.', STYLE.WRAP_TEXT));
    merges.push(`A${noteRow + 1}:L${noteRow + 3}`);

    return {
      name: 'Synthèse semaine', cells, merges,
      columns: [{ min: 1, width: 18 }, { min: 2, max: 12, width: 12 }],
      rowHeights: { 1: 30, 2: 24, 4: 24, 5: 24, 7: 22, 8: 30, 9: 30, 11: 24, 12: 36, [noteRow + 1]: 45 },
      freeze: { ySplit: 5, topLeftCell: 'A6', activePane: 'bottomLeft' },
      showGridLines: false, orientation: 'landscape', paperSize: 9, fitToHeight: 1,
      printArea: `A1:L${noteRow + 3}`, repeatRows: '1:5', tabColor: 'FFFFD600',
      headerFooter: { footer: `&L${project.name || ''}&CSynthèse S${weekInfo.week} ${weekInfo.year}&RPage &P / &N` }
    };
  }

  function makeTaskSummarySheet(context) {
    const { project, weekInfo, week, people, tasks } = context;
    const cells = [];
    const merges = ['A1:L1', 'A3:B3', 'C3:F3', 'G3:H3', 'I3:L3'];
    cells.push(makeCell(1, 1, 'SYNTHÈSE DES HEURES PAR TÂCHE', STYLE.TITLE));
    cells.push(makeCell(3, 1, 'CHANTIER', STYLE.META_LABEL));
    cells.push(makeCell(3, 3, project.name || '', STYLE.META_VALUE));
    cells.push(makeCell(3, 7, 'SEMAINE', STYLE.META_LABEL));
    cells.push(makeCell(3, 9, `${weekInfo.week} / ${weekInfo.year}`, STYLE.META_VALUE));
    const headers = ['Tâche', ...DAY_NAMES.map((name, day) => `${name}\n${formatDateFr(dateForDay(weekInfo.year, weekInfo.week, day)).slice(0, 5)}`), 'Total', 'GCC', 'Intérim', 'Prêt MO', '% semaine', 'Effectif'];
    headers.forEach((header, index) => cells.push(makeCell(5, index + 1, header, STYLE.TABLE_HEADER)));
    tasks.forEach((task, index) => {
      const row = 6 + index;
      cells.push(makeCell(row, 1, task.name || '', STYLE.TABLE_TEXT));
      DAY_NAMES.forEach((_, day) => cells.push(makeCell(row, 2 + day, taskTotal(week, task.id, day), STYLE.TABLE_NUMBER, 'number')));
      const total = taskTotal(week, task.id);
      cells.push(makeFormulaCell(row, 7, `SUM(B${row}:F${row})`, total, STYLE.TABLE_NUMBER));
      cells.push(makeCell(row, 8, taskTypeTotal(week, task.id, people, 'GCC'), STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 9, taskTypeTotal(week, task.id, people, 'Intérim'), STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 10, taskTypeTotal(week, task.id, people, 'Prêt de MO'), STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 11, weekTotal(week) ? total / weekTotal(week) : 0, STYLE.PERCENT, 'number'));
      cells.push(makeCell(row, 12, new Set((week.entries || []).filter(entry => entry.taskId === task.id).map(entry => entry.personId)).size, STYLE.TABLE_NUMBER, 'number'));
    });
    const totalRow = 6 + tasks.length;
    fillRange(cells, totalRow, totalRow, 1, 12, STYLE.TOTAL);
    cells.push(makeCell(totalRow, 1, 'TOTAL', STYLE.TOTAL));
    for (let col = 2; col <= 10; col += 1) {
      const cached = col <= 6 ? (week.entries || []).filter(entry => Number(entry.day) === col - 2).reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
        : col === 7 ? weekTotal(week)
        : col === 8 ? typeHours(week, people, 'GCC')
        : col === 9 ? typeHours(week, people, 'Intérim')
        : typeHours(week, people, 'Prêt de MO');
      cells.push(makeFormulaCell(totalRow, col, `SUM(${colLetter(col)}6:${colLetter(col)}${Math.max(6, totalRow - 1)})`, cached, STYLE.TOTAL));
    }
    cells.push(makeCell(totalRow, 11, 1, STYLE.PERCENT, 'number'));
    cells.push(makeCell(totalRow, 12, new Set((week.entries || []).map(entry => entry.personId)).size, STYLE.TOTAL, 'number'));
    return {
      name: 'Synthèse tâches', cells, merges,
      columns: [{ min: 1, width: 35 }, { min: 2, max: 6, width: 12 }, { min: 7, max: 12, width: 12 }],
      rowHeights: { 1: 28, 3: 24, 5: 38 },
      freeze: { ySplit: 5, topLeftCell: 'A6', activePane: 'bottomLeft' },
      autoFilter: `A5:L${Math.max(5, totalRow - 1)}`,
      showGridLines: false, orientation: 'landscape', paperSize: 9,
      printArea: `A1:L${totalRow}`, repeatRows: '1:5', tabColor: 'FFA9D18E',
      headerFooter: { footer: `&L${project.name || ''}&CSynthèse tâches&RPage &P / &N` }
    };
  }

  function makeIbatSummarySheet(context) {
    const { project, weekInfo, week, people, tasks } = context;
    const tasksById = new Map(tasks.map(task => [task.id, task]));
    const cells = [];
    const merges = ['A1:L1', 'B3:D3'];
    cells.push(makeCell(1, 1, 'SAISIE IBAT — HEURES PAR PERSONNE ET PAR TÂCHE', STYLE.TITLE));
    cells.push(makeCell(3, 1, 'CHANTIER', STYLE.META_LABEL));
    cells.push(makeCell(3, 2, project.name || '', STYLE.META_VALUE));
    cells.push(makeCell(3, 6, 'SEMAINE', STYLE.META_LABEL));
    cells.push(makeCell(3, 7, Number(weekInfo.week), STYLE.META_VALUE, 'number'));
    cells.push(makeCell(3, 10, 'PÉRIODE', STYLE.META_LABEL));
    cells.push(makeCell(3, 11, `${formatDateFr(dateForDay(weekInfo.year, weekInfo.week, 0))} au ${formatDateFr(dateForDay(weekInfo.year, weekInfo.week, 4))}`, STYLE.META_VALUE));

    const headers = ['Type', 'Nom prénom', 'Entreprise / agence', 'Zone de déplacement', 'Tâche'];
    DAY_NAMES.forEach((name, day) => headers.push(`${name}\n${formatDateFr(dateForDay(weekInfo.year, weekInfo.week, day)).slice(0, 5)}`));
    headers.push('Total tâche', 'Statuts / retards');
    headers.forEach((header, index) => cells.push(makeCell(5, index + 1, header, STYLE.TABLE_HEADER)));

    const sorted = [...people].sort((a, b) => {
      const groupCmp = Number(personCategory(a) !== 'GCC') - Number(personCategory(b) !== 'GCC');
      return groupCmp || String(a.name || '').localeCompare(String(b.name || ''), 'fr');
    });

    let row = 6;
    sorted.forEach((person, personIndex) => {
      const external = isExternal(person);
      const textStyle = external ? STYLE.BODY_TEXT_BLUE : STYLE.BODY_TEXT_GCC;
      const numberStyle = external ? STYLE.BODY_NUMBER_BLUE : STYLE.BODY_NUMBER_GCC;
      const subtotalStyle = external ? STYLE.SUBTOTAL_INTERIM : STYLE.SUBTOTAL_GCC;
      const entries = personEntries(week, person.id);
      const taskIds = [...new Set(entries.map(entry => entry.taskId))];
      const personStartRow = row;
      if (!taskIds.length) taskIds.push(null);

      taskIds
        .sort((a, b) => String(tasksById.get(a)?.name || '').localeCompare(String(tasksById.get(b)?.name || ''), 'fr'))
        .forEach(taskId => {
          const taskName = taskId ? (tasksById.get(taskId)?.name || 'Tâche supprimée') : '—';
          cells.push(makeCell(row, 1, personCategory(person), textStyle));
          cells.push(makeCell(row, 2, person.name || '', textStyle));
          cells.push(makeCell(row, 3, personCategory(person) === 'GCC' ? 'GCC' : (person.company || ''), textStyle));
          cells.push(makeCell(row, 4, person.travelZone || '', textStyle));
          cells.push(makeCell(row, 5, taskName, textStyle));
          DAY_NAMES.forEach((_, day) => {
            const value = taskId
              ? personEntries(week, person.id, day).filter(entry => entry.taskId === taskId).reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
              : 0;
            cells.push(makeCell(row, 6 + day, value || '', numberStyle, value ? 'number' : 'string'));
          });
          const cachedTaskTotal = taskId
            ? entries.filter(entry => entry.taskId === taskId).reduce((sum, entry) => sum + Number(entry.hours || 0), 0)
            : 0;
          cells.push(makeFormulaCell(row, 11, `SUM(F${row}:J${row})`, cachedTaskTotal, numberStyle));
          cells.push(makeCell(row, 12, '', textStyle));
          row += 1;
        });

      const personEndRow = row - 1;
      const statusParts = [];
      DAY_NAMES.forEach((dayName, day) => {
        const absence = personAbsence(week, person.id, day);
        const late = personLate(week, person.id, day);
        if (absence) statusParts.push(`${dayName.slice(0, 3)} : ${absence.code}`);
        if (late) statusParts.push(`${dayName.slice(0, 3)} : RETARD${String(late.note || '').trim() ? ` (${String(late.note).trim()})` : ''}`);
      });
      fillRange(cells, row, row, 1, 12, subtotalStyle);
      cells.push(makeCell(row, 1, personCategory(person), subtotalStyle));
      cells.push(makeCell(row, 2, person.name || '', subtotalStyle));
      cells.push(makeCell(row, 3, personCategory(person) === 'GCC' ? 'GCC' : (person.company || ''), subtotalStyle));
      cells.push(makeCell(row, 4, person.travelZone || '', subtotalStyle));
      cells.push(makeCell(row, 5, 'TOTAL PERSONNE', subtotalStyle));
      for (let col = 6; col <= 10; col += 1) {
        const day = col - 6;
        const cached = personDayTotal(week, person.id, day);
        cells.push(makeFormulaCell(row, col, `SUM(${colLetter(col)}${personStartRow}:${colLetter(col)}${personEndRow})`, cached, subtotalStyle));
      }
      cells.push(makeFormulaCell(row, 11, `SUM(F${row}:J${row})`, personWeekTotal(week, person.id), subtotalStyle));
      cells.push(makeCell(row, 12, statusParts.join(' · '), statusParts.length ? STYLE.HOURS_ALERT : subtotalStyle));
      row += 1;
      if (personIndex < sorted.length - 1) row += 1; // ligne blanche entre deux personnes
    });

    const totalRow = row;
    fillRange(cells, totalRow, totalRow, 1, 12, STYLE.TOTAL_STRONG);
    cells.push(makeCell(totalRow, 2, 'TOTAL CHANTIER', STYLE.TOTAL_STRONG));
    for (let col = 6; col <= 10; col += 1) {
      const day = col - 6;
      const cached = sorted.reduce((sum, person) => sum + personDayTotal(week, person.id, day), 0);
      cells.push(makeCell(totalRow, col, cached, STYLE.TOTAL_STRONG, 'number'));
    }
    cells.push(makeCell(totalRow, 11, weekTotal(week), STYLE.TOTAL_STRONG, 'number'));

    return {
      name: 'Saisie iBAT', cells, merges,
      columns: [
        { min: 1, width: 10 }, { min: 2, width: 25 }, { min: 3, width: 22 }, { min: 4, width: 16 }, { min: 5, width: 36 },
        { min: 6, max: 10, width: 12 }, { min: 11, width: 14 }, { min: 12, width: 32 }
      ],
      rowHeights: { 1: 28, 3: 24, 5: 40 },
      freeze: { ySplit: 5, xSplit: 5, topLeftCell: 'F6', activePane: 'bottomRight' },
      autoFilter: `A5:L${Math.max(5, totalRow - 1)}`,
      showGridLines: false, orientation: 'landscape', paperSize: 9,
      printArea: `A1:L${totalRow}`, repeatRows: '1:5', tabColor: 'FFFFD800',
      headerFooter: { footer: `&L${project.name || ''}&CSaisie iBAT S${weekInfo.week} ${weekInfo.year}&RPage &P / &N` }
    };
  }

  function makeIbatDetailSheet(context) {
    const { project, weekInfo, week, people, tasks } = context;
    const tasksById = new Map(tasks.map(task => [task.id, task]));
    const cells = [];
    const headers = ['Date', 'Jour', 'Nom prénom', 'Type', 'Entreprise / agence', 'Zone de déplacement', 'Tâche', 'Heures', 'Statut', 'Retard', 'Observation'];
    headers.forEach((header, index) => cells.push(makeCell(1, index + 1, header, STYLE.TABLE_HEADER)));
    const sorted = [...people].sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
    let row = 2;
    sorted.forEach(person => {
      DAY_NAMES.forEach((dayName, day) => {
        const dayEntries = personEntries(week, person.id, day);
        const absence = personAbsence(week, person.id, day);
        const late = personLate(week, person.id, day);
        const grouped = new Map();
        dayEntries.forEach(entry => {
          if (!grouped.has(entry.taskId)) grouped.set(entry.taskId, { hours: 0, notes: [] });
          const item = grouped.get(entry.taskId);
          item.hours += Number(entry.hours || 0);
          if (String(entry.note || '').trim()) item.notes.push(String(entry.note).trim());
        });
        const rows = grouped.size ? [...grouped.entries()] : [[null, { hours: 0, notes: [] }]];
        rows.forEach(([taskId, item]) => {
          cells.push(makeCell(row, 1, dateForDay(weekInfo.year, weekInfo.week, day), STYLE.DATE, 'date'));
          cells.push(makeCell(row, 2, dayName, STYLE.TABLE_TEXT));
          cells.push(makeCell(row, 3, person.name || '', STYLE.TABLE_TEXT));
          cells.push(makeCell(row, 4, personCategory(person), STYLE.TABLE_TEXT));
          cells.push(makeCell(row, 5, personCategory(person) === 'GCC' ? 'GCC' : (person.company || ''), STYLE.TABLE_TEXT));
          cells.push(makeCell(row, 6, person.travelZone || '', STYLE.TABLE_TEXT));
          cells.push(makeCell(row, 7, taskId ? (tasksById.get(taskId)?.name || 'Tâche supprimée') : '', STYLE.TABLE_TEXT));
          cells.push(makeCell(row, 8, item.hours || 0, STYLE.TABLE_NUMBER, 'number'));
          const status = absence ? absence.code : (dayEntries.length ? 'Présent' : 'Non renseigné');
          cells.push(makeCell(row, 9, status, absence ? STYLE.ABSENCE : (status === 'Non renseigné' ? STYLE.HOURS_ALERT : STYLE.TABLE_TEXT)));
          cells.push(makeCell(row, 10, late ? 'Oui' : '', late ? STYLE.HOURS_ALERT : STYLE.TABLE_TEXT));
          const notes = [...new Set([
            ...item.notes,
            absence && String(absence.note || '').trim() ? String(absence.note).trim() : '',
            late && String(late.note || '').trim() ? `Retard : ${String(late.note).trim()}` : ''
          ].filter(Boolean))].join(' / ');
          cells.push(makeCell(row, 11, notes, STYLE.WRAP_TEXT));
          row += 1;
        });
      });
    });
    return {
      name: 'Détail iBAT', cells,
      columns: [
        { min: 1, width: 12 }, { min: 2, width: 12 }, { min: 3, width: 28 }, { min: 4, width: 11 },
        { min: 5, width: 20 }, { min: 6, width: 16 }, { min: 7, width: 34 }, { min: 8, width: 10 },
        { min: 9, width: 15 }, { min: 10, width: 10 }, { min: 11, width: 38 }
      ],
      freeze: { ySplit: 1, xSplit: 3, topLeftCell: 'D2', activePane: 'bottomRight' },
      autoFilter: `A1:K${Math.max(1, row - 1)}`,
      showGridLines: false, orientation: 'landscape', paperSize: 9,
      headerFooter: { footer: `&L${project.name || ''}&CDétail iBAT S${weekInfo.week} ${weekInfo.year}&RPage &P / &N` }
    };
  }

  function makeVentilationSheet(context) {
    const { project, weekInfo, week, people, tasks } = context;
    const cells = [];
    const merges = [];
    const columns = [
      { min: 1, width: 5 }, { min: 2, width: 17 }, { min: 3, width: 11 },
      { min: 4, width: 29 }, { min: 5, width: 12 }
    ];
    const totalColumns = Math.max(20, 5 + tasks.length * 5);
    const lastCol = colLetter(totalColumns);
    cells.push(makeCell(1, 1, 'VENTILATION HEBDOMADAIRE DES HEURES', STYLE.TITLE));
    merges.push(`A1:${lastCol}1`);
    cells.push(makeCell(2, 1, 'CHANTIER', STYLE.META_LABEL));
    cells.push(makeCell(2, 3, project.name || '', STYLE.META_VALUE));
    merges.push('A2:B2', 'C2:E2');
    cells.push(makeCell(2, 6, 'CODE', STYLE.META_LABEL));
    cells.push(makeCell(2, 8, project.code || '', STYLE.META_VALUE));
    merges.push('F2:G2', 'H2:I2');
    cells.push(makeCell(2, 10, 'SEMAINE', STYLE.META_LABEL));
    cells.push(makeCell(2, 12, Number(weekInfo.week), STYLE.META_VALUE, 'number'));
    merges.push('J2:K2');
    cells.push(makeCell(2, 13, 'PÉRIODE', STYLE.META_LABEL));
    cells.push(makeCell(2, 15, `${formatDateFr(dateForDay(weekInfo.year, weekInfo.week, 0))} au ${formatDateFr(dateForDay(weekInfo.year, weekInfo.week, 4))}`, STYLE.META_VALUE));
    merges.push('M2:N2', 'O2:R2');
    cells.push(makeCell(2, 19, week.locked ? 'VERROUILLÉE' : 'BROUILLON', week.locked ? STYLE.STATUS_LOCKED : STYLE.STATUS_DRAFT));
    if (totalColumns >= 20) merges.push(`S2:${lastCol}2`);

    const staticHeaders = ['S/I/P', 'Entreprise / agence', 'Zone de déplacement', 'Nom prénom', 'Total semaine'];
    staticHeaders.forEach((header, index) => {
      cells.push(makeCell(3, index + 1, header, STYLE.HEADER_YELLOW));
      cells.push(makeCell(4, index + 1, index === 4 ? 'h' : '', STYLE.DAY_HEADER));
    });
    tasks.forEach((task, taskIndex) => {
      const startCol = 6 + taskIndex * 5;
      const taskStyle = taskIndex % 2 === 0 ? STYLE.TASK_HEADER : STYLE.TASK_HEADER_ALT;
      const dayStyle = taskIndex % 2 === 0 ? STYLE.DAY_HEADER : STYLE.DAY_HEADER_ALT;
      cells.push(makeCell(3, startCol, task.name, taskStyle));
      merges.push(`${cellRef(3, startCol)}:${cellRef(3, startCol + 4)}`);
      DAY_NAMES.forEach((dayName, dayIndex) => {
        const date = formatDateFr(dateForDay(weekInfo.year, weekInfo.week, dayIndex)).slice(0, 5);
        cells.push(makeCell(4, startCol + dayIndex, `${DAY_SHORT[dayIndex]}
${date}`, dayStyle));
        columns.push({ min: startCol + dayIndex, width: 7.5 });
      });
    });

    const firstDataRow = 5;
    people.forEach((person, personIndex) => {
      const row = firstDataRow + personIndex;
      const external = isExternal(person);
      const textStyle = external ? STYLE.BODY_TEXT_BLUE : STYLE.BODY_TEXT_GCC;
      const numberStyle = external ? STYLE.BODY_NUMBER_BLUE : STYLE.BODY_NUMBER_GCC;
      cells.push(makeCell(row, 1, personTypeCode(person), textStyle));
      cells.push(makeCell(row, 2, personCategory(person) === 'GCC' ? 'GCC' : (person.company || ''), textStyle));
      cells.push(makeCell(row, 3, person.travelZone || '', textStyle));
      cells.push(makeCell(row, 4, person.name || '', textStyle));
      cells.push(tasks.length ? makeFormulaCell(row, 5, `SUM(F${row}:${colLetter(5 + tasks.length * 5)}${row})`, personWeekTotal(week, person.id), numberStyle) : makeCell(row, 5, personWeekTotal(week, person.id), numberStyle, 'number'));
      tasks.forEach((task, taskIndex) => {
        DAY_NAMES.forEach((_, day) => {
          const value = (week.entries || []).filter(entry => entry.personId === person.id && entry.taskId === task.id && Number(entry.day) === day)
            .reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
          cells.push(makeCell(row, 6 + taskIndex * 5 + day, value || '', numberStyle, value ? 'number' : 'string'));
        });
      });
    });

    const lastDataRow = Math.max(firstDataRow, firstDataRow + people.length - 1);
    const gccRow = firstDataRow + people.length;
    const interimRow = gccRow + 1;
    const loanRow = gccRow + 2;
    const totalRow = gccRow + 3;
    const taskTotalRow = gccRow + 4;
    const subtotalDefinitions = [
      { row: gccRow, label: 'SOUS-TOTAL GCC', code: 'S', category: 'GCC', style: STYLE.SUBTOTAL_GCC, cached: typeHours(week, people, 'GCC') },
      { row: interimRow, label: 'SOUS-TOTAL INTÉRIM', code: 'I', category: 'Intérim', style: STYLE.SUBTOTAL_INTERIM, cached: typeHours(week, people, 'Intérim') },
      { row: loanRow, label: 'SOUS-TOTAL PRÊT DE MO', code: 'P', category: 'Prêt de MO', style: STYLE.SUBTOTAL_INTERIM, cached: typeHours(week, people, 'Prêt de MO') }
    ];
    subtotalDefinitions.forEach(def => {
      fillRange(cells, def.row, def.row, 1, 5 + tasks.length * 5, def.style);
      cells.push(makeCell(def.row, 4, def.label, def.style));
      cells.push(makeFormulaCell(def.row, 5, `SUMIF($A$${firstDataRow}:$A$${lastDataRow},"${def.code}",$E$${firstDataRow}:$E$${lastDataRow})`, def.cached, def.style));
      tasks.forEach((task, taskIndex) => DAY_NAMES.forEach((_, day) => {
        const col = 6 + taskIndex * 5 + day;
        const cached = (week.entries || []).filter(entry => entry.taskId === task.id && Number(entry.day) === day && personCategory(people.find(person => person.id === entry.personId)) === def.category)
          .reduce((sum, entry) => sum + Number(entry.hours || 0), 0);
        cells.push(makeFormulaCell(def.row, col, `SUMIF($A$${firstDataRow}:$A$${lastDataRow},"${def.code}",${colLetter(col)}$${firstDataRow}:${colLetter(col)}$${lastDataRow})`, cached, def.style));
      }));
    });

    fillRange(cells, totalRow, totalRow, 1, 5 + tasks.length * 5, STYLE.TOTAL_STRONG);
    cells.push(makeCell(totalRow, 4, 'TOTAL GÉNÉRAL', STYLE.TOTAL_STRONG));
    cells.push(makeFormulaCell(totalRow, 5, `SUM(E${gccRow}:E${loanRow})`, weekTotal(week), STYLE.TOTAL_STRONG));
    tasks.forEach((task, taskIndex) => DAY_NAMES.forEach((_, day) => {
      const col = 6 + taskIndex * 5 + day;
      cells.push(makeFormulaCell(totalRow, col, `SUM(${colLetter(col)}${gccRow}:${colLetter(col)}${loanRow})`, taskTotal(week, task.id, day), STYLE.TOTAL_STRONG));
    }));

    fillRange(cells, taskTotalRow, taskTotalRow, 1, 5 + tasks.length * 5, STYLE.TOTAL);
    cells.push(makeCell(taskTotalRow, 4, 'TOTAL PAR TÂCHE', STYLE.TOTAL));
    cells.push(tasks.length ? makeFormulaCell(taskTotalRow, 5, `SUM(F${taskTotalRow}:${colLetter(5 + tasks.length * 5)}${taskTotalRow})`, weekTotal(week), STYLE.TOTAL) : makeCell(taskTotalRow, 5, weekTotal(week), STYLE.TOTAL, 'number'));
    tasks.forEach((task, taskIndex) => {
      const startCol = 6 + taskIndex * 5;
      cells.push(makeFormulaCell(taskTotalRow, startCol, `SUM(${colLetter(startCol)}${totalRow}:${colLetter(startCol + 4)}${totalRow})`, taskTotal(week, task.id), STYLE.TOTAL));
      for (let offset = 1; offset < 5; offset += 1) cells.push(makeCell(taskTotalRow, startCol + offset, '', STYLE.TOTAL));
      merges.push(`${cellRef(taskTotalRow, startCol)}:${cellRef(taskTotalRow, startCol + 4)}`);
    });

    return {
      name: 'Ventilation', cells, merges, columns,
      rowHeights: { 1: 30, 2: 27, 3: 46, 4: 34 },
      freeze: { xSplit: 5, ySplit: 4, topLeftCell: 'F5', activePane: 'bottomRight' },
      showGridLines: false, orientation: 'landscape', paperSize: 8,
      printArea: `A1:${lastCol}${taskTotalRow}`, repeatRows: '1:4', tabColor: 'FFA9D18E',
      headerFooter: { footer: `&L${project.name || ''}&CVentilation S${weekInfo.week} ${weekInfo.year}&RPage &P / &N` }
    };
  }

  function makePointageSummarySheet(context, type) {
    const { project, weekInfo, week, people } = context;
    const filtered = people.filter(person => personCategory(person) === type);
    const cells = [];
    const merges = ['A1:J1', 'A2:J2', 'A3:B3', 'C3:F3', 'G3:H3', 'I3:J3', 'A4:B4', 'E4:F4', 'H4:I4'];
    cells.push(makeCell(1, 1, `FEUILLE DE POINTAGE — ${type === 'GCC' ? 'SALARIÉS GCC' : (type === 'Intérim' ? 'INTÉRIMAIRES' : 'PRÊT DE MAIN D’ŒUVRE')}`, STYLE.TITLE));
    cells.push(makeCell(2, 1, 'RELEVÉ HEBDOMADAIRE DES HEURES', STYLE.SUBTITLE));
    cells.push(makeCell(3, 1, 'CHANTIER', STYLE.META_LABEL));
    cells.push(makeCell(3, 3, project.name || '', STYLE.META_VALUE));
    cells.push(makeCell(3, 7, 'CODE', STYLE.META_LABEL));
    cells.push(makeCell(3, 9, project.code || '', STYLE.META_VALUE));
    cells.push(makeCell(4, 1, 'SEMAINE N°', STYLE.META_LABEL));
    cells.push(makeCell(4, 3, Number(weekInfo.week), STYLE.META_VALUE, 'number'));
    cells.push(makeCell(4, 4, 'DU', STYLE.META_LABEL));
    cells.push(makeCell(4, 5, dateForDay(weekInfo.year, weekInfo.week, 0), STYLE.DATE, 'date'));
    cells.push(makeCell(4, 7, 'AU', STYLE.META_LABEL));
    cells.push(makeCell(4, 8, dateForDay(weekInfo.year, weekInfo.week, 4), STYLE.DATE, 'date'));
    cells.push(makeCell(4, 10, week.locked ? 'VERROUILLÉE' : 'BROUILLON', week.locked ? STYLE.STATUS_LOCKED : STYLE.STATUS_DRAFT));

    const headers = ['N°', 'Nom prénom', type === 'GCC' ? 'Compte chantier' : 'Agence', ...DAY_NAMES.map((name, day) => `${name}
${formatDateFr(dateForDay(weekInfo.year, weekInfo.week, day)).slice(0, 5)}`), 'Total', 'Observations'];
    headers.forEach((header, index) => cells.push(makeCell(6, index + 1, header, STYLE.TABLE_HEADER)));
    filtered.forEach((person, index) => {
      const row = 7 + index;
      const textStyle = type === 'GCC' ? STYLE.BODY_TEXT_GCC : STYLE.BODY_TEXT_BLUE;
      const numStyle = type === 'GCC' ? STYLE.BODY_NUMBER_GCC : STYLE.BODY_NUMBER_BLUE;
      cells.push(makeCell(row, 1, String(index + 1), numStyle, 'string'));
      cells.push(makeCell(row, 2, person.name || '', textStyle));
      cells.push(makeCell(row, 3, type === 'GCC' ? (project.code || '') : (person.company || ''), textStyle));
      DAY_NAMES.forEach((_, day) => {
        const absence = personAbsence(week, person.id, day);
        const total = personDayTotal(week, person.id, day);
        cells.push(makeCell(row, 4 + day, absence ? absence.code : (total || ''), absence ? STYLE.ABSENCE : numStyle, absence ? 'string' : (total ? 'number' : 'string')));
      });
      cells.push(makeFormulaCell(row, 9, `SUM(D${row}:H${row})`, personWeekTotal(week, person.id), numStyle));
      cells.push(makeCell(row, 10, noteSummary(week, person.id), STYLE.WRAP_TEXT));
    });
    const firstDataRow = 7;
    const lastDataRow = Math.max(firstDataRow, firstDataRow + filtered.length - 1);
    const totalRow = 7 + filtered.length;
    fillRange(cells, totalRow, totalRow, 1, 10, STYLE.TOTAL_STRONG);
    cells.push(makeCell(totalRow, 2, 'TOTAL HEURES', STYLE.TOTAL_STRONG));
    for (let col = 4; col <= 9; col += 1) {
      const cached = col === 9 ? filtered.reduce((sum, person) => sum + personWeekTotal(week, person.id), 0)
        : filtered.reduce((sum, person) => sum + personDayTotal(week, person.id, col - 4), 0);
      cells.push(makeFormulaCell(totalRow, col, `SUM(${colLetter(col)}${firstDataRow}:${colLetter(col)}${lastDataRow})`, cached, STYLE.TOTAL_STRONG));
    }
    const effectiveRow = totalRow + 1;
    fillRange(cells, effectiveRow, effectiveRow, 1, 10, STYLE.LIGHT_VALUE);
    cells.push(makeCell(effectiveRow, 2, 'EFFECTIF PRÉSENT', STYLE.LIGHT_LABEL));
    DAY_NAMES.forEach((_, day) => cells.push(makeCell(effectiveRow, 4 + day, dayPresentCount(week, filtered, day), STYLE.TABLE_NUMBER, 'number')));
    cells.push(makeCell(effectiveRow, 9, filtered.length, STYLE.TABLE_NUMBER, 'number'));

    const sigRow = effectiveRow + 3;
    fillRange(cells, sigRow, sigRow, 1, 5, STYLE.SIGNATURE_HEADER);
    fillRange(cells, sigRow, sigRow, 6, 10, STYLE.SIGNATURE_HEADER);
    cells.push(makeCell(sigRow, 1, type === 'GCC' ? 'Visa chef de chantier' : 'Visa entreprise / agence', STYLE.SIGNATURE_HEADER));
    cells.push(makeCell(sigRow, 6, 'Visa conducteur de travaux', STYLE.SIGNATURE_HEADER));
    merges.push(`A${sigRow}:E${sigRow}`, `F${sigRow}:J${sigRow}`);
    fillRange(cells, sigRow + 1, sigRow + 4, 1, 10, STYLE.SIGNATURE_BOX);
    merges.push(`A${sigRow + 1}:E${sigRow + 4}`, `F${sigRow + 1}:J${sigRow + 4}`);
    return {
      name: type === 'GCC' ? 'Pointages GCC' : (type === 'Intérim' ? 'Pointages Intérim' : 'Pointages Prêt MO'), cells, merges,
      columns: [{ min: 1, width: 5 }, { min: 2, width: 29 }, { min: 3, width: 18 }, { min: 4, max: 8, width: 13 }, { min: 9, width: 11 }, { min: 10, width: 33 }],
      rowHeights: { 1: 28, 2: 22, 3: 24, 4: 24, 6: 42 },
      freeze: { ySplit: 6, topLeftCell: 'A7', activePane: 'bottomLeft' },
      showGridLines: false, orientation: 'landscape', paperSize: 9, fitToHeight: 1,
      printArea: `A1:J${sigRow + 4}`, repeatRows: '1:6', tabColor: type === 'GCC' ? 'FFFFD600' : 'FFBDD7EE',
      headerFooter: { footer: `&L${project.name || ''}&C${type} — S${weekInfo.week} ${weekInfo.year}&RPage &P / &N` }
    };
  }

  function makeInterimEditionSheet(context) {
    const { project, weekInfo, week, people } = context;
    const interims = people.filter(isInterim);
    const cells = [];
    const merges = ['A1:K1', 'A2:K2', 'A4:B4', 'C4:F4', 'G4:H4', 'I4:K4'];
    cells.push(makeCell(1, 1, 'ÉDITION DES FEUILLES INTÉRIMAIRES', STYLE.TITLE));
    cells.push(makeCell(2, 1, 'TABLEAU DE CONTRÔLE AVANT TRANSMISSION AUX AGENCES', STYLE.SUBTITLE));
    cells.push(makeCell(4, 1, 'CHANTIER', STYLE.META_LABEL));
    cells.push(makeCell(4, 3, project.name || '', STYLE.META_VALUE));
    cells.push(makeCell(4, 7, 'SEMAINE N°', STYLE.META_LABEL));
    cells.push(makeCell(4, 9, `${weekInfo.week} / ${weekInfo.year}`, STYLE.META_VALUE));
    const headers = ['N°', 'Nom prénom', 'Agence', ...DAY_NAMES.map((name, day) => `${name}
${formatDateFr(dateForDay(weekInfo.year, weekInfo.week, day)).slice(0, 5)}`), 'Total', 'Théorique', 'Écart'];
    headers.forEach((header, index) => cells.push(makeCell(6, index + 1, header, STYLE.TABLE_HEADER)));
    interims.forEach((person, index) => {
      const row = 7 + index;
      cells.push(makeCell(row, 1, String(index + 1), STYLE.BODY_NUMBER_BLUE, 'string'));
      cells.push(makeCell(row, 2, person.name || '', STYLE.BODY_TEXT_BLUE));
      cells.push(makeCell(row, 3, person.company || '', STYLE.BODY_TEXT_BLUE));
      DAY_NAMES.forEach((_, day) => {
        const absence = personAbsence(week, person.id, day);
        const total = personDayTotal(week, person.id, day);
        cells.push(makeCell(row, 4 + day, absence ? absence.code : (total || ''), absence ? STYLE.ABSENCE : STYLE.BODY_NUMBER_BLUE, absence ? 'string' : (total ? 'number' : 'string')));
      });
      const actual = personWeekTotal(week, person.id);
      const expected = personExpectedTotal(person);
      cells.push(makeFormulaCell(row, 9, `SUM(D${row}:H${row})`, actual, STYLE.BODY_NUMBER_BLUE));
      cells.push(makeCell(row, 10, expected, STYLE.BODY_NUMBER_BLUE, 'number'));
      cells.push(makeFormulaCell(row, 11, `I${row}-J${row}`, actual - expected, Math.abs(actual - expected) > 0.01 ? STYLE.HOURS_ALERT : STYLE.BODY_NUMBER_BLUE));
    });
    const firstRow = 7;
    const lastRow = Math.max(firstRow, firstRow + interims.length - 1);
    const totalRow = 7 + interims.length;
    fillRange(cells, totalRow, totalRow, 1, 11, STYLE.TOTAL_STRONG);
    cells.push(makeCell(totalRow, 2, 'TOTAL', STYLE.TOTAL_STRONG));
    for (let col = 4; col <= 11; col += 1) {
      const cached = col <= 8 ? interims.reduce((sum, person) => sum + personDayTotal(week, person.id, col - 4), 0)
        : col === 9 ? interims.reduce((sum, person) => sum + personWeekTotal(week, person.id), 0)
        : col === 10 ? interims.reduce((sum, person) => sum + personExpectedTotal(person), 0)
        : interims.reduce((sum, person) => sum + personWeekTotal(week, person.id) - personExpectedTotal(person), 0);
      cells.push(makeFormulaCell(totalRow, col, `SUM(${colLetter(col)}${firstRow}:${colLetter(col)}${lastRow})`, cached, STYLE.TOTAL_STRONG));
    }
    return {
      name: 'Edition intérimaires', cells, merges,
      columns: [{ min: 1, width: 5 }, { min: 2, width: 29 }, { min: 3, width: 19 }, { min: 4, max: 8, width: 13 }, { min: 9, max: 11, width: 12 }],
      rowHeights: { 1: 28, 2: 22, 4: 24, 6: 42 },
      freeze: { ySplit: 6, topLeftCell: 'A7', activePane: 'bottomLeft' },
      showGridLines: false, orientation: 'landscape', paperSize: 9,
      printArea: `A1:K${totalRow}`, repeatRows: '1:6', tabColor: 'FFBDD7EE',
      headerFooter: { footer: `&L${project.name || ''}&CContrôle intérim S${weekInfo.week}&RPage &P / &N` }
    };
  }

  function makeIndividualInterimSheet(context, person, index) {
    const { project, weekInfo, week, tasks } = context;
    const tasksById = new Map(tasks.map(task => [task.id, task]));
    const cells = [];
    const merges = [
      'A1:H1', 'A2:H2', 'C4:H4', 'C5:D5', 'G5:H5', 'C6:D6', 'G6:H6',
      'C8:H8', 'C9:D9', 'G9:H9', 'F11:G11', 'F12:G12', 'F13:G13', 'F14:G14', 'F15:G15', 'F16:G16',
      'A18:C18', 'D18:E18', 'F18:G18', 'A20:D20', 'E20:H20', 'A21:D24', 'E21:H24'
    ];
    cells.push(makeCell(1, 1, 'FEUILLE DE POINTAGE — INTÉRIMAIRE', STYLE.TITLE));
    cells.push(makeCell(2, 1, 'RELEVÉ HEBDOMADAIRE INDIVIDUEL', STYLE.SUBTITLE));
    cells.push(makeCell(4, 1, 'CHANTIER', STYLE.META_LABEL));
    cells.push(makeCell(4, 3, project.name || '', STYLE.META_VALUE));
    cells.push(makeCell(5, 1, 'CODE', STYLE.META_LABEL));
    cells.push(makeCell(5, 3, project.code || '', STYLE.META_VALUE));
    cells.push(makeCell(5, 5, 'SEMAINE N°', STYLE.META_LABEL));
    cells.push(makeCell(5, 7, Number(weekInfo.week), STYLE.META_VALUE, 'number'));
    cells.push(makeCell(6, 1, 'DU', STYLE.META_LABEL));
    cells.push(makeCell(6, 3, dateForDay(weekInfo.year, weekInfo.week, 0), STYLE.DATE, 'date'));
    cells.push(makeCell(6, 5, 'AU', STYLE.META_LABEL));
    cells.push(makeCell(6, 7, dateForDay(weekInfo.year, weekInfo.week, 4), STYLE.DATE, 'date'));
    cells.push(makeCell(8, 1, 'INTÉRIMAIRE', STYLE.META_LABEL));
    cells.push(makeCell(8, 3, person.name || '', STYLE.META_VALUE));
    cells.push(makeCell(9, 1, 'AGENCE', STYLE.META_LABEL));
    cells.push(makeCell(9, 3, person.company || '', STYLE.META_VALUE));
    cells.push(makeCell(9, 5, 'ZONE DE DÉPLACEMENT', STYLE.META_LABEL));
    cells.push(makeCell(9, 7, person.travelZone || '', STYLE.META_VALUE));

    const headers = [
      { col: 1, value: 'Jour' }, { col: 2, value: 'Date' }, { col: 3, value: `Horaire\nthéorique` },
      { col: 4, value: `Heures\nréalisées` }, { col: 5, value: 'Statut' }, { col: 6, value: 'Tâches réalisées' }, { col: 8, value: 'Observations' }
    ];
    headers.forEach(header => cells.push(makeCell(11, header.col, header.value, STYLE.TABLE_HEADER)));
    DAY_NAMES.forEach((dayName, day) => {
      const row = 12 + day;
      const absence = personAbsence(week, person.id, day);
      const late = personLate(week, person.id, day);
      const total = personDayTotal(week, person.id, day);
      cells.push(makeCell(row, 1, dayName, STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 2, dateForDay(weekInfo.year, weekInfo.week, day), STYLE.DATE, 'date'));
      cells.push(makeCell(row, 3, Number(person?.schedule?.[day] || 0), STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 4, total || '', absence ? STYLE.ABSENCE : STYLE.TABLE_NUMBER, total ? 'number' : 'string'));
      cells.push(makeCell(row, 5, absence ? absence.code : (late ? 'Retard' : (total ? 'Présent' : '')), absence ? STYLE.ABSENCE : (late ? STYLE.HOURS_ALERT : STYLE.TABLE_TEXT)));
      cells.push(makeCell(row, 6, taskSummary(week, tasksById, person.id, day), STYLE.WRAP_TEXT));
      cells.push(makeCell(row, 8, noteSummary(week, person.id, day), STYLE.WRAP_TEXT));
    });
    fillRange(cells, 18, 18, 1, 8, STYLE.TOTAL_STRONG);
    cells.push(makeCell(18, 1, 'TOTAL HEBDOMADAIRE', STYLE.TOTAL_STRONG));
    cells.push(makeFormulaCell(18, 4, 'SUM(D12:D16)', personWeekTotal(week, person.id), STYLE.TOTAL_STRONG));
    cells.push(makeCell(18, 6, `Théorique : ${formatNumber(personExpectedTotal(person))} h`, STYLE.TOTAL_STRONG));
    cells.push(makeCell(18, 8, `Écart : ${formatNumber(personWeekTotal(week, person.id) - personExpectedTotal(person))} h`, STYLE.TOTAL_STRONG));
    cells.push(makeCell(20, 1, 'Visa intérimaire', STYLE.SIGNATURE_HEADER));
    cells.push(makeCell(20, 5, 'Visa chef de chantier', STYLE.SIGNATURE_HEADER));
    fillRange(cells, 21, 24, 1, 8, STYLE.SIGNATURE_BOX);
    const prefix = String(index + 1).padStart(2, '0');
    return {
      name: `INT ${prefix} ${person.name || 'Intérimaire'}`, cells, merges,
      columns: [{ min: 1, width: 13 }, { min: 2, width: 12 }, { min: 3, width: 12 }, { min: 4, width: 12 }, { min: 5, width: 13 }, { min: 6, max: 7, width: 23 }, { min: 8, width: 30 }],
      rowHeights: { 1: 28, 2: 22, 4: 24, 5: 24, 6: 24, 8: 24, 9: 24, 11: 38, 12: 47, 13: 47, 14: 47, 15: 47, 16: 47, 18: 28, 20: 25 },
      showGridLines: false, orientation: 'landscape', paperSize: 9, fitToHeight: 1,
      printArea: 'A1:H24', repeatRows: '1:11', tabColor: 'FFBDD7EE',
      margins: { left: 0.25, right: 0.25, top: 0.35, bottom: 0.35, header: 0.15, footer: 0.15 },
      headerFooter: { footer: `&L${person.company || ''}&CPage &P / &N&R${project.name || ''}` }
    };
  }

  function makeDetailsSheet(context) {
    const { project, weekInfo, week, people, tasks } = context;
    const peopleById = new Map(people.map(person => [person.id, person]));
    const tasksById = new Map(tasks.map(task => [task.id, task]));
    const cells = [];
    const headers = ['Date', 'Jour', 'Nom prénom', 'Type', 'Entreprise', 'Zone de déplacement', 'Tâche', 'Heures', 'Observation'];
    headers.forEach((header, index) => cells.push(makeCell(1, index + 1, header, STYLE.TABLE_HEADER)));
    (week.entries || []).slice().sort((a, b) => Number(a.day) - Number(b.day) || String(peopleById.get(a.personId)?.name || '').localeCompare(String(peopleById.get(b.personId)?.name || ''), 'fr')).forEach((entry, index) => {
      const row = index + 2;
      const person = peopleById.get(entry.personId);
      const task = tasksById.get(entry.taskId);
      cells.push(makeCell(row, 1, dateForDay(weekInfo.year, weekInfo.week, Number(entry.day)), STYLE.DATE, 'date'));
      cells.push(makeCell(row, 2, DAY_NAMES[Number(entry.day)] || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 3, person?.name || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 4, person?.type || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 5, person?.company || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 6, person?.travelZone || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 7, task?.name || 'Tâche supprimée', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 8, Number(entry.hours || 0), STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 9, entry.note || '', STYLE.WRAP_TEXT));
    });
    return {
      name: 'Détail saisies', cells,
      columns: [{ min: 1, width: 12 }, { min: 2, width: 12 }, { min: 3, width: 28 }, { min: 4, width: 12 }, { min: 5, width: 18 }, { min: 6, width: 12 }, { min: 7, width: 28 }, { min: 8, width: 10 }, { min: 9, width: 35 }],
      freeze: { ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' },
      autoFilter: `A1:I${Math.max(1, (week.entries || []).length + 1)}`,
      showGridLines: false, orientation: 'landscape', paperSize: 9
    };
  }

  function makeAbsencesSheet(context) {
    const { project, weekInfo, week, people } = context;
    const peopleById = new Map(people.map(person => [person.id, person]));
    const cells = [];
    const headers = ['Date', 'Jour', 'Nom prénom', 'Type', 'Entreprise', 'Statut', 'Observation'];
    headers.forEach((header, index) => cells.push(makeCell(1, index + 1, header, STYLE.TABLE_HEADER)));
    (week.absences || []).slice().sort((a, b) => Number(a.day) - Number(b.day)).forEach((item, index) => {
      const row = index + 2;
      const person = peopleById.get(item.personId);
      cells.push(makeCell(row, 1, dateForDay(weekInfo.year, weekInfo.week, Number(item.day)), STYLE.DATE, 'date'));
      cells.push(makeCell(row, 2, DAY_NAMES[Number(item.day)] || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 3, person?.name || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 4, person?.type || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 5, person?.company || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 6, item.code || '', STYLE.ABSENCE));
      cells.push(makeCell(row, 7, item.note || '', STYLE.WRAP_TEXT));
    });
    return {
      name: 'Absences', cells,
      columns: [{ min: 1, width: 12 }, { min: 2, width: 12 }, { min: 3, width: 28 }, { min: 4, width: 12 }, { min: 5, width: 18 }, { min: 6, width: 14 }, { min: 7, width: 35 }],
      freeze: { ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' },
      autoFilter: `A1:G${Math.max(1, (week.absences || []).length + 1)}`,
      showGridLines: false, orientation: 'landscape', paperSize: 9
    };
  }


  function makeLatesSheet(context) {
    const { project, weekInfo, week, people } = context;
    const peopleById = new Map(people.map(person => [person.id, person]));
    const cells = [];
    const headers = ['Date', 'Jour', 'Nom prénom', 'Type', 'Entreprise', 'Horaire théorique', 'Heures réalisées', 'Écart', 'Observation'];
    headers.forEach((header, index) => cells.push(makeCell(1, index + 1, header, STYLE.TABLE_HEADER)));
    (week.lates || []).slice().sort((a, b) => Number(a.day) - Number(b.day) || String(peopleById.get(a.personId)?.name || '').localeCompare(String(peopleById.get(b.personId)?.name || ''), 'fr')).forEach((item, index) => {
      const row = index + 2;
      const person = peopleById.get(item.personId);
      const target = Number(person?.schedule?.[Number(item.day)] || 0);
      const actual = personDayTotal(week, item.personId, Number(item.day));
      cells.push(makeCell(row, 1, dateForDay(weekInfo.year, weekInfo.week, Number(item.day)), STYLE.DATE, 'date'));
      cells.push(makeCell(row, 2, DAY_NAMES[Number(item.day)] || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 3, person?.name || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 4, person?.type || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 5, person?.company || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 6, target, STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 7, actual, STYLE.TABLE_NUMBER, 'number'));
      cells.push(makeCell(row, 8, actual - target, STYLE.HOURS_ALERT, 'number'));
      cells.push(makeCell(row, 9, item.note || '', STYLE.WRAP_TEXT));
    });
    return {
      name: 'Retards', cells,
      columns: [{ min: 1, width: 12 }, { min: 2, width: 12 }, { min: 3, width: 28 }, { min: 4, width: 12 }, { min: 5, width: 18 }, { min: 6, max: 8, width: 15 }, { min: 9, width: 35 }],
      freeze: { ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' },
      autoFilter: `A1:I${Math.max(1, (week.lates || []).length + 1)}`,
      showGridLines: false, orientation: 'landscape', paperSize: 9,
      headerFooter: { footer: `&L${project.name || ''}&CRetards — S${weekInfo.week} ${weekInfo.year}&RPage &P / &N` }
    };
  }


  function makeContractsSheet(context) {
    const { people, allPeople, interimContracts, contractRules } = context;
    const interimPeople = (allPeople || people).filter(isInterim).slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'fr'));
    const cells = [];
    const headers = ['Intérimaire', 'Agence', 'N° contrat', 'Poste', 'Motif', 'Début', 'Fin initiale', 'Fin actuelle', 'Renouv.', 'Max', 'Durée (j)', 'Durée max (mois)', 'Statut', 'Carence estimée (j)', 'Observation'];
    headers.forEach((header, index) => cells.push(makeCell(1, index + 1, header, STYLE.TABLE_HEADER)));
    let row = 2;
    interimPeople.forEach(person => {
      const contracts = (interimContracts || []).filter(contract => contract.personId === person.id).slice().sort((a, b) => String(contractCurrentEnd(b)).localeCompare(String(contractCurrentEnd(a))));
      const rows = contracts.length ? contracts : [null];
      rows.forEach(contract => {
        const start = contract ? parseIsoDate(contract.startDate) : null;
        const initialEnd = contract ? parseIsoDate(contract.initialEndDate) : null;
        const currentEnd = contract ? parseIsoDate(contractCurrentEnd(contract)) : null;
        const status = contractStatus(contract, new Date().toISOString().slice(0, 10), contractRules);
        cells.push(makeCell(row, 1, person.name || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 2, contract?.agency || person.company || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 3, contract?.contractNumber || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 4, contract?.position || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 5, contract?.reason || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 6, start || '', start ? STYLE.DATE : STYLE.TABLE_TEXT, start ? 'date' : null));
        cells.push(makeCell(row, 7, initialEnd || '', initialEnd ? STYLE.DATE : STYLE.TABLE_TEXT, initialEnd ? 'date' : null));
        cells.push(makeCell(row, 8, currentEnd || '', currentEnd ? STYLE.DATE : STYLE.TABLE_TEXT, currentEnd ? 'date' : null));
        cells.push(makeCell(row, 9, (contract?.renewals || []).length, STYLE.TABLE_NUMBER, 'number'));
        cells.push(makeCell(row, 10, Number(contractRules?.maxRenewals ?? 2), STYLE.TABLE_NUMBER, 'number'));
        cells.push(makeCell(row, 11, contract ? contractDurationDays(contract) : 0, STYLE.TABLE_NUMBER, 'number'));
        cells.push(makeCell(row, 12, Number(contract?.maxDurationMonths || contractRules?.maxDurationMonths || 18), STYLE.TABLE_NUMBER, 'number'));
        cells.push(makeCell(row, 13, status, ['Expiré', 'Sans contrat', 'À compléter'].includes(status) ? STYLE.ABSENCE : STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 14, contract ? contractCarenceDays(contract, contractRules) : 0, STYLE.TABLE_NUMBER, 'number'));
        cells.push(makeCell(row, 15, contract?.note || '', STYLE.WRAP_TEXT));
        row += 1;
      });
    });
    return {
      name: 'Suivi contrats intérim', cells,
      columns: [{ min: 1, width: 28 }, { min: 2, width: 18 }, { min: 3, width: 17 }, { min: 4, width: 22 }, { min: 5, width: 25 }, { min: 6, max: 8, width: 13 }, { min: 9, max: 10, width: 10 }, { min: 11, max: 12, width: 15 }, { min: 13, width: 15 }, { min: 14, width: 20 }, { min: 15, width: 38 }],
      freeze: { ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' },
      autoFilter: `A1:O${Math.max(1, row - 1)}`,
      showGridLines: false, orientation: 'landscape', paperSize: 9,
      printArea: `A1:O${Math.max(2, row - 1)}`, repeatRows: '1:1', tabColor: 'FFFFD800',
      headerFooter: { footer: '&LSuivi interne — règles à confirmer avec RH / agence&CPage &P / &N&RPointages GCC' }
    };
  }

  function makeLiaisonsSheet(context) {
    const { people, allPeople, interimContracts } = context;
    const peopleById = new Map((allPeople || people).map(person => [person.id, person]));
    const cells = [];
    const headers = ['Intérimaire', 'Agence', 'Début mission', 'Fin actuelle', 'État liaison', 'Email agence', 'Contact agence', 'Téléphone', 'Taux horaire (€)', 'Coefficient', 'Panier (€)', 'Trajet (€)', 'Transport (€)', 'Durée hebdo (h)', 'Envoyée le', 'Complétée le', 'Validée le', 'Observation'];
    headers.forEach((header, index) => cells.push(makeCell(1, index + 1, header, STYLE.TABLE_HEADER)));
    let row = 2;
    (interimContracts || []).slice().sort((a, b) => String(a.startDate || '').localeCompare(String(b.startDate || ''))).forEach(contract => {
      const person = peopleById.get(contract.personId);
      const liaison = contract.liaison || {};
      const statusMap = { to_send: 'À envoyer', sent: 'Envoyée', completed: 'Complétée', validated: 'Validée' };
      const start = parseIsoDate(contract.startDate);
      const end = parseIsoDate(contractCurrentEnd(contract));
      const sent = liaison.sentAt ? new Date(liaison.sentAt) : null;
      const completed = liaison.completedAt ? new Date(liaison.completedAt) : null;
      const validated = liaison.validatedAt ? new Date(liaison.validatedAt) : null;
      cells.push(makeCell(row, 1, person?.name || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 2, contract.agency || person?.company || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 3, start || '', start ? STYLE.DATE : STYLE.TABLE_TEXT, start ? 'date' : null));
      cells.push(makeCell(row, 4, end || '', end ? STYLE.DATE : STYLE.TABLE_TEXT, end ? 'date' : null));
      cells.push(makeCell(row, 5, statusMap[liaison.status] || 'À envoyer', liaison.status === 'validated' ? STYLE.TABLE_TEXT : STYLE.ABSENCE));
      cells.push(makeCell(row, 6, liaison.agencyEmail || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 7, liaison.contactName || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 8, liaison.contactPhone || '', STYLE.TABLE_TEXT));
      cells.push(makeCell(row, 9, liaison.hourlyRate === '' || liaison.hourlyRate == null ? '' : Number(liaison.hourlyRate), STYLE.TABLE_NUMBER, liaison.hourlyRate === '' || liaison.hourlyRate == null ? null : 'number'));
      cells.push(makeCell(row, 10, liaison.billingCoefficient === '' || liaison.billingCoefficient == null ? '' : Number(liaison.billingCoefficient), STYLE.TABLE_NUMBER, liaison.billingCoefficient === '' || liaison.billingCoefficient == null ? null : 'number'));
      cells.push(makeCell(row, 11, liaison.mealAllowance === '' || liaison.mealAllowance == null ? '' : Number(liaison.mealAllowance), STYLE.TABLE_NUMBER, liaison.mealAllowance === '' || liaison.mealAllowance == null ? null : 'number'));
      cells.push(makeCell(row, 12, liaison.travelAllowance === '' || liaison.travelAllowance == null ? '' : Number(liaison.travelAllowance), STYLE.TABLE_NUMBER, liaison.travelAllowance === '' || liaison.travelAllowance == null ? null : 'number'));
      cells.push(makeCell(row, 13, liaison.transportAllowance === '' || liaison.transportAllowance == null ? '' : Number(liaison.transportAllowance), STYLE.TABLE_NUMBER, liaison.transportAllowance === '' || liaison.transportAllowance == null ? null : 'number'));
      cells.push(makeCell(row, 14, liaison.weeklyHours === '' || liaison.weeklyHours == null ? '' : Number(liaison.weeklyHours), STYLE.TABLE_NUMBER, liaison.weeklyHours === '' || liaison.weeklyHours == null ? null : 'number'));
      cells.push(makeCell(row, 15, sent && !Number.isNaN(sent.getTime()) ? sent : '', sent && !Number.isNaN(sent.getTime()) ? STYLE.DATE : STYLE.TABLE_TEXT, sent && !Number.isNaN(sent.getTime()) ? 'date' : null));
      cells.push(makeCell(row, 16, completed && !Number.isNaN(completed.getTime()) ? completed : '', completed && !Number.isNaN(completed.getTime()) ? STYLE.DATE : STYLE.TABLE_TEXT, completed && !Number.isNaN(completed.getTime()) ? 'date' : null));
      cells.push(makeCell(row, 17, validated && !Number.isNaN(validated.getTime()) ? validated : '', validated && !Number.isNaN(validated.getTime()) ? STYLE.DATE : STYLE.TABLE_TEXT, validated && !Number.isNaN(validated.getTime()) ? 'date' : null));
      cells.push(makeCell(row, 18, liaison.note || '', STYLE.WRAP_TEXT));
      row += 1;
    });
    return {
      name: 'Liaisons intérim', cells,
      columns: [{ min: 1, width: 28 }, { min: 2, width: 18 }, { min: 3, max: 4, width: 14 }, { min: 5, width: 16 }, { min: 6, width: 30 }, { min: 7, width: 22 }, { min: 8, width: 16 }, { min: 9, max: 14, width: 14 }, { min: 15, max: 17, width: 15 }, { min: 18, width: 38 }],
      freeze: { ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' },
      autoFilter: `A1:R${Math.max(1, row - 1)}`,
      showGridLines: false, orientation: 'landscape', paperSize: 9,
      tabColor: 'FFFFD800'
    };
  }

  function makeRenewalsSheet(context) {
    const { people, allPeople, interimContracts } = context;
    const peopleById = new Map((allPeople || people).map(person => [person.id, person]));
    const cells = [];
    const headers = ['Intérimaire', 'Agence', 'N° contrat', 'Renouvellement', 'Début période', 'Nouvelle fin', 'Signé / reçu le', 'Référence avenant', 'Observation'];
    headers.forEach((header, index) => cells.push(makeCell(1, index + 1, header, STYLE.TABLE_HEADER)));
    let row = 2;
    (interimContracts || []).forEach(contract => {
      const person = peopleById.get(contract.personId);
      (contract.renewals || []).forEach((renewal, index) => {
        const start = parseIsoDate(renewal.startDate);
        const end = parseIsoDate(renewal.endDate);
        const signed = parseIsoDate(renewal.signedDate);
        cells.push(makeCell(row, 1, person?.name || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 2, contract.agency || person?.company || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 3, contract.contractNumber || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 4, index + 1, STYLE.TABLE_NUMBER, 'number'));
        cells.push(makeCell(row, 5, start || '', start ? STYLE.DATE : STYLE.TABLE_TEXT, start ? 'date' : null));
        cells.push(makeCell(row, 6, end || '', end ? STYLE.DATE : STYLE.TABLE_TEXT, end ? 'date' : null));
        cells.push(makeCell(row, 7, signed || '', signed ? STYLE.DATE : STYLE.TABLE_TEXT, signed ? 'date' : null));
        cells.push(makeCell(row, 8, renewal.reference || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 9, renewal.note || '', STYLE.WRAP_TEXT));
        row += 1;
      });
    });
    return {
      name: 'Avenants intérim', cells,
      columns: [{ min: 1, width: 28 }, { min: 2, width: 18 }, { min: 3, width: 17 }, { min: 4, width: 14 }, { min: 5, max: 7, width: 14 }, { min: 8, width: 20 }, { min: 9, width: 38 }],
      freeze: { ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' },
      autoFilter: `A1:I${Math.max(1, row - 1)}`,
      showGridLines: false, orientation: 'landscape', paperSize: 9,
      tabColor: 'FFBFBFBF'
    };
  }

  function makeTeamsSheet(context) {
    const { week, people, teams } = context;
    const peopleById = new Map(people.map(person => [person.id, person]));
    const roster = new Set(week.rosterIds || []);
    const cells = [];
    ['Équipe', 'Nom prénom', 'Type', 'Entreprise', 'Présent semaine'].forEach((header, index) => cells.push(makeCell(1, index + 1, header, STYLE.TABLE_HEADER)));
    let row = 2;
    (teams || []).forEach(team => {
      (team.memberIds || []).forEach(personId => {
        const person = peopleById.get(personId);
        if (!person) return;
        cells.push(makeCell(row, 1, team.name || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 2, person.name || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 3, person.type || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 4, person.company || '', STYLE.TABLE_TEXT));
        cells.push(makeCell(row, 5, roster.has(person.id) ? 'Oui' : 'Non', STYLE.TABLE_TEXT));
        row += 1;
      });
    });
    return {
      name: 'Équipes', cells,
      columns: [{ min: 1, width: 22 }, { min: 2, width: 28 }, { min: 3, width: 12 }, { min: 4, width: 18 }, { min: 5, width: 16 }],
      freeze: { ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft' },
      autoFilter: `A1:E${Math.max(1, row - 1)}`,
      showGridLines: false, orientation: 'portrait', paperSize: 9
    };
  }

  function crc32(bytes) {
    if (!crc32.table) {
      crc32.table = new Uint32Array(256);
      for (let n = 0; n < 256; n += 1) {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        crc32.table[n] = c >>> 0;
      }
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i += 1) crc = crc32.table[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, date.getFullYear());
    const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
    const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
    return { time, day };
  }

  function uint16(value) {
    return new Uint8Array([value & 0xFF, (value >>> 8) & 0xFF]);
  }

  function uint32(value) {
    return new Uint8Array([value & 0xFF, (value >>> 8) & 0xFF, (value >>> 16) & 0xFF, (value >>> 24) & 0xFF]);
  }

  function concatBytes(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    chunks.forEach(chunk => { output.set(chunk, offset); offset += chunk.length; });
    return output;
  }

  function zipStore(files) {
    const encoder = new TextEncoder();
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;
    const now = dosDateTime();
    Object.entries(files).forEach(([name, content]) => {
      const nameBytes = encoder.encode(name);
      const dataBytes = content instanceof Uint8Array ? content : encoder.encode(content);
      const crc = crc32(dataBytes);
      const localHeader = concatBytes([
        uint32(0x04034B50), uint16(20), uint16(0x0800), uint16(0), uint16(now.time), uint16(now.day),
        uint32(crc), uint32(dataBytes.length), uint32(dataBytes.length), uint16(nameBytes.length), uint16(0), nameBytes
      ]);
      localChunks.push(localHeader, dataBytes);
      const centralHeader = concatBytes([
        uint32(0x02014B50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(now.time), uint16(now.day),
        uint32(crc), uint32(dataBytes.length), uint32(dataBytes.length), uint16(nameBytes.length), uint16(0), uint16(0),
        uint16(0), uint16(0), uint32(0), uint32(offset), nameBytes
      ]);
      centralChunks.push(centralHeader);
      offset += localHeader.length + dataBytes.length;
    });
    const central = concatBytes(centralChunks);
    const end = concatBytes([
      uint32(0x06054B50), uint16(0), uint16(0), uint16(Object.keys(files).length), uint16(Object.keys(files).length),
      uint32(central.length), uint32(offset), uint16(0)
    ]);
    return new Blob([...localChunks, central, end], { type: MIME_XLSX });
  }

  function buildPackage(context) {
    const usedNames = new Set();
    const sheets = [];
    const pushSheet = sheet => {
      sheet.name = safeSheetName(sheet.name, usedNames);
      sheets.push(sheet);
    };
    pushSheet(makeSummarySheet(context));
    pushSheet(makeIbatSummarySheet(context));
    pushSheet(makeIbatDetailSheet(context));
    pushSheet(makeVentilationSheet(context));
    pushSheet(makeTaskSummarySheet(context));
    pushSheet(makePointageSummarySheet(context, 'GCC'));
    pushSheet(makePointageSummarySheet(context, 'Intérim'));
    if (context.people.some(isLoan)) pushSheet(makePointageSummarySheet(context, 'Prêt de MO'));
    pushSheet(makeContractsSheet(context));
    pushSheet(makeLiaisonsSheet(context));
    pushSheet(makeRenewalsSheet(context));
    pushSheet(makeInterimEditionSheet(context));
    context.people.filter(isInterim).forEach((person, index) => pushSheet(makeIndividualInterimSheet(context, person, index)));
    pushSheet(makeDetailsSheet(context));
    pushSheet(makeAbsencesSheet(context));
    pushSheet(makeLatesSheet(context));
    pushSheet(makeTeamsSheet(context));

    const workbookSheets = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
    const workbookRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
    const sheetOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    const titles = sheets.map(sheet => `<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`).join('');
    const definedNames = sheets.flatMap((sheet, index) => {
      const escapedName = sheet.name.replaceAll("'", "''");
      const names = [];
      if (sheet.printArea) names.push(`<definedName name="_xlnm.Print_Area" localSheetId="${index}" hidden="1">'${escapeXml(escapedName)}'!$${sheet.printArea.replace(':', ':$').replace(/([A-Z]+)(\d+)/g, '$1$$$2')}</definedName>`);
      if (sheet.repeatRows) names.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${index}" hidden="1">'${escapeXml(escapedName)}'!$${sheet.repeatRows.replace(':', ':$')}</definedName>`);
      return names;
    }).join('');
    const files = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="15000" activeTab="0"/></bookViews><sheets>${workbookSheets}</sheets>${definedNames ? `<definedNames>${definedNames}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml': stylesXml(),
      'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Pointages ${escapeXml(context.project.name || '')}</dc:title><dc:subject>Semaine ${context.weekInfo.week} ${context.weekInfo.year}</dc:subject><dc:creator>GCC Auvergne</dc:creator><cp:lastModifiedBy>Application Pointages GCC</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`,
      'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Pointages GCC</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Feuilles de calcul</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts><Company>GCC Auvergne</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.14.3</AppVersion></Properties>`
    };
    sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = worksheetXml(sheet); });
    return { blob: zipStore(files), sheetCount: sheets.length, interimSheetCount: context.people.filter(isInterim).length };
  }

  function buildIbatPackage(context) {
    const usedNames = new Set();
    const sheets = [makeIbatSummarySheet(context), makeIbatDetailSheet(context)];
    sheets.forEach(sheet => { sheet.name = safeSheetName(sheet.name, usedNames); });

    const workbookSheets = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
    const workbookRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
    const sheetOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');
    const titles = sheets.map(sheet => `<vt:lpstr>${escapeXml(sheet.name)}</vt:lpstr>`).join('');
    const definedNames = sheets.flatMap((sheet, index) => {
      const escapedName = sheet.name.replaceAll("'", "''");
      const names = [];
      if (sheet.printArea) names.push(`<definedName name="_xlnm.Print_Area" localSheetId="${index}" hidden="1">'${escapeXml(escapedName)}'!$${sheet.printArea.replace(':', ':$').replace(/([A-Z]+)(\d+)/g, '$1$$$2')}</definedName>`);
      if (sheet.repeatRows) names.push(`<definedName name="_xlnm.Print_Titles" localSheetId="${index}" hidden="1">'${escapeXml(escapedName)}'!$${sheet.repeatRows.replace(':', ':$')}</definedName>`);
      return names;
    }).join('');
    const files = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="24000" windowHeight="15000" activeTab="0"/></bookViews><sheets>${workbookSheets}</sheets>${definedNames ? `<definedNames>${definedNames}</definedNames>` : ''}<calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml': stylesXml(),
      'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Saisie iBAT ${escapeXml(context.project.name || '')}</dc:title><dc:subject>Semaine ${context.weekInfo.week} ${context.weekInfo.year}</dc:subject><dc:creator>GCC Auvergne</dc:creator><cp:lastModifiedBy>Application Pointages GCC</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`,
      'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Pointages GCC</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop><HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Feuilles de calcul</vt:lpstr></vt:variant><vt:variant><vt:i4>${sheets.length}</vt:i4></vt:variant></vt:vector></HeadingPairs><TitlesOfParts><vt:vector size="${sheets.length}" baseType="lpstr">${titles}</vt:vector></TitlesOfParts><Company>GCC Auvergne</Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.14.3</AppVersion></Properties>`
    };
    sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = worksheetXml(sheet); });
    return { blob: zipStore(files), sheetCount: sheets.length, interimSheetCount: 0 };
  }

  function slug(value) {
    return String(value || 'export')
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function normalizeExportContext(context) {
    return {
      project: context.project || {},
      weekInfo: context.weekInfo || {},
      week: context.week || { entries: [], absences: [], lates: [], rosterIds: [] },
      people: Array.isArray(context.people) ? context.people : [],
      allPeople: Array.isArray(context.allPeople) ? context.allPeople : (Array.isArray(context.people) ? context.people : []),
      tasks: Array.isArray(context.tasks) ? context.tasks : [],
      teams: Array.isArray(context.teams) ? context.teams : [],
      interimContracts: Array.isArray(context.interimContracts) ? context.interimContracts : [],
      contractRules: context.contractRules || { maxRenewals: 2, maxDurationMonths: 18, alertDays: [21, 14, 7, 2], arrivalAlertDays: [7, 2], carenceMode: 'standard' },
      integration: context.integration || { mode: 'local' }
    };
  }

  function exportWorkbook(context) {
    const normalizedContext = normalizeExportContext(context);
    const output = buildPackage(normalizedContext);
    output.filename = `Pointages_${slug(normalizedContext.project.name)}_S${normalizedContext.weekInfo.week}_${normalizedContext.weekInfo.year}.xlsx`;
    return output;
  }

  function exportIbatWorkbook(context) {
    const normalizedContext = normalizeExportContext(context);
    const output = buildIbatPackage(normalizedContext);
    output.filename = `Saisie_iBAT_${slug(normalizedContext.project.name)}_S${normalizedContext.weekInfo.week}_${normalizedContext.weekInfo.year}.xlsx`;
    return output;
  }

  window.GCCExcelExporter = { exportWorkbook, exportIbatWorkbook };
})();
