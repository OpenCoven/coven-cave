// @ts-nocheck
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const announce = vi.hoisted(() => vi.fn());
vi.mock("@/components/ui/live-region", () => ({
  useAnnouncer: () => ({ announce }),
}));

import { useOpenAiVoicePreview } from "./use-openai-voice-preview";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function audioResponse() {
  return new Response(new Blob(["audio"]), {
    status: 200,
    headers: { "content-type": "audio/mpeg" },
  });
}

type FakeAudio = {
  src: string;
  play: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  currentTime: number;
  onended: (() => void) | null;
  onerror: (() => void) | null;
};

let current: ReturnType<typeof useOpenAiVoicePreview>;
let renderer: ReactTestRenderer;
let audios: FakeAudio[];
let playResults: Array<Promise<void>>;
let revoked: string[];
let created = 0;

function Harness({ voiceId }: { voiceId: string }) {
  current = useOpenAiVoicePreview(voiceId);
  return <output data-state={current.state}>{current.error}</output>;
}

async function mount(voiceId = "alloy") {
  await act(async () => {
    renderer = create(<Harness voiceId={voiceId} />);
    await Promise.resolve();
  });
}

async function start() {
  await act(async () => {
    void current.start();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  announce.mockReset();
  audios = [];
  playResults = [];
  revoked = [];
  created = 0;
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:preview-${++created}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn((url: string) => revoked.push(url)),
  });
  Object.defineProperty(globalThis, "Audio", {
    configurable: true,
    value: vi.fn(function MockAudio(src: string) {
      const audio: FakeAudio = {
        src,
        play: vi.fn(() => playResults.shift() ?? Promise.resolve()),
        pause: vi.fn(),
        currentTime: 0,
        onended: null,
        onerror: null,
      };
      audios.push(audio);
      return audio;
    }),
  });
  globalThis.fetch = vi.fn(async () => audioResponse());
});

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  vi.restoreAllMocks();
});

describe("useOpenAiVoicePreview ownership", () => {
  test("stale non-ok JSON cannot stop or publish over a replacement preview", async () => {
    const staleJson = deferred<unknown>();
    globalThis.fetch = vi.fn(async (url: string) => {
      if (url.endsWith("alloy")) {
        return { ok: false, json: () => staleJson.promise } as Response;
      }
      return audioResponse();
    });
    await mount("alloy");
    await start();
    expect(current.state).toBe("loading");

    await act(async () => {
      renderer.update(<Harness voiceId="sage" />);
      await Promise.resolve();
    });
    await start();
    expect(current.state).toBe("playing");
    const replacement = audios[0];

    await act(async () => {
      staleJson.resolve({ error: "preview_unsupported", hint: "unsafe stale prose" });
      await staleJson.promise;
      await Promise.resolve();
    });
    expect(current.state).toBe("playing");
    expect(current.error).toBeNull();
    expect(replacement.pause).not.toHaveBeenCalled();
    expect(announce).not.toHaveBeenCalled();
  });

  test("an old onended callback cannot clean up a replacement", async () => {
    await mount("alloy");
    await start();
    const oldAudio = audios[0];
    const oldEnded = oldAudio.onended!;

    await act(async () => {
      renderer.update(<Harness voiceId="sage" />);
      await Promise.resolve();
    });
    await start();
    const replacement = audios[1];
    expect(current.state).toBe("playing");

    await act(async () => oldEnded());
    expect(current.state).toBe("playing");
    expect(replacement.pause).not.toHaveBeenCalled();
    expect(revoked).toEqual(["blob:preview-1"]);
  });

  test("current post-play onerror cleans up its own media and publishes static failure", async () => {
    await mount();
    await start();
    const audio = audios[0];
    await act(async () => audio.onerror!());
    expect(current.state).toBe("error");
    expect(current.error).toBe("Couldn’t preview this OpenAI voice.");
    expect(audio.pause).toHaveBeenCalledTimes(1);
    expect(audio.onended).toBeNull();
    expect(audio.onerror).toBeNull();
    expect(revoked).toEqual(["blob:preview-1"]);
    expect(announce).toHaveBeenCalledWith("Couldn’t preview this OpenAI voice.", "assertive");
  });

  test("play rejection revokes the owned URL and reports only static failure", async () => {
    const playFailure = deferred<void>();
    playResults.push(playFailure.promise);
    await mount();
    await start();
    await act(async () => {
      playFailure.reject(new Error("raw device failure"));
      await Promise.resolve();
    });
    expect(current.state).toBe("error");
    expect(current.error).toBe("Couldn’t preview this OpenAI voice.");
    expect(revoked).toEqual(["blob:preview-1"]);
    expect(JSON.stringify(announce.mock.calls)).not.toContain("raw device failure");
  });

  test("stop and unmount detach handlers, abort, pause, and revoke only their owner", async () => {
    const signals: AbortSignal[] = [];
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      signals.push(init!.signal as AbortSignal);
      return audioResponse();
    });
    await mount();
    await start();
    const first = audios[0];
    await act(async () => current.stop());
    expect(signals[0].aborted).toBe(true);
    expect(first.onended).toBeNull();
    expect(first.onerror).toBeNull();
    expect(first.pause).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual(["blob:preview-1"]);
    expect(current.state).toBe("idle");

    await start();
    const second = audios[1];
    await act(async () => renderer.unmount());
    expect(signals[1].aborted).toBe(true);
    expect(second.onended).toBeNull();
    expect(second.onerror).toBeNull();
    expect(second.pause).toHaveBeenCalledTimes(1);
    expect(revoked).toEqual(["blob:preview-1", "blob:preview-2"]);
  });
});
