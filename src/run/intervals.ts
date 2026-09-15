export interface Interval {
  start: number;
  end: number;
}

/** A union of half-open intervals. Adjacent deletions collapse into one entry. */
export class Intervals {
  readonly ranges: Interval[] = [];

  lowerBound(start: number): number {
    let lo = 0;
    let hi = this.ranges.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const range = this.ranges[mid];
      if (range !== undefined && range.end < start) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  add(start: number, end: number): void {
    const index = this.lowerBound(start);
    let stop = index;
    let mergedStart = start;
    let mergedEnd = end;
    while (stop < this.ranges.length) {
      const range = this.ranges[stop];
      if (range === undefined || range.start > mergedEnd) break;
      mergedStart = Math.min(mergedStart, range.start);
      mergedEnd = Math.max(mergedEnd, range.end);
      stop++;
    }
    this.ranges.splice(index, stop - index, { start: mergedStart, end: mergedEnd });
  }
}
