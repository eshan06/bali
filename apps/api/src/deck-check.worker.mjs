// A deck's PDF parsed in a thread of its own (Phase 7, M2b; ARCHITECTURE, "Live lesson", decision
// 6 and Settled): the API's check runs it under a hard time limit and a heap of its own, so a hostile
// file can stall or exhaust only this thread, which the check then stops. Plain JavaScript, so it
// loads with no TypeScript loader. It answers once: `{ pages }`, or `{ rejection }`, why the file
// can be no deck.
import { parentPort, workerData } from 'node:worker_threads';
import { getDocumentProxy } from 'unpdf';

async function parse(bytes) {
  try {
    const pdf = await getDocumentProxy(bytes, { verbosity: 0 });
    // Opened with no password, yet encrypted: an owner's password (its /Encrypt holds a /P). Never
    // its metadata, whose XMP stream PDF.js decodes whole, a compression bomb's way in.
    if (await pdf.getPermissions()) return { rejection: 'encrypted' };
    // PDF.js has walked the page tree to its last page; a PDF with none has nothing to show.
    return pdf.numPages > 0 ? { pages: pdf.numPages } : { rejection: 'not_pdf' };
  } catch (err) {
    // Needs a password to open: encrypted. Anything else PDF.js can't read is no PDF.
    return { rejection: err?.name === 'PasswordException' ? 'encrypted' : 'not_pdf' };
  }
}

parentPort.postMessage(await parse(workerData));
