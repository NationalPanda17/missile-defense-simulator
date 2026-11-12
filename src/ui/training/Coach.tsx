// The in-game coach for Training Academy lessons: one step at a time, ticked off automatically as the player acts.
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LESSONS, examResult, examStandards, type SimState, type TrainingLesson } from '../../engine';
import { dispatch, store } from '../../store/simStore';
import { useUI, type ViewId } from '../uiState';
import { loadStep, markLessonDone, recordExam, saveStep, startLesson } from './progress';

export function Coach({ s, lesson }: { s: SimState; lesson: TrainingLesson }) {
  const ui = useUI();
  const [i, setI] = useState(() => Math.min(loadStep(s.campaignId), lesson.steps.length - 1));
  const [since, setSince] = useState(() => ({ cmd: s.commands.length, hour: s.hour }));
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 640);
  const [hint, setHint] = useState(false);
  const [picked, setPicked] = useState<number | null>(null);
  const [justDone, setJustDone] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const step = lesson.steps[i];
  const last = i === lesson.steps.length - 1;
  const quiz = step.quiz ? step.quiz(s) : null;
  // Freeze the quiz once it is shown: its options come from the state, which keeps moving.
  const quizRef = useRef<{ step: string; q: NonNullable<typeof quiz> } | null>(null);
  if (quiz && quizRef.current?.step !== step.id) quizRef.current = { step: step.id, q: quiz };
  const q = step.quiz ? quizRef.current!.q : null;
  const isRead = !step.check && !step.quiz;
  const lessonIndex = LESSONS.indexOf(lesson);
  const nextLesson = LESSONS[lessonIndex + 1];

  const go = (n: number) => {
    setI(n);
    setSince({ cmd: s.commands.length, hour: s.hour });
    setHint(false);
    setPicked(null);
    saveStep(s.campaignId, n);
    // Read steps take the player to what they describe; action steps leave finding it to the player.
    const st = lesson.steps[n];
    if (st?.view && !st.check) ui.setView(st.view as ViewId);
  };

  // Hold the clock while the player reads or answers.
  useEffect(() => {
    if ((isRead || step.quiz) && s.status === 'running' && !s.paused) dispatch({ type: 'setPaused', paused: true });
  }, [i]);

  // Tick a step off as soon as its check passes.
  const passed = !!step.check?.({ s, view: ui.view, region: ui.region, eventId: ui.eventId, assetId: ui.assetId, since });
  useEffect(() => {
    if (!passed || last) return;
    setJustDone(step.title);
    go(i + 1);
    const t = window.setTimeout(() => setJustDone(null), 2500);
    return () => window.clearTimeout(t);
  }, [passed, i]);

  // Record completion once the last step is reached.
  useEffect(() => {
    if (!last) return;
    if (lesson.exam) {
      if (s.status !== 'complete') return;
      const r = examResult(s);
      recordExam({ ...r, at: Date.now() });
    } else markLessonDone(lesson.id);
  }, [last, lesson, s, s.status]);

  // Let dialogs stop above the coach.
  useLayoutEffect(() => {
    const el = ref.current;
    document.body.classList.add('coach-on');
    const set = () => document.body.style.setProperty('--coach-h', `${el ? el.getBoundingClientRect().height : 0}px`);
    set();
    const ro = el ? new ResizeObserver(set) : null;
    if (el && ro) ro.observe(el);
    return () => {
      ro?.disconnect();
      document.body.classList.remove('coach-on');
      document.body.style.removeProperty('--coach-h');
    };
  }, [open]);

  const timeUp = s.status === 'complete' && !last && !passed;
  const spot = step.target && !passed && !timeUp ? <Spotlight names={step.target} /> : null;
  const restart = () => startLesson(lesson.id);
  const academy = () => ui.setAcademyOpen(true);

  if (!open) {
    return (
      <div ref={ref} className="fixed bottom-2 left-2 right-2 z-[55] sm:right-auto sm:w-[380px]">
        {spot}
        <button className="panel flex w-full items-center gap-2 border-ops-cyan/50 bg-ops-panel px-3 py-2 text-left" onClick={() => setOpen(true)} aria-expanded={false}>
          <span className="label shrink-0 text-ops-cyan">Coach {i + 1}/{lesson.steps.length}</span>
          <span className="min-w-0 flex-1 truncate text-white">{step.title}</span>
          <span className="text-ops-cyan">▴</span>
        </button>
      </div>
    );
  }

  return (
    <div ref={ref} className="panel fadein fixed bottom-2 left-2 right-2 z-[55] max-h-[45vh] overflow-y-auto border-ops-cyan/50 bg-ops-panel sm:bottom-3 sm:left-3 sm:right-auto sm:w-[400px] sm:max-h-[70vh]" role="complementary" aria-label="Training coach">
      {spot}
      <div className="panel-title sticky top-0 z-10 bg-ops-panel">
        <span className="truncate">{lesson.exam ? 'Final exercise' : `Lesson ${lessonIndex + 1}`} · {lesson.title}</span>
        <span className="flex shrink-0 gap-1">
          <button className="btn px-2" onClick={academy} title="Training Academy">Academy</button>
          <button className="btn px-2" onClick={() => setOpen(false)} aria-label="Minimise coach">▾</button>
        </span>
      </div>
      <div className="space-y-2 p-3">
        <div className="flex gap-0.5" aria-label={`Step ${i + 1} of ${lesson.steps.length}`}>
          {lesson.steps.map((x, k) => (
            <span key={x.id} title={x.title} className={`h-1.5 flex-1 rounded ${k < i ? 'bg-ops-green' : k === i ? 'bg-ops-cyan' : 'bg-ops-line'}`} />
          ))}
        </div>
        {justDone && <div className="fadein text-[11px] text-ops-green" aria-live="polite">✔ {justDone}</div>}
        <div className="flex items-baseline justify-between gap-2">
          <div className="font-sans text-lg font-semibold leading-tight text-white">{step.title}</div>
          <span className="shrink-0 text-[10px] text-ops-dim">{i + 1}/{lesson.steps.length}</span>
        </div>
        <p className="text-[12px] leading-relaxed">{step.text}</p>
        {step.why && <p className="border-l-2 border-ops-cyan/50 pl-2 text-[11px] leading-relaxed text-ops-dim"><b className="text-ops-cyan">Why it matters: </b>{step.why}</p>}

        {q && (
          <div className="space-y-1.5">
            <div className="text-[12px] text-white">{q.question}</div>
            {q.options.map((o, k) => {
              const chosen = picked === k;
              const right = picked !== null && k === q.answer && picked === q.answer;
              return (
                <button key={o} disabled={picked === q.answer}
                  className={`btn block w-full whitespace-normal text-left normal-case tracking-normal ${right ? 'border-ops-green text-ops-green' : chosen ? 'border-ops-red text-ops-red' : ''}`}
                  onClick={() => setPicked(k)}>
                  {right ? '✔ ' : chosen ? '✘ ' : ''}{o}
                </button>
              );
            })}
            {picked !== null && (
              <p className={`text-[11px] leading-relaxed ${picked === q.answer ? 'text-ops-green' : 'text-ops-amber'}`} aria-live="polite">
                {picked === q.answer ? 'Correct. ' : 'Not quite, try again. '}{picked === q.answer ? q.explain : ''}
              </p>
            )}
          </div>
        )}

        {lesson.exam && <ExamStandards s={s} />}

        {timeUp && (
          <div className="rounded border border-ops-amber/50 bg-ops-amber/10 p-2 text-[11px] text-ops-amber">
            The lesson clock ran out before this step was done. Restart the lesson to try again.
          </div>
        )}

        {step.check && !timeUp && (
          <div className="flex items-center gap-2 text-[11px] text-ops-dim">
            <span className="blink inline-block h-2 w-2 rounded-full bg-ops-cyan" />
            Waiting for you…
            {s.status === 'running' && s.paused && !s.turnBased && (
              <button className="btn ml-auto" onClick={() => dispatch({ type: 'setPaused', paused: false })}>▶ Resume time</button>
            )}
          </div>
        )}
        {step.hint && !hint && <button className="btn text-[11px]" onClick={() => setHint(true)}>Show hint</button>}
        {step.hint && hint && <p className="rounded border border-ops-line p-2 text-[11px] leading-relaxed text-ops-dim"><b className="text-white">Hint: </b>{step.hint}</p>}

        <div className="flex flex-wrap justify-between gap-2 pt-1">
          <button className="btn" disabled={i === 0} onClick={() => go(i - 1)}>◂ Back</button>
          {step.view && <button className="btn" onClick={() => ui.setView(step.view as ViewId)}>Show me</button>}
          {timeUp ? <button className="btn btn-primary" onClick={restart}>Restart lesson</button>
            : last ? (
              lesson.exam ? <button className="btn btn-primary" onClick={academy}>Training Academy</button>
                : nextLesson ? <button className="btn btn-primary" onClick={() => { startLesson(nextLesson.id); ui.setView('global'); }}>Next: {nextLesson.title} ▸</button>
                  : <button className="btn btn-primary" onClick={academy}>Training Academy</button>
            )
              : isRead ? <button className="btn btn-primary" onClick={() => go(i + 1)}>Next ▸</button>
                : q ? <button className="btn btn-primary" disabled={picked !== q.answer} onClick={() => go(i + 1)}>Next ▸</button>
                  : <button className="btn" onClick={() => go(i + 1)} title="Skip this step">Skip ▸</button>}
        </div>
        {last && !lesson.exam && <p className="text-[11px] text-ops-green">Lesson complete. It is ticked off in the Training Academy.</p>}
      </div>
    </div>
  );
}

