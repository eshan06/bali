'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type Drafts,
  focusAfter,
  QuestionsView,
  type Removal,
  TITLE,
} from '@/components/saved-questions';
import { getAccessToken } from '@/lib/auth';
import {
  readDrafts,
  removeAttemptFor,
  type RemoveAttempt,
  removeDraft,
} from '@/lib/saved-questions';
import { useApi } from '@/lib/use-api';

/**
 * Your questions (L7b, part 1): the teacher's drafts, oldest first, each removable, asked in class
 * (part 2). A removal whose answer never came is sent again under its id by its Remove.
 */
export default function QuestionsPage() {
  const api = useApi();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Drafts>('loading');
  const [removals, setRemovals] = useState<Record<string, Removal>>({});
  // Each removal whose answer never came: it may have landed.
  const unremoved = useRef(new Map<string, RemoveAttempt>());
  // Where focus goes once the page has drawn it: the first of these ids it finds.
  const [focus, setFocus] = useState<string[]>([]);

  useEffect(() => {
    focus
      .map((id) => document.getElementById(id))
      .find(Boolean)
      ?.focus();
  }, [focus]);

  const read = useCallback(async () => {
    setDrafts('loading');
    const answer = await readDrafts(api);
    setDrafts(answer.kind === 'read' ? answer.drafts : 'failed');
  }, [api]);

  useEffect(() => {
    if (getAccessToken()) void read();
    else router.replace('/login');
  }, [read, router]);

  /** The list without the draft `gone`. */
  const unlisted = (gone: string) =>
    setDrafts((d) => (Array.isArray(d) ? d.filter((x) => x.id !== gone) : d));

  /** A card's Remove as pressed now, or none (null). */
  const removal = (draftId: string, now: Removal | null) =>
    setRemovals((r) => {
      const next = { ...r };
      if (now) next[draftId] = now;
      else delete next[draftId];
      return next;
    });

  async function remove(draftId: string, near: string[]) {
    const attempt = removeAttemptFor(unremoved.current.get(draftId), draftId);
    unremoved.current.set(draftId, attempt);
    removal(draftId, { busy: true, failure: null });
    const answer = await removeDraft(api, attempt);
    if (answer.kind !== 'failed') unremoved.current.delete(draftId);
    if (answer.kind !== 'removed') return removal(draftId, { busy: false, failure: answer });
    // Focus moves on from the card that goes, never from where the teacher has gone since.
    const card = document.getElementById(`q-${draftId}`)?.closest('li');
    const from = document.activeElement;
    unlisted(draftId);
    removal(draftId, null);
    if (!from || from === document.body || card?.contains(from)) setFocus([...near, TITLE]);
  }

  return (
    <QuestionsView
      drafts={drafts}
      removals={removals}
      on={{
        ask: (draftId) => {
          removal(draftId, { busy: false, failure: null });
          setFocus([`q-${draftId}-keep`]);
        },
        remove: (draftId) =>
          void remove(draftId, focusAfter(Array.isArray(drafts) ? drafts : [], draftId, 'remove')),
        keep: (draftId) => {
          removal(draftId, null);
          setFocus([`q-${draftId}-remove`]);
        },
        read: () => void read(),
      }}
    />
  );
}
