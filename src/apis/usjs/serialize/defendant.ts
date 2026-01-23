/** Defendant/person data extraction */
import { parseName, keyValueMatch } from './utils.js';
import { Defendant, type SerializedSummary } from '../types.js';

/** Extract and parse defendant name from lines */
export const extractDefendantName = (lines: string[]) => {
  console.log('👤 extractDefendantName debug:');
  console.log('Lines array length:', lines?.length || 0);
  console.log('Lines[2] exists:', !!lines[2]);
  console.log('Lines[2] content:', lines[2] || 'undefined');

  if (!lines[2]) {
    console.log('❌ No lines[2] - returning empty name');
    return { fullName: '', first: '', middle: '', last: '' };
  }

  const fullName = lines[2].split('DOB:')[0].replaceAll('|', '').trim() || '';
  console.log('Extracted fullName:', fullName);
  const [first, middle, last] = parseName(fullName);
  return { fullName, first, middle, last };
};

/** Lazy-evaluated matchers for defendant fields */
export const personMatchers = (lines: string[]) => {
  const nameInfo = extractDefendantName(lines);

  return {
    [Defendant.Name]: () => nameInfo.fullName,
    [Defendant.FirstName]: () => nameInfo.first,
    [Defendant.MiddleName]: () => nameInfo.middle,
    [Defendant.LastName]: () => nameInfo.last,
    [Defendant.Address]: () => lines[3]?.split('Eyes:')[0]?.replaceAll('|', '').trim() || '',
    [Defendant.DOB]: () => keyValueMatch({ line: lines[2] || '', regex: /DOB:\s+(\d{2}\/\d{2}\/\d{4})/ }),
    [Defendant.Sex]: () => keyValueMatch({ line: lines[2] || '', regex: /Sex:\s+(\w+)/ }),
    [Defendant.Eyes]: () => keyValueMatch({ line: lines[3] || '', regex: /Eyes:\s+(\w+)/ }),
    [Defendant.Hair]: () => keyValueMatch({ line: lines[4] || '', regex: /Hair:\s+(\w+)/ }),
    [Defendant.Race]: () => keyValueMatch({ line: lines[5] || '', regex: /Race:\s+(\w+)/ }),
    [Defendant.Aliases]: () => {
      // Assumption - 20 aliases is generally going to be enough;
      return lines.slice(
        lines.findIndex((line) => line.match(/Aliases/)) + 1,
        lines.findIndex((line) => line.match(/Open|Closed|Adjudicated|Active|Pending|Dismissed|Completed|Inactive/))
      )
        .reduce((acc, lineText, idx) => {
          /** Aliases share a line with demographic info */
          if (lineText.match(/Race:/)) {
            acc.push(lineText.split('Race:')[0].replaceAll('|', '').trim());
            return acc;
          };

          acc.push(lineText);
          return acc;
        }, [] as string[]) || [];
    }
  };
};

/** Aggregator returning typed person object */
export const person = (lines: string[]): SerializedSummary['person'] => {
  const info = personMatchers(lines);

  return Object.values(Defendant)
    .reduce((acc, key) => {
      if (key === Defendant.Aliases) {
        /** This block is for typescript narrowing only */
        acc[Defendant.Aliases] = info[Defendant.Aliases]();
        return acc;
      };

      acc[key] = info[key]();
      return acc;
    }, {
      [Defendant.Name]: '',
      [Defendant.FirstName]: '',
      [Defendant.MiddleName]: '',
      [Defendant.LastName]: '',
      [Defendant.Address]: '',
      [Defendant.DOB]: '',
      [Defendant.Eyes]: '',
      [Defendant.Hair]: '',
      [Defendant.Race]: '',
      [Defendant.Sex]: '',
      [Defendant.Aliases]: []
    } as SerializedSummary['person']);
};
