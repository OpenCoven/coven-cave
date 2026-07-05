"use client";

import { useState } from "react";
import { Icon } from "@/lib/icon";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { StandardSelect } from "@/components/ui/select";
import { STICKY_COLORS, type FlowNodeType, type FlowParamField } from "@/lib/flow/flow-catalog";
import type { FlowNode, FlowNodeSettings, FlowParamValue, FlowStickyData } from "@/lib/flow/flow-doc";
import type { FlowNodeRunData } from "@/lib/flow/flow-progress";
import { webhookProductionPath, webhookTestPath } from "@/lib/flow/flow-webhook";

export type NodeDetailOption = { value: string; label: string };

export type NodeDetailViewProps = {
  node: FlowNode;
  def: FlowNodeType | undefined;
  familiarOptions: NodeDetailOption[];
  skillOptions: NodeDetailOption[];
  /** Input/output data from the latest run, when there is one. */
  runData: FlowNodeRunData | null;
  onRename: (name: string) => void;
  onChangeParam: (key: string, value: FlowParamValue) => void;
  onChangeNotes: (notes: string) => void;
  onToggleDisplayNote: () => void;
  onChangeSettings: (patch: Partial<FlowNodeSettings>) => void;
  onToggleDisabled: () => void;
  onExecuteNode: () => void;
  onPinData: (data: string) => void;
  onDuplicate: () => void;
  onListenWebhookTest: () => Promise<{ testUrl: string; expiresAt: string } | null>;
  onChangeSticky: (patch: Partial<FlowStickyData>) => void;
  onDelete: () => void;
  onClose: () => void;
};

const RUN_STATUS_LABEL: Record<FlowNodeRunData["status"], string> = {
  pending: "Not run",
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  skipped: "Skipped",
};

export function NodeDetailView(props: NodeDetailViewProps) {
  const { node, def } = props;
  if (def?.sticky || node.sticky) return <StickyDetail {...props} />;

  return (
    <aside className="flow-ndv" aria-label={`${node.name} settings`}>
      <header className="flow-ndv-head">
        <span className="flow-ndv-icon" style={{ background: def?.accent ?? "#7b7f87" }} aria-hidden>
          <Icon name={def?.icon ?? "ph:cube"} width={16} />
        </span>
        <NameField value={node.name} onCommit={props.onRename} />
        <IconButton
          icon="ph:x"
          size="sm"
          className="flow-ndv-close"
          onClick={props.onClose}
          aria-label="Close settings"
        />
      </header>
      <p className="flow-ndv-type">{def?.label ?? node.type}</p>
      {def?.description && <p className="flow-ndv-desc">{def.description}</p>}

      <div className="flow-ndv-fields">
        {node.type === "trigger.webhook" && (
          <WebhookUrlsSection node={node} onListenWebhookTest={props.onListenWebhookTest} />
        )}

        {(def?.params ?? []).length === 0 && (
          <p className="flow-ndv-no-params">This node has no parameters.</p>
        )}
        {(def?.params ?? []).map((field) => (
          <ParamRow
            key={field.key}
            field={field}
            value={node.params[field.key]}
            familiarOptions={props.familiarOptions}
            skillOptions={props.skillOptions}
            onChange={(value) => props.onChangeParam(field.key, value)}
          />
        ))}

        <label className="flow-ndv-field">
          <span className="flow-ndv-label">Notes</span>
          <textarea
            className="flow-ndv-textarea"
            rows={2}
            value={node.notes ?? ""}
            placeholder="Optional note shown on hover"
            onChange={(event) => props.onChangeNotes(event.target.value)}
          />
        </label>
        <label className="flow-ndv-field">
          <span className="flow-ndv-toggle">
            <input
              type="checkbox"
              checked={node.displayNote === true}
              onChange={props.onToggleDisplayNote}
            />
            <span>Display note in flow</span>
          </span>
        </label>

        <ExecutionSettingsSection
          node={node}
          onChangeSettings={props.onChangeSettings}
          onToggleDisabled={props.onToggleDisabled}
        />

        {props.runData && <RunDataSection data={props.runData} />}

        <PinnedDataSection node={node} runData={props.runData} onPinData={props.onPinData} />
      </div>

      <footer className="flow-ndv-foot">
        <Button
          variant="primary"
          size="xs"
          leadingIcon="ph:play"
          className="flow-ndv-action flow-ndv-primary"
          onClick={props.onExecuteNode}
          disabled={node.disabled === true}
          title={node.disabled ? "Enable this node before executing it." : undefined}
        >
          Execute step
        </Button>
        <Button
          variant="secondary"
          size="xs"
          leadingIcon={node.disabled ? "ph:play" : "ph:pause"}
          className="flow-ndv-action"
          onClick={props.onToggleDisabled}
        >
          {node.disabled ? "Enable" : "Disable"}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          leadingIcon="ph:copy"
          className="flow-ndv-action"
          onClick={props.onDuplicate}
        >
          Duplicate
        </Button>
        <Button
          variant="danger"
          size="xs"
          leadingIcon="ph:trash"
          className="flow-ndv-action flow-ndv-danger"
          onClick={props.onDelete}
        >
          Delete
        </Button>
      </footer>
    </aside>
  );
}

