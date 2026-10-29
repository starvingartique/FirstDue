// Shared data shapes. These mirror /schemas/*.schema.json. JSON files stay the
// source of truth; these types only describe what the loaders return.

export interface MetaBlock {
  version: string;
  status?: string;
  basis?: string;
  [key: string]: unknown;
}

// - drugs -

export interface DrugPresentation {
  label: string;
  form: string;
  mg_per_mL?: number | null;
  volume_mL?: number;
  fixedDose_mg?: number;
}

export interface DrugDosing {
  indication: string;
  route: string[];
  dose_mg?: number | string;
  dose_mcg?: number | string;
  dose_mcg_per_min?: string;
  dose_mg_per_kg?: number | string;
  repeat?: string;
  max?: string;
  notes?: string;
}

export interface Drug {
  id: string;
  name: string;
  class?: string;
  brand?: string;
  presentations: DrugPresentation[];
  dosing: DrugDosing[];
  onset?: Record<string, string>;
  duration?: Record<string, string>;
  effects?: Record<string, string>;
  contraindications?: string[];
  dangers?: string[];
  scopeLevel: number | Record<string, number>;
  controlled?: string;
  location: string;
  coverage?: Record<string, number>;
  pk_s?: Record<string, [number, number, number]>;
}

export interface DrugsFile {
  _meta: MetaBlock & { count: number };
  drugs: Drug[];
}

// - physiology (Oct 28 clinical anchors) -

export interface PhysiologyFile {
  _meta: MetaBlock;
  baselines: Record<string, unknown>;
  shockClasses: Record<string, unknown>;
  effectTokens: Record<string, unknown>;
  bleedRates_mL_per_min: Record<string, unknown>;
}

// - conditions -

export interface ConditionSpawn {
  id: string;
  probability: number;
  delay_s?: number | string | unknown[];
  requires?: string;
  trigger?: string;
  notes?: string;
}

export interface Condition {
  id: string;
  name: string;
  region?: string;
  description?: string;
  mechanisms?: string[];
  herniatedContents?: string[];
  effects: Record<string, unknown>;
  stages?: Record<string, unknown>[];
  findings: Record<string, string[]>;
  spawns?: ConditionSpawn[];
  resolvedBy?: string[];
  reducedBy?: Record<string, unknown>;
  traps?: string[];
  dangers?: string[];
  teachingPoint?: string;
  minLevel: number;
  generatorReady: boolean;
}

export interface ConditionsFile {
  _meta: MetaBlock;
  infectionModel?: Record<string, unknown>;
  sepsisModel?: Record<string, unknown>;
  conditions: Condition[];
}

// - interventions and equipment (Oct 28 hemorrhage set) -

export interface Intervention {
  id: string;
  name: string;
  timeCost_s: number | string;
  minLevel: number;
  marchStep?: string;
  regions?: string[];
  equipment?: string[];
  fixes?: string[];
  reduces?: Record<string, unknown>;
  failureModes?: string[];
  notes?: string;
}

export interface InterventionsFile {
  _meta: MetaBlock;
  interventions: Intervention[];
}

export interface EquipmentItem {
  id: string;
  name: string;
  category: string;
  location: string;
  quantity: number | string;
  /** Per-stash counts for Oct 28: belt, jump_bag (at patient), cabinet (truck). */
  quantities?: {
    belt: number;
    jump_bag: number;
    cabinet: number;
  };
  sizes?: string[];
  sizeEffects?: Record<string, unknown>;
  consumable?: boolean;
  notes?: string;
}

export interface EquipmentFile {
  _meta: MetaBlock;
  equipment: EquipmentItem[];
}

// - Oct 28 core conditions (separate from the DRAFT conditions.json) -

export interface Oct28Condition {
  id: string;
  name: string;
  region?: string;
  bleedClass?: string;
  baseRate_mL_per_min?: number;
  baselineMAP_mmhg?: number;
  pressureScaling?: string;
  effects: Record<string, unknown>;
  stages?: Record<string, unknown>[];
  findings: Record<string, string[]>;
  resolvedBy?: string[];
  reducedBy?: Record<string, unknown>;
  minLevel: number;
  generatorReady: boolean;
  note?: string;
}

export interface Oct28ConditionsFile {
  _meta: MetaBlock;
  conditions: Oct28Condition[];
}

// - trauma library -

export interface TraumaInjury {
  id: string;
  // Ref entries (ref -> conditions.json) carry no name of their own.
  name?: string;
  cat?: string;
  region?: string;
  march?: string;
  bleed?: string;
  findings?: Record<string, string[]>;
  spawns?: unknown[][];
  fix?: string[];
  traps?: string[];
  infection?: Record<string, unknown>;
  ref?: string;
  stub?: boolean;
  minLevel?: number;
}

export interface TraumaLibraryFile {
  _meta: MetaBlock;
  injuries: TraumaInjury[];
}

// - march-paws -

export interface MarchStep {
  step: string;
  name: string;
  checks?: string[];
  interventions?: string[];
  graded?: string[];
  timeTarget_s?: number | null;
  applies?: string;
}

