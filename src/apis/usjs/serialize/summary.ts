/** Summary PDF processing driver */
import assert from 'assert';
import { pdf } from '../../../_parsers/pdf.js';
import { USJS_PDF_PATH } from '../../../consts.js';
import { FileType } from '../types.js';
import { person } from './defendant.js';
import { cases } from './case.js';
import { slices, docketIndex } from './slices.js';
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';

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

  const result = {
    person: person(text),
    cases: slices({ lines: text, reducer: docketIndex })
      .map(cases),
    summaryUrl: acc.data.scrapedUrls?.[FileType.Summary] || null,
    rawText: text,
    rawChargeSlices: slices({ lines: text, reducer: docketIndex })
  };

  console.dir(result, { depth: null });

  acc.response.body = result;
  return acc;
}
