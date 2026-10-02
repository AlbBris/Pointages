from pathlib import Path

p=Path('index.html')
s=p.read_text(encoding='utf-8')
s=s.replace('<span>V1.14.7</span>', '<span>V1.14.8</span>')
s=s.replace('  <script src="js/seed-data.js"></script>\n  <script src="js/excel-export.js"></script>', '  <script src="js/seed-data.js"></script>\n  <script src="vendor/exceljs.min.js"></script>\n  <script src="js/excel-export.js"></script>')
p.write_text(s,encoding='utf-8')

p=Path('sw.js')
s=p.read_text(encoding='utf-8')
s=s.replace('pointages-gcc-v1.14.7-excel-safe-minimal','pointages-gcc-v1.14.8-exceljs')
s=s.replace("'./manifest.webmanifest'", "'./vendor/exceljs.min.js', './manifest.webmanifest'")
p.write_text(s,encoding='utf-8')

p=Path('js/app.js')
s=p.read_text(encoding='utf-8')
s=s.replace('  function createIbatExport() {', '  async function createIbatExport() {')
s=s.replace('    return window.GCCExcelExporter.exportIbatWorkbook(buildExportContext());', '    return await window.GCCExcelExporter.exportIbatWorkbook(buildExportContext());', 1)
s=s.replace('  function exportIbatWorkbook() {\n    try {\n      const output = createIbatExport();', '  async function exportIbatWorkbook() {\n    try {\n      const output = await createIbatExport();')
s=s.replace('      const output = createIbatExport();\n      if (!output) return;', '      const output = await createIbatExport();\n      if (!output) return;', 1)
p.write_text(s,encoding='utf-8')

