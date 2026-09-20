export type GlobalInstructions = {
  present: boolean;
  path?: string;
  byte_count?: number;
};

export type HarnessCapSkill = {
  id: string;
  name: string;
  source?: string;
  harness_id?: string;
  description?: string;
  version?: string;
  tags?: string[];
  path: string;
};

export type HarnessPlugin = {
  id: string;
  name: string;
  source?: string;
  harness_id?: string;
  kind: string;
  enabled: boolean;
  transport?: string;
  command?: string;
  args?: string[];
};

export type CapWarning = {
  kind: string;
  path: string;
  message: string;
};

export type HarnessCapabilityManifest = {
  harness_id: string;
  scanned_at: string;
  global_instructions: GlobalInstructions;
  skills: HarnessCapSkill[];
  plugins: HarnessPlugin[];
  warnings: CapWarning[];
};
