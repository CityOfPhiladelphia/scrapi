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

   const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.1 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.1 Safari/605.1.15',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/117.0',
    // Add more user agents as needed
  ];
  const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
  await page.setExtraHTTPHeaders({
    'User-Agent': randomUserAgent
  });
 
  // Anti-detection: Random delay from 0.5s (min) to 1.5s (max)
  await page.waitForTimeout(500 + Math.random() * 1000);

  // Navigate to court search page with retry logic
  let navigationSuccess = false;
  let retryCount = 0;
  const maxRetries = 3;

  while (!navigationSuccess && retryCount < maxRetries) {
    try {
      await page.goto('https://ujsportal.pacourts.us/CaseSearch', { 
        waitUntil: 'networkidle',
        timeout: 45000 // Shorter timeout for navigation
      });
      navigationSuccess = true;
    } catch (error) {
      retryCount++;
      console.log(`Navigation attempt ${retryCount} failed, retrying...`);
      if (retryCount >= maxRetries) throw error;
      await page.waitForTimeout(2000 + Math.random() * 3000); // Random backoff
    }
  }

  // Try to find search control with multiple fallback strategies
  let searchControl;
  const searchSelectors = [
    () => page.getByTitle('Search By'),
    () => page.locator('#SearchBy'),
    () => page.locator('select[name="SearchBy"]'),
    () => page.locator('.search-by'),
    () => page.locator('select').first()
  ];

  for (let i = 0; i < searchSelectors.length; i++) {
    try {
      console.log(`Trying search selector strategy ${i + 1}...`);
      searchControl = searchSelectors[i]();
      await searchControl.waitFor({ timeout: 20000 }); // Shorter individual timeouts
      console.log(`Search control found using strategy ${i + 1}`);
      break;
    } catch (error) {
      console.log(`Search selector strategy ${i + 1} failed:`, error instanceof Error ? error.message : String(error));
      if (i === searchSelectors.length - 1) {
        // Last attempt failed, try refreshing the page once
        console.log('All search strategies failed, refreshing page...');
        await page.reload({ waitUntil: 'networkidle' });
        await page.waitForTimeout(3000);
        
        // One final attempt with the most basic selector
        try {
          searchControl = page.locator('#SearchBy');
          await searchControl.waitFor({ timeout: 30000 });
          console.log('Search control found after page refresh');
        } catch (finalError) {
          throw new Error(`Could not find search control after all attempts: ${finalError instanceof Error ? finalError.message : String(finalError)}`);
        }
      }
    }
  }

  if (!searchControl) {
    throw new Error('Search control was not found after all attempts');
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