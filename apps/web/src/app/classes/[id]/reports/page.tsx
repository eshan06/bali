import { redirect } from 'next/navigation';

/**
 * A class's reports had a page of their own until Reports joined the menu (PV13): a link or a
 * bookmark to it lands on Reports, that class picked.
 */
export default async function ClassReports({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/reports?class=${encodeURIComponent(id)}`);
}
