/** Node Modules */
import assert from 'assert';

/** Local Imports 
 *  Note - setup aliases in tsconfig.json for cleaner imports
*/
import { pdf } from '../../_parsers/pdf.js';
import { USJS_PDF_PATH } from '../../consts.js'
/** Types */
import { Case, Charge, CourtCase, CourtSentence, Defendant, FileType, Sentence, SerializedSummary } from "./types.js";
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';


/** ToDo: Modularize & cleanup 
 *   Make PURE functions - 
 *    Parse above in pipeline
 */

/** Name parsing utility function */
function parseName(fullName: string): [string, string, string] {

  //empty or null
  // if (!fullName || !fullName.trim()) return ["", "", ""];
   if (!fullName || !fullName.trim()) {
    console.warn("parseName: Empty or null name provided");
    return ["", "", ""];
  }

  // Case 1: format like "Last, First M."
  if (fullName.includes(",")) {
    const [lastPart, rest] = fullName.split(",", 2).map(s => s.trim());
    const parts = rest.split(" ").filter(part => Boolean(part));
    const first = parts[0] || "";
    const middle = (parts[1] || "").replace(/\./g, ""); // strip periods
    return [first, middle, lastPart];
  }

 // Case 2: Format like "First Middle Last"
  const parts = fullName.split(" ").filter(Boolean);
  switch(parts.length){ 
    case 1: {
        const [last] = parts;
        return ["", "", last];
    }
    case 2: {
        const [first, last] = parts; 
        return [first, "", last];
    }
    case 3: {
        const [first, middle, last] = parts; 
        return [first, middle.replace(/\./g, ""), last];
    }
    default: { 
        //unrecognized format: preserve original
        return ["", "", fullName];
    }
  }
}

/** Driver Function */
async function summary (acc: RestAccumulator): Promise<RestAccumulator> {
  const data = await pdf.extract(USJS_PDF_PATH + `${FileType.Summary}.pdf`);
    
    assert(data && data.pages && Array.isArray(data.pages), 
    `PDF does not contain valid pages or was not able to be parsed: ${JSON.stringify(data)}`
    );
    
    // Debug logging for PDF extraction
    console.log('📄 PDF extraction debug:');
    console.log('Total pages:', data.pages.length);
    console.log('First page content elements:', data.pages[0]?.content?.length || 0);
    if (data.pages[0]?.content?.length > 0) {
      console.log('First few content elements:', data.pages[0].content.slice(0, 3));
    }
    
    const text = data.pages
    .reduce((acc, page, idx) => {
        /** Get the lines per page */
        const lines = pdf.lines.group(page.content);
        console.log(`Page ${idx + 1} grouped into ${lines.length} lines`);
        acc.push(lines);

        return acc;
    }, [] as string[][])
    .flat()

    // Debug logging for final text array
    console.log('🔤 Final text array debug:');
    console.log('Total lines after flattening:', text.length);
    console.log('First 5 lines:', text.slice(0, 5));
    console.log('Lines 2-4 specifically:', text.slice(2, 5));
    
    const result = {
      person: person(text),
      cases: slices({ lines: text, reducer: docketIndex })
      .map(cases),
      summaryUrl: acc.data.scrapedUrls?.[FileType.Summary] || null
    }

    console.dir(result, { depth: null });

    acc.response.body = result;
    return acc;
};

type KVMatch = {
  line: string,
  regex: RegExp
};

const keyValueMatch = ({ line, regex }: KVMatch): string => {
  const match = line.match(regex);

  if(match && match[1]) return match[1].replaceAll('|', '').trim();
  return '';
};

// Helper function to extract and parse defendant name from lines
const extractDefendantName = (lines: string[]) => {
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

const personMatchers = (lines: string[]) => {
   const nameInfo = extractDefendantName(lines); 
  
  return {
    // Possibly break the regex out to their own mapping for easier test cases
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
        if(lineText.match(/Race:/)) {
          acc.push(lineText.split('Race:')[0].replaceAll('|', '').trim());
          return acc;
        };

        acc.push(lineText);
        return acc;
      }, [] as string[]) || [];
    }
  };
};

