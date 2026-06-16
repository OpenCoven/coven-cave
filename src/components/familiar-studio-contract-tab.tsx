"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/lib/icon";
import type { ResolvedFamiliar } from "@/lib/familiar-resolve";
import type { ContractReport, ContractFile } from "@/lib/familiar-contract";

type Props = { familiar: ResolvedFamiliar };

type ContractResponse = {
  ok: boolean;
  id?: string;
  workspace?: string;
  present?: Record<"soul" | "identity" | "ward" | "memory", boolean>;
  report?: ContractReport;
  error?: string;
};

type LoadState = "idle" | "loading" | "ready" | "error";

const FILE_ORDER: Array<{ key: "soul" | "identity" | "ward" | "memory"; name: ContractFile }> = [
  { key: "soul", name: "SOUL.md" },
  { key: "identity", name: "IDENTITY.md" },
  { key: "ward", name: "ward.toml" },
  { key: "memory", name: "MEMORY.md" },
];

export function FamiliarStudioContractTab({ familiar }: Props) {
  const [state, setState] = useState<LoadState>("idle");
  const [data, setData] = useState<ContractResponse | null>(null);

  const runCheck = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/familiars/${encodeURIComponent(familiar.id)}/contract`, {
        cache: "no-store",
      });
      const json = (await res.json()) as ContractResponse;
      if (json.ok && json.report) {
        setData(json);
        setState("ready");
      } else {
        setData(json);
        setState("error");
      }
    } catch {
      setData(null);
      setState("error");
    }
  }, [familiar.id]);

  useEffect(() => {
    void runCheck();
  }, [runCheck]);

  const report = data?.report;

  return (
    <div className="familiar-studio-contract">
      <div className="familiar-studio-contract__intro">
        <p className="familiar-studio-contract__lede">
          Tests this familiar against the{" "}
          <a
            href="https://github.com/OpenCoven/familiar-contract"
            target="_blank"
            rel="noreferrer"
            className="familiar-studio-contract__link"
          >
            Familiar Contract
          </a>{" "}
          — the five-property identity spec a familiar must honor.
        </p>
        <button
          type="button"
          className="familiar-studio-contract__rerun"
          onClick={() => void runCheck()}
          disabled={state === "loading"}
        >
          <Icon name="ph:arrows-clockwise" width={13} />
          {state === "loading" ? "Checking…" : "Re-run check"}
        </button>
      </div>

      {state === "loading" && !report ? (
        <p className="familiar-studio-contract__status" role="status">
          Reading identity files…
        </p>
      ) : null}

      {state === "error" ? (
        <p className="familiar-studio-contract__status familiar-studio-contract__status--error" role="status">
          Couldn&apos;t run the check{data?.error ? `: ${data.error}` : ""}. The Coven daemon and this
          familiar&apos;s workspace must be reachable.
        </p>
      ) : null}

      {report ? (
        <>
          {/* Overall verdict */}
          <div
            className={`familiar-studio-contract__verdict familiar-studio-contract__verdict--${
              report.pass ? "pass" : "fail"
            }`}
            role="status"
          >
            <Icon name={report.pass ? "ph:seal-check-fill" : "ph:warning-circle-fill"} width={20} />
            <div className="familiar-studio-contract__verdict-text">
              <strong>
                {report.pass ? "Compliant" : `${report.violations.length} violation${report.violations.length === 1 ? "" : "s"}`}
              </strong>
              <span>
                familiar-contract v{report.specVersion}
                {report.pass && report.warnings.length > 0
                  ? ` · ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}`
                  : ""}
              </span>
            </div>
          </div>

          {/* Five-property coverage */}
          <section className="familiar-studio-contract__section">
            <h3 className="familiar-studio-contract__heading">Property coverage</h3>
            <ul className="familiar-studio-contract__properties">
              {report.properties.map((p) => (
                <li
                  key={p.property}
                  className={`familiar-studio-contract__property familiar-studio-contract__property--${
                    p.pass ? "pass" : "fail"
                  }`}
                >
                  <Icon name={p.pass ? "ph:check-circle-fill" : "ph:x-circle-fill"} width={16} aria-hidden />
                  <span>{p.property}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Files present on disk */}
          <section className="familiar-studio-contract__section">
            <h3 className="familiar-studio-contract__heading">Identity files</h3>
            <ul className="familiar-studio-contract__files">
              {FILE_ORDER.map(({ key, name }) => {
                const present = data?.present?.[key] ?? false;
                return (
                  <li
                    key={key}
                    className={`familiar-studio-contract__file familiar-studio-contract__file--${
                      present ? "present" : "absent"
                    }`}
                  >
                    <Icon name={present ? "ph:file-text" : "ph:file-dashed"} width={14} aria-hidden />
                    <code>{name}</code>
                    <span className="familiar-studio-contract__file-tag">{present ? "found" : "missing"}</span>
                  </li>
                );
              })}
            </ul>
            {data?.workspace ? (
              <p className="familiar-studio-contract__workspace">
                {data.workspace.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~")}
              </p>
            ) : null}
          </section>

          {/* Violations */}
          {report.violations.length > 0 ? (
            <section className="familiar-studio-contract__section">
              <h3 className="familiar-studio-contract__heading">Violations</h3>
              <ul className="familiar-studio-contract__findings">
                {report.violations.map((v, i) => (
                  <li key={`${v.file}-${v.field}-${i}`} className="familiar-studio-contract__finding">
                    <span className="familiar-studio-contract__finding-loc">
                      <code>{v.file}</code> › {v.field}
                    </span>
                    <span className="familiar-studio-contract__finding-msg">{v.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {/* Warnings */}
          {report.warnings.length > 0 ? (
            <section className="familiar-studio-contract__section">
              <h3 className="familiar-studio-contract__heading">Warnings</h3>
              <ul className="familiar-studio-contract__findings">
                {report.warnings.map((w, i) => (
                  <li
                    key={`${w.file}-${w.field}-${i}`}
                    className="familiar-studio-contract__finding familiar-studio-contract__finding--warn"
                  >
                    <span className="familiar-studio-contract__finding-loc">
                      <code>{w.file}</code> › {w.field}
                    </span>
                    <span className="familiar-studio-contract__finding-msg">{w.message}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