function ExecutionSettingsSection({
  node,
  onChangeSettings,
  onToggleDisabled,
}: {
  node: FlowNode;
  onChangeSettings: (patch: Partial<FlowNodeSettings>) => void;
  onToggleDisabled: () => void;
}) {
  const settings = node.settings ?? {};
  const alwaysOutputData = settings.alwaysOutputData === true;
  const executeOnce = settings.executeOnce === true;
  const retryOnFail = settings.retryOnFail === true;
  const maxTries = settings.maxTries ?? 2;
  const onError = settings.onError ?? "stop";
  return (
    <section className="flow-ndv-settings" aria-label="Execution settings">
      <span className="flow-ndv-label">Execution settings</span>
      <label className="flow-ndv-field">
        <span className="flow-ndv-toggle">
          <input
            type="checkbox"
            checked={node.disabled === true}
            onChange={onToggleDisabled}
          />
          <span>Deactivate node</span>
        </span>
      </label>
      <label className="flow-ndv-field">
        <span className="flow-ndv-toggle">
          <input
            type="checkbox"
            checked={alwaysOutputData}
            onChange={(event) => onChangeSettings({ alwaysOutputData: event.target.checked })}
          />
          <span>Always output data</span>
        </span>
      </label>
      <label className="flow-ndv-field">
        <span className="flow-ndv-toggle">
          <input
            type="checkbox"
            checked={executeOnce}
            onChange={(event) => onChangeSettings({ executeOnce: event.target.checked })}
          />
          <span>Execute once</span>
        </span>
      </label>
      <label className="flow-ndv-field">
        <span className="flow-ndv-toggle">
          <input
            type="checkbox"
            checked={retryOnFail}
            onChange={(event) =>
              onChangeSettings({
                retryOnFail: event.target.checked,
                maxTries: event.target.checked ? maxTries : 1,
              })
            }
          />
          <span>Retry on fail</span>
        </span>
      </label>
      <label className="flow-ndv-field">
        <span className="flow-ndv-label">Max tries</span>
        <input
          className="flow-ndv-input"
          type="number"
          min={1}
          max={10}
          value={maxTries}
          disabled={!retryOnFail}
          onChange={(event) => onChangeSettings({ maxTries: Number(event.target.value) })}
        />
      </label>
      <label className="flow-ndv-field">
        <span className="flow-ndv-label">On error</span>
        <StandardSelect<NonNullable<FlowNodeSettings["onError"]>>
          label="On error"
          className="flow-ndv-input"
          value={onError}
          onChange={(next) => onChangeSettings({ onError: next })}
          options={[
            { value: "stop", label: "Stop workflow" },
            { value: "continue", label: "Continue with last output" },
            { value: "continueErrorOutput", label: "Continue using error output" },
          ]}
        />
      </label>
    </section>
  );
}

