/* Minimal PDF writer (no packages). Produces plain, searchable A4 PDFs using the built-in Helvetica font.
   - tablePdf(): a titled report with a table that paginates automatically
   - documentPdf(): receipts / invoices (heading, key-value lines, optional table)            */

const REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

const A4 = { portrait: [595.28, 841.89], landscape: [841.89, 595.28] };

function width(text, size, bold) {
  const table = bold ? BOLD : REG;
  let total = 0;
  for (const ch of String(text)) {
    const code = ch.charCodeAt(0);
    total += code >= 32 && code <= 126 ? table[code - 32] : 556;
  }
  return (total * size) / 1000;
}

// Keep text printable in the standard Latin font
function safe(value) {
  return String(value ?? "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2192]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[^\x20-\x7E]/g, "?");
}

const escapeText = (s) => s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");

function wrap(text, maxWidth, size, bold) {
  const words = safe(text).split(" ");
  const lines = [];
  let line = "";

  for (const word of words) {
    let w = word;
    // break a single very long word
    while (width(w, size, bold) > maxWidth && w.length > 1) {
      let cut = w.length - 1;
      while (cut > 1 && width(w.slice(0, cut), size, bold) > maxWidth) cut -= 1;
      if (line) { lines.push(line); line = ""; }
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const test = line ? `${line} ${w}` : w;
    if (width(test, size, bold) <= maxWidth) line = test;
    else { if (line) lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

class Doc {
  constructor(orientation = "portrait") {
    [this.w, this.h] = A4[orientation];
    this.margin = 40;
    this.pages = [];
    this.footer = "";
    this.newPage();
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = this.h - this.margin;
  }

  text(x, y, str, size = 10, bold = false, color = [0, 0, 0]) {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${color.join(" ")} rg ${x.toFixed(2)} ${y.toFixed(2)} Td (${escapeText(safe(str))}) Tj ET`);
  }

  rect(x, y, w, h, fill) {
    this.ops.push(`${fill.join(" ")} rg ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f`);
  }

  line(x1, y1, x2, y2, color = [0.8, 0.8, 0.8]) {
    this.ops.push(`${color.join(" ")} RG 0.5 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  ensure(space) {
    if (this.y - space < this.margin + 20) {
      this.newPage();
      return true;
    }
    return false;
  }

  build() {
    const objects = [];
    const add = (body) => { objects.push(body); return objects.length; };

    const catalog = add(null);
    const pagesRoot = add(null);
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const pageIds = [];

    this.pages.forEach((ops, index) => {
      const footer = `BT /F1 8 Tf 0.4 0.4 0.4 rg ${this.margin} 24 Td (${escapeText(safe(this.footer))}) Tj ET ` +
                     `BT /F1 8 Tf 0.4 0.4 0.4 rg ${(this.w - this.margin - 60).toFixed(2)} 24 Td (Page ${index + 1} of ${this.pages.length}) Tj ET`;
      const stream = ops.join("\n") + "\n" + footer;
      const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
      const pageId = add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${this.w} ${this.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${contentId} 0 R >>`);
      pageIds.push(pageId);
    });

    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
    objects[pagesRoot - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

    let out = "%PDF-1.4\n";
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(Buffer.byteLength(out, "latin1"));
      out += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });

    const xref = Buffer.byteLength(out, "latin1");
    out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.forEach((o) => { out += `${String(o).padStart(10, "0")} 00000 n \n`; });
    out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

    return Buffer.from(out, "latin1");
  }
}

const TEAL = [0.055, 0.435, 0.412];

function heading(doc, title, subtitle) {
  doc.rect(0, doc.h - 70, doc.w, 70, TEAL);
  doc.text(doc.margin, doc.h - 38, "Hostel Management System", 11, false, [1, 1, 1]);
  doc.text(doc.margin, doc.h - 58, title, 17, true, [1, 1, 1]);
  doc.y = doc.h - 95;
  if (subtitle) {
    doc.text(doc.margin, doc.y, subtitle, 9, false, [0.35, 0.35, 0.35]);
    doc.y -= 18;
  }
}

/* columns: [{ key, label, width? (relative), align? }] */
function drawTable(doc, columns, rows, { size = 8.5 } = {}) {
  const usable = doc.w - doc.margin * 2;
  const totalWeight = columns.reduce((s, c) => s + (c.width || 1), 0);
  const cols = columns.map((c) => ({ ...c, px: (usable * (c.width || 1)) / totalWeight }));
  const pad = 4;
  const lineHeight = size + 3;

  const header = () => {
    doc.ensure(24);
    doc.rect(doc.margin, doc.y - 16, usable, 20, [0.91, 0.95, 0.94]);
    let x = doc.margin;
    cols.forEach((c) => {
      doc.text(c.align === "right" ? x + c.px - pad - width(c.label, size, true) : x + pad, doc.y - 10, c.label, size, true, [0.1, 0.25, 0.28]);
      x += c.px;
    });
    doc.y -= 20;
  };

  header();

  rows.forEach((row, rowIndex) => {
    const wrapped = cols.map((c) => wrap(row[c.key] ?? "", c.px - pad * 2, size, false));
    const height = Math.max(...wrapped.map((l) => l.length)) * lineHeight + 4;

    if (doc.ensure(height + 4)) header();

    if (rowIndex % 2 === 1) doc.rect(doc.margin, doc.y - height + 2, usable, height, [0.975, 0.98, 0.98]);

    let x = doc.margin;
    cols.forEach((c, ci) => {
      wrapped[ci].forEach((text, li) => {
        const tx = c.align === "right" ? x + c.px - pad - width(text, size, false) : x + pad;
        doc.text(tx, doc.y - 8 - li * lineHeight, text, size);
      });
      x += c.px;
    });

    doc.y -= height;
    doc.line(doc.margin, doc.y + 2, doc.margin + usable, doc.y + 2, [0.88, 0.9, 0.9]);
  });

  if (!rows.length) {
    doc.text(doc.margin + pad, doc.y - 12, "No records found.", size, false, [0.4, 0.4, 0.4]);
    doc.y -= 22;
  }
}

function tablePdf({ title, subtitle, columns, rows, summary, orientation }) {
  const doc = new Doc(orientation || (columns.length > 6 ? "landscape" : "portrait"));
  doc.footer = `${title} - generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  heading(doc, title, subtitle);

  (summary || []).forEach((s) => {
    doc.ensure(16);
    doc.text(doc.margin, doc.y, `${s.label}: `, 9.5, true);
    doc.text(doc.margin + width(`${s.label}: `, 9.5, true) + 2, doc.y, String(s.value), 9.5);
    doc.y -= 14;
  });
  if (summary && summary.length) doc.y -= 6;

  drawTable(doc, columns, rows);
  return doc.build();
}

/* lines: [{ label, value }], optional table: { columns, rows }, optional notes: [string] */
function documentPdf({ title, subtitle, lines, table, notes }) {
  const doc = new Doc("portrait");
  doc.footer = `${title} - Hostel Management System`;
  heading(doc, title, subtitle);

  const labelWidth = 150;
  (lines || []).forEach((l) => {
    const wrapped = wrap(l.value ?? "", doc.w - doc.margin * 2 - labelWidth, 10.5, !!l.bold);
    doc.ensure(wrapped.length * 15 + 4);
    doc.text(doc.margin, doc.y, l.label, 10, true, [0.35, 0.35, 0.35]);
    wrapped.forEach((t, i) => doc.text(doc.margin + labelWidth, doc.y - i * 14, t, 10.5, !!l.bold));
    doc.y -= wrapped.length * 14 + 6;
  });

  if (table) {
    doc.y -= 8;
    drawTable(doc, table.columns, table.rows, { size: 9.5 });
  }

  (notes || []).forEach((n) => {
    doc.y -= 10;
    wrap(n, doc.w - doc.margin * 2, 9, false).forEach((t) => {
      doc.ensure(14);
      doc.text(doc.margin, doc.y, t, 9, false, [0.35, 0.35, 0.35]);
      doc.y -= 12;
    });
  });

  return doc.build();
}

module.exports = { tablePdf, documentPdf };
