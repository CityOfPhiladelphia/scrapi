/** Docket Sheet PDF processing driver */
import assert from 'assert';
import { pdf } from '../../../_parsers/pdf.js';
import { USJS_PDF_PATH } from '../../../consts.js';
import { FileType } from '../types.js';
import { PA_COUNTIES } from './slices.js';
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';

/** Extract zipcode from address line */
const extractZipcode = (text: string[]): string => {
  // Primary method: Look for "City/State/Zip:" format
  const [addressLine] = text.filter((line) => { return line.match(/.*City\/State\/Zip.*/) });
  
  if (addressLine) {
    const zipline = addressLine.split('City/State/Zip:')[1];
    const zipParts = zipline.trim().split(/\s+/);
    return zipParts[zipParts.length - 1]; // Take the last part as zip code
  }
  
  // Fallback method: Look for Pennsylvania zip codes (5 digits with PA on same line)
  for (const line of text) {
    const zipMatch = line.match(/.*\b(?:PA|Pennsylvania)\s+(\d{5}(?:-\d{4})?)\b/i);
    if (zipMatch) {
      return zipMatch[1]; // Return the captured zip code group
    }
  }
  
  throw new Error('Docket Sheet does not contain a zip code');
};

/** Extract balance with 4-level fallback chain */
const extractBalance = (text: string[], pages: any[]) => {
  // Check for simple "Case Balance: $amount" format first (before other fallbacks)
  const balanceLine = text.find((line) => 
    line.match(/case balance:\s*\$[\d,]+\.?\d*/i)
  );
  if (balanceLine) {
    const balanceMatch = balanceLine.match(/\$[\d,]+\.?\d*/);
    const balanceAmount = balanceMatch ? balanceMatch[0] : '';
    return { assessment: '', payments: '', adjustments: '', nonmonetary: '', balance: balanceAmount };
  }

  // Try primary logic first - existing approach
  let total = text.find((line) => line.match(/^.*Grand Totals.*$/));

  // If not found, try fallback strategies
  if (!total) {
    // Fallback 1: Case-insensitive search
    total = text.find((line) => line.match(/grand totals/i));

    // Fallback 2: Page-by-page search if still not found
    if (!total) {
      for (const page of pages) {
        const pageLines = pdf.lines.group(page.content);
        const grandTotalLine = pageLines.find(line => line.match(/grand totals/i));
        if (grandTotalLine) {
          total = grandTotalLine;
          break;
        }
      }
    }

    // Fallback 3: Broader pattern matching for financial summaries
    if (!total) {
      total = text.find((line) =>
        line.toLowerCase().includes('totals') &&
        (line.includes('$') || line.includes('|'))
      );
    }

    // Fallback 4: Look for balance-related patterns (but exclude "Case Balance:" format)
    if (!total) {
      total = text.find((line) =>
        (line.toLowerCase().includes('balance') ||
          line.toLowerCase().includes('total due') ||
          line.toLowerCase().includes('amount owed')) &&
        line.includes('|') &&
        !line.toLowerCase().match(/case balance:\s*\$/)
      );
    }
  }

  const [_, _1, assessment, _2, payments, adjustments, nonmonetary, balance] = total && total.split('|') || [];
  return { assessment, payments, adjustments, nonmonetary, balance };
};

