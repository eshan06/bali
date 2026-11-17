import { redirect } from 'next/navigation';

/**
 * Classes' old address (PV16): Home and Classes are one page since LO3 (Main, HomeIdle), so it goes
 * there, from the server, before any of the page is drawn or read.
 */
export default function ClassesPage(): never {
  redirect('/');
}