function ExamStandards({ s }: { s: SimState }) {
  const st = examStandards(s);
  const r = examResult(s);
  const final = s.status === 'complete';
  return (
    <div className="rounded border border-ops-amber/40 p-2">
      <div className="label mb-1 flex justify-between"><span>Standards {final ? '(final)' : '(live)'}</span><span>{r.met}/{r.total} met</span></div>
      <ul className="space-y-0.5 text-[11px]">
        {st.map((x) => (
          <li key={x.id} className="flex justify-between gap-2">
            <span className={x.met ? 'text-ops-green' : 'text-ops-dim'}>{x.met ? '✔' : '○'} {x.text}</span>
            <span className="shrink-0 text-white">{x.value}</span>
          </li>
        ))}
      </ul>
      {final && (
        <div className={`mt-2 font-sans text-lg font-bold ${r.passed ? 'text-ops-green' : 'text-ops-amber'}`}>
          {r.passed ? 'CERTIFIED' : 'NOT YET CERTIFIED'} · score {r.score} ({r.grade})
        </div>
      )}
      {final && !r.passed && <button className="btn mt-1" onClick={() => { startLesson('exam'); store.notify(); }}>Retry the exercise</button>}
    </div>
  );
}

/**
 * A glowing ring around the control the current step is about. Takes the first `data-coach` name with something
 * visible on screen and follows it as the page scrolls or dialogs open and close.
 */
