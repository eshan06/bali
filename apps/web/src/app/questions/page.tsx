'use client';

import type { SavedQuestion } from '@bali/shared';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  answerId,
  type Drafts,
  focusAfter,
  type Form,
  formAfter,
  nothingToSave,
  PROMPT,
  QuestionsView,
  type Removal,
  TITLE,
  WRITE,
} from '@/components/saved-questions';
import { getAccessToken } from '@/lib/auth';
import type { QuestionDraft } from '@/lib/live-question';
import {
  oldestFirst,
  readDrafts,
  refusalsOf,
  removeAttemptFor,
  type RemoveAttempt,
  removeDraft,
  type SaveAttempt,
  saveAttemptFor,
  saveDraft,
  trimmed,
  withoutAnswer,
} from '@/lib/saved-questions';
import { useApi } from '@/lib/use-api';

/** A new question: no words yet, and the two answers a question needs at least. */
const NEW: QuestionDraft = { prompt: '', options: ['', ''], correctOption: null };
const editId = (draftId: string) => `q-${draftId}-edit`;

/**
 * Your questions, in the menu (L7b, part 1): the teacher's drafts, oldest first, written, edited and
 * removed here, asked in class (part 2). Each save is minted after the draft's own `eventId`, one at
 * a time, and one answered under another is said as not saved (#318); a save or a removal whose
 * answer never came is sent again under its id by Try again, or by its Remove.
 */
export default function QuestionsPage() {
  const api = useApi();
  const router = useRouter();
  const [drafts, setDrafts] = useState<Drafts>('loading');
  const [form, setForm] = useState<Form | null>(null);
  const [removals, setRemovals] = useState<Record<string, Removal>>({});
  // The last save, and each removal, whose answer never came: they may have landed.
  const unsaved = useRef<SaveAttempt | null>(null);
  const unremoved = useRef(new Map<string, RemoveAttempt>());
  // The form's number: a save answered once its form has closed changes only the list.
  const opened = useRef(0);
  // The form as last drawn: a save's answer reads the words typed while it was sent.
  const drawn = useRef<Form | null>(null);
  useEffect(() => {
    drawn.current = form;
  });
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

  /** The list with `draft` as it is now, in its place. */
  const listed = (draft: SavedQuestion) =>
    setDrafts((d) =>
      Array.isArray(d) ? oldestFirst([...d.filter((x) => x.id !== draft.id), draft]) : d,
    );
  /** The list without the draft `gone`. */
  const unlisted = (gone: string) =>
    setDrafts((d) => (Array.isArray(d) ? d.filter((x) => x.id !== gone) : d));

  /** Open the form, a new question (`draft` null) or a draft's edit, or close it (undefined). */
  function show(draft: SavedQuestion | null | undefined, to: string[]) {
    opened.current += 1;
    // A save whose answer never came may have landed: the list reads the drafts as they are.
    if (unsaved.current) void read();
    unsaved.current = null;
    const start = draft ? trimmed(draft) : NEW;
    setForm(
      draft === undefined
        ? null
        : { draft, words: start, tried: false, busy: false, problem: null, tries: 0 },
    );
    setFocus(to);
  }
  const words = (change: (w: QuestionDraft) => QuestionDraft) =>
    setForm((f) => f && { ...f, words: change(f.words) });

  async function save() {
    if (!form || form.busy) return;
    const refused = refusalsOf(form.words);
    const first = refused.options.findIndex((r) => r !== null);
    if (refused.prompt || first !== -1) {
      setForm({ ...form, tried: true });
      return setFocus([refused.prompt ? PROMPT : answerId(first)]);
    }
    const { draft } = form;
    // The draft's own words, with no save held that may have landed: nothing to save, so it
    // isn't marked edited.
    if (draft && nothingToSave(draft, form.words, unsaved.current)) {
      return show(undefined, [editId(draft.id)]);
    }
    const attempt = saveAttemptFor(unsaved.current, draft, form.words);
    unsaved.current = attempt;
    const mine = opened.current;
    setForm({ ...form, busy: true });
    const answer = await saveDraft(api, attempt);
    if (answer.kind === 'saved' || answer.kind === 'not_saved') listed(answer.draft);
    if (answer.kind === 'gone' && draft) unlisted(draft.id);
    if (mine !== opened.current || !drawn.current) return;
    if (answer.kind !== 'failed') unsaved.current = null;
    const next = formAfter(drawn.current, attempt, answer);
    if (next) return setForm(next);
    show(undefined, answer.kind === 'saved' ? [editId(answer.draft.id), WRITE] : [WRITE]);
  }

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
    if (!from || from === document.body || card?.contains(from)) {
      setFocus([...near, WRITE, TITLE]);
    }
  }

  return (
    <QuestionsView
      drafts={drafts}
      form={form}
      removals={removals}
      on={{
        write: () => show(null, [PROMPT]),
        edit: (draftId) => {
          const draft = Array.isArray(drafts) && drafts.find((d) => d.id === draftId);
          if (draft && !form?.busy) show(draft, [PROMPT]);
        },
        change: (next) => words(() => next),
        addAnswer: () => {
          words((w) => ({ ...w, options: [...w.options, ''] }));
          setFocus([answerId(form?.words.options.length ?? 0)]);
        },
        removeAnswer: (i) => {
          words((w) => withoutAnswer(w, i));
          setFocus([answerId(i), answerId(i - 1)]);
        },
        save: () => void save(),
        cancel: () => {
          if (!form?.busy) show(undefined, form?.draft ? [editId(form.draft.id), WRITE] : [WRITE]);
        },
        ask: (draftId) => {
          removal(draftId, { busy: false, failure: null });
          setFocus([`q-${draftId}-keep`]);
        },
        remove: (draftId) =>
          void remove(draftId, focusAfter(Array.isArray(drafts) ? drafts : [], draftId, 'edit')),
        keep: (draftId) => {
          removal(draftId, null);
          setFocus([`q-${draftId}-remove`]);
        },
        read: () => void read(),
      }}
    />
  );
}
