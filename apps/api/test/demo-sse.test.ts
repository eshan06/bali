import type { FeedEvent } from '@bali/shared';
import { describe, expect, it } from 'vitest';

import { eventFromFrame, parseSseFrames } from '../scripts/demo/sse.js';

/*
 * The demo's SSE parsing. It is what turns "the stream said something" into "the
 * teacher's grid saw this event", so the exit demo's live-delivery assertion is
 * only as trustworthy as these: a frame split across two chunks, a keep-alive
 * comment, and a CRLF-rewriting proxy must all behave.
 */

const event = (seq: number, eventId: string): FeedEvent => ({
  seq,
  eventId,
  type: 'unlock',
  userId: 'user-1',
  occurredAt: '2026-09-20T08:05:00.000Z',
  payload: null,
});

const frame = (e: FeedEvent): string => `id: ${e.seq}\ndata: ${JSON.stringify(e)}\n\n`;

describe('parseSseFrames', () => {
  it('splits complete frames and keeps the unterminated remainder', () => {
    const buffer = `${frame(event(1, 'a'))}id: 2\ndata: {"partial"`;

    const { frames, rest } = parseSseFrames(buffer);

    expect(frames).toHaveLength(1);
    expect(rest).toBe('id: 2\ndata: {"partial"');
  });

  it('reassembles a frame delivered across two chunks', () => {
    const whole = frame(event(7, 'seven'));
    const split = Math.floor(whole.length / 2);

    const first = parseSseFrames(whole.slice(0, split));
    expect(first.frames).toHaveLength(0);

    const second = parseSseFrames(first.rest + whole.slice(split));
    expect(second.frames).toHaveLength(1);
    expect(eventFromFrame(second.frames[0]!)?.eventId).toBe('seven');
  });

  it('handles CRLF line endings, so a rewriting proxy cannot hide a boundary', () => {
    const buffer = frame(event(3, 'c')).replace(/\n/g, '\r\n');

    const { frames } = parseSseFrames(buffer);

    expect(frames).toHaveLength(1);
    expect(eventFromFrame(frames[0]!)?.seq).toBe(3);
  });

  it('returns no frames for an empty buffer', () => {
    expect(parseSseFrames('')).toEqual({ frames: [], rest: '' });
  });
});

describe('eventFromFrame', () => {
  it('parses the event carried by a data frame', () => {
    const parsed = eventFromFrame(frame(event(12, 'twelve')));

    expect(parsed).toMatchObject({ seq: 12, eventId: 'twelve', type: 'unlock' });
  });

  it('returns null for the open marker and for keep-alive comments', () => {
    // Comment frames are normal traffic on a long-lived stream, not an error.
    expect(eventFromFrame(': open')).toBeNull();
    expect(eventFromFrame(': keep-alive')).toBeNull();
  });

  it('reads a data line with no space after the colon', () => {
    const e = event(4, 'four');

    expect(eventFromFrame(`id: 4\ndata:${JSON.stringify(e)}`)?.eventId).toBe('four');
  });
});
