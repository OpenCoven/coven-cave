"use client";

import { Component, Fragment, createRef, useRef, type ReactNode, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { workspacePaneErrorMessage, workspacePaneResetKey } from "@/lib/workspace-pane-error";

export type WorkspacePaneUnavailable = {
  reason: string;
  recoveryLabel: string;
  onRecover: () => void;
};

type WorkspacePanePageCommonProps = {
  instanceId: string;
  landmark: string;
};

type WorkspacePanePageReadyProps = {
  status?: "ready";
  unavailable?: never;
  children: ReactNode;
};

type WorkspacePanePageLoadingProps = {
  status: "loading";
  unavailable?: never;
  children?: never;
};

type WorkspacePanePageUnavailableProps = {
  status?: never;
  unavailable: WorkspacePaneUnavailable;
  children?: never;
};

export type WorkspacePanePageProps = WorkspacePanePageCommonProps &
  (WorkspacePanePageReadyProps | WorkspacePanePageLoadingProps | WorkspacePanePageUnavailableProps);

type WorkspacePaneErrorBoundaryProps = {
  landmark: string;
  resetKey: string;
  recoveryFocusRef: RefObject<HTMLElement | null>;
  children: ReactNode;
};

type WorkspacePaneErrorBoundaryState = {
  errorMessage: string | null;
  resetKey: string;
  retryKey: number;
};

class WorkspacePaneErrorBoundary extends Component<
  WorkspacePaneErrorBoundaryProps,
  WorkspacePaneErrorBoundaryState
> {
  private retryButtonRef = createRef<HTMLButtonElement>();
  private focusFrame: number | null = null;

  state: WorkspacePaneErrorBoundaryState = {
    errorMessage: null,
    resetKey: this.props.resetKey,
    retryKey: 0,
  };

  static getDerivedStateFromError(error: unknown): Partial<WorkspacePaneErrorBoundaryState> {
    return { errorMessage: workspacePaneErrorMessage(error) };
  }

  static getDerivedStateFromProps(
    props: WorkspacePaneErrorBoundaryProps,
    state: WorkspacePaneErrorBoundaryState,
  ): Partial<WorkspacePaneErrorBoundaryState> | null {
    if (props.resetKey !== state.resetKey) {
      return {
        errorMessage: null,
        retryKey: 0,
        resetKey: props.resetKey,
      };
    }
    return null;
  }

  componentDidMount() {
    if (this.state.errorMessage) this.focusRetry();
  }

  componentDidUpdate(
    _prevProps: WorkspacePaneErrorBoundaryProps,
    prevState: WorkspacePaneErrorBoundaryState,
  ) {
    if (this.state.errorMessage) {
      if (
        !prevState.errorMessage ||
        this.state.retryKey !== prevState.retryKey ||
        this.state.resetKey !== prevState.resetKey
      ) {
        this.focusRetry();
      }
      return;
    }

    if (prevState.errorMessage) this.focusPane();
  }

  componentWillUnmount() {
    this.cancelScheduledFocus();
  }

  private cancelScheduledFocus() {
    if (this.focusFrame === null || typeof window === "undefined") return;
    window.cancelAnimationFrame(this.focusFrame);
    this.focusFrame = null;
  }

  private scheduleFocus = (target: () => HTMLElement | null) => {
    this.cancelScheduledFocus();
    if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return;
    this.focusFrame = window.requestAnimationFrame(() => {
      this.focusFrame = null;
      target()?.focus();
    });
  };

  private focusRetry = () => {
    this.scheduleFocus(() => this.retryButtonRef.current);
  };

  private focusPane = () => {
    this.scheduleFocus(() => this.props.recoveryFocusRef.current);
  };

  private handleRetry = () => {
    this.setState((state) => ({
      errorMessage: null,
      retryKey: state.retryKey + 1,
    }));
  };

  render() {
    if (this.state.errorMessage) {
      return (
        <div className="workspace-pane-page__state workspace-pane-page__state--error" role="alert">
          <div className="workspace-pane-page__state-copy">
            <p className="workspace-pane-page__state-title">{this.props.landmark} could not load</p>
            <p className="workspace-pane-page__state-description">{this.state.errorMessage}</p>
          </div>
          <Button ref={this.retryButtonRef} size="sm" onClick={this.handleRetry}>Try again</Button>
        </div>
      );
    }

    return <Fragment key={this.state.retryKey}>{this.props.children}</Fragment>;
  }
}

export function WorkspacePanePage({
  instanceId,
  landmark,
  status = "ready",
  unavailable,
  children,
}: WorkspacePanePageProps) {
  const paneRef = useRef<HTMLElement>(null);

  return (
    <section
      ref={paneRef}
      className="workspace-pane-page"
      data-pane-instance={instanceId}
      aria-label={landmark}
      tabIndex={-1}
    >
      <WorkspacePaneErrorBoundary
        landmark={landmark}
        resetKey={workspacePaneResetKey(instanceId, landmark)}
        recoveryFocusRef={paneRef}
      >
        {status === "loading" ? (
          <div
            className="workspace-pane-page__state workspace-pane-page__state--loading"
            role="status"
            aria-live="polite"
            aria-label={`${landmark} is loading`}
          >
            <SkeletonRows count={6} className="workspace-pane-page__skeleton" />
          </div>
        ) : unavailable ? (
          <div
            className="workspace-pane-page__state workspace-pane-page__state--unavailable"
            role="status"
            aria-live="polite"
          >
            <div className="workspace-pane-page__state-copy">
              <p className="workspace-pane-page__state-title">{landmark} is unavailable</p>
              <p className="workspace-pane-page__state-description">{unavailable.reason}</p>
            </div>
            <Button size="sm" onClick={unavailable.onRecover}>{unavailable.recoveryLabel}</Button>
          </div>
        ) : (
          children
        )}
      </WorkspacePaneErrorBoundary>
    </section>
  );
}
