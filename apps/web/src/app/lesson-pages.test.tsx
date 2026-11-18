import { isValidElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { StudentLessonPage } from '@/components/student-lesson';

import Lesson from './lessons/[classId]/[sessionId]/page';
import QuestionsLayout from './questions/layout';
import SlidesLayout from './slides/layout';

/*
 * A live lesson's pages reached by their address, with the lessons switch either way (LO1;
 * ARCHITECTURE, Web portal, decision 8): Your questions, Your slides and a student's lesson. On,
 * each is its page, as before. Off, the menu and the home no longer lead there, and the address
 * goes to `/`: a teacher's Home, or a student's Your classes, never a page with nothing on it. A
 * student's lesson is the student web's too (decision 9; LO15): with it off, the lesson's address
 * goes to `/`, the page saying the web is for teachers, whichever way lessons are set.
 */
const next = vi.hoisted(() => ({
  /** As Next's own: it ends the render where it is called. */
  redirect: vi.fn((to: string): never => {
    throw new Error(`redirect ${to}`);
  }),
  notFound: vi.fn((): never => {
    throw new Error('not found');
  }),
}));
vi.mock('next/navigation', () => next);

afterEach(() => {
  vi.unstubAllEnvs();
  next.redirect.mockClear();
  next.notFound.mockClear();
});

const CLASS = '0199e3a1-0000-7000-8000-00000000000c';
const SESSION = '0199e3a1-0000-7000-8000-00000000000a';
const lesson = (classId = CLASS) =>
  Lesson({ params: Promise.resolve({ classId, sessionId: SESSION }) });

describe('with lessons on', () => {
  it('opens Your questions and Your slides as their pages', () => {
    for (const layout of [QuestionsLayout, SlidesLayout]) {
      expect(layout({ children: 'the page' }), layout.name).toBe('the page');
    }
    expect(next.redirect).not.toHaveBeenCalled();
  });

  it('opens a student’s lesson as its page, the student web on', async () => {
    vi.stubEnv('NEXT_PUBLIC_STUDENT_WEB', 'on');
    const page = await lesson();
    expect(isValidElement(page) && page.type).toBe(StudentLessonPage);
    expect(next.redirect).not.toHaveBeenCalled();
  });
});

describe('with the student web off (LO15)', () => {
  it('sends a student’s lesson to `/`, a lesson’s address or not, whichever way lessons are set', async () => {
    // Unset, as a deploy that sets nothing has it, and said off.
    for (const [web, lessons] of [
      [undefined, undefined],
      ['off', 'on'],
      [undefined, 'off'],
    ]) {
      vi.stubEnv('NEXT_PUBLIC_STUDENT_WEB', web);
      vi.stubEnv('NEXT_PUBLIC_LESSONS', lessons);
      for (const classId of [CLASS, 'c1']) {
        const said = `${web} ${lessons} ${classId}`;
        next.redirect.mockClear();
        await expect(lesson(classId), said).rejects.toThrow('redirect /');
        expect(next.redirect, said).toHaveBeenCalledExactlyOnceWith('/');
      }
    }
    expect(next.notFound).not.toHaveBeenCalled();
  });

  it('leaves Your questions and Your slides, a teacher’s, as their pages with lessons on', () => {
    vi.stubEnv('NEXT_PUBLIC_STUDENT_WEB', 'off');
    for (const layout of [QuestionsLayout, SlidesLayout]) {
      expect(layout({ children: 'the page' }), layout.name).toBe('the page');
    }
    expect(next.redirect).not.toHaveBeenCalled();
  });
});

describe('with lessons off (LO1)', () => {
  it('sends Your questions and Your slides Home, the page never drawn', () => {
    vi.stubEnv('NEXT_PUBLIC_LESSONS', 'off');
    for (const layout of [QuestionsLayout, SlidesLayout]) {
      next.redirect.mockClear();
      expect(() => layout({ children: 'the page' }), layout.name).toThrow('redirect /');
      expect(next.redirect, layout.name).toHaveBeenCalledExactlyOnceWith('/');
    }
  });

  it('sends a student’s lesson to Your classes, a lesson’s address or not', async () => {
    vi.stubEnv('NEXT_PUBLIC_LESSONS', 'off');
    for (const classId of [CLASS, 'c1']) {
      next.redirect.mockClear();
      await expect(lesson(classId), classId).rejects.toThrow('redirect /');
      expect(next.redirect, classId).toHaveBeenCalledExactlyOnceWith('/');
    }
    expect(next.notFound).not.toHaveBeenCalled();
  });
});
