import { chromium  as playwright } from 'playwright';
import chromium from '@sparticuz/chromium-min';
import { USJS_PDF_PATH } from '@src/consts.js';
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';

interface SummaryScrapeParams {
  docketNumber: string;
  savePath: string;
};

const summary = async (acc: RestAccumulator): Promise<RestAccumulator> => {
  const { docketNumber, savePath } = acc.data.valid as Record<string, string> & SummaryScrapeParams;
  
  const browser = await playwright.launch({
    args: chromium.args,
    headless: true,
    executablePath: await chromium.executablePath("/opt/nodejs/node_modules/@sparticuz/chromium/bin")
  });

  const page = await browser.newPage();
  await page.goto('https://ujsportal.pacourts.us/CaseSearch');
  const searchControl = page.getByTitle('Search By', )
  await searchControl.selectOption('Docket Number');
  
  const docketInput = page.getByTitle('Docket Number');
  await docketInput.fill(docketNumber);
  await page.getByRole('button', { name: 'Search' }).click();
  await page.waitForTimeout(2000);
  
  const link =  page.locator('[href*="/Report/CpCourtSummary?"]');
  const href = await link.getAttribute('href');
  const url = `https://ujsportal.pacourts.us${href}`;
  
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    // Annoyingly opens in pdf reader mode in a new tab
    await link.click({ modifiers: ['Alt'] })
   ])

   console.log("downloaded path: ", await download.path());
   await download.saveAs(`${USJS_PDF_PATH}/summary.pdf`);
   await browser.close();

   return acc;
};

export const scrape = {
  summary,
};