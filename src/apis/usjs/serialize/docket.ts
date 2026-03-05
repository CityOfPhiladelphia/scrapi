/** Docket Sheet PDF processing driver */
import assert from 'assert';
import { pdf } from '../../../_parsers/pdf.js';
import { USJS_PDF_PATH } from '../../../consts.js';
import { FileType } from '../types.js';
import { PA_COUNTIES } from './slices.js';
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';

/** Extract zipcode from address line */
const extractZipcode = (text: string[]): string => {
  const [addressLine] = text.filter((line) => { return line.match(/.*City\/State\/Zip.*/) });
  assert(addressLine, 'Docket Sheet does not contain a zip code');

  const zipline = addressLine.split('City/State/Zip:')[1];
  const zipParts = zipline.trim().split(/\s+/);
  return zipParts[zipParts.length - 1]; // Take the last part as zip code
};

/** Extract balance with 4-level fallback chain */
const extractBalance = (text: string[], pages: any[]) => {
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

    // Fallback 4: Look for balance-related patterns
    if (!total) {
      total = text.find((line) =>
        (line.toLowerCase().includes('balance') ||
          line.toLowerCase().includes('total due') ||
          line.toLowerCase().includes('amount owed')) &&
        line.includes('|')
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

  // Extract type from restitution lines
  for (const line of restitutionTypeLines) {
    const lineText = line.toLowerCase();
    if (!restitutionOwedTo) {
      if (lineText.includes('individual restitution')) {
        restitutionOwedTo = 'Individual person';
      } else if (
        lineText.includes('public assistance restitution') ||
        lineText.includes('insurance fraud prevention authority') ||
        lineText.includes('business entity restitution') ||
        lineText.includes('unemployment compensation') ||
        lineText.includes('providian national bank') ||
        lineText.match(/.*bank.*restitution.*|.*corporation.*restitution.*|.*insurance.*restitution.*|.*government.*restitution.*/i)
      ) {
        restitutionOwedTo = 'Government, insurance company, or corporation';
      }
    }
  }

  // Process entity lines (these are already filtered for specific entities)
  if (!restitutionOwedTo && restitutionEntityLines.length > 0) {
    for (const line of restitutionEntityLines) {
      const lineText = line.toLowerCase();
      if (lineText.includes('individual restitution')) {
        restitutionOwedTo = 'Individual person';
        break;
      } else {
        // All other entities in our filter are corporate/government
        restitutionOwedTo = 'Government, insurance company, or corporation';
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
    docketUrl: acc.data.scrapedUrls?.[FileType.DocketSheet] || null
  };

  console.dir(acc.response.body, { depth: null });
  return acc;
}
