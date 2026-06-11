/** Placeholder for surfaces that land in build pass 2b — route exists, shell holds. */
export function ComingSoon({ title, note }: { title: string; note: string }) {
  return (
    <div className="mx-auto flex max-w-[1190px] flex-col gap-3 px-8 pb-9 pt-6">
      <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.01em]">{title}</h1>
      <p className="max-w-[480px] text-[14px] leading-[21px] text-ink-secondary">{note}</p>
    </div>
  );
}
