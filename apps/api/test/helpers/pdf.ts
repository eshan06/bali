import { createHash, randomBytes } from 'node:crypto';

/*
 * Real PDFs for the deck check (M2b), written byte by byte so each test names what is in its file:
 * blank pages, an /Encrypt in the trailer, and the hostile shapes built from them.
 */

const latin1 = (text: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(Buffer.from(text, 'latin1'));

/** A PDF of `pages` blank pages; `trailer` added to its trailer, `extra` objects after the pages. */
export function pdf(
  pages = 1,
  { trailer = '', extra = [] as string[] } = {},
): Uint8Array<ArrayBuffer> {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 3} 0 R`).join(' ');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`,
    ...Array.from(
      { length: pages },
      () => '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    ),
    ...extra,
  ];
  let file = '%PDF-1.7\n';
  const offsets = objects.map((body, i) => {
    const offset = file.length;
    file += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${trailer} >>\n`;
  return latin1(`${file}startxref\n${xref}\n%%EOF\n`);
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/**
 * A one-page PDF encrypted with AES-256 (revision 5): a password needed to open it, or, `open`,
 * only an owner's, so any reader opens it with none (its /U is the empty password's hash).
 */
export function encryptedPdf(open: boolean): Uint8Array<ArrayBuffer> {
  const [salt, keySalt] = [randomBytes(8), randomBytes(8)];
  const u = open
    ? Buffer.concat([createHash('sha256').update(salt).digest(), salt, keySalt])
    : randomBytes(48);
  const encrypt = `<< /Filter /Standard /V 5 /R 5 /Length 256 /P -1028 /O <${hex(randomBytes(48))}> /U <${hex(u)}> /OE <${hex(randomBytes(32))}> /UE <${hex(randomBytes(32))}> /Perms <${hex(randomBytes(16))}> >>`;
  // Its /Encrypt is object 4: the catalog, the pages and the one page come first.
  return pdf(1, { trailer: '/Encrypt 4 0 R', extra: [encrypt] });
}

/** `bytes` with its first occurrence of `from` written as `to`, a byte for a byte. */
export function swapped(bytes: Uint8Array, from: string, to: string): Uint8Array<ArrayBuffer> {
  return latin1(Buffer.from(bytes).toString('latin1').replace(from, to));
}
