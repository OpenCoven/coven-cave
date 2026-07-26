export type BrowserNavigationRequest = {
  id: number;
  url: string;
};

export type ExpectedBrowserNavigation = {
  url: string;
  currentUrl: string;
  chainUrls: string[];
  expiresAt: number;
  started: boolean;
  completed: boolean;
  sequence?: number;
};

export type BrowserNavigationEventPhase = "started" | "finished" | "title";

export type BrowserNavigationEventDecision = {
  accept: boolean;
  nextExpected: ExpectedBrowserNavigation | null;
};

function expectationFromAuthoritativeEvent(
  actualUrl: string,
  phase: BrowserNavigationEventPhase,
  now: number,
  sequence: number,
): ExpectedBrowserNavigation {
  return {
    url: actualUrl,
    currentUrl: actualUrl,
    chainUrls: [actualUrl],
    expiresAt: now + 15_000,
    started: true,
    completed: phase === "finished" || phase === "title",
    sequence,
  };
}

export function createExpectedBrowserNavigation(
  url: string,
  now = Date.now(),
  sequence?: number,
): ExpectedBrowserNavigation {
  return {
    url,
    currentUrl: url,
    chainUrls: [url],
    expiresAt: now + 15_000,
    started: false,
    completed: false,
    sequence,
  };
}

function sameNavigationTarget(actual: string, expected: string): boolean {
  try {
    const actualUrl = new URL(actual);
    const expectedUrl = new URL(expected);
    actualUrl.hash = "";
    expectedUrl.hash = "";
    return actualUrl.toString() === expectedUrl.toString();
  } catch {
    return actual === expected;
  }
}

/**
 * Decide whether a native WebView event belongs to the newest requested URL.
 * WebView2 can report about:blank during attachment and can finish an older
 * navigation after a newer request has already been accepted by Rust.
 */
export function decideBrowserNavigationEvent(
  actualUrl: string,
  expected: ExpectedBrowserNavigation | undefined,
  phase: BrowserNavigationEventPhase,
  now = Date.now(),
  eventSequence = 0,
): BrowserNavigationEventDecision {
  if (actualUrl === "about:blank") {
    return { accept: false, nextExpected: expected ?? null };
  }
  if (!expected) {
    return {
      accept: true,
      nextExpected:
        eventSequence > 0
          ? expectationFromAuthoritativeEvent(actualUrl, phase, now, eventSequence)
          : null,
    };
  }

  if (expected.sequence !== undefined) {
    // Once Rust has assigned a generation, it is the authoritative ordering
    // signal. Keep its high-water mark indefinitely: retiring it after a new
    // user navigation would let the next delayed old finish/title through.
    if (eventSequence === 0) {
      return { accept: false, nextExpected: expected };
    }
    if (eventSequence < expected.sequence) {
      return { accept: false, nextExpected: expected };
    }
    if (eventSequence > expected.sequence) {
      return {
        accept: true,
        nextExpected: expectationFromAuthoritativeEvent(
          actualUrl,
          phase,
          now,
          eventSequence,
        ),
      };
    }
    const chainUrls = expected.chainUrls.some((url) => sameNavigationTarget(actualUrl, url))
      ? expected.chainUrls
      : [...expected.chainUrls, actualUrl];
    return {
      accept: true,
      nextExpected: {
        ...expected,
        currentUrl: actualUrl,
        chainUrls,
        started: expected.started || phase === "started" || phase === "finished",
        completed: expected.completed || phase === "finished",
      },
    };
  }

  if (now > expected.expiresAt) {
    return { accept: true, nextExpected: null };
  }

  const belongsToNewestChain = expected.chainUrls.some((url) =>
    sameNavigationTarget(actualUrl, url),
  );
  if (belongsToNewestChain) {
    const chainUrls = expected.chainUrls.some((url) => sameNavigationTarget(actualUrl, url))
      ? expected.chainUrls
      : [...expected.chainUrls, actualUrl];
    return {
      accept: true,
      nextExpected: {
        ...expected,
        currentUrl: actualUrl,
        chainUrls,
        started: expected.started || phase === "started" || phase === "finished",
        completed: expected.completed || phase === "finished",
      },
    };
  }

  if (phase === "started" && expected.started && !expected.completed) {
    // Once the requested URL has started, a new Started URL is its redirect
    // chain (for example discord.gg -> discord.com/invite). Keep the same
    // generation guard through the redirected Finished event.
    return {
      accept: true,
      nextExpected: {
        ...expected,
        currentUrl: actualUrl,
        chainUrls: [...expected.chainUrls, actualUrl],
      },
    };
  }

  if (phase === "started" && expected.completed) {
    // A genuinely new in-page navigation after the guarded load completed is
    // user driven. Accept it and retire the programmatic-navigation guard.
    return { accept: true, nextExpected: null };
  }

  // A finished/title event from an older rapid-click navigation cannot
  // overwrite the newest address, even after the newest load has finished.
  return { accept: false, nextExpected: expected };
}

export function enqueueBrowserNavigation(
  queue: BrowserNavigationRequest[],
  request: BrowserNavigationRequest,
): BrowserNavigationRequest[] {
  if (!request.url || queue.some((pending) => pending.url === request.url)) {
    return queue;
  }
  return [...queue, request];
}

export function consumeBrowserNavigation(
  queue: BrowserNavigationRequest[],
  id: number,
): BrowserNavigationRequest[] {
  return queue.filter((request) => request.id !== id);
}
