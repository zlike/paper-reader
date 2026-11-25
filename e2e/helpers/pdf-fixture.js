function escapePdfText(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

/**
 * Generates a minimal valid multi-page PDF 1.4 buffer with real Helvetica text
 * on each page so PDF.js renders both canvases and selectable text layers.
 */
export function createTestPdf(pageTexts = ['Page 1 sample text', 'Page 2 sample text', 'Page 3 sample text']) {
  const objects = [];
  const addObj = body => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObj(''); // placeholder 1
  const pagesId = addObj('');   // placeholder 2
  const fontId = addObj('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  const pageIds = [];
  for (const text of pageTexts) {
    const stream = `BT /F1 18 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
    const contentId = addObj(`<< /Length ${Buffer.byteLength(stream, 'utf8')} >>\nstream\n${stream}\nendstream`);
    const pageId = addObj(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    pageIds.push(pageId);
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
