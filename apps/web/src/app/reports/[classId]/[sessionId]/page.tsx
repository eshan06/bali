import { notFound } from 'next/navigation';

import { SessionReportPage } from '@/components/session-report';
import { UUID } from '@/lib/reports';

/**
 * A session's report on a page and a URL of its own (PV14), where Reports' rows and the class
 * page's recap lead. Its class and its session each an id the API mints: anything else names no
 * page, as any URL with none does, so no other path reaches the API.
 */
export default async function SessionReport({
  params,
}: {
  params: Promise<{ classId: string; sessionId: string }>;
}) {
  const { classId, sessionId } = await params;
  if (!UUID.test(classId) || !UUID.test(sessionId)) notFound();
  return <SessionReportPage classId={classId} sessionId={sessionId} />;
}
