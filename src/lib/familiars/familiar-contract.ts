/**
 * Familiar Contract adherence checker.
 *
 * A pure, dependency-free port of the OpenCoven `familiar-contract` validator
 * (https://github.com/OpenCoven/familiar-contract, spec v0.1.0). It evaluates a
 * familiar's identity files — SOUL.md, IDENTITY.md, ward.toml, MEMORY.md —
 * against the five-property normative core and reports violations, warnings,
 * and per-property coverage.
 *
 * This module never touches the filesystem: callers pass already-loaded file
 * contents (or `null` when a file is absent). That keeps it usable both
 * server-side (the /api/familiars/[id]/contract route reads the workspace) and
 * in unit tests, and mirrors the reference CLI's checks 1:1 so a PASS here means
 * the same thing as `node validators/validate.js <dir>`.
 */

export const FAMILIAR_CONTRACT_SPEC_VERSION = "0.1.0";

/** The five normative properties a compliant familiar must satisfy. */
export const FAMILIAR_PROPERTIES = [
  "Named Identity",
  "Defined Purpose",
  "Bounded Authority",
  "Persistent Memory",
  "Human Belonging",
] as const;

export type FamiliarProperty = (typeof FAMILIAR_PROPERTIES)[number];

export type ContractFile = "SOUL.md" | "IDENTITY.md" | "ward.toml" | "MEMORY.md" | "cross-file";

export type ContractViolation = {
  file: ContractFile;
  field: string;
  message: string;
};

export type ContractWarning = ContractViolation;

export type PropertyCoverage = {
  property: FamiliarProperty;
  pass: boolean;
};

export type ContractFiles = {
  soul: string | null;
  identity: string | null;
  ward: string | null;
  memory: string | null;
};

export type ContractReport = {
  specVersion: string;
  /** True when there are zero hard violations (warnings still allow a pass). */
  pass: boolean;
  properties: PropertyCoverage[];
  violations: ContractViolation[];
  warnings: ContractWarning[];
};

function violation(file: ContractFile, field: string, message: string): ContractViolation {
  return { file, field, message };
}

// ── SOUL.md ──────────────────────────────────────────────────────────────────

type SoulParse = {
  hasName: boolean;
  name: string | null;
  hasPurpose: boolean;
  hasCoreWork: boolean;
  hasWhatIAmNot: boolean;
  hasBoundaries: boolean;
};

