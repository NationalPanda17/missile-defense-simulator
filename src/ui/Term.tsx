// A word the game uses, shown with a dotted underline: hover for its meaning, click or tap to open the glossary.
// Tooltips do not exist on phones, so the tap matters.
import type { ReactNode } from 'react';
import { GLOSSARY } from './Guide';
import { useUI } from './uiState';

const LOOKUP = new Map(GLOSSARY.map(([k, v]) => [k.toLowerCase(), v]));
/** The glossary's explanation of a term (matched on the start of its entry name). */
export const meaningOf = (term: string): string | undefined =>
  LOOKUP.get(term.toLowerCase()) ?? GLOSSARY.find(([k]) => k.toLowerCase().startsWith(term.toLowerCase()))?.[1];

export function Term({ k, children, className = '' }: { k: string; children?: ReactNode; className?: string }) {
  const ui = useUI();
  const meaning = meaningOf(k);
  return (
    <button type="button" className={`cursor-help underline decoration-dotted decoration-ops-dim/70 underline-offset-2 hover:text-white ${className}`}
      style={{ font: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: 'inherit' }}
      title={meaning ? `${meaning} (Click for the glossary.)` : 'Open the glossary'} aria-label={`${k}: what does this mean?`}
      onClick={(e) => { e.stopPropagation(); ui.setHelp('glossary'); }}>
      {children ?? k}
    </button>
  );
}
