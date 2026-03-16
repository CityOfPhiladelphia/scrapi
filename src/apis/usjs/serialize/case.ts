/** Case-level metadata extraction */
import { keyValueMatch } from './utils.js';
import { parseCharges } from './charges.js';
import { Case, type CourtCase } from '../types.js';

/** Lazy-evaluated matchers for case header fields */
export const caseMatchers = (lines: string[]) => {
  return {
    /** These will be pulled as individual case slices
     *  First two lines seem deterministic.
     */
    [Case.DocketNumber]: () => keyValueMatch({ line: lines[0] || '', regex: /([A-Z]+-\d+-[A-Z]+-\d+-\d+)/ }),
    [Case.ProcStatus]: () => keyValueMatch({ line: lines[0] || '', regex: /Proc Status:\s+(.+?)(?=DC No:|$)/ }),
    [Case.DCNum]: () => keyValueMatch({ line: lines[0] || '', regex: /DC No:\s*(\d{10})/ }),
    [Case.OTN]: () => keyValueMatch({ line: lines[0] || '', regex: /OTN:([A-Z]\s*\d+-\d+)/ }),
    [Case.PID]: () => keyValueMatch({ line: lines[0] || '', regex: /PID:\s*([A-Z]\d+)/ }),
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
    [Case.NextActionDate]: () => {
      // Search through all case lines for "Next Action Date:" followed by a date
      for (const line of lines) {
        const match = line.match(/Next Action Date:\s*(\d{2}\/\d{2}\/\d{4})/);
        if (match && match[1]) {
          return match[1];
        }
      }
      return '';
    },
    [Case.Charges]: () => parseCharges(lines)
  };
};

/** Aggregator returning typed case object */
export const cases = (lines: string[]): CourtCase => {
  const info = caseMatchers(lines);

  return {
    [Case.DocketNumber]: info[Case.DocketNumber](),
    [Case.ProcStatus]: info[Case.ProcStatus](),
    [Case.DCNum]: info[Case.DCNum](),
    [Case.OTN]: info[Case.OTN](),
    [Case.PID]: info[Case.PID](),
    [Case.ArrestDate]: info[Case.ArrestDate](),
    [Case.DispositionDate]: info[Case.DispositionDate](),
    [Case.DispositionJudge]: info[Case.DispositionJudge](),
    [Case.DefenseAttorney]: info[Case.DefenseAttorney](),
    [Case.NextActionDate]: info[Case.NextActionDate](),
    [Case.Charges]: info[Case.Charges]()
  };
};
