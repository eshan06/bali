/**
 * The student web's switch (ARCHITECTURE, Web portal, decision 9; LO15, the owner's order of
 * 2026-11-18): `NEXT_PUBLIC_STUDENT_WEB`, off unless it says on, its case and any spaces around it
 * aside, so students are off the web from the deploy that brought it, with nothing to set. Set on
 * Vercel and baked into the build, as every `NEXT_PUBLIC_` value is, so a change takes a redeploy.
 * Off, an account whose role is student gets no student pages: its home is one page under the bar
 * with Sign out, saying the web is for teachers and Bali is in the app on their phone, and a
 * lesson's address goes there; the invite page's line for students promises no home after a
 * refresh. On, the student web is today's: their home beside the side menu, the lesson page and
 * that line. Teachers, the API, the apps, and the student web's code and tests stay either way.
 *
 * Read where it is used, never kept at import, so a test can turn it either way; a build has it
 * as a constant.
 */
export function studentWebOn(): boolean {
  const said = process.env.NEXT_PUBLIC_STUDENT_WEB;
  return said?.trim().toLowerCase() === 'on';
}