const caseMatchers = (lines: string[]) => {
  return {
    /** These will be pulled as individual case slices
     *  First two lines seem deterministic. 
     */
    [Case.DocketNumber]: () => keyValueMatch({ line: lines[0] || '', regex: /([A-Z]+-\d+-[A-Z]+-\d+-\d+)/ }),
    [Case.ProcStatus]: () => keyValueMatch({ line: lines[0] || '', regex: /Proc Status:\s+(.+?)(?=DC No:|$)/ }),
    [Case.DCNum]: () => keyValueMatch({ line: lines[0] || '', regex: /DC No:\s*(\d{10})/ }),
    [Case.OTN]: () => keyValueMatch({ line: lines[0] || '', regex: /OTN:([A-Z]\s*\d+-\d+)/ }),
    [Case.ArrestDate]: () => keyValueMatch({ line: lines[1] || '', regex: /Arrest Dt:\s+(\d{2}\/\d{2}\/\d{4})/ }),
    [Case.DispositionDate]: () => {
      // Search the first 6 lines for disposition date pattern
      for (let i = 0; i < Math.min(6, lines.length); i++) {
        const result = keyValueMatch({ line: lines[i] || '', regex: /Disp Date:\s+(\d{2}\/\d{2}\/\d{4})/ });
        if (result) return result;
      }
      return '';
    },
    [Case.DispositionJudge]: () => keyValueMatch({ line: lines[1] || '', regex: /Disp Judge:\s+(.+?)(?=\s{2,}|$)/ }),
    [Case.DefenseAttorney]: () => keyValueMatch({ line: lines[2] || '', regex: /Def Atty:\s+(.+?)(?=\s{2,}|$)/ }),
      [Case.Charges]: () => {
 
        const charges = slices({ lines, reducer: chargeIndex });
        const result  = charges.map((chargeLines) => {
        
          /** Handles variable length spaces */
          const spaces = (acc: string[], element: string) => {
            
           if(element.match(/[A-Z0-9]/)){
             acc.push(element.trim());
             return acc;
           }; 

           return acc;
          };

          const [charge = ''] = chargeLines;
          // This array is hard to parse - there's a variable level of spacing, so we need to go at it from both sides 
          // AND validate values at the end. 
          const split = charge.split('|');
          const [seqNo, statute, grade = ''] = split.reduce(spaces, []);
          const [description = '', disposition = ''] = split.slice(-2,).reduce(spaces, []);

          const sentenceLines = chargeLines.reduce((acc, line) => {
            const hasDate = line.match(/\d{2}\/\d{2}\/\d{4}/);

            if(hasDate && !line.includes('Printed:')) {
              const split = line.split('|')
              const [sentenceDate, sentenceType] = split.reduce(spaces, []);
              const [sentenceProgramPeriod, sentenceLength] = split.slice(-2, );

              acc.push({
                [Sentence.Date]: sentenceDate && sentenceDate.match(/\d{2}\/\d{2}\/\d{4}/)?.[0] || '',
                [Sentence.Type]: sentenceType,
                [Sentence.ProgramPeriod]: sentenceProgramPeriod === '  ' ? '' : sentenceProgramPeriod,
                [Sentence.Length]: sentenceLength || ''
              })
              return acc;
            }

            return acc;
          }, [] as CourtSentence[]);


          return {
            [Charge.SequenceNum]: seqNo,
            [Charge.Statute]: statute,
            // Additional Validation - updated to allow 'S' grade without digit
            [Charge.Grade]: grade.match(/^[A-Z]\d*$/) ? grade : '',
            [Charge.Description]: description,
            [Charge.Disposition]: disposition,
            [Charge.Sentence]: sentenceLines
          }
        });

        return result;

      }
  };
};

