/** Join/tag code alphabet: unambiguous at projector distance (no O/0/1/I/L confusion —
 *  JetBrains Mono disambiguates, but we also avoid the worst offenders outright). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function randomCode(length: number, rng: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  return out;
}

/** 8-char class join code (e.g. KM3W7Q2A). */
export const newJoinCode = (): string => randomCode(8);

/** 10-char tag code (e.g. T7XK2M9QPF). */
export const newTagCode = (): string => randomCode(10);
