"use client";

import { Component, Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { workspacePaneErrorMessage, workspacePaneResetKey } from "@/lib/workspace-pane-error";

export type WorkspacePaneUnavailable = {
  reason: string;
  recoveryLabel: string;
  onRecover: () => void;
};

export type WorkspacePanePageProps = {
  instanceId: string;
  landmark: string;
  status?: "ready" | "loading";
  unavailable?: WorkspacePaneUnavailable;
  children: ReactNode;
};

type WorkspacePaneErrorBoundaryProps = {
  landmark: string;
  resetKey: string;
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
          <Button size="sm" onClick={this.handleRetry}>Try again</Button>
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
  return (
    <section className="workspace-pane-page" data-pane-instance={instanceId} aria-label={landmark}>
      <WorkspacePaneErrorBoundary landmark={landmark} resetKey={workspacePaneResetKey(instanceId, landmark)}>
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
