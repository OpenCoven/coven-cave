// Keep the startup diagnosis and final failure without retaining an unbounded log.
const retainedCharacters = 16_000;

export function collectOutput(child) {
  let head = "";
  let tail = "";
  let length = 0;
  const append = (chunk) => {
    const text = String(chunk);
    length += text.length;
    const remaining = retainedCharacters - head.length;
    head += text.slice(0, remaining);
    tail = (tail + text.slice(remaining)).slice(-retainedCharacters);
  };
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding("utf8");
    stream?.on("data", append);
  }
  return () => length <= retainedCharacters * 2
    ? head + tail
    : `${head}\n[${length - head.length - tail.length} characters omitted]\n${tail}`;
}
