"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";

export type ConfirmOptions = {
  /** Bold heading — the question, e.g. "Delete secret?" */
  title: string;
  /** Supporting detail beneath the title (consequences, scope). */
  body?: ReactNode;
  /** Primary action label (default "Confirm"). */
  confirmLabel?: string;
  /** Dismiss label (default "Cancel"). */
  cancelLabel?: string;
  /** Render the primary action in the destructive (red) style. */
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

/**
 * Mount once at the root. Replaces native window.confirm() with an in-app,
 * themed, focus-trapped dialog. Consumers call `await confirm({...})` and get a
 * boolean — same control flow as `if (!window.confirm(...)) return;`, just async.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback((opts: ConfirmOptions) => {
    // Only one dialog at a time — resolve any in-flight request as cancelled.
    if (pendingRef.current) pendingRef.current.resolve(false);
    return new Promise<boolean>((resolve) => setPending({ ...opts, resolve }));
  }, []);

  // Resolve the promise and close. Backdrop/Escape settle as cancelled.
  const settle = useCallback((value: boolean) => {
    setPending((p) => {
      p?.resolve(value);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!pending}
        onClose={() => settle(false)}
        ariaLabel={pending?.title ?? "Confirm"}
        footerActions={
          pending ? (
            <>
              {/* Cancel first so it takes the focus-trap's initial focus — the
                  safe default, especially for destructive confirms. */}
              <Button variant="secondary" onClick={() => settle(false)}>
                {pending.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                variant={pending.danger ? "danger" : "primary"}
                onClick={() => settle(true)}
              >
                {pending.confirmLabel ?? "Confirm"}
              </Button>
            </>
          ) : null
        }
      >
        {pending ? (
          <div className="ui-confirm">
            <h2 className="ui-confirm-title">{pending.title}</h2>
            {pending.body ? <div className="ui-confirm-body">{pending.body}</div> : null}
          </div>
        ) : null}
      </Modal>
    </ConfirmContext.Provider>
  );
}

/**
 * `const confirm = useConfirm()` then `if (!(await confirm({ title: "Delete?",
 * danger: true }))) return;`. Throws if no provider is in scope.
 */
export function useConfirm(): (opts: ConfirmOptions) => Promise<boolean> {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within a ConfirmProvider");
  return ctx;
}
