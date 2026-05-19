import { Types } from 'mongoose';

export function toObjectId(
  value: unknown,
): Types.ObjectId | null {
  if (!value) return null;
  if (value instanceof Types.ObjectId) return value;

  const normalized = String(value).trim();
  if (!Types.ObjectId.isValid(normalized)) {
    return null;
  }

  try {
    return new Types.ObjectId(normalized);
  } catch {
    return null;
  }
}

export function normalizeObjectIdArray(
  values: unknown[] | null | undefined,
): {
  objectIds: Types.ObjectId[];
  stringIds: string[];
  changed: boolean;
} {
  const objectIds: Types.ObjectId[] = [];
  const stringIds: string[] = [];
  const seen = new Set<string>();
  let changed = false;

  for (const value of values ?? []) {
    const objectId = toObjectId(value);
    if (!objectId) {
      changed = true;
      continue;
    }

    const normalizedId = objectId.toString();
    if (seen.has(normalizedId)) {
      changed = true;
      continue;
    }

    if (!(value instanceof Types.ObjectId)) {
      changed = true;
    }

    seen.add(normalizedId);
    objectIds.push(objectId);
    stringIds.push(normalizedId);
  }

  return { objectIds, stringIds, changed };
}