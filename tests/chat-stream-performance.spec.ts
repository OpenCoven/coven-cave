import { expect, test } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { setup, openThread } from "./chat-context-fixture";
import {
  createStreamWorkload, evaluateStreamPerformance, hasCompleteStreamText, overlappingLongTasks,
  STREAM_PERFORMANCE_PROFILE as profile,
  type LongTask, type StreamPerformanceSample,
} from "./fixtures/chat-stream-performance";

type Probe = {
  ready: boolean;
  requests: number;
  produced: number;
  cancelled: boolean;
  observerSupported: boolean;
  tasks: LongTask[];
  observer: PerformanceObserver | null;
  release: (() => void) | null;
  start: number | null;
  producerEnd: number | null;
};

declare global {
  interface Window { __caveStreamPerformance: Probe }
}

test.skip(process.env.CAVE_STREAM_PERFORMANCE !== "1", "Run pnpm performance:stream");

for (const pattern of profile.patterns) {
  test(`10,000-event ${pattern} stream meets its production p95 budget`, async ({
    browser, baseURL, extraHTTPHeaders,
  }, testInfo) => {
    test.setTimeout(480_000);
    if (!baseURL || !process.env.CAVE_STREAM_ARTIFACT_ROOT) throw new Error("Missing benchmark invocation");
    const artifactRoot = process.env.CAVE_STREAM_ARTIFACT_ROOT;
    const control = process.env.CAVE_STREAM_CONTROL === "1";
    const { frames, expectedText } = createStreamWorkload();
    const samples: Array<StreamPerformanceSample & {
      error?: string; tasks?: LongTask[]; producerMs?: number; renderedMs?: number;
      renderedTurns?: number; renderedParagraphs?: number; cleanup?: boolean;
    }> = [];
    const report = {
      invocation: JSON.parse(readFileSync(path.join(artifactRoot, "invocation.json"), "utf8")),
      buildId: readFileSync(path.join(process.cwd(), ".next/BUILD_ID"), "utf8").trim(),
      browser: browser.version(), profile, pattern, control, samples,
      measurement: "Longest overlapping main-thread Long Task; zero means no task >=50 ms observed. Not INP.",
      limitations: [
        "Production web renderer with synthetic API data and browser ReadableStream send response",
        "Provider, daemon, transport, native-client and durable storage costs are excluded",
        "Fresh contexts; route interception disables HTTP caching",
      ],
      verdict: evaluateStreamPerformance(pattern, samples),
    };
    const output = path.join(artifactRoot, `${pattern}.json`);
    const save = () => {
      report.verdict = evaluateStreamPerformance(pattern, samples);
      writeFileSync(output, JSON.stringify(report, null, 2));
    };
    try {
      for (let index = 0; index < profile.trials; index++) {
        const sample: typeof samples[number] = {
          index, pattern, complete: false, observerSupported: false, sendCount: 0,
          textMatches: false, draftMatches: false, eventCount: 0, historyTurns: 0,
          textBytes: Buffer.byteLength(expectedText), sseBytes: Buffer.byteLength(frames.join("")),
          longestTaskMs: 0,
        };
        samples.push(sample);
        const context = await browser.newContext({
          baseURL, extraHTTPHeaders, viewport: profile.viewport, serviceWorkers: "block",
        });
        let typing: Promise<void> | undefined;
        try {
          await context.route("**/*", route =>
            new URL(route.request().url()).origin === baseURL ? route.continue() : route.abort());
          const page = await context.newPage();
          const errors: string[] = [];
          page.on("pageerror", error => { if (errors.length < 5) errors.push(error.message.slice(0, 300)); });
          const history = page.waitForResponse(
            response => new URL(response.url()).pathname === "/api/chat/conversation/context-a",
            { timeout: 30_000 },
          ).then(response => response.json()).then(body => body.conversation?.turns?.length as number)
            .catch(() => 0);
          await page.addInitScript(({ frames, pattern, batchSize, batchDelayMs, stallMs }) => {
            const probe: Probe = {
              ready: false, requests: 0, produced: 0, cancelled: false,
              observerSupported: typeof PerformanceObserver !== "undefined" &&
                PerformanceObserver.supportedEntryTypes.includes("longtask"),
              tasks: [], observer: null, release: null, start: null, producerEnd: null,
            };
            window.__caveStreamPerformance = probe;
            if (probe.observerSupported) {
              probe.observer = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                  probe.tasks.push({ start: entry.startTime, duration: entry.duration });
                }
              });
              probe.observer.observe({ type: "longtask", buffered: true });
            }
            const originalFetch = window.fetch.bind(window);
            window.fetch = async (input, init) => {
              const url = new URL(input instanceof Request ? input.url : String(input), location.href);
              if (url.pathname !== "/api/chat/send") return originalFetch(input, init);
              if (++probe.requests !== 1) throw new Error("Duplicate synthetic send");
              const encoder = new TextEncoder();
              let timer: ReturnType<typeof setTimeout> | undefined;
              const body = new ReadableStream<Uint8Array>({
                start(controller) {
                  probe.release = () => {
                    probe.start = performance.now();
                    // Positive control deliberately breaches the same detector
                    // and verdict; it never changes the budget or sample count.
                    const stallUntil = performance.now() + stallMs;
                    while (performance.now() < stallUntil) { /* intentional control */ }
                    const emit = () => {
                      const end = pattern === "burst" ? frames.length
                        : Math.min(frames.length, probe.produced + batchSize);
                      controller.enqueue(encoder.encode(frames.slice(probe.produced, end).join("")));
                      probe.produced = end;
                      if (end === frames.length) {
                        probe.producerEnd = performance.now();
                        controller.close();
                      } else timer = setTimeout(emit, batchDelayMs);
                    };
                    emit();
                  };
                  probe.ready = true;
                },
                cancel() { probe.cancelled = true; clearTimeout(timer); },
              });
              return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
            };
          }, {
            frames, pattern, batchSize: profile.batchSize, batchDelayMs: profile.batchDelayMs,
            stallMs: control && index < 6 ? 260 : 0,
          });
          await setup(page);
          await openThread(page, "A");
          sample.historyTurns = await history;
          expect(sample.historyTurns).toBe(profile.historyTurns);
          const main = page.getByTestId("chat-main");
          const composer = main.getByRole("textbox", { name: "Message", exact: true });
          await composer.fill("Synthetic 10000-event measurement");
          await composer.press("Enter");
          await page.waitForFunction(() => window.__caveStreamPerformance.ready, undefined, { timeout: 10_000 });
          await composer.focus();
          await page.evaluate(() => window.__caveStreamPerformance.release!());
          const draft = "Retain this unsent draft";
          typing = composer.pressSequentially(draft, { delay: 25 });
          // Observe this promise immediately even if a separate rendering
          // assertion fails before we reach its normal await.
          void typing.catch(() => {});
          const response = main.locator(".cave-linear-turn--assistant").last();
          await expect(response.locator(".streaming-turn-prose")).toContainText("ENDSTREAM10000", { timeout: 30_000 });
          await expect(response.getByText("Cody completed response", { exact: true })).toBeAttached();
          const renderedAt = await page.evaluate(() => new Promise<number>(resolve =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
          await typing;
          await expect(composer).toHaveValue(draft);
          const observed = await page.evaluate(() => {
            const probe = window.__caveStreamPerformance;
            for (const entry of probe.observer?.takeRecords() ?? []) {
              probe.tasks.push({ start: entry.startTime, duration: entry.duration });
            }
            const prose = Array.from(document.querySelectorAll(
              '[data-testid="chat-main"] .cave-linear-turn--assistant .streaming-turn-prose',
            )).at(-1);
            return {
              observerSupported: probe.observerSupported, requests: probe.requests,
              produced: probe.produced, cancelled: probe.cancelled, tasks: probe.tasks,
              start: probe.start, producerEnd: probe.producerEnd,
              text: prose?.textContent ?? "",
              paragraphs: Array.from(prose?.querySelectorAll("p") ?? [], node => node.textContent ?? ""),
              renderedTurns: document.querySelectorAll('[data-testid="chat-main"] [data-turn-id]').length,
            };
          });
          if (observed.start === null || observed.producerEnd === null) throw new Error("Unfinished stream");
          sample.tasks = overlappingLongTasks(observed.tasks, observed.start, renderedAt);
          Object.assign(sample, {
            observerSupported: observed.observerSupported, sendCount: observed.requests,
            eventCount: observed.produced,
            textMatches: hasCompleteStreamText(observed.text, observed.paragraphs, expectedText),
            draftMatches: await composer.inputValue() === draft,
            longestTaskMs: Math.max(0, ...sample.tasks.map(entry => entry.duration)),
            producerMs: observed.producerEnd - observed.start, renderedMs: renderedAt - observed.start,
            renderedTurns: observed.renderedTurns,
            renderedParagraphs: observed.paragraphs.length,
            complete: !observed.cancelled && errors.length === 0,
          });
          if (errors.length) sample.error = errors.join("; ");
          if (index === 0) await page.screenshot({ path: path.join(artifactRoot, `${pattern}.png`) });
        } catch (error) {
          sample.error = String(error).slice(0, 1_000);
        } finally {
          await context.close().then(() => { sample.cleanup = true; })
            .catch(() => { sample.cleanup = false; sample.complete = false; });
          await typing?.catch(() => {});
          save();
        }
        if (!sample.complete || sample.error) break;
      }
    } finally {
      save();
      await testInfo.attach(`${pattern}-measurements`, { path: output, contentType: "application/json" });
    }
    expect(report.verdict.failures, JSON.stringify(report.verdict)).toEqual([]);
    expect(report.verdict.pass).toBe(true);
  });
}
