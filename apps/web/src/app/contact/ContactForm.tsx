'use client';

import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useState } from 'react';
import { Button, FieldError, Input, Label, Segmented } from '@/components/bali/Button';
import { ICON_STROKE } from '@/components/bali/icons';

/** Contact form.
 *
 *  SUBMIT TARGET: there is no leads backend — no contact route in apps/api, no
 *  Next route handler, and no transactional-email provider configured. Rather
 *  than POST into a void and tell the sender "thanks, we got it", `submit()`
 *  composes a fully prefilled message to the right inbox, the same honest
 *  pattern the landing page's DemoForm uses.
 *
 *  To make it post for real, replace the body of `deliver()` with a fetch to
 *  your endpoint and keep everything else — validation, states and copy are
 *  already written for it. */

type Topic = 'demo' | 'support' | 'privacy';

const TOPICS: Array<{ value: Topic; label: string }> = [
  { value: 'demo', label: 'Book a demo' },
  { value: 'support', label: 'Support' },
  { value: 'privacy', label: 'Privacy & data' },
];

const SUBJECTS: Record<Topic, string> = {
  demo: 'Bali — demo request',
  support: 'Bali — support',
  privacy: 'Bali — privacy / data request',
};

interface Fields {
  name: string;
  email: string;
  school: string;
  message: string;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function ContactForm({ contactEmail, privacyEmail }: { contactEmail: string; privacyEmail: string }) {
  const [topic, setTopic] = useState<Topic>('demo');
  const [f, setF] = useState<Fields>({ name: '', email: '', school: '', message: '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [sent, setSent] = useState(false);

  const to = topic === 'privacy' ? privacyEmail : contactEmail;
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setF((prev) => ({ ...prev, [k]: e.target.value }));
    setErrors((prev) => ({ ...prev, [k]: undefined }));
  };

  /** The one function to swap when a real endpoint exists. */
  const deliver = () => {
    const body = [
      f.message.trim(),
      '',
      '—',
      `From: ${f.name.trim()}`,
      f.school.trim() ? `School: ${f.school.trim()}` : null,
      `Reply to: ${f.email.trim()}`,
    ]
      .filter((line) => line !== null)
      .join('\n');
    window.location.href = `mailto:${to}?subject=${encodeURIComponent(SUBJECTS[topic])}&body=${encodeURIComponent(body)}`;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: Partial<Record<keyof Fields, string>> = {};
    if (!f.name.trim()) next.name = 'Please add your name.';
    if (!EMAIL_RE.test(f.email.trim())) next.email = 'Please add an email we can reply to.';
    if (!f.message.trim()) next.message = 'Please tell us what you need.';
    setErrors(next);
    if (Object.keys(next).length) return;
    deliver();
    setSent(true);
  };

  if (sent) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-md border border-line bg-surface-card p-4 text-[15px] leading-[22px] text-ink-secondary"
      >
        <Check size={18} strokeWidth={ICON_STROKE} className="mt-0.5 flex-none text-green-600" />
        <span>
          Thanks — your email app should open with the message ready to send. If nothing happened,
          write to{' '}
          <a className="font-semibold text-ink-brand underline underline-offset-2" href={`mailto:${to}`}>
            {to}
          </a>
          .
        </span>
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-5" onSubmit={submit} noValidate>
      <div className="flex flex-col gap-2">
        <Label>What&apos;s this about?</Label>
        <Segmented options={TOPICS} value={topic} onChange={setTopic} />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="c-name">Your name</Label>
          <Input
            id="c-name"
            className="mt-2"
            value={f.name}
            onChange={set('name')}
            error={!!errors.name}
            autoComplete="name"
            aria-invalid={!!errors.name}
          />
          {errors.name ? <FieldError>{errors.name}</FieldError> : null}
        </div>
        <div>
          <Label htmlFor="c-email">Email</Label>
          <Input
            id="c-email"
            type="email"
            className="mt-2"
            placeholder="you@school.edu"
            value={f.email}
            onChange={set('email')}
            error={!!errors.email}
            autoComplete="email"
            aria-invalid={!!errors.email}
          />
          {errors.email ? <FieldError>{errors.email}</FieldError> : null}
        </div>
      </div>

      <div>
        <Label htmlFor="c-school">School or district (optional)</Label>
        <Input id="c-school" className="mt-2" value={f.school} onChange={set('school')} autoComplete="organization" />
      </div>

      <div>
        <Label htmlFor="c-message">Message</Label>
        <textarea
          id="c-message"
          rows={5}
          value={f.message}
          onChange={set('message')}
          aria-invalid={!!errors.message}
          className={clsx(
            'mt-2 w-full resize-y rounded-sm border bg-surface-card px-3 py-[9px] text-[15px] leading-[22px] text-ink-primary placeholder:text-ink-tertiary',
            errors.message ? 'border-red-500' : 'border-line-strong focus-visible:border-[var(--focus-ring-color)]',
          )}
          placeholder={
            topic === 'demo'
              ? 'How many classes, and when would suit you?'
              : topic === 'support'
                ? 'What were you trying to do, and what happened?'
                : 'What do you need — a DPA, an export, a deletion?'
          }
        />
        {errors.message ? <FieldError>{errors.message}</FieldError> : null}
      </div>

      <div className="flex flex-col items-start gap-3">
        <Button type="submit">Send message</Button>
        <span className="text-[13px] leading-[18px] text-ink-tertiary">
          Goes to {to}. We read everything.
        </span>
      </div>
    </form>
  );
}
