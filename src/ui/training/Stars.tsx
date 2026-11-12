// Star rating for practice drills.
export function Stars({ n, label }: { n: number; label?: string }) {
  return (
    <span className="tracking-[0.15em]" role="img" aria-label={label ?? `${n} of 3 stars`}>
      {[0, 1, 2].map((i) => <span key={i} className={i < n ? 'text-ops-amber' : 'text-ops-line'}>★</span>)}
    </span>
  );
}
