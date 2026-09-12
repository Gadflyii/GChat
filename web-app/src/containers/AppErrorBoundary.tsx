import { Component, type ReactNode } from 'react'
import GlobalError from './GlobalError'

export class AppErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean; error: unknown }
> {
  state = { failed: false, error: undefined as unknown }

  static getDerivedStateFromError(error: unknown) {
    return { failed: true, error }
  }

  componentDidCatch(error: Error) {
    console.error('Application render failed:', error)
  }

  render() {
    return this.state.failed
      ? <GlobalError error={this.state.error} />
      : this.props.children
  }
}
