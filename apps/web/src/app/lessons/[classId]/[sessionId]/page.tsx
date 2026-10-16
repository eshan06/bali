import { notFound } from 'next/navigation';

import { StudentLessonPage } from '@/components/student-lesson';
import { UUID } from '@/lib/reports';

/**
 * A student's lesson on a page and a URL of its own (W4): a class of theirs and its session, each an
 * id the API mints: anything else names no page, as any URL with none does, so no other path
 * reaches the API. Another lesson is a page afresh, keeping nothing of this one's.
 */
export default async function Lesson({
  params,
}: {
  params: Promise<{ classId: string; sessionId: string }>;
}) {
  const { classId, sessionId } = await params;
  if (!UUID.test(classId) || !UUID.test(sessionId)) notFound();
  return (
    <StudentLessonPage key={`${classId}/${sessionId}`} classId={classId} sessionId={sessionId} />
  );
}
