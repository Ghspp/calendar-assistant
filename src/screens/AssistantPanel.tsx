import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import './AssistantPanel.css';
import MicButton, { type MicState } from '../components/MicButton';
import { useAssistant, type AssistantMessage } from '../hooks/useAssistant';
import { useSpeech } from '../hooks/useSpeech';
import { createTtsService } from '../services/speech/TtsService';
import { loadPrefs, updatePrefs } from '../storage/prefs';
import { useInstallPrompt, useOnlineStatus } from '../hooks/useInstallPrompt';

/**
 * The assistant's home screen.
 *
 * Voice is the primary interaction; the text field stays as an always-available
 * fallback, which matters because the Web Speech API is Chrome-only and needs HTTPS.
 * Both routes feed the same `send`, so there is one command path, not two.
 */

const EXAMPLES = [
  'תקבע לי פגישה עם דניאל מחר בשש בערב לשעה',
  // Deliberately incomplete: shows off the follow-up questions.
  'תקבע לי אימון מחר',
  'מה יש לי מחר?',
  'מצא לי שעה פנויה של שעתיים מחר',
];

function bubbleClass(message: AssistantMessage): string {
  if (message.role === 'user') return 'assistant__bubble assistant__bubble--user';

  const base = 'assistant__bubble assistant__bubble--assistant';
  if (message.outcome === 'created') return `${base} assistant__bubble--created`;
  if (message.outcome === 'conflict' || message.outcome === 'failed') {
    return `${base} assistant__bubble--conflict`;
  }
  if (message.outcome === 'needs-input') return `${base} assistant__bubble--question`;
  return base;
}

