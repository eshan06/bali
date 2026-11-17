/**
 * The lessons switch (ARCHITECTURE, Web portal, decision 8; LO1): `NEXT_PUBLIC_LESSONS`, on unless
 * it says off, its case and any spaces around it aside. Set on Vercel and baked into the build, as
 * every `NEXT_PUBLIC_` value is, so a change takes a redeploy. Off, the portal hides the live
 * lesson's pieces: Questions and Slides in the menu (and their pages, which send a teacher Home),
 * the class page's Questions and slides card and its panels, Present's question and slide, a
 * session report's Questions card, and a student's lesson page and its Open the lesson. On, every
 * page shows them as it did. The API, the apps, and the pieces' code and tests stay either way.
 *
 * Read where it is used, never kept at import, so a test can turn it either way; a build has it
 * as a constant.
 */
export function lessonsOn(): boolean {
  const said = process.env.NEXT_PUBLIC_LESSONS;
  return said?.trim().toLowerCase() !== 'off';
}
