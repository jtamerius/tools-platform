import { Component } from 'react';

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: '40px', fontFamily: 'monospace', background: '#0e1120',
          color: '#ff6b6b', height: '100vh', overflowY: 'auto',
        }}>
          <h2 style={{ marginBottom: '16px' }}>Render error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: '13px' }}>
            {this.state.error.toString()}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