function Spotlight({ names }: { names: string[] }) {
  const [rects, setRects] = useState<DOMRect[]>([]);
  const key = names.join(' ');
  useEffect(() => {
    const find = () => {
      for (const n of names) {
        const els = [...document.querySelectorAll<HTMLElement>(`[data-coach="${n}"]`)];
        const rs = els.map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight);
        // Skip controls hidden under an open dialog: the dialog's own controls (or nothing) should get the ring.
        const shown = rs.filter((r, i) => {
          const topEl = document.elementFromPoint(Math.min(window.innerWidth - 1, r.left + r.width / 2), Math.min(window.innerHeight - 1, r.top + Math.min(r.height / 2, 12)));
          return !!topEl && (els[i].contains(topEl) || topEl.closest('[data-coach]') === els[i] || !!topEl.closest('[aria-label="Training coach"]'));
        });
        if (shown.length) return shown;
      }
      return [];
    };
    const update = () => setRects((prev) => {
      const next = find();
      const same = prev.length === next.length && prev.every((r, i) => Math.abs(r.x - next[i].x) < 1 && Math.abs(r.y - next[i].y) < 1 && Math.abs(r.width - next[i].width) < 1);
      return same ? prev : next;
    });
    update();
    const id = window.setInterval(update, 400);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
    // `names` is compared by content, through `key`.
  }, [key]);
  if (!rects.length) return null;
  return createPortal(
    <>
      {rects.map((r, i) => (
        <div key={i} aria-hidden className="coach-spot pointer-events-none fixed z-[54] rounded"
          style={{ left: r.left - 4, top: r.top - 4, width: r.width + 8, height: r.height + 8 }} />
      ))}
    </>,
    document.body,
  );
}
