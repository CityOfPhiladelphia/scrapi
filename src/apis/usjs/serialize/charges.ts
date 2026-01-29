/** Complex charge parsing logic */
import { slices, chargeIndex } from './slices.js';
import { Charge, Sentence, type CourtCharges, type CourtSentence } from '../types.js';

/** Helper to handle variable length spaces in split arrays */
const spaces = (acc: string[], element: string): string[] => {
  if (element.match(/[A-Z0-9]/)) {
    acc.push(element.trim());
    return acc;
  };
  return acc;
};

/** Original parsing logic for standard charge lines */
const originalParsing = (split: string[]) => {
  const [seqNo, statute, grade = ''] = split.reduce(spaces, []);
  const [description = '', disposition = ''] = split.slice(-2,).reduce(spaces, []);
  return { seqNo, statute, grade, description, disposition };
};

/** Check if we need robust parsing (field misalignment detected) */
const needsRobustParsing = (split: string[]): boolean => {
  const original = originalParsing(split);

  // Detect misalignment: statute appearing in description, or statute pattern in description
  const hasStatuteInDescription = !!(original.description && (
    original.description.includes('§') ||
    original.description.match(/^\d+\s*[A-Z]/) ||
    original.description === original.statute
  ));

  // Detect grade duplication: grade appearing in description field
  const hasGradeInDescription = !!(original.description && original.grade && (
    original.description === original.grade ||
    (original.description.match(/^[A-Z]\d*$/) && original.description.length <= 3)
  ));

  // Detect field shifting: description is too short while disposition has substantial content
  const hasFieldShifting = !!(original.description && original.disposition && (
    original.description.length <= 3 &&
    original.disposition.length > 10 &&
    original.description.match(/^[A-Z]\d*$/)
  ));

  // Detect missing grade with concatenated content:
  // Grade is empty/missing and § symbol appears in description (should only be in statute)
  // OR statute field is empty but description contains § (statute got shifted)
  const hasMissingGradeWithConcatenation = !!(original.grade === '' &&
    original.description &&
    (original.description.includes('§') || (original.statute === '' && original.description.includes('§'))));

  return hasStatuteInDescription || hasGradeInDescription || hasFieldShifting || hasMissingGradeWithConcatenation;
};

/** Handle missing grade scenario with concatenated content */
const parseMissingGradeScenario = (rawFields: string[], original: ReturnType<typeof originalParsing>) => {
  let seqNo = '';
  let statute = '';
  let grade = '';
  let description = '';
  let disposition = '';

  // First field should be sequence number
  if (rawFields[0] && rawFields[0].match(/^\d+$/)) {
    seqNo = rawFields[0];
  }

  // Second field should be statute (contains § symbol or follows statute pattern)
  if (rawFields[1] && (rawFields[1].includes('§') || rawFields[1].match(/^\d+\s*[A-Z]/))) {
    statute = rawFields[1];
  }

  const descField = original.description;
  const dispField = original.disposition;

  // The description field actually contains the statute - extract it
  if (descField && descField.includes('§')) {
    // Find where the statute ends by looking for transition to descriptive text
    // Statutes are typically codes/numbers/symbols, descriptions are typically words
    let foundDescriptiveText = false;

    // Look for § and then find where descriptive text likely starts
    const parts = descField.split(/(\s+)/); // Split on whitespace but keep delimiters
    let currentText = '';

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      currentText += part;

      // If we've seen § and now encounter what looks like descriptive text, stop here
      if (currentText.includes('§') && part.match(/^[A-Z][a-z]+/) && part.length > 3) {
        // Found what looks like the start of a description (capitalized word > 3 chars)
        foundDescriptiveText = true;
        break;
      }
    }

    if (foundDescriptiveText) {
      // Split at the descriptive text
      const statuteMatch = descField.match(/^(.*?)([A-Z][a-z]{3,}.*)/);
      if (statuteMatch) {
        statute = statuteMatch[1].trim();
        const remainingDesc = statuteMatch[2].trim();

        // Handle disposition field
        if (dispField) {
          const dispKeywords = /(Guilty Plea|Not Guilty|Dismissed|Withdrawn|Held for Court|Nolle Prosequi|ARD|Guilty|Conviction|Acquittal)/i;
          const dispMatch = dispField.match(dispKeywords);

          if (dispMatch && typeof dispMatch.index === 'number') {
            const beforeDisp = dispField.substring(0, dispMatch.index).trim();
            const actualDisp = dispField.substring(dispMatch.index).trim();

            const descParts = [remainingDesc, beforeDisp].filter(part => part && part.length > 0);
            description = descParts.join(' ');
            disposition = actualDisp;
          } else {
            const descParts = [remainingDesc, dispField].filter(part => part && part.length > 0);
            description = descParts.join(' ');
            disposition = '';
          }
        } else {
          description = remainingDesc;
          disposition = '';
        }
      } else {
        // Fallback - couldn't parse, take everything as statute
        statute = descField;
        description = '';
        disposition = dispField || '';
      }
    } else {
      // No descriptive text found after §, treat entire field as statute
      statute = descField;
      description = '';
      disposition = dispField || '';
    }
  }

  // Grade remains empty in this scenario
  grade = '';

  return { seqNo, statute, grade, description, disposition };
};