/** Extract restitution amount and type */
const extractRestitution = (text: string[]) => {
  // Extract restitution information
  const restitutionTotalLines = text.filter((line) => {
    return line.toLowerCase().includes('restitution totals:');
  });

  // Broader search for restitution type information
  const restitutionTypeLines = text.filter((line) => {
    return line.toLowerCase().includes('restitution');
  });

  // Secondary search for known restitution entities that may not contain the word 'restitution'
  const restitutionEntityLines = text.filter((line) => {
    const lineText = line.toLowerCase();
    return (
      lineText.includes('insurance fraud prevention authority') ||
      lineText.includes('business entity restitution') ||
      lineText.includes('unemployment compensation') ||
      lineText.includes('providian national bank') ||
      lineText.includes('public assistance restitution') ||
      lineText.includes('individual restitution')
    );
  });

  // Combine both searches
  const allRestitutionLines = [...restitutionTypeLines, ...restitutionEntityLines];

  console.log('Restitution total lines found:', restitutionTotalLines);
  console.log('Restitution type lines found:', restitutionTypeLines);
  console.log('Restitution entity lines found:', restitutionEntityLines);
  console.log('All restitution lines found:', allRestitutionLines);

  let restitutionAmount = '';
  let restitutionOwedTo = '';

  // Extract amount from restitution totals lines only
  for (const line of restitutionTotalLines) {
    const amountMatch = line.match(/\$?[\d,]+\.?\d*/);
    if (amountMatch && !restitutionAmount) {
      restitutionAmount = amountMatch[0].replace(/^\$/, ''); // Remove $ if present
    }
  }

  // Helper function to validate if extracted text looks like an actual entity name
  const isValidEntityName = (text: string): boolean => {
    const lower = text.toLowerCase();
    
    // Reject generic instructional phrases
    const genericPhrases = [
      'defendant', 'pay balance', 'costs, fine and', 'ordered to pay', 
      'balance of costs', 'fine and', 'is to pay', 'shall pay',
      'restitution -', 'civil penalty'
    ];
    
    if (genericPhrases.some(phrase => lower.includes(phrase))) {
      return false;
    }
    
    // Reject if it's mostly lowercase common words (likely sentence fragment)
    const commonWords = ['the', 'to', 'and', 'of', 'is', 'pay', 'balance', 'costs', 'fine'];
    const words = text.split(/\s+/);
    const commonWordCount = words.filter(word => commonWords.includes(word.toLowerCase())).length;
    if (commonWordCount > words.length / 2) {
      return false;
    }
    
    // Must be substantial length and look like proper name/entity
    return text.length > 2 && 
           !text.match(/^[\|\s\:\-\$\d,\.]+$/) && // Not just symbols/numbers
           !text.match(/^\d+$/) && // Not just numbers
           !text.match(/^\$[\d,]+\.?\d*$/); // Not just dollar amounts
  };

  // Extract actual payee name instead of mapping to categories
  // First pass: Look for specific entity restitution (with amounts)
  for (const line of allRestitutionLines) {
    if (!restitutionOwedTo) {
      console.log(`Processing restitution line (specific pass): "${line}"`);
      
      // Pattern 1: PRIORITY - Specific restitution entity tables
      // Format: "Individual Restitution | |$amount..." or "Entity Name Restitution | |$amount..."
      if (line.includes('|') && line.match(/\$[\d,]+\.?\d*/)) {
        // Look for entity name + "Restitution" + pipe table format
        const entityRestitutionMatch = line.match(/^(.+?\s+restitution)\s+\|/i);
        if (entityRestitutionMatch) {
          const fullMatch = entityRestitutionMatch[1].trim();
          // Extract just the entity name part (everything before "Restitution")
          const entityName = fullMatch.replace(/\s+restitution$/i, '').trim();
          if (isValidEntityName(entityName)) {
            restitutionOwedTo = entityName;
            console.log(`Successfully extracted entity restitution: "${entityName}" from line: "${line}"`);
            break;
          }
        }
        
        // Fallback: any text before first pipe in financial table (if no entity name found)
        if (!restitutionOwedTo) {
          const pipeTableMatch = line.match(/^([^|]+?)(?:\s+\|\s|$)/);
          if (pipeTableMatch && pipeTableMatch[1]) {
            const candidate = pipeTableMatch[1].trim();
            if (isValidEntityName(candidate) && candidate.toLowerCase() !== 'restitution') {
              restitutionOwedTo = candidate;
              console.log(`Successfully extracted pipe table entity: "${candidate}" from line: "${line}"`);
              break;
            }
          }
        }
      }
    }
  }

  // Second pass: Look for other specific patterns if no entity found yet
  if (!restitutionOwedTo) {
    for (const line of allRestitutionLines) {
      console.log(`Processing restitution line (secondary pass): "${line}"`);
      
      // Pattern 3: "Restitution to: [Payee Name]" 
      const toPattern = line.match(/restitution\s+to:\s*(.+?)(?:\s*\||$)/i);
      if (toPattern && toPattern[1]) {
        const candidate = toPattern[1].trim();
        if (isValidEntityName(candidate)) {
          restitutionOwedTo = candidate;
          console.log(`Successfully extracted 'to' pattern: "${candidate}" from line: "${line}"`);
          break;
        }
      }
      
      // Pattern 4: Extract from entity-specific lines (when no "restitution" keyword)
      if (!restitutionOwedTo && restitutionEntityLines.includes(line)) {
        // Clean up the line by removing common prefixes/suffixes
        const cleanedLine = line
          .replace(/^\|+/, '') // Remove leading pipes
          .replace(/\|+$/, '') // Remove trailing pipes  
          .replace(/restitution/gi, '') // Remove "restitution" word
          .replace(/\s*:\s*/, '') // Remove colons
          .trim();
        
        if (isValidEntityName(cleanedLine)) {
          restitutionOwedTo = cleanedLine;
          console.log(`Successfully extracted entity pattern: "${cleanedLine}" from line: "${line}"`);
          break;
        }
      }
    }
  }

  // Third pass: Fallback to simple "|Restitution" format only if no specific entity found
  if (!restitutionOwedTo) {
    for (const line of allRestitutionLines) {
      console.log(`Processing restitution line (fallback pass): "${line}"`);
      
      // Pattern 2: Simple "|Restitution" format (lowest priority)
      if (line.trim() === '|Restitution' || line.trim() === 'Restitution') {
        restitutionOwedTo = 'Restitution';
        console.log(`Successfully extracted simple restitution (fallback): "Restitution" from line: "${line}"`);
        break;
      }
    }
  }

  return { restitutionAmount, restitutionOwedTo };
};

/** Extract case status field */
const extractCaseStatus = (text: string[]): string => {
  const [caseStatusLine] = text.filter((line) => { return line.match(/.*Case Status.*/) });
  assert(caseStatusLine, 'Docket Sheet does not contain a status');

  const statusLine = caseStatusLine.split('Case Status:')[1];
  return statusLine
    .replace(/\|/g, " ")      // turn pipes into spaces
    .trim()                   // remove leading/trailing junk
    .split(/\s+/)[0];
};