export default function AssistantPanel() {
  const assistant = useAssistant();
  const [draft, setDraft] = useState('');
  const [speakReplies, setSpeakReplies] = useState(() => loadPrefs().speakReplies);
  const [soundReport, setSoundReport] = useState<string | undefined>();

  const tts = useMemo(() => createTtsService(), []);
  const online = useOnlineStatus();
  const installer = useInstallPrompt();

  // Speak each new assistant reply once. Tracking the id rather than the array length
  // keeps a cleared log from re-speaking anything.
  const lastSpokenId = useRef(0);

  useEffect(() => {
    if (!speakReplies || !tts.isSupported) return;

    const latest = assistant.messages[assistant.messages.length - 1];
    if (latest === undefined) return;
    if (latest.role !== 'assistant') return;
    if (latest.id <= lastSpokenId.current) return;

    lastSpokenId.current = latest.id;
    // Android holds the audio session briefly after speech recognition finishes, and
    // an utterance started inside that window is dropped without an error.
    tts.speak(latest.text, { delayMs: 350 });
  }, [assistant.messages, speakReplies, tts]);

  const handleTranscript = useCallback(
    (transcript: string) => {
      // A voice command goes straight through — the whole point is not to tap twice.
      void assistant.send(transcript);
    },
    [assistant],
  );

  const speech = useSpeech({ onFinal: handleTranscript });

  const ready = assistant.connection === 'connected';

  const micState: MicState = !speech.isSupported || !online
    ? 'disabled'
    : !ready
      ? 'disabled'
      : assistant.sending
        ? 'busy'
        : speech.state === 'listening'
          ? 'listening'
          : 'idle';

  const caption = (() => {
    if (!online) return 'אין חיבור לאינטרנט';
    if (!speech.isSupported) return speech.error?.message ?? 'זיהוי דיבור לא זמין בדפדפן הזה';
    if (!ready) return 'צריך להתחבר ליומן קודם';
    if (assistant.sending) return 'בודק ביומן…';
    if (speech.state === 'listening') {
      return speech.interim.length > 0 ? speech.interim : 'מקשיב…';
    }
    if (speech.error !== undefined) return speech.error.message;
    return 'לחץ כדי לדבר';
  })();

  function pressMic() {
    // Unlock speech synthesis while we are still inside the tap. The reply arrives
    // after an await, which mobile browsers will not accept as a user gesture.
    if (speakReplies) tts.prime();

    if (speech.state === 'listening') {
      speech.stop();
      return;
    }
    speech.clearError();
    tts.cancel();
    speech.start();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (speakReplies) tts.prime();
    const text = draft;
    setDraft('');
    void assistant.send(text);
  }

  function testSound() {
    // Spoken straight from the tap, so this is the best case the browser allows. If
    // this is silent too, the problem is the device rather than the app.
    tts.prime();
    tts.speak('בדיקת קול. אני שומע אותך.');

    globalThis.setTimeout(() => {
      const status = tts.getStatus();
      setSoundReport(
        status.voiceCount === 0
          ? 'המכשיר לא מדווח על אף קול מותקן.'
          : !status.hasLanguageVoice
            ? `יש ${status.voiceCount} קולות, אבל אין קול עברי מותקן.`
            : status.state === 'error'
              ? `שגיאה: ${status.detail ?? 'לא ידוע'}`
              : status.state === 'spoke' || status.state === 'speaking'
                ? 'הקול נשלח בהצלחה. אם לא שמעת — בדוק את עוצמת המדיה.'
                : `מצב: ${status.state}`,
      );
    }, 1200);
  }

  function toggleSpeech() {
    const next = !speakReplies;
    // Turning sound on is itself a tap, so it is a good moment to unlock the engine.
    if (next) tts.prime();
    setSpeakReplies(next);
    updatePrefs({ speakReplies: next });
    if (!next) tts.cancel();
  }

  return (
    <section className="assistant" aria-label="עוזר היומן">
      {!online ? (
        <p className="assistant__offline" role="status">
          אין חיבור לאינטרנט. האפליקציה נטענה מהמטמון, אבל היומן אינו זמין עד שהחיבור
          יחזור.
        </p>
      ) : null}

      <p className="assistant__prompt">מה תרצה שאקבע או לבדוק?</p>

      <MicButton state={micState} caption={caption} onPress={pressMic} />

      {assistant.connection === 'unconfigured' ? (
        <div className="assistant__connect">
          <p className="assistant__connect-text">
            החיבור ל-Google Calendar לא הוגדר. ראה את הוראות ההתקנה ב-README.
          </p>
        </div>
      ) : null}

      {assistant.connection === 'disconnected' || assistant.connection === 'connecting' ? (
        <div className="assistant__connect">
          <p className="assistant__connect-text">
            כדי לקבוע אירועים צריך לחבר את היומן שלך. ההרשאה מאפשרת קריאה ויצירה של
            אירועים בלבד.
          </p>
          <button
            type="button"
            className="assistant__button"
            disabled={assistant.connection === 'connecting'}
            onClick={() => {
              void assistant.connect();
            }}
          >
            {assistant.connection === 'connecting' ? 'מתחבר…' : 'התחבר ל-Google Calendar'}
          </button>
        </div>
      ) : null}

      <form className="assistant__composer" onSubmit={submit}>
        <input
          className="assistant__input"
          type="text"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="או הקלד כאן…"
          disabled={!ready || assistant.sending || !online}
          aria-label="פקודה ליומן"
        />
        <button
          type="submit"
          className="assistant__button"
          disabled={!ready || assistant.sending || !online || draft.trim().length === 0}
        >
          {assistant.sending ? '…' : 'שלח'}
        </button>
      </form>

      {ready && assistant.messages.length === 0 ? (
        <div className="assistant__examples">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="assistant__example"
              onClick={() => setDraft(example)}
            >
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {assistant.messages.length > 0 ? (
        <div className="assistant__log">
          {assistant.messages.map((message) => (
            <div key={message.id} className={bubbleClass(message)}>
              {message.text}
              {message.link !== undefined ? (
                <a
                  className="assistant__link"
                  href={message.link}
                  target="_blank"
                  rel="noreferrer noopener"
                >
                  פתח ביומן Google ↗
                </a>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {installer.canInstall ? (
        <div className="assistant__install">
          <span>אפשר להתקין את היומן על מסך הבית</span>
          <span>
            <button
              type="button"
              className="assistant__button"
              onClick={() => {
                void installer.install();
              }}
            >
              התקן
            </button>
            <button type="button" onClick={installer.dismiss}>
              לא עכשיו
            </button>
          </span>
        </div>
      ) : null}

      {soundReport !== undefined ? (
        <p className="assistant__offline" role="status">
          {soundReport}
        </p>
      ) : null}

      <div className="assistant__meta">
        <span>
          {ready ? 'מחובר ל-Google · קריאה ויצירת אירועים' : 'לא מחובר'}
        </span>
        <span>
          {tts.isSupported ? (
            <button type="button" onClick={toggleSpeech} aria-pressed={speakReplies}>
              {speakReplies ? '🔊 קול פעיל' : '🔇 קול כבוי'}
            </button>
          ) : null}
          {tts.isSupported ? (
            <button type="button" onClick={testSound}>
              בדוק קול
            </button>
          ) : null}
          {assistant.messages.length > 0 ? (
            <button type="button" onClick={assistant.clear}>
              נקה
            </button>
          ) : null}
          {ready ? (
            <button type="button" onClick={assistant.disconnect}>
              נתק
            </button>
          ) : null}
        </span>
      </div>
    </section>
  );
}
