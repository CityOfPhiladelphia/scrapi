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

/** Intelligent field identification based on content patterns rather than position */
const identifyFields = (split: string[]) => {
  const fields = split.map(s => s.trim()).filter(s => s.length > 0);
  
  let seqNo = '';
  let statute = '';
  let grade = '';
  let description = '';
  let disposition = '';
  
  // First field is always sequence number
  if (fields[0] && fields[0].match(/^\d+$/)) {
    seqNo = fields[0];
  }
  
  // Identify fields by content patterns
  const remainingFields = fields.slice(1);
  
  for (let i = 0; i < remainingFields.length; i++) {
    const field = remainingFields[i];
    
    // Statute: contains § symbol or starts with number + letter pattern  
    if (!statute && (field.includes('§') || field.match(/^\d+\s*[A-Z]/))) {
      statute = field;
      continue;
    }
    
    // Grade: single letter + optional digits, 1-3 characters max
    if (!grade && field.match(/^[A-Z]\d*$/) && field.length <= 3) {
      grade = field;
      continue;
    }
    
    // Disposition: contains known disposition keywords
    if (!disposition && field.match(/(Guilty|Dismissed|Withdrawn|Held for Court|Nolle|ARD|Conviction|Acquittal|Not Guilty)/i)) {
      disposition = field;
      continue;
    }
  }
  
  // Everything else goes to description (combine remaining unidentified fields)
  const usedFields = [seqNo, statute, grade, disposition].filter(f => f);
  const descriptionFields = fields.filter(field => !usedFields.includes(field));
  description = descriptionFields.join(' ').trim();
  
  return { seqNo, statute, grade, description, disposition };
};

/** Simple multi-line handler that just combines continuation lines */
const combineMultilineDescription = (chargeLines: string[]): string => {
  const sentenceDatePattern = /\d{2}\/\d{2}\/\d{4}/;
  
  // Filter out sentence lines and combine all charge-related lines
  const chargeTextLines = chargeLines
    .filter(line => !sentenceDatePattern.test(line) || line.includes('Printed:'))
    .map(line => line.trim())
    .filter(line => line.length > 0);
  
  return chargeTextLines.join(' | ');
};

/** Orchestrates charge parsing for a case */
export const parseCharges = (lines: string[]): CourtCharges[] => {
  const charges = slices({ lines, reducer: chargeIndex });

  return charges.map((chargeLines) => {
    // Combine all charge-related lines (handles multi-line descriptions)
    const combinedChargeLine = combineMultilineDescription(chargeLines);
    const split = combinedChargeLine.split('|');
    
    // Use intelligent field identification instead of positional parsing
    const parsed = identifyFields(split);
    
    const sentenceLines = extractSentences(chargeLines);

    return {
      [Charge.SequenceNum]: parsed.seqNo,
      [Charge.Statute]: parsed.statute,
      [Charge.Grade]: parsed.grade.match(/^[A-Z]\d*$/) ? parsed.grade : '',
      [Charge.Description]: parsed.description,
      [Charge.Disposition]: parsed.disposition,
      [Charge.Sentence]: sentenceLines
    };
  });
};
