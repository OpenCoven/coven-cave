import assert from "node:assert/strict";
import {
  catalogGroups,
  catalogNode,
  createNode,
  defaultParams,
  FLOW_CATALOG,
  searchCatalog,
} from "./flow-catalog.ts";
import { emptyFlow, type FlowDoc } from "./flow-doc.ts";

const NOW = "2026-01-01T00:00:00.000Z";

// Catalog integrity: unique types, valid categories, triggers have no inputs.
{
  const types = FLOW_CATALOG.map((n) => n.type);
  assert.equal(new Set(types).size, types.length, "node types are unique");
  for (const node of FLOW_CATALOG) {
    if (node.isTrigger) assert.equal(node.inputs.length, 0, `${node.type} trigger has no input`);
    if (!node.isTrigger && !node.sticky) assert.ok(node.inputs.length >= 1, `${node.type} has an input`);
    // every output/input port id is unique within the node
    const outIds = node.outputs.map((p) => p.id);
    assert.equal(new Set(outIds).size, outIds.length, `${node.type} output ids unique`);
  }
}

// IF node has true/false outputs
{
  const ifNode = catalogNode("logic.if");
  assert.ok(ifNode);
  assert.deepEqual(ifNode?.outputs.map((p) => p.id), ["true", "false"]);
}

// Execution Data node saves custom run metadata for execution filters
{
  const executionData = catalogNode("data.execution");
  assert.ok(executionData, "catalog exposes an Execution Data node");
  assert.equal(executionData?.group, "Data");
  assert.equal(executionData?.params.some((field) => field.key === "key"), true);
  assert.equal(executionData?.params.some((field) => field.key === "value"), true);
}

// groups follow CATALOG_GROUP_ORDER and cover triggers first
{
  const groups = catalogGroups();
  assert.equal(groups[0].group, "Triggers");
  assert.ok(groups.some((g) => g.group === "Flow"));
}

// search filters by term across label/description
{
  const hits = searchCatalog("webhook");
  const flat = hits.flatMap((g) => g.nodes.map((n) => n.type));
  assert.ok(flat.includes("trigger.webhook"));
  assert.ok(!flat.includes("familiar"));

  const multi = searchCatalog("http request");
  assert.ok(multi.flatMap((g) => g.nodes).some((n) => n.type === "http"));

  assert.equal(searchCatalog("zzzznotreal").length, 0, "no matches → empty");
  assert.deepEqual(searchCatalog("").map((g) => g.group), catalogGroups().map((g) => g.group));
}

// defaultParams pulls field defaults
{
  const http = catalogNode("http");
  assert.ok(http);
  const params = defaultParams(http!);
  assert.equal(params.method, "GET");
  assert.equal(params.headers, "{}");
}

// createNode: unique id/name, seeded defaults, sticky geometry
{
  let doc: FlowDoc = emptyFlow("f", "F", NOW);
  const a = createNode(doc, "trigger.manual", { x: 1, y: 2 });
  assert.ok(a);
  assert.equal(a?.type, "trigger.manual");
  assert.deepEqual(a?.position, { x: 1, y: 2 });
  doc = { ...doc, nodes: [a!] };
  const b = createNode(doc, "trigger.manual", { x: 3, y: 4 });
  assert.notEqual(b?.id, a?.id, "second node gets a unique id");

  const sticky = createNode(doc, "sticky", { x: 0, y: 0 });
  assert.ok(sticky?.sticky, "sticky node carries sticky geometry");
  assert.equal(sticky?.sticky?.width, 240);

  assert.equal(createNode(doc, "does.not.exist", { x: 0, y: 0 }), null);
}

console.log("flow-catalog.test.ts OK");
