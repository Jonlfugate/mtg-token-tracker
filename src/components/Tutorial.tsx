import { useEffect, useLayoutEffect, useState } from 'react';
import { useAppContext } from '../state/AppContext';
import { TUTORIAL_STEPS } from '../data/tutorialDeck';

interface TutorialProps {
  step: number;
  onAdvance: () => void;
  onSkip: () => void;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PADDING = 8;
const BLOCKER_Z = 260;

/**
 * Dim overlay with a transparent spotlight hole over the target element.
 *
 * Click blocking uses 4 surrounding divs instead of a single full-screen div —
 * this avoids z-index stacking-context issues where an ancestor of the target
 * creates its own stacking context, capping the target's z-index below the blocker.
 * The 4 divs physically don't overlap the spotlight area, so the target is always
 * directly clickable regardless of its stacking context.
 */
function TutorialOverlay({ targetAttr }: { targetAttr: string }) {
  const [rect, setRect] = useState<Rect | null>(null);
  const [vw, setVw] = useState(window.innerWidth);
  const [vh, setVh] = useState(window.innerHeight);

  useLayoutEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-tutorial-target="${targetAttr}"]`);
    if (!el) return;

    const measure = () => {
      const r = el.getBoundingClientRect();
      setRect({ x: r.left, y: r.top, width: r.width, height: r.height });
      setVw(window.innerWidth);
      setVh(window.innerHeight);
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(document.body);
    window.addEventListener('resize', measure, { passive: true });
    window.addEventListener('scroll', measure, { passive: true });

    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure);
    };
  }, [targetAttr]);

  const sx = rect ? Math.max(0, rect.x - PADDING) : 0;
  const sy = rect ? Math.max(0, rect.y - PADDING) : 0;
  const sw = rect ? rect.width + PADDING * 2 : 0;
  const sh = rect ? rect.height + PADDING * 2 : 0;

  const blockerBase: React.CSSProperties = {
    position: 'fixed',
    zIndex: BLOCKER_Z,
    background: 'rgba(0,0,0,0.65)',
    cursor: 'not-allowed',
  };

  return (
    <>
      {/* 4 surrounding dim+blocker panels — never overlap the spotlight */}
      {/* Top */}
      <div style={{ ...blockerBase, top: 0, left: 0, right: 0, height: sy }} />
      {/* Bottom */}
      <div style={{ ...blockerBase, top: sy + sh, left: 0, right: 0, bottom: 0 }} />
      {/* Left */}
      <div style={{ ...blockerBase, top: sy, left: 0, width: sx, height: sh }} />
      {/* Right */}
      <div style={{ ...blockerBase, top: sy, left: sx + sw, right: 0, height: sh }} />

      {/* Accent border around spotlight (pointer-events: none — purely decorative) */}
      {rect && (
        <svg
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: BLOCKER_Z + 1,
            pointerEvents: 'none',
          }}
          width={vw}
          height={vh}
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect
            x={sx}
            y={sy}
            width={sw}
            height={sh}
            rx={6}
            ry={6}
            fill="none"
            stroke="#a78bfa"
            strokeWidth={2}
            strokeDasharray="6 3"
          />
        </svg>
      )}
    </>
  );
}

export function Tutorial({ step, onAdvance, onSkip }: TutorialProps) {
  const { state } = useAppContext();
  const def = TUTORIAL_STEPS[step];

  // Auto-advance when the current step's predicate becomes true
  useEffect(() => {
    if (!def?.autoAdvance || !def.predicate) return;
    if (
      def.predicate({
        battlefield: state.battlefield,
        currentTurn: state.currentTurn,
        standaloneTokens: state.standaloneTokens,
      })
    ) {
      const timer = setTimeout(onAdvance, 600);
      return () => clearTimeout(timer);
    }
  }, [state.battlefield, state.currentTurn, state.standaloneTokens, def, onAdvance]);

  if (!def) return null;

  const isLast = step === TUTORIAL_STEPS.length - 1;

  return (
    <>
      {def.targetAttr && <TutorialOverlay targetAttr={def.targetAttr} />}
      <div className="tutorial-panel" role="dialog" aria-label="Tutorial step">
        <div className="tutorial-step-indicator">
          Step {step + 1} of {TUTORIAL_STEPS.length}
          <div className="tutorial-progress-dots">
            {TUTORIAL_STEPS.map((_, i) => (
              <span key={i} className={`tutorial-dot${i < step ? ' done' : i === step ? ' active' : ''}`} />
            ))}
          </div>
        </div>
        <h3 className="tutorial-title">{def.title}</h3>
        <p className="tutorial-body">{def.body}</p>
        <div className="tutorial-actions">
          {def.autoAdvance ? (
            <span className="tutorial-waiting">Do the action above to continue...</span>
          ) : (
            <button onClick={isLast ? onSkip : onAdvance} className="tutorial-next-btn">
              {isLast ? 'Done' : 'Next'}
            </button>
          )}
          {!isLast && (
            <button onClick={onSkip} className="tutorial-skip-btn secondary">
              Skip
            </button>
          )}
        </div>
      </div>
    </>
  );
}
