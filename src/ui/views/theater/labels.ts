// Collision-free label placement for the theater map. Pure (no DOM), so it can be unit-tested.
//
// Each label is anchored to a point and tries a list of candidate spots around it, in order. A spot is accepted only
// if its box stays inside the map and overlaps neither an already-placed label nor any icon. Labels are placed in
// priority order; one that fits nowhere is dropped (the item still shows its name on hover).

export interface Box { x: number; y: number; w: number; h: number }
export interface LabelRequest {
  id: string;
  text: string;
  x: number; // anchor point (icon centre)
  y: number;
  fontSize: number;
  priority: number; // higher is placed first
  iconRadius: number; // half-size of the icon the label belongs to
}
export interface PlacedLabel { id: string; text: string; x: number; y: number; anchor: 'start' | 'middle' | 'end'; fontSize: number; box: Box }

/** Rough text width for the map's sans-serif labels (good enough for collision tests at these sizes). */
export const textWidth = (text: string, fontSize: number) => text.length * fontSize * 0.56 + 4;

export const overlaps = (a: Box, b: Box, pad = 1) =>
  a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;

/** Candidate spots around an icon: below, above, right, left, then the four diagonals, then further out. */
function candidates(r: LabelRequest): { x: number; y: number; anchor: PlacedLabel['anchor'] }[] {
  const g = r.iconRadius + 3;
  const fs = r.fontSize;
  const near = [
    { x: 0, y: g + fs * 0.85, anchor: 'middle' as const },
    { x: 0, y: -g - 3, anchor: 'middle' as const },
    { x: g + 2, y: fs * 0.35, anchor: 'start' as const },
    { x: -g - 2, y: fs * 0.35, anchor: 'end' as const },
    { x: g, y: g + fs * 0.6, anchor: 'start' as const },
    { x: -g, y: g + fs * 0.6, anchor: 'end' as const },
    { x: g, y: -g, anchor: 'start' as const },
    { x: -g, y: -g, anchor: 'end' as const },
  ];
  const far = near.map((c) => ({ ...c, x: c.x * 1.9, y: c.y * 1.9 }));
  return [...near, ...far].map((c) => ({ ...c, x: r.x + c.x, y: r.y + c.y }));
}

function boxFor(x: number, y: number, anchor: PlacedLabel['anchor'], w: number, fs: number): Box {
  const left = anchor === 'start' ? x : anchor === 'end' ? x - w : x - w / 2;
  return { x: left, y: y - fs * 0.85, w, h: fs * 1.1 };
}

/**
 * Place labels without overlaps. `obstacles` are icon boxes (and anything else text must not cover); every label's
 * own icon is an obstacle too, so text never sits on top of a symbol.
 */
export function layoutLabels(requests: LabelRequest[], obstacles: Box[], bounds: { w: number; h: number }): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  const blocked = [...obstacles];
  for (const r of [...requests].sort((a, b) => b.priority - a.priority)) {
    const w = textWidth(r.text, r.fontSize);
    for (const c of candidates(r)) {
      const box = boxFor(c.x, c.y, c.anchor, w, r.fontSize);
      if (box.x < 2 || box.y < 2 || box.x + box.w > bounds.w - 2 || box.y + box.h > bounds.h - 2) continue;
      if (blocked.some((b) => overlaps(box, b))) continue;
      placed.push({ id: r.id, text: r.text, x: c.x, y: c.y, anchor: c.anchor, fontSize: r.fontSize, box });
      blocked.push(box);
      break;
    }
  }
  return placed;
}

/**
 * Spread markers that would sit on top of each other (closer than `minGap`) evenly around their shared centre, so
 * each stays visible and clickable. Returns display positions by id; true positions are unchanged.
 */
export function fanOut(points: { id: string; x: number; y: number }[], minGap: number, minRadius = 0): Map<string, { x: number; y: number; moved: boolean }> {
  const out = new Map<string, { x: number; y: number; moved: boolean }>();
  const used = new Set<string>();
  for (const p of points) {
    if (used.has(p.id)) continue;
    const group = points.filter((q) => !used.has(q.id) && Math.hypot(q.x - p.x, q.y - p.y) < minGap);
    group.forEach((q) => used.add(q.id));
    if (group.length === 1) {
      out.set(p.id, { x: p.x, y: p.y, moved: false });
      continue;
    }
    const cx = group.reduce((a, q) => a + q.x, 0) / group.length;
    const cy = group.reduce((a, q) => a + q.y, 0) / group.length;
    // Neighbours on the ring stay at least minGap apart; minRadius keeps the ring clear of whatever sits in the middle.
    const radius = Math.max(minRadius, minGap / 2 / Math.sin(Math.PI / Math.max(2, group.length)));
    group.forEach((q, i) => {
      const a = -Math.PI / 2 + (i / group.length) * Math.PI * 2;
      out.set(q.id, { x: cx + Math.cos(a) * radius, y: cy + Math.sin(a) * radius, moved: true });
    });
  }
  return out;
}
