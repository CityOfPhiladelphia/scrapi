import { chromium  as playwright } from 'playwright';
import chromium from '@sparticuz/chromium';
import { USJS_PDF_PATH } from '../../consts.js';
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';
import { FileType } from './types.js';



interface DocumentType {
  type: FileType
};

interface SummaryScrapeParams {
  docketNumber: string;
  savePath: string;
};


const downloadFile = ({ type }: DocumentType) => async (acc: RestAccumulator): Promise<RestAccumulator> => {
  const { docketNum } = acc.data.valid.parameters as Record<string, string> & SummaryScrapeParams;
  
  const args = process.env.LOCAL ? {}: { executablePath: await chromium.executablePath("/opt/nodejs/node_modules/@sparticuz/chromium/bin") }

  const browser = await playwright.launch({
    args: chromium.args,
    headless: true,
    ...args  
  });

  const page = await browser.newPage();
  await page.goto('https://ujsportal.pacourts.us/CaseSearch');
  
  // Retry logic for search control with timeout handling
  let searchControlRetries = 0;
  const maxRetries = 3;
  
  while (searchControlRetries < maxRetries) {
    try {
      const searchControl = page.getByTitle('Search By', );
      await searchControl.selectOption('Docket Number');
      break; // Success, exit retry loop
    } catch (error) {
      searchControlRetries++;
      console.log(`Search control attempt ${searchControlRetries} failed:`, error);
      
      if (searchControlRetries >= maxRetries) {
        console.error(`Search control failed after ${maxRetries} attempts`);
        throw error; // Re-throw the error after max retries
      }
      
      // Wait before retry
      await page.waitForTimeout(2000);
      console.log(`Retrying search control (attempt ${searchControlRetries + 1}/${maxRetries})...`);
    }
  }
  
  const docketInput = page.getByTitle('Docket Number');
  await docketInput.fill(docketNum);
  await page.getByRole('button', { name: 'Search' }).nth(1).click();
  await page.waitForTimeout(2000);

  // Find the row with your docket number first
  const docketRow = page.locator(`tr:has-text("${docketNum}")`);
  const link = docketRow.locator(`[href*="/Report/${type}?"]`).first();

  // Capture the actual URL before clicking
  const reportUrl = await link.getAttribute('href');
  const fullReportUrl = reportUrl ? `https://ujsportal.pacourts.us${reportUrl}` : null;

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    // Annoyingly opens in pdf reader mode in a new tab
    await link.click({ modifiers: ['Alt'] })
   ])

   console.log("downloaded path: ", await download.path());

   await download.saveAs(`${USJS_PDF_PATH}/${type}.pdf`);
  // await browser.close();

   // Store the URL in the accumulator for use in serialize
   acc.data.scrapedUrls = acc.data.scrapedUrls || {};
   acc.data.scrapedUrls[type] = fullReportUrl;

   return acc;
};

export const scrape = {
  summary: downloadFile({ type: FileType.Summary }),
  docket: downloadFile({ type: FileType.DocketSheet })
};