// Extract personal information
const person = (lines: string[]) => {
  const info = personMatchers(lines);
  /** ToDo: Ensure we stop at a 'Closed' or 'Open' for aliases. */
  return Object.values(Defendant)
    .reduce((acc, key) => {

      if(key === Defendant.Aliases) {
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

const cases = (lines: string[]) => { 
  const info = caseMatchers(lines);

  return Object.values(Case)
    .reduce((acc: Record<string, string | any[]>, key) => { 
      if(key === Case.Charges) {
        acc[Case.Charges] = info[Case.Charges]();
        return acc;
      };

      acc[key] = info[key]();
      return acc;
    }, {
      [Case.DocketNumber]: '',
      [Case.ProcStatus]: '', 
      [Case.DCNum]: '',
      [Case.OTN]: '',
      [Case.ArrestDate]: '',
      [Case.DispositionDate]: '',
      [Case.DispositionJudge]: '',
      [Case.DefenseAttorney]: '',
      [Case.Charges]: []
    } as CourtCase);
}
const docketIndex = (acc: number[], line: string, idx: number) => { 
  const docket = /([A-Z]+-\d+-[A-Z]+-\d+-\d+)/;
  const match = line.match(docket);

  if(!match) return acc;

  acc.push(idx);
  return acc;
}

const chargeIndex = (acc: any[], line: string, idx: any) => {
  const match = line.match(/^\d{1,2}\s+/);

  if(!match) return acc;
  acc.push(idx);
  return acc;
 }

/** Genericize this to process the charges/sentences similarly? */
type SliceProps = { 
  lines: string[],
  reducer: (acc: number[], line: string, idx: number) => number[]
}

const slices = ({ lines, reducer}: SliceProps ) => {
  
  /** Find the slices of the array using the docket #'s */
  return lines
  /** Get the index of each section # within lines as a breakpoint for cases */
  .reduce(reducer, [])
  /** Return case slices from lines */
  .map((startLineIdx, SectionIdx, SectionArray) => { 
    const nextIdx = SectionIdx + 1;
    const arrayLen = SectionArray.length - 1;

    if(nextIdx > arrayLen) return lines.slice(startLineIdx);
    const endLineIdx = SectionArray[nextIdx];
    return lines.slice(startLineIdx, endLineIdx)
  })
}

/** Docket Serialize  */
const docket = async (acc: RestAccumulator): Promise<RestAccumulator> => {
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
  .flat()
  
  // Pattern is find line, extract info from line
  const [addressLine] = text.filter((line) => { return line.match(/.*City\/State\/Zip.*/)})
  assert(addressLine, 'Docket Sheet does not contain a zip code');

  const zipline = addressLine.split('City/State/Zip:')[1]
  const zipcode = zipline.split(' ')[3]
  
  const [total] = text.filter((line) => { return line.match(/^.*Grand Totals.*$/)})
  console.log('Total', total);
  const [_, _1, assessment, _2, payments, adjustments, nonmonetary, balance] = total && total.split('|') || []

  // Extract case status using the same pattern as address
  const [caseStatusLine] = text.filter((line) => { return line.match(/.*Case Status.*/)})
  assert(caseStatusLine, 'Docket Sheet does not contain a status');

  const statusLine = caseStatusLine.split('Case Status:')[1]
  const casestatus = statusLine
  .replace(/\|/g, " ")      // turn pipes into spaces
  .trim()                   // remove leading/trailing junk
  .split(/\s+/)[0];   

  // Extract county using the same pattern
  const [countyLine] = text.filter((line) => { return line.match(/.*County:.*/)})
  const county = countyLine ? countyLine.split('County:')[1]?.trim()?.split(/\s+/)[0] : '';

  // Extract defense attorney information from ATTORNEY INFORMATION section
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
    docketUrl: acc.data.scrapedUrls?.[FileType.DocketSheet] || null
  };

  console.dir(acc.response.body, { depth: null });
  return acc;
}


export const serialize = { 
  summary,
  docket
}