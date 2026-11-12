// Training Academy progress, kept in this browser. Lessons are short, so losing it only means re-taking one.
import { LESSONS, defaultSettings, lessonSettings } from '../../engine';
import { api } from '../../store/remote';
import { store } from '../../store/simStore';
import type { ExamRecord } from '../../shared/api';

const KEY = 'mds.academy';
const STEP_KEY = (campaignId: string) => `mds.lessonStep.${campaignId}`;

export type { ExamRecord };
export interface AcademyProgress { done: string[]; exam?: ExamRecord; bestExam?: ExamRecord }

export function loadProgress(): AcademyProgress {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as AcademyProgress) : null;
    if (p && Array.isArray(p.done)) return p;
  } catch { /* ignore */ }
  return { done: [] };
}

function save(p: AcademyProgress, push = true) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
  listeners.forEach((f) => f());
  if (push) void syncAcademy();
}

const listeners = new Set<() => void>();
/** Called whenever progress changes, including when it arrives from the server. */
export function onProgressChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

const better = (a: ExamRecord | undefined | null, b: ExamRecord | undefined | null) =>
  !a ? b ?? undefined : !b ? a : a.passed !== b.passed ? (a.passed ? a : b) : b.score > a.score ? b : a;

let syncing = false;
let again = false;
/**
 * Signed in to the save server: merge this browser's progress with the account's (lessons are never un-done, the
 * better exam wins) and keep the result on both sides. Signed out or offline: does nothing.
 */
export async function syncAcademy(): Promise<void> {
  if (store.server.status !== 'online' || !store.server.user) return;
  if (syncing) { again = true; return; }
  syncing = true;
  try {
    const local = loadProgress();
    const merged = await api.putAcademy({ done: local.done.filter((id) => LESSONS.some((l) => l.id === id)), bestExam: local.bestExam ?? null });
    const now = loadProgress();
    const next: AcademyProgress = { ...now, done: [...new Set([...now.done, ...merged.done])], bestExam: better(now.bestExam, merged.bestExam) };
    if (JSON.stringify(next) !== JSON.stringify(now)) save(next, false);
  } catch { /* offline or signed out: try again next time */ } finally {
    syncing = false;
    if (again) { again = false; void syncAcademy(); }
  }
}

// Sync whenever someone signs in (or the server comes back with a session).
if (typeof window !== 'undefined') {
  let lastUser: string | null = null;
  store.subscribe(() => {
    const u = store.server.status === 'online' ? store.server.user?.id ?? null : null;
    if (u && u !== lastUser) void syncAcademy();
    lastUser = u;
  });
}

export function markLessonDone(id: string) {
  const p = loadProgress();
  if (!p.done.includes(id)) save({ ...p, done: [...p.done, id] });
}

export function recordExam(r: ExamRecord) {
  const p = loadProgress();
  save({ ...p, exam: r, bestExam: better(p.bestExam, r), done: r.passed && !p.done.includes('exam') ? [...p.done, 'exam'] : p.done });
}

/** Clears this browser's progress only; progress kept with a signed-in account stays there. */
export function resetProgress() {
  save({ done: [] }, false);
}

/** The first lesson not yet done, in course order. */
export function nextLessonId(p = loadProgress()): string | undefined {
  return LESSONS.find((l) => !p.done.includes(l.id))?.id;
}

export function loadStep(campaignId: string | undefined): number {
  if (!campaignId) return 0;
  try { return Number(localStorage.getItem(STEP_KEY(campaignId))) || 0; } catch { return 0; }
}

export function saveStep(campaignId: string | undefined, i: number) {
  if (!campaignId) return;
  try { localStorage.setItem(STEP_KEY(campaignId), String(i)); } catch { /* ignore */ }
}

export function startLesson(id: string) {
  store.newGame(lessonSettings(id, defaultSettings('training')));
}
