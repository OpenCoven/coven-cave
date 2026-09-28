import { VoiceConnectError } from "./types.ts";

/** Play signed little-endian PCM as it arrives, with bounded queued audio.
 * Web Audio works in WKWebView as well as Chromium; unlike MP3 MediaSource it
 * does not depend on a browser-specific streaming codec. */
export async function playPcmStream(
  response: Response,
  context: AudioContext,
  signal: AbortSignal,
  sampleRate = 24_000,
): Promise<void> {
  if (!response.body) throw new VoiceConnectError("audio_playback_failed", "The voice service returned no audio. Retry the call.");
  const reader = response.body.getReader();
  const pending = new Map<AudioBufferSourceNode, { done: Promise<void>; finish: () => void }>();
  let nextTime = context.currentTime;
  let trailing: number | undefined;
  let samples = 0;
  const stop = () => {
    void reader.cancel().catch(() => {});
    for (const [source, entry] of pending) {
      try { source.stop(); } catch { /* already ended */ }
      entry.finish();
    }
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal.throwIfAborted();
      if (done) break;
      let bytes = value;
      if (trailing !== undefined) {
        bytes = new Uint8Array(value.length + 1);
        bytes[0] = trailing;
        bytes.set(value, 1);
      }
      trailing = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
      const count = Math.floor(bytes.length / 2);
      if (!count) continue;
      const buffer = context.createBuffer(1, count, sampleRate);
      const data = buffer.getChannelData(0);
      const view = new DataView(bytes.buffer, bytes.byteOffset, count * 2);
      for (let i = 0; i < count; i++) data[i] = view.getInt16(i * 2, true) / 32768;
      samples += count;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(context.destination);
      let resolve!: () => void;
      const donePlaying = new Promise<void>(done => { resolve = done; });
      const finish = () => {
        source.onended = null;
        source.disconnect();
        pending.delete(source);
        resolve();
      };
      source.onended = finish;
      pending.set(source, { done: donePlaying, finish });
      nextTime = Math.max(nextTime, context.currentTime + 0.025);
      source.start(nextTime);
      nextTime += buffer.duration;
      // Let fetch backpressure the provider instead of scheduling an entire
      // long utterance into the audio graph and retaining every decoded buffer.
      if (nextTime - context.currentTime > 2) {
        await pending.values().next().value?.done;
        signal.throwIfAborted();
      }
    }
    if (trailing !== undefined || samples === 0) {
      throw new VoiceConnectError("audio_playback_failed", "The voice service returned incomplete audio. Retry the call.");
    }
    await Promise.all([...pending.values()].map(entry => entry.done));
    signal.throwIfAborted();
  } catch (error) {
    stop();
    throw error;
  } finally {
    signal.removeEventListener("abort", stop);
    reader.releaseLock();
  }
}
