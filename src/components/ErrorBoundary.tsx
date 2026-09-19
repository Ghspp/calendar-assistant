import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Last line of defence against a white screen.
 *
 * An unhandled render error would otherwise leave the user staring at nothing, with no
 * hint that anything is wrong. This catches it, says so in Hebrew, and offers a reload.
 *
 * It deliberately does NOT report anywhere: there is no backend and no analytics, and
 * the error text could contain event titles.
 */

interface Props {
  children: ReactNode;
}

interface State {
  error?: Error;
}

export default class ErrorBoundary extends Component<Props, State> {
  override state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // The console is the only sink. Nothing leaves the device.
    console.error('Unhandled error in the assistant UI', error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === undefined) return this.props.children;

    return (
      <main className="app-shell">
        <section className="panel" role="alert">
          <h2>משהו השתבש</h2>
          <p className="hint" style={{ marginBlockStart: 'var(--space-3)' }}>
            האפליקציה נתקלה בשגיאה בלתי צפויה. שום דבר לא נשלח ליומן.
          </p>
          <button
            type="button"
            className="assistant__button"
            style={{ marginBlockStart: 'var(--space-4)' }}
            onClick={() => window.location.reload()}
          >
            טען מחדש
          </button>
          <pre className="code-block" dir="ltr" style={{ marginBlockStart: 'var(--space-4)' }}>
            {error.message}
          </pre>
        </section>
      </main>
    );
  }
}
