/** Node Modules */
import assert from 'assert';

/** Local Imports 
 *  Note - setup aliases in tsconfig.json for cleaner imports
*/
import { pdf } from '../../_parsers/pdf.js';
import { USJS_PDF_PATH } from '../../consts.js'
/** Types */
import { Case, Charge, CourtCase, CourtSentence, Defendant, Sentence, SerializedSummary } from "./types.js";
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';


/** ToDo: Modularize & cleanup 
 *   Make PURE functions - 
 *    Parse above in pipeline
 */


/** Driver Function */
async function summary (acc: RestAccumulator): Promise<RestAccumulator> {
  const data = await pdf.extract(USJS_PDF_PATH + '/summary.pdf');
    
    assert(data && data.pages && Array.isArray(data.pages), 
    `PDF does not contain valid pages or was not able to be parsed: ${JSON.stringify(data)}`
    );
    
    const text = data.pages
    .reduce((acc, page, idx) => {
        /** Get the lines per page */
        const lines = pdf.lines.group(page.content);
        acc.push(lines);

        return acc;
    }, [] as string[][])
    .flat()
    

    const result = {
      person: person(text),
      cases: slices({ lines: text, reducer: docketIndex })
      .map(cases)
      
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


const matchers = (lines: string[]) => {
  return {
    person: {
      // Possibly break the regex out to their own mapping for easier test cases
      [Defendant.Name]: () => lines[2].split('DOB:')[0].replaceAll('|', '').trim() || '',
      [Defendant.Address]: () => lines[3].split('Eyes:')[0].replaceAll('|', '').trim() || '',
      [Defendant.DOB]: () => keyValueMatch({ line: lines[2], regex: /DOB:\s+(\d{2}\/\d{2}\/\d{4})/ }),
      [Defendant.Sex]: () => keyValueMatch({ line: lines[2], regex: /Sex:\s+(\w+)/ }),
      [Defendant.Eyes]: () => keyValueMatch({ line: lines[3], regex: /Eyes:\s+(\w+)/ }),
      [Defendant.Hair]: () => keyValueMatch({ line: lines[4], regex: /Hair:\s+(\w+)/ }),
      [Defendant.Race]: () => keyValueMatch({ line: lines[5], regex: /Race:\s+(\w+)/ }),
      [Defendant.Aliases]: () => {
        // Assumption - 20 aliases is generally going to be enough;
        return lines.slice(
          lines.findIndex((line) => line.match(/Aliases/)) + 1,
          lines.findIndex((line) => line.match(/Open|Closed/))
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
    },
    case: {
      /** These will be pulled as individual case slices
       *  First two lines seem deterministic. 
       */
      [Case.DocketNumber]: () => keyValueMatch({ line: lines[0], regex: /([A-Z]+-\d+-[A-Z]+-\d+-\d+)/ }),
      [Case.ProcStatus]: () => keyValueMatch({ line: lines[0], regex: /Proc Status:\s+(.+?)(?=DC No:|$)/ }),
      [Case.DCNum]: () => keyValueMatch({ line: lines[0], regex: /DC No:\s*(\d{10})/ }),
      [Case.OTN]: () => keyValueMatch({ line: lines[0], regex: /OTN:([A-Z]\s*\d+-\d+)/ }),
      [Case.ArrestDate]: () => keyValueMatch({ line: lines[1], regex: /Arrest Dt:\s+(\d{2}\/\d{2}\/\d{4})/ }),
      [Case.DispositionDate]: () => keyValueMatch({ line: lines[1], regex: /Disp Date:\s+(\d{2}\/\d{2}\/\d{4})/ }),
      [Case.DispositionJudge]: () => keyValueMatch({ line: lines[1], regex: /Disp Judge:\s+(.+?)(?=\s{2,}|$)/ }),
      [Case.DefenseAttorney]: () => keyValueMatch({ line: lines[2], regex: /Def Atty:\s+(.+?)(?=\s{2,}|$)/ }),
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
            // Additional Validation 
            [Charge.Grade]: grade.match(/[A-Z0-9]?[0-9]/) ? grade : '',
            [Charge.Description]: description,
            [Charge.Disposition]: disposition,
            [Charge.Sentence]: sentenceLines
          }
        });

        return result;

      }
    }
  }
}

// Extract personal information
const person = (lines: string[]) => {
  const info = matchers(lines);
  /** ToDo: Ensure we stop at a 'Closed' or 'Open' for aliases. */
  return Object.values(Defendant)
    .reduce((acc, key) => {

      if(key === Defendant.Aliases) {
        /** This block is for typescript narrowing only */
        acc[Defendant.Aliases] = info.person[Defendant.Aliases]();
        return acc;
      };
      
      acc[key] = info.person[key]();
      return acc;
    }, {
      [Defendant.Name]: '',
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
  const info = matchers(lines);

  return Object.values(Case)
    .reduce((acc: Record<string, string | any[]>, key) => { 
      if(key === Case.Charges) {
        acc[Case.Charges] = info.case[Case.Charges]();
        return acc;
      };

      acc[key] = info.case[key]();
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


export const serialize = { 
  summary
}