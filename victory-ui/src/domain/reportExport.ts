import type { reportMatrix } from './reportEngine';

type Matrix = ReturnType<typeof reportMatrix>;
function save(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function createReportWorkbook(matrix: Matrix) {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Time report');
  sheet.addRow(matrix.columns.map(c => c.header));
  matrix.values.forEach((values, index) => {
    const row = sheet.addRow(values);
    if (matrix.rows[index]?.group) { row.font = { bold: true }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EEF5' } }; }
    row.outlineLevel = Math.min(matrix.rows[index]?.depth ?? 0, 7);
  });
  matrix.columns.forEach((column, index) => { const target = sheet.getColumn(index + 1); target.width = column.field === 'notes' || column.field === 'label' ? 48 : column.numeric ? 15 : 26; if (column.numeric) target.numFmt = column.field === 'entries' ? '0' : '0.00'; target.alignment = { vertical: 'top', wrapText: true }; });
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }; sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F99' } };
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  return workbook;
}
export async function reportExcel(matrix: Matrix, filename: string): Promise<void> {
  const workbook = await createReportWorkbook(matrix);
  const bytes = await workbook.xlsx.writeBuffer();
  save(new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename);
}
export async function createReportPdf(matrix: Matrix, title: string) {
  if (matrix.values.length > 5000) throw new Error('For PDF, narrow the report to 5,000 rows. CSV and Excel support the full report.');
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape', format: 'a3' });
  doc.setFontSize(14); doc.text(title, 12, 13);
  autoTable(doc, { head: [matrix.columns.map(c => c.header)], body: matrix.values.map(row => row.map(String)), startY: 20, margin: 12,
    horizontalPageBreak: true, horizontalPageBreakRepeat: 0,
    columnStyles: Object.fromEntries(matrix.columns.map((column, index) => [index, { cellWidth: column.field === 'notes' ? 65 : column.field === 'label' ? 55 : column.field === 'task' ? 50 : column.field === 'date' ? 25 : column.field === 'billable' ? 20 : column.numeric ? 22 : 35, halign: column.numeric ? 'right' : 'left' }])),
    styles: { fontSize: 8, cellPadding: 2, overflow: 'linebreak' }, headStyles: { fillColor: [31, 95, 153] },
    didParseCell: data => { if (data.section === 'body' && matrix.rows[data.row.index]?.group) { data.cell.styles.fontStyle = 'bold'; data.cell.styles.fillColor = [232, 238, 245]; } },
    didDrawPage: () => { doc.setFontSize(8); doc.text(`Page ${doc.getNumberOfPages()}`, 12, doc.internal.pageSize.getHeight() - 5); },
  });
  return doc;
}
export async function reportPdf(matrix: Matrix, filename: string, title: string): Promise<void> {
  const doc = await createReportPdf(matrix, title);
  doc.save(filename);
}
