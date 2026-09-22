import { describe, expect, it } from 'vitest';

import { streamErrorLog } from '../src/routes/feed.js';

/*
 * The one behavioural decision in the stream route's error listener, and now
 * the WHOLE of it: the listener dispatches on what this returns and has no
 * branch of its own, so there is nowhere else for the decision to be inverted.
 *
 * It matters because it is a string comparison on the teardown path. Mistyped
 * or inverted, every ordinary tab-close logs at `warn` in production, which is
 * the noise the split exists to avoid — and until this file existed, nothing
 * in the suite would have noticed.
 */
describe('streamErrorLog', () => {
  it('sends the ordinary teardown race to debug', () => {
    expect(streamErrorLog('ERR_STREAM_WRITE_AFTER_END')).toEqual({
      level: 'debug',
      msg: 'live stream ended mid-write',
    });
  });

  it.each([
    ['a code that never reaches this listener', 'ERR_STREAM_DESTROYED'],
    ['a peer reset, which arrives on the socket instead', 'ECONNRESET'],
    ['an unset code', undefined],
    ['something unheard of', 'ERR_SOMETHING_NEW'],
  ])('sends %s to warn', (_why, code) => {
    expect(streamErrorLog(code)).toEqual({
      level: 'warn',
      msg: 'unexpected error on a live stream',
    });
  });
});
