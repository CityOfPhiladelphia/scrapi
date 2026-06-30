/** Summary PDF processing driver */
import assert from 'assert';
import { pdf } from '../../../_parsers/pdf.js';
import { USJS_PDF_PATH } from '../../../consts.js';
import { FileType } from '../types.js';
import { person } from './defendant.js';
import { cases } from './case.js';
import { slices, docketIndex } from './slices.js';
import { Case } from '../types.js';
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';

const DOCKET_NUMBER_PATTERN = /([A-Z]+-\d+-[A-Z]+-\d+-\d+)/;

const normalizeStatusHeading = (line: string): string | null => {
  const normalized = line
    .replace(/^\|+/, '')
    .replace(/\|+$/, '')
    .replace(/\(Continued\)/gi, '')
    .trim()
    .toLowerCase();

  const headingMap: Record<string, string> = {
    archived: 'Archived',
    closed: 'Closed',
    open: 'Open',
    adjudicated: 'Adjudicated',
    active: 'Active',
    pending: 'Pending',
    dismissed: 'Dismissed',
    completed: 'Completed',
    inactive: 'Inactive'
  };

  return headingMap[normalized] || null;
};

const getSummaryStatusByDocket = (lines: string[]): Map<string, string> => {
  const byDocket = new Map<string, string>();
  let currentStatus: string | null = null;

  for (const line of lines) {
    const headingStatus = normalizeStatusHeading(line);
    if (headingStatus) {
      currentStatus = headingStatus;
      continue;
    }

    const docketMatch = line.match(DOCKET_NUMBER_PATTERN);
    if (docketMatch && currentStatus) {
      byDocket.set(docketMatch[1], currentStatus);
    }
  }

  return byDocket;
};

/** Main async function for Summary PDF */
export async function summary(acc: RestAccumulator): Promise<RestAccumulator> {
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
    .flat();

  // Debug logging for final text array
  console.log('🔤 Final text array debug:');
  console.log('Total lines after flattening:', text.length);
  console.log('First 5 lines:', text.slice(0, 5));
  console.log('Lines 2-4 specifically:', text.slice(2, 5));

  const summaryStatusByDocket = getSummaryStatusByDocket(text);

  const parsedCases = slices({ lines: text, reducer: docketIndex })
    .map(cases)
    .map((courtCase) => {
      const summaryStatus = summaryStatusByDocket.get(courtCase[Case.DocketNumber]);
      const parsedStatus = (courtCase[Case.ProcStatus] || '').trim();

      if (summaryStatus === 'Archived' && (!parsedStatus || /^closed$/i.test(parsedStatus))) {
        courtCase[Case.ProcStatus] = 'Archived';
      }

      return courtCase;
    });

  const result = {
    person: person(text),
    cases: parsedCases,
    summaryUrl: acc.data.scrapedUrls?.[FileType.Summary] || null,
    rawText: text,
    rawChargeSlices: slices({ lines: text, reducer: docketIndex })
  };

  console.dir(result, { depth: null });

  acc.response.body = result;
  return acc;
}
