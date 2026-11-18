import { notFound, redirect } from 'next/navigation';

import { StudentLessonPage } from '@/components/student-lesson';
import { lessonsOn } from '@/lib/lessons';
import { UUID } from '@/lib/reports';
import { studentWebOn } from '@/lib/student-web-switch';

/**
 * A student's lesson on a page and a URL of its own (W4): a class of theirs and its session, each an
 * id the API mints: anything else names no page, as any URL with none does, so no other path
 * reaches the API. Another lesson is a page afresh, keeping nothing of this one's. With lessons off
 * (LO1) there is no lesson to show: its address goes to the student's home. With the student web off
 * (LO15) a student has no page here either: its address goes to `/`, the page saying the web is for
 * teachers.
 */
export default async function Lesson({
  params,
}: {
  params: Promise<{ classId: string; sessionId: string }>;
}) {
  if (!lessonsOn() || !studentWebOn()) redirect('/');
  const { classId, sessionId } = await params;
  if (!UUID.test(classId) || !UUID.test(sessionId)) notFound();
  return (
    <StudentLessonPage key={`${classId}/${sessionId}`} classId={classId} sessionId={sessionId} />
  );
}