/** Robust parsing for other misaligned scenarios */
const parseRobustOther = (rawFields: string[]) => {
  let seqNo = '';
  let statute = '';
  let grade = '';
  let description = '';
  let disposition = '';

  // First field should be sequence number
  if (rawFields[0] && rawFields[0].match(/^\d+$/)) {
    seqNo = rawFields[0];
  }

  // Second field should be statute (contains § symbol or follows statute pattern)
  if (rawFields[1] && (rawFields[1].includes('§') || rawFields[1].match(/^\d+\s*[A-Z]/))) {
    statute = rawFields[1];
  }

  const remainingFields = rawFields.slice(2).filter(f => f && f.match(/[A-Z0-9]/));

  if (remainingFields.length >= 1) {
    const lastField = remainingFields[remainingFields.length - 1];
    const secondLastField = remainingFields.length >= 2 ? remainingFields[remainingFields.length - 2] : '';

    if (remainingFields.length === 1) {
      // Only one field remaining - determine if it's grade, description, or disposition
      if (lastField.match(/^[A-Z]\d*$/) && lastField.length <= 3) {
        grade = lastField;
      } else {
        description = lastField;
      }
    } else if (remainingFields.length === 2) {
      // Two fields remaining
      if (secondLastField.match(/^[A-Z]\d*$/) && secondLastField.length <= 3) {
        grade = secondLastField;
        description = lastField;
      } else {
        description = secondLastField;
        disposition = lastField;
      }
    } else if (remainingFields.length >= 3) {
      // Three or more fields
      if (remainingFields[0].match(/^[A-Z]\d*$/) && remainingFields[0].length <= 3) {
        grade = remainingFields[0];
        description = remainingFields[1];
        disposition = remainingFields.slice(2).join(' ');
      } else {
        description = remainingFields[0];
        disposition = remainingFields.slice(1).join(' ');
      }
    }
  }

  return { seqNo, statute, grade, description, disposition };
};

/** Parse a single charge line */
const parseChargeLine = (charge: string) => {
  const split = charge.split('|');

  if (!needsRobustParsing(split)) {
    // Use original parsing for normal cases
    return originalParsing(split);
  }

  // Apply robust parsing for misaligned cases
  const rawFields = split.map(field => field.trim());
  const original = originalParsing(split);
  const isMissingGradeScenario = original.grade === '' &&
    original.description &&
    original.description.includes('§');

  if (isMissingGradeScenario) {
    return parseMissingGradeScenario(rawFields, original);
  } else {
    return parseRobustOther(rawFields);
  }
};

/** Extract sentences from charge lines */
const extractSentences = (chargeLines: string[]): CourtSentence[] => {
  return chargeLines.reduce((acc, line) => {
    const hasDate = line.match(/\d{2}\/\d{2}\/\d{4}/);

    if (hasDate && !line.includes('Printed:')) {
      const split = line.split('|');
      const [sentenceDate, sentenceType] = split.reduce(spaces, []);
      const [sentenceProgramPeriod, sentenceLength] = split.slice(-2,);

      acc.push({
        [Sentence.Date]: sentenceDate && sentenceDate.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || '',
        [Sentence.Type]: sentenceType,
        [Sentence.ProgramPeriod]: sentenceProgramPeriod === '  ' ? '' : sentenceProgramPeriod,
        [Sentence.Length]: sentenceLength || ''
      });
      return acc;
    }

    return acc;
  }, [] as CourtSentence[]);
};

