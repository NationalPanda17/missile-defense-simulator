// Training Academy: the course outline, progress and certification record.
import { useState } from 'react';
import { EXAM_PASS, LESSONS, defaultSettings } from '../../engine';
import { store } from '../../store/simStore';
import { Modal } from '../components/ui';
import { useUI } from '../uiState';
import { loadProgress, nextLessonId, resetProgress, startLesson } from './progress';

export function AcademyModal() {
  const ui = useUI();
  const [p, setP] = useState(loadProgress);
  const next = nextLessonId(p);
  const course = LESSONS.filter((l) => !l.exam);
  const doneCount = course.filter((l) => p.done.includes(l.id)).length;
  const go = (id: string) => {
    startLesson(id);
    ui.setAcademyOpen(false);
    ui.setView('global');
  };
  return (
    <Modal wide title="TRAINING ACADEMY" onClose={() => ui.setAcademyOpen(false)}
      footer={<>
        <button className="btn" onClick={() => { store.newGame(defaultSettings('training')); ui.setAcademyOpen(false); ui.setView('global'); }}>Free practice scenario</button>
        {next && <button className="btn btn-primary px-6 py-2 text-[13px]" autoFocus onClick={() => go(next)}>{p.done.length ? 'Continue' : 'Start'}: {LESSONS.find((l) => l.id === next)!.title} ▶</button>}
      </>}>
      <div className="space-y-4">
        <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
          <div className="space-y-2">
            <p className="leading-relaxed">
              {course.length} short lessons take you from your first click to defending a region under attack, then a graded
              certification exercise puts it all together. Each lesson is its own small scenario: the coach in the corner
              tells you what to do, waits until you have done it, and explains why it matters. Lessons can be taken in any
              order and repeated as often as you like.
            </p>
            <p className="text-[11px] text-ops-dim">Progress is saved in this browser.</p>
          </div>
          <div className="rounded border border-ops-line p-3">
            <div className="label">Your progress</div>
            <div className="mt-1 font-sans text-2xl font-bold text-white">{doneCount}<span className="text-ops-dim">/{course.length}</span> lessons</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-ops-line"><div className="h-full bg-ops-cyan" style={{ width: `${(doneCount / course.length) * 100}%` }} /></div>
            <div className="mt-2 text-[11px]">
              Certification:{' '}
              {p.bestExam ? (
                <span className={p.bestExam.passed ? 'text-ops-green' : 'text-ops-amber'}>
                  {p.bestExam.passed ? 'CERTIFIED' : 'not yet passed'} · best {p.bestExam.met}/{p.bestExam.total} standards, score {p.bestExam.score} ({p.bestExam.grade})
                </span>
              ) : <span className="text-ops-dim">not attempted</span>}
            </div>
          </div>
        </div>
        <ol className="grid gap-2 md:grid-cols-2">
          {LESSONS.map((l, i) => {
            const done = p.done.includes(l.id);
            const isNext = l.id === next;
            return (
              <li key={l.id} className={`flex flex-col rounded border p-3 ${isNext ? 'border-ops-cyan/60 bg-ops-cyan/5' : l.exam ? 'border-ops-amber/50' : 'border-ops-line'}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="label">{l.exam ? 'Final exercise' : `Lesson ${i + 1}`} · about {l.minutes} min</div>
                    <div className="font-sans text-base font-semibold text-white">{l.title}</div>
                  </div>
                  <span className={`shrink-0 text-[11px] ${done ? 'text-ops-green' : isNext ? 'text-ops-cyan' : 'text-ops-dim'}`}>{done ? '✔ Done' : isNext ? 'Up next' : ''}</span>
                </div>
                <p className="mt-1 flex-1 text-[11px] leading-relaxed text-ops-dim">{l.summary}</p>
                <div className="mt-2 flex flex-wrap gap-1">
                  {l.skills.map((s) => <span key={s} className="rounded border border-ops-line px-1.5 text-[10px] text-ops-dim">{s}</span>)}
                </div>
                {l.exam && <div className="mt-1 text-[10px] text-ops-amber">Pass {EXAM_PASS} of 6 standards to certify.</div>}
                <button className={`btn mt-2 self-start ${isNext ? 'btn-primary' : ''}`} onClick={() => go(l.id)}>{done ? 'Retake' : 'Start'} ▸</button>
              </li>
            );
          })}
        </ol>
        {p.done.length > 0 && (
          <button className="btn text-[10px]" onClick={() => { if (window.confirm('Clear your Training Academy progress in this browser?')) { resetProgress(); setP(loadProgress()); } }}>Reset progress</button>
        )}
      </div>
    </Modal>
  );
}
