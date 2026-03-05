/** Array slicing utilities for PDF parsing */
import type { SliceProps } from '../types.js';

/** Pennsylvania counties list */
export const PA_COUNTIES = [
  'Philadelphia', 'Montgomery', 'Bucks', 'Delaware', 'Chester', 'Berks', 
  'Lancaster', 'York', 'Dauphin', 'Allegheny', 'Westmoreland', 'Washington', 
  'Fayette', 'Greene', 'Beaver', 'Butler', 'Armstrong', 'Indiana', 'Jefferson', 
  'Clarion', 'Venango', 'Crawford', 'Erie', 'Warren', 'McKean', 'Potter', 
  'Tioga', 'Bradford', 'Susquehanna', 'Wayne', 'Pike', 'Monroe', 'Carbon', 
  'Northampton', 'Lehigh', 'Schuylkill', 'Lebanon', 'Luzerne', 'Lackawanna', 
  'Wyoming', 'Sullivan', 'Columbia', 'Montour', 'Snyder', 'Union', 
  'Northumberland', 'Lycoming', 'Clinton', 'Centre', 'Clearfield', 'Cambria', 
  'Blair', 'Huntingdon', 'Mifflin', 'Juniata', 'Perry', 'Cumberland', 
  'Adams', 'Franklin', 'Fulton', 'Bedford'
] as const;

/** Reducer for finding docket number boundaries */
export const docketIndex = (acc: number[], line: string, idx: number): number[] => {
  const docket = /([A-Z]+-\d+-[A-Z]+-\d+-\d+)/;
  const docketMatch = line.match(docket);
  
  // Create county pattern dynamically from PA_COUNTIES array
  const countyPattern = new RegExp(`^\\|(${PA_COUNTIES.join('|')})$`);
  const countyMatch = line.match(countyPattern);

  if (docketMatch || countyMatch) {
    acc.push(idx);
  }

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
