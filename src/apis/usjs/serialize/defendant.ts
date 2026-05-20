/** Defendant/person data extraction */
import { parseName, keyValueMatch } from './utils.js';
import { Defendant, type SerializedSummary } from '../types.js';

/** Detect if this is an MJ (Magisterial) court document */
const isMJDocument = (lines: string[]): boolean => {
  return lines.some(line => line.match(/MJ-\d{5}-[A-Z]{2}-\d{7}-\d{4}/));
};

/** Find line containing specific field label */
const findFieldLine = (lines: string[], fieldPattern: RegExp): string => {
  return lines.find(line => line.match(fieldPattern)) || '';
};

/** Normalize name for comparison (handle different formats) */
const normalizeName = (name: string): string => {
  if (!name) return '';

  // Convert "Last, First Middle" to "First Middle Last"
  const commaMatch = name.match(/^(.+?),\s*(.+)$/);
  if (commaMatch) {
    const [, lastName, firstMiddle] = commaMatch;
    return `${firstMiddle.trim()} ${lastName.trim()}`.replace(/\s+/g, ' ').trim();
  }

  // Return normalized version (remove extra spaces)
  return name.replace(/\s+/g, ' ').trim();
};

/** Remove aliases that are exact formatting variants of the defendant full name */
const deduplicateAliases = (aliases: string[], personName: string): string[] => {
  if (!aliases || aliases.length === 0) return [];

  const normalizedPersonName = normalizeName(personName).toLowerCase();

  const filtered = aliases.filter(alias => {
    if (!alias || alias.trim().length === 0) return false;

    const normalizedAlias = normalizeName(alias).toLowerCase();
    return normalizedAlias !== normalizedPersonName;
  });

  return filtered;
};

/** Extract defendant name using label-based parsing for MJ documents */
export const extractDefendantNameMJ = (lines: string[]) => {
  // For MJ documents, look for name field more dynamically
  let nameInfo = extractDefendantName(lines); // Try standard method first
  
  // If standard method fails, try label-based approach
  if (!nameInfo.fullName) {
    const nameLine = findFieldLine(lines, /.*DOB:/);
    if (nameLine) {
      const fullName = nameLine.split('DOB:')[0].replaceAll('|', '').trim() || '';
      const [first, middle, last] = parseName(fullName);
      nameInfo = { fullName, first, middle, last };
    }
  }
  
  return nameInfo;
};

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

/** MJ-specific matchers using label-based parsing */
export const personMatchersMJ = (lines: string[]) => {
  const nameInfo = extractDefendantNameMJ(lines);

  return {
    [Defendant.Name]: () => nameInfo.fullName,
    [Defendant.FirstName]: () => nameInfo.first,
    [Defendant.MiddleName]: () => nameInfo.middle,
    [Defendant.LastName]: () => nameInfo.last,
    [Defendant.Address]: () => {
      // For MJ documents, find address more dynamically
      const addressLine = findFieldLine(lines, /Eyes:/);
      return addressLine?.split('Eyes:')[0]?.replaceAll('|', '').trim() || '';
    },
    [Defendant.DOB]: () => keyValueMatch({ line: lines.find(l => l.includes('DOB:')) || '', regex: /DOB:\s+(\d{2}\/\d{2}\/\d{4})/ }),
    [Defendant.Sex]: () => keyValueMatch({ line: lines.find(l => l.includes('Sex:')) || '', regex: /Sex:\s+(\w+)/ }),
    [Defendant.Eyes]: () => keyValueMatch({ line: lines.find(l => l.includes('Eyes:')) || '', regex: /Eyes:\s+(\w+)/ }),
    [Defendant.Hair]: () => keyValueMatch({ line: lines.find(l => l.includes('Hair:')) || '', regex: /Hair:\s+(\w+)/ }),
    [Defendant.Race]: () => keyValueMatch({ line: lines.find(l => l.includes('Race:')) || '', regex: /Race:\s+(\w+)/ }),
    [Defendant.Aliases]: () => {
      // MJ documents often have aliases on the same line as the "Aliases:" label
      const aliasLine = lines.find(line => line.match(/Aliases:/));
      if (!aliasLine) {
        return [];
      }
      
      // Extract everything after "Aliases:" on the same line
      const aliasText = aliasLine.split('Aliases:')[1];
      if (!aliasText) {
        return [];
      }
      
      // Split by pipes and clean up each part
      const aliasFields = aliasText.split('|')
        .map(field => field.trim())
        .filter(field => field.length > 0);
      
      // Combine all fields and split by commas for multiple aliases
      const combinedAliases = aliasFields.join(' ').trim();
      if (!combinedAliases || combinedAliases === 'None') {
        return [];
      }
      
      // Split by commas and clean up individual aliases
      return combinedAliases.split(',')
        .map(alias => alias.trim())
        .filter(alias => alias.length > 0);
    }
  };
};
export const person = (lines: string[]): SerializedSummary['person'] => {
  // Detect if this is an MJ document and use appropriate matchers
  const isMJ = isMJDocument(lines);
  const info = isMJ ? personMatchersMJ(lines) : personMatchers(lines);

  console.log(`🏛️ Document type: ${isMJ ? 'MJ (Magisterial)' : 'Regular'} court document`);

  const personData = Object.values(Defendant)
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

  personData[Defendant.Aliases] = deduplicateAliases(
    personData[Defendant.Aliases],
    personData[Defendant.Name]
  );

  return personData;
};
