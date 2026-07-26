import { stripAnsi } from "@/lib/ansi";
import { redactSecretText } from "@/lib/secret-redaction";

export type InstallJobOutput = {
  output: string;
  trace: string[];
};

const OUTPUT_CAP = 8_192;
const CLIENT_TAIL_CAP = 2_000;
const TRACE_LINE_CAP = 240;
const TRACE_LINES_CAP = 8;

/** Remove secrets before installer output is retained or sent to a client. */
export function redactSensitiveInstallOutput(value: string): string {
  return redactSecretText(value).replace(
    /^.*(?:GITHUB_(?:PAT|PERSONAL_ACCESS_TOKEN)|NPM_CONFIG_.*(?:AUTH|TOKEN)|(?:^|[_-])TOKEN)\s*=.*$/gim,
    "[redacted sensitive installer output]",
  );
}

export function appendOutput(job: InstallJobOutput, chunk: string) {
  job.output = redactSensitiveInstallOutput(job.output + stripAnsi(chunk)).slice(-OUTPUT_CAP);
}

export function appendTrace(job: InstallJobOutput, line: string) {
  const safeLine = redactSensitiveInstallOutput(stripAnsi(line))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TRACE_LINE_CAP);
  if (!safeLine) return;
  job.trace = [...job.trace, safeLine].slice(-TRACE_LINES_CAP);
}

/** Keep lifecycle facts stable while retaining the most useful raw output. */
export function installJobTail(job: InstallJobOutput): string {
  const trace = job.trace.join("\n").slice(-CLIENT_TAIL_CAP);
  const separator = trace && job.output ? "\n" : "";
  const outputBudget = Math.max(0, CLIENT_TAIL_CAP - trace.length - separator.length);
  return `${trace}${separator}${job.output.slice(-outputBudget)}`;
}
