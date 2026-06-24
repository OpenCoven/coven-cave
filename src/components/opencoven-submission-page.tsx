"use client";

import { OpenCovenSubmissionPanel } from "@/components/opencoven-submission-panel";

export function OpenCovenSubmissionPage() {
  return (
    <section className="flex h-full min-w-0 flex-col bg-background text-foreground">
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[1280px] px-4 pb-12 pt-5 sm:px-8">
          <div className="mb-4">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              OpenCoven
            </p>
            <h2 className="mt-1 text-[20px] font-semibold text-[var(--text-primary)]">
              Runtime and harness submissions
            </h2>
            <p className="mt-1 max-w-3xl text-[12px] text-muted-foreground">
              Submit once to OpenCoven, validate against OpenCoven contracts, publish into
              the OpenCoven catalog, and route execution through OpenCoven services.
            </p>
          </div>

          <OpenCovenSubmissionPanel />
        </div>
      </div>
    </section>
  );
}
