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

   // Set longer timeouts for slower court systems
  page.setDefaultTimeout(60000); // 60 seconds
  page.setDefaultNavigationTimeout(60000); // 60 seconds

  //Still randomizing chrome versions; Other combos cause more timeouts
  const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.183 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.6422.113 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.207 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.112 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6210.92 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.6099.71 Safari/537.36',
  ];
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  await page.setExtraHTTPHeaders({
    'User-Agent': randomUserAgent
  });
 
  // Anti-detection: Random delay
  await page.waitForTimeout(500 + Math.random() * 1000);

  // Navigate to court search page
  await page.goto('https://ujsportal.pacourts.us/CaseSearch', { 
    waitUntil: 'networkidle'
  });

  // Try to find search control with fallback
  let searchControl;
  try {
    searchControl = page.getByTitle('Search By');
    await searchControl.waitFor({ timeout: 60000 });
  } catch (error) {
    console.log('Trying fallback selector for SearchBy...');
    searchControl = page.locator('#SearchBy');
    await searchControl.waitFor({ timeout: 60000 });
  }

  await searchControl.selectOption('Docket Number');
  
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