import { NextResponse } from "next/server";
import {
  ONBOARDING_BOOTSTRAP_BOUNDARIES,
  type OnboardingBootstrapState,
} from "@/lib/onboarding-bootstrap";
import {
  onboardingBootstrapStatus,
  startOrResumeOnboardingBootstrap,
} from "@/lib/server/onboarding-bootstrap";
import {
  readJsonBody,
  rejectNonLocalRequest,
} from "@/lib/server/api-security";

type BootstrapBody = {
  confirm?: boolean;
  resume?: boolean;
};

function response(state: OnboardingBootstrapState) {
  return NextResponse.json({
    ok: true,
    ...state,
    boundaries: ONBOARDING_BOOTSTRAP_BOUNDARIES,
  });
}

export function createOnboardingBootstrapHandlers(
  dependencies: {
    status: typeof onboardingBootstrapStatus;
    startOrResume: typeof startOrResumeOnboardingBootstrap;
  } = {
    status: onboardingBootstrapStatus,
    startOrResume: startOrResumeOnboardingBootstrap,
  },
) {
  return {
    async GET(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) return forbidden;
      return response(await dependencies.status());
    },
    async POST(req: Request) {
      const forbidden = rejectNonLocalRequest(req);
      if (forbidden) return forbidden;
      const parsed = await readJsonBody<BootstrapBody>(req, 1_024);
      if (!parsed.ok) return parsed.response;
      if (parsed.body.confirm !== true && parsed.body.resume !== true) {
        return NextResponse.json(
          { ok: false, error: "explicit setup confirmation required" },
          { status: 400 },
        );
      }
      const current = await dependencies.status();
      if (!current.confirmed && parsed.body.confirm !== true) {
        return NextResponse.json(
          { ok: false, error: "explicit setup confirmation required" },
          { status: 400 },
        );
      }
      const state = await dependencies.startOrResume(
        parsed.body.confirm === true,
      );
      return response(state);
    },
  };
}
