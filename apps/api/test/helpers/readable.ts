/*
 * The texts a printed string decodes back into under three renderings — JS and
 * JSON string escapes, percent-encoding, and HTML character references —
 * applied in any order and stacked. Not every encoding there is: '+' for a
 * space and base64 are not undone, which is why the leak tests also plant a
 * canary beside the password.
 *
 * A transcript that merely ESCAPED a password has still leaked it — whoever
 * reads it can undo the escaping — so a leak assertion has to look through the
 * renderings a printer or a proxy applies, and through several stacked: a JSON
 * body quoted by `util.inspect` is escaped twice.
 *
 * The decoders are range-checked. An escape naming a code point that does not
 * exist (`\u{FFFFFF}`) is left as written rather than thrown on: a helper that
 * throws reports a crash where the test needed a verdict.
 */

const SINGLE_ESCAPES: Record<string, string> = {
  n: '\n',
  t: '\t',
  r: '\r',
  b: '\b',
  f: '\f',
  v: '\v',
  '0': '\0',
};

/** A code point, or undefined when `code` names none. */
function codePoint(code: number): string | undefined {
  return Number.isInteger(code) && code >= 0 && code <= 0x10ffff
    ? String.fromCodePoint(code)
    : undefined;
}

/** One pass of JS/JSON string escapes: `\"`, `\\`, `\n`, `\xHH`, `\uHHHH`, `\u{H…}`. */
function unescapeOnce(text: string): string {
  return text.replace(
    /\\(?:u\{([0-9a-fA-F]{1,8})\}|u([0-9a-fA-F]{4})|x([0-9a-fA-F]{2})|([\s\S]))/g,
    (whole: string, braced?: string, u4?: string, x2?: string, single?: string) => {
      const hex = braced ?? u4 ?? x2;
      if (hex !== undefined) return codePoint(Number.parseInt(hex, 16)) ?? whole;
      return single === undefined ? whole : (SINGLE_ESCAPES[single] ?? single);
    },
  );
}

/** Runs of `%HH`, read as UTF-8 (a malformed run decodes to U+FFFD, never a throw). */
function percentDecode(text: string): string {
  return text.replace(/(?:%[0-9a-fA-F]{2})+/g, (run) =>
    Buffer.from(run.replace(/%/g, ''), 'hex').toString('utf8'),
  );
}

/** Numeric character references and the handful of named ones a page escapes with. */
function htmlDecode(text: string): string {
  const named: Record<string, string> = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'" };
  return text.replace(
    /&(?:#(\d{1,8})|#[xX]([0-9a-fA-F]{1,8})|([a-z]+));/g,
    (whole: string, dec?: string, hex?: string, name?: string) => {
      if (dec !== undefined) return codePoint(Number(dec)) ?? whole;
      if (hex !== undefined) return codePoint(Number.parseInt(hex, 16)) ?? whole;
      return named[name ?? ''] ?? whole;
    },
  );
}

const DECODERS = [unescapeOnce, percentDecode, htmlDecode];

/**
 * `text` itself plus what applying the decoders above in any order reaches from
 * it, up to six rounds deep, starting no new round once 256 forms are known:
 * enough for the stacked renderings these tests produce. A deeper stack is what
 * the canary beside the password is for.
 */
export function readableForms(text: string): string[] {
  const seen = new Set([text]);
  let frontier = [text];
  for (let round = 0; round < 6 && frontier.length > 0 && seen.size < 256; round++) {
    const next: string[] = [];
    for (const form of frontier) {
      for (const decode of DECODERS) {
        const decoded = decode(form);
        if (!seen.has(decoded)) {
          seen.add(decoded);
          next.push(decoded);
        }
      }
    }
    frontier = next;
  }
  return [...seen];
}
