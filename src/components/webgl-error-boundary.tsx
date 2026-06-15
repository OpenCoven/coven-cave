"use client";

import { Component, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Rendered instead of children once a render error is caught. */
  fallback: ReactNode;
  /** When this value changes, the boundary resets and retries children — so a
   *  transient failure recovers on the next data load instead of latching. */
  resetKey?: unknown;
};

type State = { failed: boolean };

/**
 * Render-error boundary for the Three.js delegation graph. WebGL can throw at
 * mount (no GPU / context-creation refused, common on older or virtualized
 * machines) or mid-render; without a boundary that surfaces as a blank 320px
 * box or a crashed view. Catching it lets the Calls view fall back to the 2D
 * list instead. React error boundaries must be class components.
 */
export class WebGLErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidUpdate(prev: Props) {
    if (prev.resetKey !== this.props.resetKey && this.state.failed) {
      this.setState({ failed: false });
    }
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