export interface MarchPawsFile {
  _meta: MetaBlock;
  sequence: MarchStep[];
  reassessment: string;
  difficultyBehavior?: Record<string, string>;
}

// - call components -

export interface Complaint {
  id: string;
  label: string;
  weight: number | string;
  sourceNote?: string;
  minLevel?: number;
}

export interface ComplaintsFile {
  _meta: MetaBlock;
  complaints: Complaint[];
}

export interface MechanismSubtype {
  id: string;
  w?: number;
  patient?: string;
  injuries?: unknown[][];
  regionWeights?: unknown[][];
  woundCount?: string;
  medicalCauseCheck?: string[];
  pediatricPattern?: string;
  sceneSafety?: string;
  teachingPoint?: string;
}

export interface Mechanism {
  id: string;
  ntdbShare?: number;
  caseFatality?: number;
  subtypes: MechanismSubtype[];
}

export interface MechanismsFile {
  _meta: MetaBlock;
  mechanisms: Mechanism[];
  universalModifiers?: Record<string, string>;
}

export interface ConditionsMapEntry {
  conditionId: string;
  probability: number | string;
  onsetDelay_s?: number | string;
  coOccursWith?: string[];
  excludes?: string[];
  notes?: string;
}

export interface ConditionsMapping {
  mechanismId: string;
  conditions: ConditionsMapEntry[];
}

export interface ConditionsMapFile {
  _meta: MetaBlock;
  mappings: ConditionsMapping[];
}

export interface PatientDistribution {
  complaintId: string;
  ageRange: [number, number] | string;
  sexSplit?: Record<string, unknown>;
  weight_kg?: Record<string, unknown>;
  notes?: string;
}

export interface PatientsFile {
  _meta: MetaBlock;
  distributions: PatientDistribution[];
}

export interface ComorbidityEntry {
  id: string;
  label: string;
  homeMeds?: string[];
  physiologyModifiers?: Record<string, unknown>;
  examMasks?: string[];
  weight?: number | string;
  notes?: string;
}

export interface ComorbiditiesFile {
  _meta: MetaBlock;
  entries: ComorbidityEntry[];
}

export interface EnvironmentEntry {
  id: string;
  label: string;
  timesOfDay?: string[];
  weather?: string[];
  hazards?: string[];
  weight?: number | string;
  notes?: string;
}

export interface EnvironmentsFile {
  _meta: MetaBlock;
  environments: EnvironmentEntry[];
}

export interface BystanderArchetype {
  id: string;
  label: string;
  behavior: string;
  helpsWith?: string[];
  obstructsWith?: string[];
  sampleLines?: string[];
  weight?: number | string;
}

export interface BystandersFile {
  _meta: MetaBlock;
  archetypes: BystanderArchetype[];
}

export interface Complication {
  id: string;
  label: string;
  trigger: string;
  engineEffect?: string;
  weight?: number | string;
  minLevel?: number;
}

export interface ComplicationsFile {
  _meta: MetaBlock;
  complications: Complication[];
}

// - fixed call seed -

export interface FixedCallInjury {
  injuryId: string;
  side: string;
  region?: string;
  notes?: string;
}

export interface FixedCall {
  id: string;
  seed: number;
  patient: {
    name: string;
    nameLocked: boolean;
    age: number;
    sex: string;
    weight_kg?: number | string;
    weightNote?: string;
    complaint?: string;
  };
  dispatch: {
    nature: string;
    address: string;
    cadText?: string;
    updates?: string[];
  };
  scene: {
    location: string;
    timeOfDay: string;
    weather?: string;
    mechanism: string;
    mechanismSubtype?: string;
    hazards?: string[];
    description?: string;
  };
  backstory?: string;
  /** Parked Oct 29 voice lines. Data only today. */
  patientPrompt?: {
    note?: string;
    weightLine?: string;
    weightLineTrigger?: string;
    tourniquetPainLine?: string;
  };
  /** Scene-start fix: mid-bleed contact, bystander pressure, spurt hook, belt trap. */
  sceneStart?: {
    note?: string;
    bloodLossAtContact_mL?: number;
    bloodLossAtContact_pct?: number;
    bloodLossAtContact_class?: string;
    bystanderPressure?: {
      what?: string;
      effectiveness?: number;
      note?: string;
    };
    spurtTrigger?: string;
    venousTourniquetTrap?: {
      included?: boolean;
      what?: string;
      effect?: string;
      playerMust?: string;
      note?: string;
    };
  };
  injuries: FixedCallInjury[];
  conditions: string[];
  conditionsNote?: string;
  marchFocus: string[];
  bystander?: {
    archetypeId?: string;
    label?: string;
    notes?: string;
  };
  levels?: number[];
}

// - difficulty -

export interface DifficultyLevel {
  level: number;
  role: string;
  vitalsDisplay: string;
  hints: boolean;
  deterioration: string;
  grading: string;
  customDials?: Record<string, unknown>;
  notes: string;
}