function WebhookUrlsSection({
  node,
  onListenWebhookTest,
}: {
  node: FlowNode;
  onListenWebhookTest: () => Promise<{ testUrl: string; expiresAt: string } | null>;
}) {
  const [copied, setCopied] = useState(false);
  const [listening, setListening] = useState(false);
  const [testListen, setTestListen] = useState<{ testUrl: string; expiresAt: string } | null>(null);
  const method = typeof node.params.method === "string" && node.params.method.trim()
    ? node.params.method.trim().toUpperCase()
    : "POST";
  const path = typeof node.params.path === "string" ? node.params.path : "/hook";
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const productionUrl = `${origin}${webhookProductionPath(path)}`;
  const testUrl = testListen?.testUrl ?? `${origin}${webhookTestPath(path)}`;
  const copyUrl = async (url: string) => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };
  const listen = async () => {
    setListening(true);
    try {
      const result = await onListenWebhookTest();
      if (result) setTestListen(result);
    } finally {
      setListening(false);
    }
  };

  return (
    <section className="flow-ndv-webhook" aria-label="Webhook URLs">
      <div className="flow-ndv-webhook-head">
        <span className="flow-ndv-label">Webhook URLs</span>
        <span className="flow-ndv-webhook-method">{method}</span>
      </div>
      <div className="flow-ndv-webhook-url-row">
        <span className="flow-ndv-webhook-url-label">Production URL</span>
        <code className="flow-ndv-webhook-url">{productionUrl}</code>
        <Button
          variant="secondary"
          size="xs"
          className="flow-ndv-mini-action"
          onClick={() => void copyUrl(productionUrl)}
        >
          {copied ? "Copied" : "Copy URL"}
        </Button>
      </div>
      <div className="flow-ndv-webhook-url-row">
        <span className="flow-ndv-webhook-url-label">Test URL</span>
        <code className="flow-ndv-webhook-url">{testUrl}</code>
        <Button
          variant="secondary"
          size="xs"
          className="flow-ndv-mini-action"
          onClick={() => void copyUrl(testUrl)}
        >
          {copied ? "Copied" : "Copy URL"}
        </Button>
      </div>
      <Button
        variant="primary"
        size="xs"
        leadingIcon="ph:play"
        className="flow-ndv-webhook-listen"
        disabled={listening}
        onClick={() => void listen()}
      >
        {listening ? "Listening..." : "Listen for test event"}
      </Button>
      <p className="flow-ndv-webhook-note">
        {testListen
          ? `Test URL is listening until ${new Date(testListen.expiresAt).toLocaleTimeString()}.`
          : "Production URL is armed when this flow is active and saved. Test URL listens for 120 seconds."}
      </p>
    </section>
  );
}

/** n8n-style data view: what fed into this node and what it produced, from the
 *  latest run's per-node narration. */
function RunDataSection({ data }: { data: FlowNodeRunData }) {
  return (
    <div className="flow-ndv-data">
      <div className="flow-ndv-data-head">
        <span className={`flow-ndv-data-status flow-ndv-data-status-${data.status}`}>
          {RUN_STATUS_LABEL[data.status]}
        </span>
        <span className="flow-ndv-data-title">Run data</span>
        {data.stale && <span className="flow-ndv-data-stale">Stale data</span>}
      </div>
      {data.stale && (
        <p className="flow-ndv-data-stale-note">Node changed since this execution. Rerun it to refresh data.</p>
      )}

      <div className="flow-ndv-data-block">
        <span className="flow-ndv-data-label">
          <Icon name="ph:arrow-down" width={11} aria-hidden /> Input
        </span>
        {data.inputs.length === 0 ? (
          <p className="flow-ndv-data-empty">No upstream node.</p>
        ) : (
          data.inputs.map((input) => (
            <div key={input.nodeId} className="flow-ndv-data-io">
              <span className="flow-ndv-data-from">from {input.nodeId}</span>
              <pre className="flow-ndv-data-text">{input.detail.trim() || "—"}</pre>
            </div>
          ))
        )}
      </div>

      <div className="flow-ndv-data-block">
        <span className="flow-ndv-data-label">
          <Icon name="ph:arrow-up" width={11} aria-hidden /> Output
        </span>
        <pre className="flow-ndv-data-text">{data.output.trim() || "—"}</pre>
      </div>
    </div>
  );
}