p=Path('js/excel-export.js')
s=p.read_text(encoding='utf-8')
start=s.index('  function buildIbatPackage(context) {')
end=s.index('\n  function slug(value)', start)
replacement=r'''  function excelJsBorder(style = 'thin', color = 'FF7F7F7F') {
    return {
      top: { style, color: { argb: color } },
      bottom: { style, color: { argb: color } },
      left: { style, color: { argb: color } },
      right: { style, color: { argb: color } }
    };
  }

  function excelJsStyle(styleId) {
    const baseFont = { name: 'Arial', size: 10 };
    const thin = excelJsBorder('thin', 'FF7F7F7F');
    const medium = excelJsBorder('medium', 'FF000000');
    const styles = {
      [STYLE.TITLE]: { font: { ...baseFont, size: 16, bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD600' } }, border: medium, alignment: { horizontal: 'center', vertical: 'middle' } },
      [STYLE.META_LABEL]: { font: { ...baseFont, bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD600' } }, border: thin, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } },
      [STYLE.META_VALUE]: { font: { ...baseFont, bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }, border: thin, alignment: { horizontal: 'left', vertical: 'middle', wrapText: true } },
      [STYLE.TABLE_HEADER]: { font: { ...baseFont, bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } }, border: thin, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } },
      [STYLE.BODY_TEXT_BLUE]: { font: baseFont, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } }, border: thin, alignment: { horizontal: 'left', vertical: 'middle', wrapText: true } },
      [STYLE.BODY_NUMBER_BLUE]: { font: baseFont, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } }, border: thin, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' },
      [STYLE.BODY_TEXT_GCC]: { font: baseFont, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8D6' } }, border: thin, alignment: { horizontal: 'left', vertical: 'middle', wrapText: true } },
      [STYLE.BODY_NUMBER_GCC]: { font: baseFont, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8D6' } }, border: thin, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' },
      [STYLE.SUBTOTAL_GCC]: { font: { ...baseFont, bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF8D6' } }, border: { top: { style: 'medium', color: { argb: 'FF000000' } }, bottom: { style: 'medium', color: { argb: 'FF000000' } }, left: { style: 'thin', color: { argb: 'FF7F7F7F' } }, right: { style: 'thin', color: { argb: 'FF7F7F7F' } } }, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' },
      [STYLE.SUBTOTAL_INTERIM]: { font: { ...baseFont, bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } }, border: { top: { style: 'medium', color: { argb: 'FF000000' } }, bottom: { style: 'medium', color: { argb: 'FF000000' } }, left: { style: 'thin', color: { argb: 'FF7F7F7F' } }, right: { style: 'thin', color: { argb: 'FF7F7F7F' } } }, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' },
      [STYLE.TABLE_TEXT]: { font: baseFont, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }, border: thin, alignment: { horizontal: 'left', vertical: 'middle', wrapText: true } },
      [STYLE.TABLE_NUMBER]: { font: baseFont, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }, border: thin, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' },
      [STYLE.WRAP_TEXT]: { font: { name: 'Arial', size: 9 }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }, border: thin, alignment: { horizontal: 'left', vertical: 'top', wrapText: true } },
      [STYLE.DATE]: { font: baseFont, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFFF' } }, border: thin, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: 'dd/mm/yyyy' },
      [STYLE.ABSENCE]: { font: { ...baseFont, bold: true, color: { argb: 'FF7A3D00' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE5CC' } }, border: thin, alignment: { horizontal: 'center', vertical: 'middle', wrapText: true } },
      [STYLE.HOURS_ALERT]: { font: { ...baseFont, bold: true }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4CCCC' } }, border: thin, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' },
      [STYLE.TOTAL_STRONG]: { font: { name: 'Arial', size: 12, bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } }, border: medium, alignment: { horizontal: 'center', vertical: 'middle' }, numFmt: '0.00' }
    };
    return styles[styleId] || { font: baseFont };
  }

  function applyExcelJsStyle(cell, styleId) {
    const style = excelJsStyle(styleId);
    if (style.font) cell.font = style.font;
    if (style.fill) cell.fill = style.fill;
    if (style.border) cell.border = style.border;
    if (style.alignment) cell.alignment = style.alignment;
    if (style.numFmt) cell.numFmt = style.numFmt;
  }

  function addModelSheetToExcelJs(workbook, model) {
    const worksheet = workbook.addWorksheet(model.name, {
      views: [{ showGridLines: model.showGridLines !== false }],
      properties: model.tabColor ? { tabColor: { argb: model.tabColor } } : undefined
    });
    (model.columns || []).forEach(column => {
      const max = column.max || column.min;
      for (let col = column.min; col <= max; col += 1) worksheet.getColumn(col).width = column.width;
    });
    (model.cells || []).forEach(item => {
      const cell = worksheet.getCell(item.row, item.col);
      if (item.formula) cell.value = { formula: item.formula, result: Number.isFinite(Number(item.value)) ? Number(item.value) : 0 };
      else if (item.type === 'date' && item.value instanceof Date) cell.value = new Date(item.value.getTime());
      else cell.value = item.value === undefined || item.value === null ? '' : item.value;
      applyExcelJsStyle(cell, item.style || 0);
    });
    Object.entries(model.rowHeights || {}).forEach(([row, height]) => { worksheet.getRow(Number(row)).height = Number(height); });
    (model.merges || []).forEach(ref => worksheet.mergeCells(ref));
    if (model.autoFilter) worksheet.autoFilter = model.autoFilter;
    if (model.freeze) worksheet.views = [{ state: 'frozen', xSplit: Number(model.freeze.xSplit || 0), ySplit: Number(model.freeze.ySplit || 0), topLeftCell: model.freeze.topLeftCell || undefined, showGridLines: model.showGridLines !== false }];
    return worksheet;
  }

  async function buildIbatPackage(context) {
    if (!window.ExcelJS?.Workbook) throw new Error('ExcelJS indisponible');
    const workbook = new window.ExcelJS.Workbook();
    workbook.creator = 'Pointages GCC';
    workbook.lastModifiedBy = 'Pointages GCC';
    workbook.created = new Date();
    workbook.modified = new Date();
    workbook.company = 'GCC Auvergne';
    workbook.calcProperties.fullCalcOnLoad = true;
    const sheets = [makeIbatSummarySheet(context), makeIbatDetailSheet(context)];
    sheets.forEach(model => addModelSheetToExcelJs(workbook, model));
    const bytes = await workbook.xlsx.writeBuffer();
    return { blob: new Blob([bytes], { type: MIME_XLSX }), sheetCount: sheets.length, interimSheetCount: 0 };
  }
'''
s=s[:start]+replacement+s[end:]
s=s.replace('  function exportIbatWorkbook(context) {\n    const normalizedContext = normalizeExportContext(context);\n    const output = buildIbatPackage(normalizedContext);\n    output.filename = `Saisie_iBAT_${slug(normalizedContext.project.name)}_S${normalizedContext.weekInfo.week}_${normalizedContext.weekInfo.year}.xlsx`;\n    return output;\n  }', '  async function exportIbatWorkbook(context) {\n    const normalizedContext = normalizeExportContext(context);\n    const output = await buildIbatPackage(normalizedContext);\n    output.filename = `Saisie_iBAT_${slug(normalizedContext.project.name)}_S${normalizedContext.weekInfo.week}_${normalizedContext.weekInfo.year}.xlsx`;\n    return output;\n  }')
p.write_text(s,encoding='utf-8')