/** Fallback county extraction from document header */
const fallbackCountyFromHeader = (text: string[]): string => {
  // Search document header (first 15 lines typically contain court metadata)
  for (let i = 0; i < Math.min(15, text.length); i++) {
    const line = text[i].toLowerCase();
    
    for (const county of PA_COUNTIES) {
      if (line.includes(county.toLowerCase())) {
        return county;
      }
    }
  }
  
  return ''; // Return empty if no county found
};

/** Extract county field with fallback for edge cases */
const extractCounty = (text: string[]): string => {
  const [countyLine] = text.filter((line) => { return line.match(/.*County:.*/) });
  let county = countyLine ? countyLine.split('County:')[1]?.trim()?.split(/\s+/)[0] : '';
  
  // Remove leading pipes from MJ documents (e.g., "|Montgomery" → "Montgomery")
  county = county.replace(/^\|+/, '');
  
  // Handle edge cases: empty, pipes, or whitespace only
  if (!county || /^\s*\|\s*$/.test(county)) {
    county = fallbackCountyFromHeader(text);
  }
  
  return county;
};

/** Extract defense attorney and representation type */
const extractDefenseAttorney = (text: string[]) => {
  const attorneyInfoIndex = text.findIndex(line =>
    line.toLowerCase().includes('attorney information')
  );

  let defenseAtty = '';
  let representationType = '';

  if (attorneyInfoIndex !== -1) {
    // Get the attorney information section, handling pipe-delimited columns
    const attorneyLines = text.slice(attorneyInfoIndex, attorneyInfoIndex + 10)
      .filter(line => line.trim());

    // Extract only the defense attorney column (right side after pipes)
    const defenseAttyLines = attorneyLines
      .map(line => {
        // Split by pipes and take the right column (defense attorney info)
        const parts = line.split('|');
        if (parts.length >= 2) {
          // Take the rightmost non-empty part
          const rightParts = parts.slice(1).filter(p => p.trim());
          return rightParts.length > 0 ? rightParts[rightParts.length - 1].trim() : '';
        }
        return line.trim();
      })
      .filter(line => line && !line.toLowerCase().includes('commonwealth') && !line.toLowerCase().includes('district attorney'))
      .join('\n');

    defenseAtty = defenseAttyLines;

    // Parse representation type from the defense attorney text
    const attorneyText = defenseAttyLines.toLowerCase();

    // Also check individual lines for representation type
    const allLines = attorneyLines.join('\n').toLowerCase();

    if (attorneyText.includes('public defender') || attorneyText.includes('public') || allLines.includes('public defender')) {
      representationType = 'Public Defender';
    } else if (attorneyText.includes('court appointed') || allLines.includes('court appointed')) {
      representationType = 'Court appointed attorney';
    } else if (attorneyText.includes('private') || allLines.includes('private')) {
      representationType = 'Private attorney';
    } else if (attorneyText.includes('pro se') || attorneyText.includes('self') || allLines.includes('pro se')) {
      representationType = 'NA, not a case from defenders, AOPC, GVI, or P3';
    } else if (defenseAttyLines.trim()) {
      // Has defense attorney info but doesn't match known patterns
      representationType = 'NA, not a case from defenders, AOPC, GVI, or P3';
    } else {
      representationType = 'Blank';
    }
  } else {
    representationType = 'Blank';
  }

  return { defenseAtty, representationType };
};

/** Main async function for Docket PDF */
export async function docket(acc: RestAccumulator): Promise<RestAccumulator> {
  const data = await pdf.extract(USJS_PDF_PATH + `${FileType.DocketSheet}.pdf`);

  assert(data && data.pages && Array.isArray(data.pages),
    `PDF does not contain valid pages or was not able to be parsed: ${JSON.stringify(data)}`
  );

  const text = data.pages
    .reduce((acc, page) => {
      /** Get the lines per page */
      const lines = pdf.lines.group(page.content);
      acc.push(lines);

      return acc;
    }, [] as string[][])
    .flat();

  const zipcode = extractZipcode(text);
  const { assessment, payments, adjustments, nonmonetary, balance } = extractBalance(text, data.pages);
  const { restitutionAmount, restitutionOwedTo } = extractRestitution(text);
  const casestatus = extractCaseStatus(text);
  const county = extractCounty(text);
  const { representationType } = extractDefenseAttorney(text);

  acc.response.body = {
    zipcode,
    balance: balance,
    assessment: assessment,
    payments: payments,
    adjustments: adjustments,
    nonmonetary: nonmonetary,
    casestatus,
    county,
    representationType,
    restitutionAmount: restitutionAmount,
    restitutionOwedTo: restitutionOwedTo,
    docketUrl: acc.data.scrapedUrls?.[FileType.DocketSheet] || null,
    rawDocketText: text // Add raw text for debugging
  };

  console.dir(acc.response.body, { depth: null });
  return acc;
}
