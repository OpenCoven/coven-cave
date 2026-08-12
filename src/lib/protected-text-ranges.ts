export type ProtectedTextRange = readonly [start: number, end: number];

export function validateProtectedTextRanges(
  textLength: number,
  ranges: ReadonlyArray<ProtectedTextRange>,
  caller: string,
): ProtectedTextRange[] {
  const validated: ProtectedTextRange[] = [];
  let previousEnd = 0;

  for (let index = 0; index < ranges.length; index += 1) {
    const range = ranges[index];
    const [start, end] = range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      throw new RangeError(`${caller} protected range offsets must be safe integers`);
    }
    if (start < 0 || end > textLength) {
      throw new RangeError(`${caller} protected range must stay within text`);
    }
    if (start >= end) {
      throw new RangeError(`${caller} protected range must have positive length`);
    }
    if (index > 0 && start < previousEnd) {
      throw new RangeError(
        `${caller} protected ranges must be sorted and non-overlapping`,
      );
    }
    validated.push([start, end]);
    previousEnd = end;
  }

  return validated;
}

export function indexInProtectedTextRanges(
  ranges: ReadonlyArray<ProtectedTextRange>,
  index: number,
): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const [start, end] = ranges[middle];
    if (index < start) {
      high = middle - 1;
    } else if (index >= end) {
      low = middle + 1;
    } else {
      return true;
    }
  }
  return false;
}
