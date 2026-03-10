import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('React error boundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '2rem', color: '#fca5a5', background: '#1a1a2e', minHeight: '100vh' }}>
          <h1 style={{ color: '#e0e0e0' }}>Something went wrong</h1>
          <p>{this.state.error?.message}</p>
          <pre style={{ fontSize: '0.8rem', overflow: 'auto', background: '#0f0f1a', padding: '1rem', borderRadius: '8px' }}>
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => {
              localStorage.removeItem('mtg-token-tracker');
              window.location.reload();
            }}
            style={{ marginTop: '1rem', padding: '0.5rem 1rem', background: '#8b5cf6', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}
          >
            Clear saved data and reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
