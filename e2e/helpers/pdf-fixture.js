function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Generates a minimal valid multi-page PDF 1.4 buffer with real Helvetica text
 * on each page (and optional internal /Link annotations) so PDF.js renders
 * canvases, selectable text layers, and interactive link annotations.
 */
export function createTestPdf(
  pageTexts = ['Page 1 sample text', 'Page 2 sample text', 'Page 3 sample text'],
  options = {}
) {
  const { links = [] } = options;
  const objects = [];
  const addObj = body => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObj(''); // placeholder 1
  const pagesId = addObj('');   // placeholder 2
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  // Pre-allocate page object IDs so link annotations can reference target pages.
  const pageIds = pageTexts.map(() => addObj(''));

  for (let idx = 0; idx < pageTexts.length; idx++) {
    const entry = pageTexts[idx];
    const lines = Array.isArray(entry)
      ? entry
      : [{ text: entry, x: 72, y: 720 }];
    const stream = lines
      .map(line => `BT /F1 ${line.size ?? 18} Tf ${line.x ?? 72} ${line.y ?? 720} Td (${escapePdfText(line.text)}) Tj ET`)
      .join('\n');
    const contentId = addObj(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);

    const pageLinks = links.filter(link => link.fromPage === idx + 1);
    const annotIds = pageLinks.map(link => {
      const [x1, y1, x2, y2] = link.rect || [72, 700, 280, 745];
      if (link.url) {
        return addObj(
          `<< /Type /Annot /Subtype /Link /Rect [${x1} ${y1} ${x2} ${y2}] /Border [0 0 0] /A << /Type /Action /S /URI /URI (${escapePdfText(link.url)}) >> >>`
        );
      }
      const targetPageId = pageIds[link.toPage - 1];
      const dest = link.destY != null
        ? `[${targetPageId} 0 R /XYZ ${link.destX ?? 72} ${link.destY} null]`
        : `[${targetPageId} 0 R /Fit]`;
      return addObj(
        `<< /Type /Annot /Subtype /Link /Rect [${x1} ${y1} ${x2} ${y2}] /Border [0 0 0] /Dest ${dest} >>`
      );
    });

    const annotsEntry = annotIds.length
      ? ` /Annots [${annotIds.map(id => `${id} 0 R`).join(' ')}]`
      : '';
    objects[pageIds[idx] - 1] =
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R${annotsEntry} >>`;
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  const chunks = ['%PDF-1.4\n'];
  const offsets = [0];
  let byteOffset = Buffer.byteLength(chunks[0], 'utf8');

  for (let i = 0; i < objects.length; i++) {
    offsets.push(byteOffset);
    const entry = `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
    chunks.push(entry);
    byteOffset += Buffer.byteLength(entry, 'utf8');
  }

  const xrefOffset = byteOffset;
  chunks.push(`xref\n0 ${objects.length + 1}\n`);
  chunks.push('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i++) {
    chunks.push(`${String(offsets[i]).padStart(10, '0')} 00000 n \n`);
  }
  chunks.push(
    `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  return Buffer.from(chunks.join(''), 'utf8');
}