function PinnedDataSection({
  node,
  runData,
  onPinData,
}: {
  node: FlowNode;
  runData: FlowNodeRunData | null;
  onPinData: (data: string) => void;
}) {
  const pinned = node.pinnedData ?? "";
  const canPinOutput = Boolean(runData?.output.trim());
  return (
    <section className={`flow-ndv-pinned${pinned ? " is-active" : ""}`} aria-label="Pinned data">
      <div className="flow-ndv-pinned-head">
        <span className="flow-ndv-label">Pinned data</span>
        <div className="flow-ndv-pinned-actions">
          <Button
            variant="secondary"
            size="xs"
            className="flow-ndv-mini-action"
            disabled={!canPinOutput}
            onClick={() => onPinData(runData?.output ?? "")}
          >
            Pin output
          </Button>
          {pinned && (
            <Button
              variant="secondary"
              size="xs"
              className="flow-ndv-mini-action"
              onClick={() => onPinData("")}
            >
              Unpin
            </Button>
          )}
        </div>
      </div>
      <textarea
        className="flow-ndv-textarea flow-ndv-code"
        rows={4}
        spellCheck={false}
        value={pinned}
        placeholder="Paste JSON or text to reuse as this node's output during manual runs"
        onChange={(event) => onPinData(event.target.value)}
      />
      {pinned && <p className="flow-ndv-pinned-note">Manual runs reuse this output instead of recomputing the node.</p>}
    </section>
  );
}

function ParamRow({
  field,
  value,
  familiarOptions,
  skillOptions,
  onChange,
}: {
  field: FlowParamField;
  value: FlowParamValue | undefined;
  familiarOptions: NodeDetailOption[];
  skillOptions: NodeDetailOption[];
  onChange: (value: FlowParamValue) => void;
}) {
  const str = value === undefined || value === null ? "" : String(value);
  const expressionCapable = canUseExpressionMode(field);
  const expressionMode = expressionCapable && isExpressionValue(str);
  return (
    <div className="flow-ndv-field">
      <span className="flow-ndv-param-head">
        <span className="flow-ndv-label">{field.label}</span>
        {expressionCapable && (
          <span className="flow-ndv-param-mode" aria-label={`${field.label} value mode`}>
            <Button
              variant="ghost"
              size="xs"
              className={!expressionMode ? "is-active" : ""}
              aria-pressed={!expressionMode}
              onClick={() => {
                if (expressionMode) onChange(fromExpressionValue(str));
              }}
            >
              Fixed
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className={expressionMode ? "is-active" : ""}
              aria-pressed={expressionMode}
              onClick={() => {
                if (!expressionMode) onChange(toExpressionValue(str));
              }}
            >
              Expression
            </Button>
          </span>
        )}
      </span>
      {renderControl()}
      {field.help && <span className="flow-ndv-help">{field.help}</span>}
    </div>
  );

  function renderControl() {
    switch (field.control) {
      case "textarea":
        return (
          <textarea
            className="flow-ndv-textarea"
            aria-label={field.label}
            rows={4}
            value={str}
            placeholder={field.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case "code":
        return (
          <textarea
            className="flow-ndv-textarea flow-ndv-code"
            aria-label={field.label}
            rows={5}
            spellCheck={false}
            value={str}
            placeholder={field.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case "json":
        return (
          <textarea
            className="flow-ndv-textarea flow-ndv-code"
            aria-label={field.label}
            rows={3}
            spellCheck={false}
            value={str}
            placeholder={field.placeholder ?? "{}"}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case "number":
        return (
          <input
            className="flow-ndv-input"
            aria-label={field.label}
            type="number"
            value={str}
            onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))}
          />
        );
      case "boolean":
        return (
          <span className="flow-ndv-toggle">
            <input
              type="checkbox"
              aria-label={field.label}
              checked={value === true}
              onChange={(event) => onChange(event.target.checked)}
            />
            <span>{value === true ? "On" : "Off"}</span>
          </span>
        );
      case "select":
        return (
          <StandardSelect
            label={field.label}
            className="flow-ndv-input"
            value={str}
            onChange={onChange}
            options={[
              ...(!field.default ? [{ value: "", label: "Choose...", disabled: true }] : []),
              ...(field.options ?? []).map((option) => ({ value: option.value, label: option.label })),
            ]}
            placeholder="Choose..."
          />
        );
      case "familiar":
        return (
          <StandardSelect
            label={field.label}
            className="flow-ndv-input"
            value={str}
            onChange={onChange}
            options={[
              { value: "", label: "Choose a familiar...", disabled: true },
              ...familiarOptions.map((option) => ({ value: option.value, label: option.label })),
            ]}
            placeholder="Choose a familiar..."
          />
        );
      case "skill":
        return (
          <input
            className="flow-ndv-input"
            aria-label={field.label}
            list="flow-skill-options"
            value={str}
            placeholder="skill id"
            onChange={(event) => onChange(event.target.value)}
          />
        );
      default:
        return (
          <input
            className="flow-ndv-input"
            aria-label={field.label}
            type="text"
            value={str}
            placeholder={field.placeholder}
            onChange={(event) => onChange(event.target.value)}
          />
        );
    }
  }
}

function canUseExpressionMode(field: FlowParamField): boolean {
  return ["text", "textarea", "json", "code"].includes(field.control);
}

function isExpressionValue(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("=") || /\{\{[\s\S]+?\}\}/.test(trimmed);
}

function toExpressionValue(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "={{ }}";
  if (isExpressionValue(trimmed)) return value;
  return `={{ ${JSON.stringify(value)} }}`;
}

function fromExpressionValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("={{") && trimmed.endsWith("}}")) {
    return trimmed.slice(3, -2).trim();
  }
  if (trimmed.startsWith("=")) return trimmed.slice(1).trim();
  return value;
}

