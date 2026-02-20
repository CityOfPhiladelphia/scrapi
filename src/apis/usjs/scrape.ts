import { chromium  as playwright } from 'playwright';
import chromium from '@sparticuz/chromium';
import { USJS_PDF_PATH } from '../../consts.js';
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';
import { FileType } from './types.js';
import { browserPool } from './browser-pool.js';



interface DocumentType {
  type: FileType
};

interface SummaryScrapeParams {
  docketNumber: string;
  savePath: string;
};


const downloadFile = ({ type }: DocumentType) => async (acc: RestAccumulator): Promise<RestAccumulator> => {
  const { docketNum } = acc.data.valid.parameters as Record<string, string> & SummaryScrapeParams;
  
  // Acquire browser from pool instead of creating new one
  const browserInstance = await browserPool.acquire();
  
  try {
    console.log(`🔗 Using browser ${browserInstance.id} for docket ${docketNum} (${type})`);
    
    // Ensure browser is navigated to search page
    await browserPool.ensureNavigated(browserInstance);
    
    const page = browserInstance.page;
    
    // Anti-detection: Random delay
    await page.waitForTimeout(300 + Math.random() * 700); // 300-1000ms
    
    // Find and wait for search control (reuse existing logic)
    try {
      console.log(`🔍 Looking for search control using getByTitle('Search By')`);
      const searchControl = page.getByTitle('Search By');
      await searchControl.waitFor({ timeout: 30000 }); // Reduced timeout since page should already be loaded
      console.log(`Search control found using getByTitle('Search By')`);
      
      await searchControl.selectOption('Docket Number');
    } catch (error) {
      console.log(`Failed to find search control:`, error instanceof Error ? error.message : String(error));
      throw new Error(`Could not find search control: ${error instanceof Error ? error.message : String(error)}`);
    }

    const docketInput = page.getByTitle('Docket Number');
    await docketInput.fill(docketNum);
    await page.getByRole('button', { name: 'Search' }).nth(1).click();
    
    // Human-like delay after search
    await page.waitForTimeout(1500 + Math.random() * 1000); // 1.5-2.5s

    // Find the row with your docket number first
    const docketRow = page.locator(`tr:has-text("${docketNum}")`);
    const index = type === FileType.DocketSheet ? 0 : 1;
    const link = docketRow.locator(`[href*="/Report/"]`).nth(index);

    // Capture the actual URL before clicking
    const reportUrl = await link.getAttribute('href');
    const fullReportUrl = reportUrl ? `https://ujsportal.pacourts.us${reportUrl}` : null;

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      // Annoyingly opens in pdf reader mode in a new tab
      await link.click({ modifiers: ['Alt'] })
    ]);

    console.log("downloaded path: ", await download.path());

    await download.saveAs(`${USJS_PDF_PATH}/${type}.pdf`);

    // Store the URL in the accumulator for use in serialize
    acc.data.scrapedUrls = acc.data.scrapedUrls || {};
    acc.data.scrapedUrls[type] = fullReportUrl;

    console.log(`✅ Successfully processed ${docketNum} (${type}) with browser ${browserInstance.id}`);
    
    return acc;
    
  } catch (error) {
    console.log(`❌ Error processing ${docketNum} (${type}) with browser ${browserInstance.id}:`, error);
    throw error;
  } finally {
    // Always release browser back to pool
    browserPool.release(browserInstance);
  }
};

export const scrape = {
  summary: downloadFile({ type: FileType.Summary }),
  docket: downloadFile({ type: FileType.DocketSheet })
};