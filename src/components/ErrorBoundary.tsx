import { Component } from 'react';
import type { ReactNode } from 'react';

/**
 * Error Boundary to catch render errors and prevent blank-screen crashes.
 * Wrapping a component tree in ErrorBoundary ensures that an unexpected
 * render error shows a recoverable UI instead of a white screen.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '16px', textAlign: 'center' }}>
          <p>Something went wrong.</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      );
    }
    return this.props.children;
  }
}
