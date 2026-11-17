import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';

import { lessonsOn } from '@/lib/lessons';

/**
 * Your questions (L7b), a live lesson's page: with lessons off (LO1) the menu lists it no more, and
 * its address goes Home.
 */
export default function QuestionsLayout({ children }: { children: ReactNode }) {
  if (!lessonsOn()) redirect('/');
  return children;
}
