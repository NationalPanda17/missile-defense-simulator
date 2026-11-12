// What a screen reader should hear when the situation changes. Pure, so it can be tested without a browser.
import { SEVERITY_LABEL, type SimState } from '../../engine';

export interface AnnounceMemo {
  campaignId: string | undefined;
  seenEvents: Set<string>;
  launched: Set<string>;
  applied: Set<string>;
  status: SimState['status'];
  phaseIndex: number;
  escalations: number;
  alerts: string[];
}

export interface Announcements { polite: string[]; assertive: string[] }

export function announceMemo(s: SimState): AnnounceMemo {
  const waves = s.tactical?.waves ?? [];
  return {
    campaignId: s.campaignId,
    seenEvents: new Set(s.events.filter((e) => e.reportedAt <= s.hour).map((e) => e.id)),
    launched: new Set(waves.filter((w) => w.resolved).map((w) => w.id)),
    applied: new Set(waves.filter((w) => w.resolved && w.applied !== false && w.atHour <= s.hour).map((w) => w.id)),
    status: s.status,
    phaseIndex: s.phaseIndex,
    escalations: s.counters.escalations,
    alerts: (s.tactical?.alerts ?? []).map((a) => `${a.region}:${a.until}`),
  };
}

/** Sentences for what changed since `prev`; urgent ones (attacks, critical reports) go in `assertive`. */
export function describeChanges(prev: AnnounceMemo | null, s: SimState): { out: Announcements; memo: AnnounceMemo } {
  const memo = announceMemo(s);
  const out: Announcements = { polite: [], assertive: [] };
  if (!prev || prev.campaignId !== s.campaignId) return { out, memo };
  const region = (r: keyof SimState['regions']) => s.regions[r].name;

  if (prev.status === 'briefing' && s.status === 'running') out.polite.push(`Phase ${s.phaseIndex + 1}, ${s.phases[s.phaseIndex].name}, has begun.`);
  if (s.status === 'complete' && prev.status !== 'complete') out.polite.push('Scenario complete. The after-action review is ready.');
  else if (prev.status === 'running' && s.status === 'briefing') out.polite.push(`Phase complete. Briefing for phase ${s.phaseIndex + 1} is open.`);

  for (const e of s.events.filter((x) => x.reportedAt <= s.hour && !prev.seenEvents.has(x.id))) {
    const text = `New report: ${e.title}, ${region(e.region)}, severity ${SEVERITY_LABEL[e.severity].toLowerCase()}, confidence ${Math.round(e.confidence)} percent.`;
    (e.severity >= 3 ? out.assertive : out.polite).push(text);
  }
  if (s.counters.escalations > prev.escalations) out.assertive.push(`${s.counters.escalations - prev.escalations === 1 ? 'An event has' : 'Events have'} escalated.`);

  for (const w of s.tactical?.waves ?? []) {
    if (w.resolved && !prev.launched.has(w.id)) {
      const n = w.tracks.filter((x) => !x.decoy).length;
      out.assertive.push(`Threat wave launched toward ${region(w.region)}${w.forecast ? '' : ', outside the forecast'}: about ${n} threats, arriving in ${Math.max(0, Math.round(w.atHour - s.hour))} hours.`);
    }
    if (w.resolved && w.applied !== false && w.atHour <= s.hour && !prev.applied.has(w.id)) {
      const real = w.tracks.filter((x) => !x.decoy);
      const stopped = real.filter((x) => x.outcome === 'stopped').length;
      out.polite.push(`Wave over ${region(w.region)} ended: ${stopped} of ${real.length} threats stopped, ${real.length - stopped} hit.`);
    }
  }
  for (const a of s.tactical?.alerts ?? []) {
    if (!prev.alerts.includes(`${a.region}:${a.until}`)) out.polite.push(`Alert raised in ${region(a.region)} for ${Math.round(a.until - s.hour)} hours.`);
  }
  return { out, memo };
}
