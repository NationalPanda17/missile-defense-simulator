// Training Academy progress, kept in this browser. Lessons are short, so losing it only means re-taking one.
import { LESSONS, defaultSettings, lessonSettings } from '../../engine';
import { store } from '../../store/simStore';

const KEY = 'mds.academy';
const STEP_KEY = (campaignId: string) => `mds.lessonStep.${campaignId}`;

export interface ExamRecord { passed: boolean; met: number; total: number; score: number; grade: string; at: number }
export interface AcademyProgress { done: string[]; exam?: ExamRecord; bestExam?: ExamRecord }

export function loadProgress(): AcademyProgress {
  try {
    const raw = localStorage.getItem(KEY);
    const p = raw ? (JSON.parse(raw) as AcademyProgress) : null;
    if (p && Array.isArray(p.done)) return p;
  } catch { /* ignore */ }
  return { done: [] };
}

function save(p: AcademyProgress) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

export function markLessonDone(id: string) {
  const p = loadProgress();
  if (!p.done.includes(id)) save({ ...p, done: [...p.done, id] });
}

export function recordExam(r: ExamRecord) {
  const p = loadProgress();
  const better = !p.bestExam || (r.passed && !p.bestExam.passed) || (r.passed === p.bestExam.passed && r.score > p.bestExam.score);
  save({ ...p, exam: r, bestExam: better ? r : p.bestExam, done: r.passed && !p.done.includes('exam') ? [...p.done, 'exam'] : p.done });
}

export function resetProgress() {
  save({ done: [] });
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
