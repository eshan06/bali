'use client';

import type { MeClass } from '@bali/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type Decks,
  focusAfter,
  idOf,
  type Made,
  type Refusal,
  type Removal,
  rowsOf,
  type Sending,
  SlidesView,
  TITLE,
} from '@/components/slides';
import { getAccessToken } from '@/lib/auth';
import {
  judgePick,
  newUpload,
  readDecks,
  removeAttemptFor,
  type RemoveAttempt,
  removeDeck,
  runUpload,
  type Upload,
  uploadAgain,
} from '@/lib/decks';
import type { Failure } from '@/lib/live-question';
import { useApi } from '@/lib/use-api';

/** An upload in this page: how far it got, its Cancel, whether it runs, and why it stopped. */
interface Held {
  upload: Upload;
  controller: AbortController;
  running: boolean;
  failure: Failure | null;
  /** Where focus goes once a Cancel takes its row away, worked out as it was pressed. */
  near: string[];
}

/**
 * Your slides (M5b; the Slides board): the teacher's decks, and each PDF uploaded from here with its
 * percentage and Cancel, its check and the server's verdict; Remove after its confirm. Leaving the
 * page stops its uploads, which then read as unfinished when it opens again (SlidesStates).
 */
export default function SlidesPage() {
  const api = useApi();
  const router = useRouter();
  const [decks, setDecks] = useState<Decks>('loading');
  const [made, setMade] = useState<Made[]>([]);
  const [sending, setSending] = useState<Sending[]>([]);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [removals, setRemovals] = useState<Record<string, Removal>>({});
  const [inUse, setInUse] = useState<Record<string, MeClass[]>>({});
  // Where focus goes once the page has drawn it: the first of these ids it finds.
  const [focus, setFocus] = useState<string[]>([]);
  const picker = useRef<HTMLInputElement>(null);
  const held = useRef(new Map<string, Held>());
  // Each removal whose answer never came: it may have landed.
  const unremoved = useRef(new Map<string, RemoveAttempt>());
  const uploads = useRef(0);
  // The page is open: an answer that lands after it closed draws and removes nothing.
  const open = useRef(true);

  useEffect(() => {
    focus
      .map((id) => document.getElementById(id))
      .find(Boolean)
      ?.focus();
  }, [focus]);

  const read = useCallback(async () => {
    setDecks('loading');
    const answer = await readDecks(api);
    if (open.current) setDecks(answer.kind === 'read' ? answer.decks : 'failed');
  }, [api]);

  useEffect(() => {
    if (getAccessToken()) void read();
    else router.replace('/login');
  }, [read, router]);

  useEffect(() => {
    open.current = true;
    const running = held.current;
    return () => {
      open.current = false;
      for (const upload of running.values()) upload.controller.abort();
    };
  }, []);

  const rows = rowsOf(decks, made, sending);

  /** The upload `key` as it stands now, or gone from the list (null). */
  const show = (key: string, change: Partial<Sending> | null) =>
    setSending((list) =>
      change === null
        ? list.filter((s) => s.key !== key)
        : list.map((s) => (s.key === key ? { ...s, ...change } : s)),
    );

  /** A deck's Remove as pressed now, or none (null); and the classes it is in use in, or none. */
  const removal = (deckId: string, now: Removal | null) =>
    setRemovals((r) => {
      const next = { ...r };
      if (now) next[deckId] = now;
      else delete next[deckId];
      return next;
    });
  const showing = (deckId: string, classes: MeClass[] | null) =>
    setInUse((u) => {
      const next = { ...u };
      if (classes) next[deckId] = classes;
      else delete next[deckId];
      return next;
    });

  /** Run `upload` on from where it got to, in the row `key`, to the server's verdict or a stop. */
  async function run(key: string, upload: Upload) {
    const controller = new AbortController();
    held.current.set(key, { upload, controller, running: true, failure: null, near: [] });
    let percent = 0;
    let deckId = upload.deck?.id ?? null;
    const end = await runUpload(api, upload, {
      signal: controller.signal,
      onCreated: (deck) => {
        deckId = deck.id;
        if (open.current) show(key, { deckId });
      },
      onStep: (step) => {
        if (!open.current || controller.signal.aborted) return;
        if (step.step === 'checking') return show(key, { state: { step: 'checking' } });
        const now = Math.floor(step.fraction * 100);
        if (now === percent) return;
        percent = now;
        show(key, { state: { step: 'uploading', percent } });
      },
    });
    if (!open.current) return;
    const at = held.current.get(key);
    if (end.kind === 'cancelled') return void cancelled(key, end.upload, at?.near ?? []);
    // The check took the row's buttons away: focus it lost comes back to the row's button now, or
    // to the page's title once the row has gone with its deck.
    if (document.activeElement === document.body) setFocus([`${idOf(key)}-act`, TITLE]);
    if (end.kind === 'checked' || end.kind === 'gone') {
      held.current.delete(key);
      // The verdict: the row turns into its deck, the same element, so its line is said.
      if (end.kind === 'checked') {
        setMade((m) => [{ key, deck: end.deck }, ...m.filter((x) => x.deck.id !== end.deck.id)]);
      } else if (deckId) unlist(deckId);
      return show(key, null);
    }
    const failure = end.kind === 'stopped' ? end.failure : null;
    held.current.set(key, { upload: end.upload, controller, running: false, failure, near: [] });
    // A stop never follows a Cancel (`runUpload` ends it cancelled); its buttons are free all the same.
    show(key, {
      state: { step: 'stopped', why: failure ?? { kind: 'too_slow' } },
      cancelling: false,
    });
  }

  /** A deck gone from the list: the API's, and those made here. */
  function unlist(deckId: string) {
    setDecks((d) => (Array.isArray(d) ? d.filter((x) => x.id !== deckId) : d));
    setMade((m) => m.filter((x) => x.deck.id !== deckId));
  }

  /**
   * A Cancel's end: the pending deck its upload made, if any, removed, and the row gone; or, if
   * Bali didn't hear it, the deck as the list shows one left unfinished, with Remove (SlidesStates).
   */
  async function cancelled(key: string, upload: Upload, near: string[]) {
    held.current.delete(key);
    const deck = upload.deck;
    const answer = deck ? await removeDeck(api, removeAttemptFor(undefined, deck.id)) : null;
    if (!open.current) return;
    if (deck && answer?.kind !== 'removed') {
      setMade((m) => [{ key, deck }, ...m]);
      show(key, null);
      return setFocus([`${idOf(key)}-act`]);
    }
    const row = document.getElementById(`${idOf(key)}-name`)?.closest('li');
    const from = document.activeElement;
    if (deck) unlist(deck.id);
    show(key, null);
    if (!from || from === document.body || row?.contains(from)) setFocus([...near, TITLE]);
  }

  async function picked(file: File) {
    const judged = await judgePick(file);
    if (!open.current) return;
    if (judged.kind === 'too_large') {
      return setRefusal({ kind: 'too_large', name: file.name, bytes: file.size });
    }
    if (judged.kind === 'not_pdf') return setRefusal({ kind: 'not_pdf', name: file.name });
    setRefusal(null);
    const key = `upload-${(uploads.current += 1)}`;
    const state = { step: 'uploading', percent: 0 } as const;
    setSending((list) => [
      { key, title: judged.title, deckId: null, state, cancelling: false },
      ...list,
    ]);
    void run(key, newUpload(file, judged.title));
  }

  async function remove(deckId: string, key: string, near: string[]) {
    const attempt = removeAttemptFor(unremoved.current.get(deckId), deckId);
    unremoved.current.set(deckId, attempt);
    removal(deckId, { busy: true, failure: null });
    const answer = await removeDeck(api, attempt);
    if (!open.current) return;
    if (answer.kind !== 'failed') unremoved.current.delete(deckId);
    if (answer.kind === 'in_use') {
      removal(deckId, null);
      showing(deckId, answer.classes);
      return setFocus([`${idOf(key)}-act`]);
    }
    if (answer.kind !== 'removed') return removal(deckId, { busy: false, failure: answer });
    // Focus moves on from the row that goes, never from where the teacher has gone since.
    const row = document.getElementById(`${idOf(key)}-name`)?.closest('li');
    const from = document.activeElement;
    unlist(deckId);
    removal(deckId, null);
    if (!from || from === document.body || row?.contains(from)) setFocus([...near, TITLE]);
  }

  /** The key of the row a deck is drawn in. */
  const keyOf = (deckId: string) =>
    rows.find((r) => 'deck' in r && r.deck.id === deckId)?.key ?? deckId;

  return (
    <SlidesView
      decks={decks}
      rows={rows}
      refusal={refusal}
      removals={removals}
      inUse={inUse}
      on={{
        pick: () => picker.current?.click(),
        read: () => void read(),
        cancel: (key) => {
          const at = held.current.get(key);
          if (!at) return;
          show(key, { cancelling: true });
          at.near = focusAfter(rows, key);
          // A running upload ends cancelled, which removes its deck; a stopped one, now.
          if (at.running) at.controller.abort();
          else void cancelled(key, at.upload, at.near);
        },
        retry: (key) => {
          const at = held.current.get(key);
          if (!at || at.running) return;
          // On from where it stopped, or afresh once the API refused it (`uploadAgain`).
          const upload = at.failure
            ? uploadAgain({ failure: at.failure, upload: at.upload })
            : at.upload;
          show(key, {
            state: upload.uploaded ? { step: 'checking' } : { step: 'uploading', percent: 0 },
            deckId: upload.deck?.id ?? null,
          });
          setFocus([`${idOf(key)}-act`]);
          void run(key, upload);
        },
        ask: (deckId) => {
          showing(deckId, null);
          removal(deckId, { busy: false, failure: null });
          setFocus([`${idOf(keyOf(deckId))}-keep`]);
        },
        remove: (deckId) => {
          const key = keyOf(deckId);
          void remove(deckId, key, focusAfter(rows, key));
        },
        keep: (deckId) => {
          removal(deckId, null);
          setFocus([`${idOf(keyOf(deckId))}-act`]);
        },
      }}
    >
      <input
        ref={picker}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          // Cleared, so the same file picked again is read again.
          e.currentTarget.value = '';
          if (file) void picked(file);
        }}
      />
    </SlidesView>
  );
}
