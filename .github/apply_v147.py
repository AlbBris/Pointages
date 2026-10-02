from pathlib import Path
import re

p = Path('js/excel-export.js')
s = p.read_text(encoding='utf-8')
s = s.replace('function worksheetXml(sheet) {', 'function worksheetXml(sheet, options = {}) {\n    const excelSafe = Boolean(options.excelSafe);')
s = s.replace("    const autoFilter = sheet.autoFilter ? `<autoFilter ref=\"${sheet.autoFilter}\"/>` : '';", "    const autoFilter = !excelSafe && sheet.autoFilter ? `<autoFilter ref=\"${sheet.autoFilter}\"/>` : '';")
s = s.replace("    const headerFooter = sheet.headerFooter\n      ? `<headerFooter><oddHeader>${escapeXml(sheet.headerFooter.header || '')}</oddHeader><oddFooter>${escapeXml(sheet.headerFooter.footer || '')}</oddFooter></headerFooter>`\n      : '';", "    const headerFooter = !excelSafe && sheet.headerFooter\n      ? `<headerFooter><oddHeader>${escapeXml(sheet.headerFooter.header || '')}</oddHeader><oddFooter>${escapeXml(sheet.headerFooter.footer || '')}</oddFooter></headerFooter>`\n      : '';")

old = '''  <sheetPr>${tabColor}<pageSetUpPr fitToPage="1" autoPageBreaks="0"/></sheetPr>\n  <dimension ref="A1:${cellRef(maxRow, maxCol)}"/>\n  <sheetViews><sheetView workbookViewId="0" showGridLines="${sheet.showGridLines === false ? 0 : 1}">${freeze}</sheetView></sheetViews>\n  <sheetFormatPr defaultRowHeight="15"/>\n  ${colsXml}\n  <sheetData>${rowXml}</sheetData>\n  ${autoFilter}${merges}\n  <printOptions horizontalCentered="1" verticalCentered="0"/>\n  <pageMargins left="${margins.left}" right="${margins.right}" top="${margins.top}" bottom="${margins.bottom}" header="${margins.header}" footer="${margins.footer}"/>\n  <pageSetup paperSize="${paperSize}" orientation="${orientation}" fitToWidth="1" fitToHeight="${fitToHeight}" horizontalDpi="300" verticalDpi="300"/>\n  ${headerFooter}\n</worksheet>`;'''
new = '''  <sheetPr>${tabColor}${excelSafe ? '' : '<pageSetUpPr fitToPage="1" autoPageBreaks="0"/>'}</sheetPr>\n  ${excelSafe ? '' : `<dimension ref="A1:${cellRef(maxRow, maxCol)}"/>`}\n  <sheetViews><sheetView workbookViewId="0" showGridLines="${sheet.showGridLines === false ? 0 : 1}">${freeze}</sheetView></sheetViews>\n  <sheetFormatPr defaultRowHeight="15"/>\n  ${colsXml}\n  <sheetData>${rowXml}</sheetData>\n  ${autoFilter}${merges}\n  ${excelSafe ? '' : '<printOptions horizontalCentered="1" verticalCentered="0"/>'}\n  <pageMargins left="${excelSafe ? 0.7 : margins.left}" right="${excelSafe ? 0.7 : margins.right}" top="${excelSafe ? 0.75 : margins.top}" bottom="${excelSafe ? 0.75 : margins.bottom}" header="${excelSafe ? 0.3 : margins.header}" footer="${excelSafe ? 0.3 : margins.footer}"/>\n  ${excelSafe ? '' : `<pageSetup paperSize="${paperSize}" orientation="${orientation}" fitToWidth="1" fitToHeight="${fitToHeight}" horizontalDpi="300" verticalDpi="300"/>`}\n  ${headerFooter}\n</worksheet>`;'''
if old not in s:
    raise SystemExit('Bloc worksheet attendu introuvable')
s = s.replace(old, new)

replacement = r'''  function buildIbatPackage(context) {
    // Structure OOXML volontairement minimale pour une compatibilité Excel maximale.
    // Les données, styles et formules sont conservés ; les métadonnées, zones
    // d'impression et réglages avancés non indispensables sont écartés.
    const usedNames = new Set();
    const sheets = [makeIbatSummarySheet(context), makeIbatDetailSheet(context)];
    sheets.forEach(sheet => { sheet.name = safeSheetName(sheet.name, usedNames); });

    const workbookSheets = sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('');
    const workbookRels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('');
    const sheetOverrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('');

    const files = {
      '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheetOverrides}</Types>`,
      '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
      'xl/styles.xml': stylesXml()
    };
    sheets.forEach((sheet, index) => { files[`xl/worksheets/sheet${index + 1}.xml`] = worksheetXml(sheet, { excelSafe: true }); });
    return { blob: zipStore(files), sheetCount: sheets.length, interimSheetCount: 0 };
  }
'''
pattern = r'  function buildIbatPackage\(context\) \{.*?\n  \}\n\n  function slug\(value\)'
s, count = re.subn(pattern, replacement + '\n  function slug(value)', s, count=1, flags=re.S)
if count != 1:
    raise SystemExit('buildIbatPackage attendu introuvable')
p.write_text(s, encoding='utf-8')

p = Path('index.html')
s = p.read_text(encoding='utf-8').replace('V1.14.6', 'V1.14.7')
p.write_text(s, encoding='utf-8')

p = Path('sw.js')
s = p.read_text(encoding='utf-8').replace('pointages-gcc-v1.14.6-excel-safe', 'pointages-gcc-v1.14.7-excel-safe-minimal')
p.write_text(s, encoding='utf-8')
