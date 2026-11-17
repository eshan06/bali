// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { type MenuRole, SideMenu } from './shell';

/*
 * The side menu with the lessons switch either way (LO1; ARCHITECTURE, Web portal, decision 8), as
 * a teacher or a student meets it: a teacher's lists Questions and Slides only while lessons are
 * on, every other page where it was; a student's never listed either.
 */
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function open(role: MenuRole, path = '/') {
  render(
    <SideMenu
      role={role}
      path={path}
      name="Ms. Rivera"
      leaving={false}
      onSignOut={() => undefined}
    />,
  );
}

/** Each link of the menu, in its order: what it says and where it goes. */
const links = () =>
  within(screen.getByRole('navigation', { name: 'Main' }))
    .getAllByRole('link')
    .map((link) => [link.textContent, link.getAttribute('href')]);

const TEACHER = [
  ['Bali', '/'],
  ['Home', '/'],
  ['Classes', '/classes'],
  ['Reports', '/reports'],
];
const HELP = ['Help', '/support'];

describe('the side menu and the lessons switch (LO1)', () => {
  it('lists Questions and Slides for a teacher while lessons are on, as it always has', () => {
    open('teacher');
    expect(links()).toEqual([...TEACHER, ['Questions', '/questions'], ['Slides', '/slides'], HELP]);
  });

  it('lists neither with lessons off, the rest in their places, the page open still marked', () => {
    vi.stubEnv('NEXT_PUBLIC_LESSONS', 'off');
    open('teacher', '/reports');
    expect(links()).toEqual([...TEACHER, HELP]);
    expect(screen.queryByRole('link', { name: 'Questions' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Slides' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Reports' }).getAttribute('aria-current')).toBe('page');
  });

  it('gives a student Your classes and Help whichever way it is set', () => {
    for (const said of ['on', 'off']) {
      vi.stubEnv('NEXT_PUBLIC_LESSONS', said);
      open('student');
      expect(links(), said).toEqual([['Bali', '/'], ['Your classes', '/'], HELP]);
      cleanup();
    }
  });
});