function StickyDetail(props: NodeDetailViewProps) {
  const sticky = props.node.sticky;
  return (
    <aside className="flow-ndv" aria-label="Sticky note settings">
      <header className="flow-ndv-head">
        <span className="flow-ndv-icon" style={{ background: "#c9b458" }} aria-hidden>
          <Icon name="ph:note" width={16} />
        </span>
        <span className="flow-ndv-name-static">Sticky note</span>
        <IconButton
          icon="ph:x"
          size="sm"
          className="flow-ndv-close"
          onClick={props.onClose}
          aria-label="Close settings"
        />
      </header>
      <div className="flow-ndv-fields">
        <label className="flow-ndv-field">
          <span className="flow-ndv-label">Text</span>
          <textarea
            className="flow-ndv-textarea"
            rows={5}
            value={sticky?.text ?? ""}
            onChange={(event) => props.onChangeSticky({ text: event.target.value })}
          />
        </label>
        <div className="flow-ndv-field">
          <span className="flow-ndv-label">Colour</span>
          <div className="flow-sticky-swatches">
            {STICKY_COLORS.map((color) => (
              <Button
                key={color.key}
                variant="ghost"
                size="xs"
                className={`flow-sticky-swatch${sticky?.color === color.key ? " is-active" : ""}`}
                style={{ background: color.fill }}
                aria-label={color.label}
                aria-pressed={sticky?.color === color.key}
                onClick={() => props.onChangeSticky({ color: color.key })}
              />
            ))}
          </div>
        </div>
      </div>
      <footer className="flow-ndv-foot">
        <Button
          variant="secondary"
          size="xs"
          leadingIcon="ph:copy"
          className="flow-ndv-action"
          onClick={props.onDuplicate}
        >
          Duplicate
        </Button>
        <Button
          variant="danger"
          size="xs"
          leadingIcon="ph:trash"
          className="flow-ndv-action flow-ndv-danger"
          onClick={props.onDelete}
        >
          Delete
        </Button>
      </footer>
    </aside>
  );
}

function NameField({ value, onCommit }: { value: string; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(value);
  // Re-seed when switching nodes.
  const [seed, setSeed] = useState(value);
  if (seed !== value) {
    setSeed(value);
    setDraft(value);
  }
  return (
    <input
      className="flow-ndv-name"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft.trim() && draft !== value && onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      aria-label="Node name"
    />
  );
}