export function parseSoul(content: string): SoulParse {
  const lines = content.split("\n");
  const result: SoulParse = {
    hasName: false,
    name: null,
    hasPurpose: false,
    hasCoreWork: false,
    hasWhatIAmNot: false,
    hasBoundaries: false,
  };

  for (const raw of lines) {
    const line = raw.trim();

    const h2Name = line.match(/^##\s+I am\s+(.+)/i);
    if (h2Name) {
      result.hasName = true;
      result.name = h2Name[1].trim();
    }
    const h1Name = line.match(/^#\s+I am\s+(.+)/i);
    if (h1Name && !result.hasName) {
      result.hasName = true;
      result.name = h1Name[1].trim();
    }

    if (/my purpose is/i.test(line) || /^##\s*Purpose/i.test(line)) result.hasPurpose = true;
    if (/^##\s*Core Work/i.test(line)) result.hasCoreWork = true;
    if (/^##\s*What I Am Not/i.test(line)) result.hasWhatIAmNot = true;
    if (/^##\s*(My\s*)?Bounds?aries?/i.test(line)) result.hasBoundaries = true;
  }

  return result;
}

function validateSoul(soul: string | null): ContractViolation[] {
  if (soul === null) {
    return [violation("SOUL.md", "file", "SOUL.md does not exist. Required for Named Identity compliance.")];
  }
  if (soul.trim().length < 100) {
    return [violation("SOUL.md", "content", "SOUL.md appears empty or too short. Minimum meaningful content required.")];
  }

  const parsed = parseSoul(soul);
  const violations: ContractViolation[] = [];

  if (!parsed.hasName) {
    violations.push(violation("SOUL.md", "name", 'No "## I am <Name>" section found. Named Identity requires a declared name.'));
  }
  if (!parsed.hasPurpose) {
    violations.push(violation("SOUL.md", "purpose", 'No purpose declaration found. Look for "My purpose is..." or a "## Purpose" section.'));
  }
  if (!parsed.hasCoreWork) {
    violations.push(violation("SOUL.md", "core_work", 'No "## Core Work" section found. Defined Purpose requires a declared scope of work.'));
  }
  if (!parsed.hasWhatIAmNot) {
    violations.push(violation("SOUL.md", "what_i_am_not", 'No "## What I Am Not" section found. Defined Purpose requires explicit boundary declaration.'));
  }
  if (!parsed.hasBoundaries) {
    violations.push(violation("SOUL.md", "boundaries", 'No "## My Boundaries" section found. Bounded Authority requires explicit boundary rules.'));
  }

  return violations;
}

// ── IDENTITY.md ────────────────────────────────────────────────────────────────

type IdentityParse = {
  hasName: boolean;
  name: string | null;
  hasCreature: boolean;
  hasPurpose: boolean;
};

export function parseIdentity(content: string): IdentityParse {
  const result: IdentityParse = { hasName: false, name: null, hasCreature: false, hasPurpose: false };

  for (const raw of content.split("\n")) {
    const trimmed = raw.trim();

    const h1Match = trimmed.match(/^#\s+IDENTITY\.md\s*[-–]\s*(.+)/i);
    if (h1Match) {
      result.hasName = true;
      result.name = h1Match[1].trim();
    }
    const nameField = trimmed.match(/^\*\*Name:\*\*\s*(.+)/);
    if (nameField) {
      result.hasName = true;
      result.name = nameField[1].trim();
    }

    if (/\*\*Creature:\*\*/i.test(trimmed)) result.hasCreature = true;
    if (/^##\s*Purpose/i.test(trimmed)) result.hasPurpose = true;
    if (/I help|my purpose|I assist/i.test(trimmed) && !result.hasPurpose) result.hasPurpose = true;
  }

  return result;
}

function validateIdentity(identity: string | null): ContractViolation[] {
  if (identity === null) {
    return [violation("IDENTITY.md", "file", "IDENTITY.md does not exist. Required for Named Identity compliance.")];
  }
  if (identity.trim().length < 50) {
    return [violation("IDENTITY.md", "content", "IDENTITY.md appears empty or too short.")];
  }

  const parsed = parseIdentity(identity);
  const violations: ContractViolation[] = [];

  if (!parsed.hasName) {
    violations.push(violation("IDENTITY.md", "name", 'No name found. Expected "# IDENTITY.md - <Name>" or "- **Name:** <Name>".'));
  }
  if (!parsed.hasCreature) {
    violations.push(violation("IDENTITY.md", "creature", 'No "**Creature:**" field found. IDENTITY.md requires a creature/type declaration.'));
  }
  if (!parsed.hasPurpose) {
    violations.push(violation("IDENTITY.md", "purpose", "No purpose description found. IDENTITY.md requires a purpose statement."));
  }

  return violations;
}

// ── ward.toml ──────────────────────────────────────────────────────────────────

type WardParse = {
  hasMeta: boolean;
  metaFamiliar: string | null;
  metaPerson: string | null;
  metaVersion: string | null;
  hasProtected: boolean;
  protectedFiles: string[];
  protectedInvariants: string[];
  hasEditable: boolean;
  editablePaths: string[];
  hasApprovalTiers: boolean;
  hasAutoTier: boolean;
  hasHumanReviewTier: boolean;
};

export function parseWardToml(content: string): WardParse {
  const result: WardParse = {
    hasMeta: false,
    metaFamiliar: null,
    metaPerson: null,
    metaVersion: null,
    hasProtected: false,
    protectedFiles: [],
    protectedInvariants: [],
    hasEditable: false,
    editablePaths: [],
    hasApprovalTiers: false,
    hasAutoTier: false,
    hasHumanReviewTier: false,
  };

  const lines = content.split("\n");
  let currentSection: string | null = null;
  let inArray = false;
  let arrayTarget: { section: string | null; key: string } | null = null;
  let arrayBuffer: string[] = [];

  const stripItems = (raw: string): string[] =>
    raw
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);

  const commitArray = () => {
    if (!arrayTarget) return;
    if (arrayTarget.section === "protected" && arrayTarget.key === "files") result.protectedFiles = [...arrayBuffer];
    if (arrayTarget.section === "protected" && arrayTarget.key === "invariants") result.protectedInvariants = [...arrayBuffer];
    if (arrayTarget.section === "editable" && arrayTarget.key === "paths") result.editablePaths = [...arrayBuffer];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (trimmed.startsWith("#") || trimmed === "") continue;

    // Section headers.
    if (!inArray) {
      if (/^\[meta\]/.test(trimmed)) { currentSection = "meta"; continue; }
      if (/^\[protected\]/.test(trimmed)) { currentSection = "protected"; result.hasProtected = true; continue; }
      if (/^\[editable\]/.test(trimmed)) { currentSection = "editable"; result.hasEditable = true; continue; }
      if (/^\[approval_tiers\.auto\]/.test(trimmed)) { result.hasAutoTier = true; continue; }
      if (/^\[approval_tiers\.human_review\]/.test(trimmed)) { result.hasHumanReviewTier = true; continue; }
      if (/^\[approval_tiers\]/.test(trimmed)) { currentSection = "approval_tiers"; result.hasApprovalTiers = true; continue; }
      if (/^\[approval_tiers\.\w+\]/.test(trimmed)) { continue; }
      if (/^\[/.test(trimmed)) { currentSection = "other"; continue; }
    }

    // Multi-line array start (no closing bracket on this line).
    if (!inArray && /=\s*\[/.test(trimmed) && !/\]$/.test(trimmed.replace(/\s*#.*/, ""))) {
      inArray = true;
      const keyMatch = trimmed.match(/^(\w+)\s*=/);
      arrayTarget = keyMatch ? { section: currentSection, key: keyMatch[1] } : null;
      arrayBuffer = [];
      const inline = trimmed.replace(/^[^[]*\[/, "").trim();
      if (inline) arrayBuffer.push(...stripItems(inline));
      continue;
    }

    // Multi-line array end.
    if (inArray && /^\]/.test(trimmed)) {
      inArray = false;
      commitArray();
      arrayTarget = null;
      arrayBuffer = [];
      continue;
    }

    // Multi-line array item.
    if (inArray) {
      const item = trimmed.replace(/^["']|["'],?\s*$|["']$/g, "").trim();
      if (item && !item.startsWith("#")) arrayBuffer.push(item);
      continue;
    }

    // Whole array on one line.
    const inlineArr = trimmed.match(/^(\w+)\s*=\s*\[(.+)\]/);
    if (inlineArr) {
      const key = inlineArr[1];
      const items = stripItems(inlineArr[2]);
      if (currentSection === "protected" && key === "files") result.protectedFiles = items;
      if (currentSection === "protected" && key === "invariants") result.protectedInvariants = items;
      if (currentSection === "editable" && key === "paths") result.editablePaths = items;
      continue;
    }

    // Key-value pairs (meta only — that's all we read).
    const kv = trimmed.match(/^(\w+)\s*=\s*["']?([^"'#\n]+?)["']?\s*(#.*)?$/);
    if (kv && currentSection === "meta") {
      result.hasMeta = true;
      if (kv[1] === "familiar") result.metaFamiliar = kv[2].trim();
      if (kv[1] === "person") result.metaPerson = kv[2].trim();
      if (kv[1] === "version") result.metaVersion = kv[2].trim();
    }
  }

  return result;
}

function validateWard(ward: string | null): ContractViolation[] {
  if (ward === null) {
    return [violation("ward.toml", "file", "ward.toml does not exist. Required for Bounded Authority and Human Belonging compliance.")];
  }
  if (ward.trim().length < 50) {
    return [violation("ward.toml", "content", "ward.toml appears empty or too short.")];
  }

  const parsed = parseWardToml(ward);
  const violations: ContractViolation[] = [];

  if (!parsed.hasMeta) {
    violations.push(violation("ward.toml", "[meta]", "[meta] section missing. Required: version, familiar, person."));
  } else {
    if (!parsed.metaFamiliar) violations.push(violation("ward.toml", "meta.familiar", "meta.familiar is missing. Must match the familiar's name."));
    if (!parsed.metaPerson) violations.push(violation("ward.toml", "meta.person", "meta.person is missing. Human Belonging requires a declared person binding."));
    if (!parsed.metaVersion) violations.push(violation("ward.toml", "meta.version", "meta.version is missing. Ward must be versioned."));
  }

  if (!parsed.hasProtected) {
    violations.push(violation("ward.toml", "[protected]", "[protected] section missing. The protected surface must be declared."));
  } else {
    for (const required of ["SOUL.md", "IDENTITY.md", "MEMORY.md", "ward.toml"]) {
      if (!parsed.protectedFiles.includes(required)) {
        violations.push(violation("ward.toml", "protected.files", `${required} must be in the protected files list. It defines core familiar identity.`));
      }
    }
    if (parsed.protectedInvariants.length === 0) {
      violations.push(violation("ward.toml", "protected.invariants", "No invariants declared. At minimum, familiar.name and familiar.person must be invariants."));
    } else {
      if (!parsed.protectedInvariants.some((inv) => inv.includes("familiar.name"))) {
        violations.push(violation("ward.toml", "protected.invariants", "No familiar.name invariant found. The familiar's name must be protected."));
      }
      if (!parsed.protectedInvariants.some((inv) => inv.includes("familiar.person"))) {
        violations.push(violation("ward.toml", "protected.invariants", "No familiar.person invariant found. The person binding must be protected."));
      }
    }
  }

  if (!parsed.hasEditable) {
    violations.push(violation("ward.toml", "[editable]", "[editable] section missing. The editable surface must be declared (even if minimal)."));
  } else if (parsed.editablePaths.length === 0) {
    violations.push(violation("ward.toml", "editable.paths", "editable.paths is empty. Declare at least one editable path (e.g., TOOLS.md, HEARTBEAT.md)."));
  }

  if (!parsed.hasApprovalTiers) {
    violations.push(violation("ward.toml", "[approval_tiers]", "[approval_tiers] section missing. Approval tiers must be defined."));
  } else {
    if (!parsed.hasAutoTier) {
      violations.push(violation("ward.toml", "approval_tiers.auto", "[approval_tiers.auto] (Tier 0) not found. Auto tier must be defined even if empty."));
    }
    if (!parsed.hasHumanReviewTier) {
      violations.push(violation("ward.toml", "approval_tiers.human_review", "[approval_tiers.human_review] (Tier 2) not found. Human review tier is required."));
    }
  }

  return violations;
}

// ── Cross-file ─────────────────────────────────────────────────────────────────

function validateCrossFile(soul: string | null, ward: string | null): ContractViolation[] {
  if (soul === null || ward === null) return [];

  const soulParsed = parseSoul(soul);
  const wardParsed = parseWardToml(ward);
  const violations: ContractViolation[] = [];

  if (soulParsed.name && wardParsed.metaFamiliar) {
    if (soulParsed.name.toLowerCase() !== wardParsed.metaFamiliar.toLowerCase()) {
      violations.push(
        violation(
          "cross-file",
          "name consistency",
          `SOUL.md declares name "${soulParsed.name}" but ward.toml has familiar="${wardParsed.metaFamiliar}". These must match (case-insensitive).`,
        ),
      );
    }
  }

  return violations;
}

// ── Memory (warning only) ───────────────────────────────────────────────────────

function checkMemory(memory: string | null): ContractWarning[] {
  if (memory === null) {
    return [
      violation(
        "MEMORY.md",
        "file",
        "MEMORY.md does not exist. Persistent Memory compliance requires a durable long-term memory store. (This is a warning, not a hard violation — you may bootstrap memory on first session.)",
      ),
    ];
  }
  return [];
}

// ── Top-level evaluation ─────────────────────────────────────────────────────────

/**
 * Run the full familiar-contract v0.1.0 check over a familiar's loaded files.
 * Mirrors the reference CLI: a familiar PASSES when there are zero hard
 * violations (warnings — e.g. a missing MEMORY.md — still allow a pass).
 */
export function evaluateFamiliarContract(files: ContractFiles): ContractReport {
  const soulViolations = validateSoul(files.soul);
  const identityViolations = validateIdentity(files.identity);
  const wardViolations = validateWard(files.ward);
  const crossViolations = validateCrossFile(files.soul, files.ward);
  const memoryWarnings = checkMemory(files.memory);

  const violations = [...soulViolations, ...identityViolations, ...wardViolations, ...crossViolations];

  const hasField = (list: ContractViolation[], fields: string[]) =>
    list.some((v) => fields.includes(v.field));

  // A wholly-missing or empty file surfaces as a `file`/`content` violation
  // rather than the granular field violations. Folding those into every
  // property that depends on the file keeps the per-property coverage honest:
  // a familiar with no SOUL.md must NOT read as "Defined Purpose ✓".
  const SOUL_GONE = ["file", "content"];
  const WARD_GONE = ["file", "content"];

  const properties: PropertyCoverage[] = [
    {
      property: "Named Identity",
      pass:
        !hasField(soulViolations, [...SOUL_GONE, "name"]) &&
        !hasField(identityViolations, ["file", "content", "name"]),
    },
    {
      property: "Defined Purpose",
      pass: !hasField(soulViolations, [...SOUL_GONE, "purpose", "core_work", "what_i_am_not"]),
    },
    {
      property: "Bounded Authority",
      pass:
        !hasField(soulViolations, [...SOUL_GONE, "boundaries"]) &&
        !hasField(wardViolations, [
          ...WARD_GONE,
          "[protected]",
          "protected.files",
          "[editable]",
          "editable.paths",
          "[approval_tiers]",
        ]),
    },
    {
      property: "Persistent Memory",
      pass: memoryWarnings.length === 0,
    },
    {
      property: "Human Belonging",
      pass: !hasField(wardViolations, [...WARD_GONE, "[meta]", "meta.person", "protected.invariants"]),
    },
  ];

  return {
    specVersion: FAMILIAR_CONTRACT_SPEC_VERSION,
    pass: violations.length === 0,
    properties,
    violations,
    warnings: memoryWarnings,
  };
}
