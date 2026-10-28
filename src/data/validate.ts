// Small runtime checks that mirror /schemas/*.schema.json. They catch a broken
// data file at boot with a readable error instead of a later crash. A full
// JSON Schema validator (ajv) can replace these when the generator lands.

export class DataError extends Error {
  readonly file: string;
  constructor(file: string, message: string) {
    super(`${file}: ${message}`);
    this.file = file;
  }
}

type Rec = Record<string, unknown>;

export function isObject(value: unknown): value is Rec {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function need(file: string, value: unknown, key: string): unknown {
  if (!isObject(value) || !(key in value) || value[key] === undefined) {
    throw new DataError(file, `missing required key "${key}"`);
  }
  return (value as Rec)[key];
}

function needArray(file: string, value: unknown, key: string): unknown[] {
  const v = need(file, value, key);
  if (!Array.isArray(v)) throw new DataError(file, `"${key}" must be an array`);
  return v;
}

function needObject(file: string, value: unknown, key: string): Rec {
  const v = need(file, value, key);
  if (!isObject(v)) throw new DataError(file, `"${key}" must be an object`);
  return v;
}

function needString(file: string, obj: Rec, key: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) {
    throw new DataError(file, `"${key}" must be a non-empty string`);
  }
  return v;
}

/** Every data file carries a _meta block with at least a version string. */
export function checkMeta(file: string, root: unknown): Rec {
  const meta = needObject(file, root, "_meta");
  needString(file, meta, "version");
  return meta;
}

/** Checks that each array entry has the listed keys. Keeps loaders short. */
export function checkEntries(
  file: string,
  listKey: string,
  root: unknown,
  keys: string[]
): Rec[] {
  const list = needArray(file, root, listKey);
  return list.map((entry, i) => {
    if (!isObject(entry)) throw new DataError(file, `"${listKey}[${i}]" must be an object`);
    for (const key of keys) {
      if (!(key in entry) || entry[key] === undefined) {
        throw new DataError(file, `"${listKey}[${i}]" is missing "${key}"`);
      }
    }
    return entry;
  });
}

/** Finds duplicate ids in a validated entry list. */
export function checkUniqueIds(file: string, listKey: string, entries: Rec[]): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    const id = entry["id"];
    if (typeof id !== "string") continue;
    if (seen.has(id)) throw new DataError(file, `duplicate id "${id}" in "${listKey}"`);
    seen.add(id);
  }
}
