export function startFixtureKeepalive(response) {
  // Human observation gates can outlast fetch's five-minute idle-body limit.
  // SSE comments keep the transport alive without projecting tool activity.
  const timer = setInterval(() => {
    if (response.destroyed || response.writableEnded) { stop(); return; }
    response.write(': waiting for human observation\n\n');
  }, 15_000);
  timer.unref?.();
  function stop() {
    clearInterval(timer);
    response.off('close', stop);
    response.off('finish', stop);
  }
  response.once('close', stop);
  response.once('finish', stop);
  return stop;
}
