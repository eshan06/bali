import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Field } from './field';

/*
 * The Field (DESIGN.md §4, Inputs), rendered: a `trailing` button sits on the input's row, after
 * it, the help under both; the input keeps its depth, its edge and what describes it whether or
 * not a button is there.
 */
const render = (trailing?: string) =>
  renderToStaticMarkup(
    createElement(Field, {
      id: 'name',
      label: 'New class name',
      help: 'Your students see this name in the Bali app.',
      'aria-describedby': 'name-said',
      trailing: trailing ? createElement('button', { type: 'submit' }, trailing) : undefined,
    }),
  );

describe('the Field', () => {
  it('puts a trailing button on the input’s row, after the input, the help under both', () => {
    const html = render('Create class');
    const row = /<div class="mt-2 flex[^"]*">(.*?)<\/div><p id="name-help"/.exec(html)?.[1];
    expect(row).toMatch(/<input[^>]*id="name"[^>]*\/><\/div><button type="submit">Create class/);
  });

  it('keeps the input at one depth with or without it, so a button never remounts the input', () => {
    const depth = (html: string) => html.slice(0, html.indexOf('<input')).match(/<div\b/g)?.length;
    expect(depth(render('Create class'))).toBe(depth(render()));
  });

  it('gives the input its border-input edge and its help, then the page’s words, either way', () => {
    for (const html of [render(), render('Create class')]) {
      expect(html).toMatch(/<input[^>]*aria-describedby="name-help name-said"/);
      expect(html).toMatch(/<input[^>]*class="[^"]*\bborder-border-input\b/);
    }
  });

  it('says a refusal right under the input, before the help, the input invalid and described by both', () => {
    const html = renderToStaticMarkup(
      createElement(Field, {
        id: 'code',
        label: 'Invite code',
        help: '25 letters and digits.',
        refusal: 'That code has already been used.',
      }),
    );
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    expect(html).toMatch(/<input[^>]*aria-describedby="code-help code-refusal"/);
    expect(html).toMatch(
      /<input[^>]*\/><\/div><\/div><p id="code-refusal" role="alert"[^>]*>That code has already been used\.<\/p><p id="code-help"/,
    );
  });

  it('with no refusal, leaves aria-invalid to the page', () => {
    const field = (invalid?: boolean) =>
      renderToStaticMarkup(
        createElement(Field, { id: 'name', label: 'New class name', 'aria-invalid': invalid }),
      );
    expect(field(true)).toMatch(/<input[^>]*aria-invalid="true"/);
    expect(field()).not.toContain('aria-invalid');
    expect(field()).not.toContain('role="alert"');
  });
});
