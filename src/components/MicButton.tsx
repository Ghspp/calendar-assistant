import './MicButton.css';

/**
 * The primary control of the app.
 *
 * Large enough to hit without looking (132px, well past the 44px minimum), with the
 * listening state shown by an expanding ring rather than a colour change alone.
 */

export type MicState = 'idle' | 'listening' | 'busy' | 'disabled';

export interface MicButtonProps {
  state: MicState;
  caption: string;
  onPress: () => void;
}

const LABELS: Record<MicState, string> = {
  idle: 'לחץ כדי לדבר',
  listening: 'מקשיב — לחץ לסיום',
  busy: 'רגע…',
  disabled: 'זיהוי דיבור לא זמין',
};

export default function MicButton({ state, caption, onPress }: MicButtonProps) {
  const disabled = state === 'disabled' || state === 'busy';

  return (
    <div className="mic">
      <button
        type="button"
        className={`mic__button mic__button--${state}`}
        onClick={onPress}
        disabled={disabled}
        aria-label={LABELS[state]}
        aria-pressed={state === 'listening'}
      >
        {/* Rings sit behind the icon and animate only while listening. */}
        <span className="mic__ring" aria-hidden="true" />
        <span className="mic__ring mic__ring--delayed" aria-hidden="true" />
        <span className="mic__icon" aria-hidden="true">
          {state === 'busy' ? '⏳' : '🎙️'}
        </span>
      </button>

      <p className="mic__caption" aria-live="polite">
        {caption}
      </p>
    </div>
  );
}