/** Reconstruct full charge line from multiple lines */
const reconstructChargeLine = (chargeLines: string[]): string => {
  const sentenceDatePattern = /\d{2}\/\d{2}\/\d{4}/;
  
  // Filter out sentence lines (lines containing dates but not "Printed:")
  const chargeOnlyLines = chargeLines.filter(line => 
    !sentenceDatePattern.test(line) || line.includes('Printed:')
  );
  
  if (chargeOnlyLines.length <= 1) {
    return chargeOnlyLines[0] || '';
  }
  
  // First line contains the main charge structure
  const mainLine = chargeOnlyLines[0];
  const continuationLines = chargeOnlyLines.slice(1);
  
  // Split main line to identify field positions
  const mainParts = mainLine.split('|');
  
  // If continuation lines exist, append them to the description field
  // Continuation text usually goes into the description area
  if (continuationLines.length > 0 && mainParts.length >= 2) {
    const continuationText = continuationLines
      .map(line => line.trim())
      .filter(line => line && !line.includes('Printed:'))
      .join(' ');
    
    if (continuationText) {
      // Find the description field (usually second to last or third field)
      // Insert continuation text into appropriate position
      if (mainParts.length >= 4) {
        // Standard 5-field structure: seqNo | statute | grade | description | disposition
        mainParts[3] = (mainParts[3] || '').trim() + ' ' + continuationText;
      } else if (mainParts.length === 3) {
        // Missing field structure: seqNo | statute | description-disposition
        mainParts[2] = (mainParts[2] || '').trim() + ' ' + continuationText;
      }
    }
  }
  
  return mainParts.join('|');
};

/** Detect missing grade field by analyzing field count and patterns */
const detectMissingGrade = (split: string[]): boolean => {
  const cleanFields = split.map(s => s.trim()).filter(s => s.length > 0);
  
  // If we have exactly 4 meaningful fields instead of expected 5
  if (cleanFields.length === 4) {
    const [seqNo, field1, field2, field3] = cleanFields;
    
    // Check if field1 looks like a statute (contains § or number pattern)
    const isStatute = field1.includes('§') || field1.match(/^\d+\s*[A-Z]/);
    
    // Check if field2 looks like a grade (single letter + optional digits, 1-3 chars)
    const isGrade = field2.match(/^[A-Z]\d*$/) && field2.length <= 3;
    
    // If field1 is statute but field2 is NOT a grade, grade is missing
    if (isStatute && !isGrade) {
      return true;
    }
  }
  
  return false;
};

/** Enhanced parsing for missing grade scenarios */
const parseMissingGrade = (split: string[]) => {
  const cleanFields = split.map(s => s.trim()).filter(s => s.length > 0);
  
  if (cleanFields.length === 4) {
    const [seqNo, statute, description, disposition] = cleanFields;
    
    return {
      seqNo: seqNo || '',
      statute: statute || '',
      grade: '', // Explicitly missing
      description: description || '',
      disposition: disposition || ''
    };
  }
  
  // Fallback to original parsing if structure doesn't match expected missing grade pattern
  return originalParsing(split);
};

/** Orchestrates charge parsing for a case */
export const parseCharges = (lines: string[]): CourtCharges[] => {
  const charges = slices({ lines, reducer: chargeIndex });

  return charges.map((chargeLines) => {
    // Reconstruct complete charge line from multiple lines if needed
    const fullChargeLine = reconstructChargeLine(chargeLines);
    const split = fullChargeLine.split('|');
    
    // Check for missing grade field first
    let parsed;
    if (detectMissingGrade(split)) {
      parsed = parseMissingGrade(split);
    } else if (needsRobustParsing(split)) {
      // Use existing robust parsing for other misalignment issues
      const rawFields = split.map(field => field.trim());
      const original = originalParsing(split);
      const isMissingGradeScenario = original.grade === '' &&
        original.description &&
        original.description.includes('§');

      if (isMissingGradeScenario) {
        parsed = parseMissingGradeScenario(rawFields, original);
      } else {
        parsed = parseRobustOther(rawFields);
      }
    } else {
      // Use original parsing for normal cases
      parsed = originalParsing(split);
    }
    
    const sentenceLines = extractSentences(chargeLines);

    return {
      [Charge.SequenceNum]: parsed.seqNo,
      [Charge.Statute]: parsed.statute,
      // Additional Validation - updated to allow 'S' grade without digit
      [Charge.Grade]: parsed.grade.match(/^[A-Z]\d*$/) ? parsed.grade : '',
      [Charge.Description]: parsed.description,
      [Charge.Disposition]: parsed.disposition,
      [Charge.Sentence]: sentenceLines
    };
  });
};
