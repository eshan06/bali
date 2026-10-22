'use client';

import { Fragment, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';

import { Button } from './button';

/** What can take focus in a page's `main`: a control, or anything given a tabindex. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** The part of the page focus is read and moved in: a test hands `land` and `handOff` its own. */
type Page = Pick<Document, 'activeElement' | 'body' | 'getElementById' | 'querySelector'>;

/**
 * Focus, once a read has landed and its failure has gone, Try again with it: on the first of `then`
 * the page has, the region's heading or its content's first control; with none of them there, on the
 * page's own heading, or else its first control. Never left on the body. A heading takes it as one
 * focus is moved to does: given tabindex -1, which keeps it out of the tab order.
 */
export function land(
  page: Pick<Page, 'getElementById' | 'querySelector'>,
  then: readonly string[],
) {
  const to =
    then.map((id) => page.getElementById(id)).find((el) => el !== null) ??
    page.querySelector<HTMLElement>('main h1') ??
    page.querySelector<HTMLElement>(`main :is(${FOCUSABLE})`);
  if (!to) return;
  if (!to.matches(FOCUSABLE)) to.tabIndex = -1;
  to.focus();
}

/**
 * Try again going while focus is on it, its read landed and its failure gone: once the page has
 * drawn what took its place, focus lands there (`land`, where `then` says as the frame comes); never
 * over focus the page has moved itself meanwhile.
 */
export function handOff(
  button: Element | null,
  then: () => readonly string[],
  page: Page = document,
  frame: (run: () => void) => void = (run) => void window.requestAnimationFrame(run),
) {
  if (button === null || page.activeElement !== button) return;
  frame(() => {
    const now = page.activeElement;
    if (now === null || now === page.body || now === button) land(page, then());
  });
}

/**
 * Try again, for a read that failed (CLAUDE.md: no silent failures), after its failure's line: one
 * button throughout, as the account's card had it first (PV17a; HomeInterimStates). Pressed, it
 * reads again and holds as Loading… until Bali answers, while the promise `onRetry` gives runs, or
 * while the page says its own read again is on its way (`held`): `aria-disabled`, never `disabled`,
 * so focus stays on it. An answer that leaves the failure standing says its line again, a new
 * element, however it is worded. One that takes the failure away, Try again with it, lands focus
 * where `then` says (`handOff`), never on the body. A send's resend holds the same way, its line
 * kept until Bali answers. A send's own button (`send`: Register block, Make new code, Create
 * class, the invite code), or a read's (Reports' Show earlier), says its words, and Try again only
 * once one of it failed. Held at rest (`blocked`), nothing of its own on its way, it keeps its
 * words.
 */
export function TryAgain({
  onRetry,
  held = false,
  blocked = false,
  then,
  size = 'sm',
  variant = 'secondary',
  type = 'button',
  send,
  describedBy,
  className = '',
  children,
}: {
  onRetry: () => unknown;
  held?: boolean;
  /**
   * Held, nothing of its own on its way: another control's send (a stopped upload's Cancel), or
   * nothing to send yet (Create class before a name is typed). `aria-disabled` alone, its words as
   * they are, a press sending nothing.
   */
  blocked?: boolean;
  /** The ids focus lands on once the read is in, the first the page has (`land`). */
  then: readonly string[];
  size?: 'sm' | 'md';
  variant?: 'primary' | 'secondary';
  type?: 'button' | 'submit';
  /** A send's own words: at rest, while it sends, and whether its last send failed. */
  send?: { words: string; sending: string; failed: boolean };
  /** What it is about, where its line doesn't say (a deck in the side panel's list). */
  describedBy?: string;
  className?: string;
  /** The failure's line, said again at each answer that leaves it standing; none where it sits apart. */
  children?: ReactNode;
}) {
  const button = useRef<HTMLButtonElement>(null);
  // Its own read again on its way: the promise `onRetry` gave, not settled yet.
  const [waiting, setWaiting] = useState(false);
  const busy = held || waiting;
  // Each answer that left the failure standing: its line a new element, so it is said again.
  const [said, setSaid] = useState(0);
  const [was, setWas] = useState(busy);
  if (was !== busy) {
    setWas(busy);
    if (!busy) setSaid((n) => n + 1);
  }
  // Where focus lands, as the page last said it.
  const where = useRef(then);
  useEffect(() => {
    where.current = then;
  });
  useLayoutEffect(() => {
    const el = button.current;
    return () => handOff(el, () => where.current);
  }, []);

  function press() {
    if (busy || blocked) return;
    const answer = onRetry();
    if (!(answer instanceof Promise)) return;
    setWaiting(true);
    const done = () => setWaiting(false);
    answer.then(done, done);
  }

  return (
    <>
      <Fragment key={said}>{children}</Fragment>
      <Button
        ref={button}
        type={type}
        variant={variant}
        size={size}
        aria-disabled={busy || blocked}
        aria-busy={busy}
        aria-describedby={describedBy}
        onClick={press}
        className={className}
      >
        {busy ? (send?.sending ?? 'Loading…') : !send || send.failed ? 'Try again' : send.words}
      </Button>
    </>
  );
}
