/** Array slicing utilities for PDF parsing */
import type { SliceProps } from '../types.js';

/** Reducer for finding docket number boundaries */
export const docketIndex = (acc: number[], line: string, idx: number): number[] => {
  const docket = /([A-Z]+-\d+-[A-Z]+-\d+-\d+)/;
  const match = line.match(docket);

  if (!match) return acc;

  acc.push(idx);
  return acc;
};

/** Reducer for finding charge boundaries */
export const chargeIndex = (acc: number[], line: string, idx: number): number[] => {
  const match = line.match(/^\d{1,2}\s+/);

  if (!match) return acc;
  acc.push(idx);
  return acc;
};

/** Generic line slicing function using a reducer to find boundaries */
export const slices = ({ lines, reducer }: SliceProps): string[][] => {
  /** Find the slices of the array using the reducer */
  return lines
    /** Get the index of each section # within lines as a breakpoint */
    .reduce(reducer, [])
    /** Return slices from lines */
    .map((startLineIdx, SectionIdx, SectionArray) => {
      const nextIdx = SectionIdx + 1;
      const arrayLen = SectionArray.length - 1;

      if (nextIdx > arrayLen) return lines.slice(startLineIdx);
      const endLineIdx = SectionArray[nextIdx];
      return lines.slice(startLineIdx, endLineIdx);
    });
};
