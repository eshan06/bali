import { describe, expect, it } from 'vitest';

import { streamErrorLevel } from '../src/routes/feed.js';

/*
 * The one behavioural decision in the stream route's error listener. It is a
 * string comparison on the teardown path: inverted or mistyped, every ordinary
 * tab-close logs at `warn` in production, which is the noise the split exists
 * to avoid — and nothing else in the suite would notice.
 */
describe('streamErrorLevel', () => {
  it('sends the ordinary teardown race to debug', () => {
    expect(streamErrorLevel('ERR_STREAM_WRITE_AFTER_END')).toBe('debug');
  });

  it.each([
    ['a code that never reaches this listener', 'ERR_STREAM_DESTROYED'],
    ['a peer reset, which arrives on the socket instead', 'ECONNRESET'],
    ['an unset code', undefined],
    ['something unheard of', 'ERR_SOMETHING_NEW'],
  ])('sends %s to warn', (_why, code) => {
    expect(streamErrorLevel(code)).toBe('warn');
  });
});
