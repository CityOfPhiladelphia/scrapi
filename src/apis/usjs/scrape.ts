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

const personSearch = async (acc: RestAccumulator): Promise<RestAccumulator> => {
  const { firstName, lastName, dob } = acc.data.valid.parameters as Record<string, string>;
  
  // Acquire browser from pool  
  const browserInstance = await browserPool.acquire();
  
  try {
    console.log(`� Searching for person: ${firstName} ${lastName}, DOB: ${dob}`);
    
    // Ensure browser is navigated to search page
    await browserPool.ensureNavigated(browserInstance);
    
    const page = browserInstance.page;
    
    // Anti-detection: Random delay before search
    await page.waitForTimeout(300 + Math.random() * 700); // 300-1000ms
    
    // Find and wait for search control
    try {
      console.log(`🔍 Looking for search control using getByTitle('Search By')`);
      const searchControl = page.getByTitle('Search By');
      await searchControl.waitFor({ timeout: 20000 });
      console.log(`Search control found, selecting Participant Name`);
      
      await searchControl.selectOption('Participant Name');
    } catch (error) {
      console.log(`Failed to find search control:`, error instanceof Error ? error.message : String(error));
      throw new Error(`Could not find search control: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Fill in search fields using correct locators
    const filedStartDateInput = page.locator('[name="FiledStartDate"]');  
    const filedEndDateInput = page.locator('[name="FiledEndDate"]');  
    const lastNameInput = page.locator('[name="ParticipantLastName"]');  
    const firstNameInput = page.locator('[name="ParticipantFirstName"]');
    const dobInput = page.locator('[name="ParticipantDateOfBirth"]');

    // Fill date range to capture all possible cases
    const today = new Date();
    const todayFormatted = `${today.getMonth() + 1}/${today.getDate()}/${today.getFullYear()}`;
    
    // Convert DOB from YYYY-MM-DD to MM/DD/YYYY format
    const dobParts = dob.split('-'); // ['1992', '10', '03']
    const dobFormatted = `${dobParts[1]}/${dobParts[2]}/${dobParts[0]}`; // '10/03/1992'
    console.log(`📅 DOB conversion: "${dob}" → "${dobFormatted}"`);
    
    // Simple form filling (like docket search)
    await filedStartDateInput.pressSequentially('01/01/1900');
    await filedEndDateInput.pressSequentially(todayFormatted);
    await lastNameInput.fill(lastName);
    await firstNameInput.fill(firstName);
    await dobInput.pressSequentially(dobFormatted);

    // Submit search
    await page.getByRole('button', { name: 'Search' }).nth(1).click();
    
    // Human-like delay after search (same as working docket search)
    await page.waitForTimeout(1500 + Math.random() * 1000); // 1.5-2.5s

    // Extract search results
    const searchResults: any[] = [];
    
    // Wait for results table or "no results" message
    try {
      await page.waitForSelector('table, .no-results, [data-testid="no-results"]', { timeout: 10000 });
    } catch (error) {
      console.log('No results table found, assuming no matches');
    }

    // Find all table rows with docket number patterns - updated for magistrate format
    const docketPattern = /(CP|MC|MD|SU)-\d{2}-[A-Z]{2}-\d{7}-\d{4}|MJ-\d{5}-[A-Z]{2}-\d{7}-\d{4}/;
    const rows = page.locator('tr');
    const rowCount = await rows.count();
    
    console.log(`Found ${rowCount} total rows to scan`);

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);
      const rowText = await row.textContent() || '';
      
      // Check if row contains a docket number
      const docketMatch = rowText.match(docketPattern);
      if (docketMatch) {
        const docketNumber = docketMatch[0];
        console.log(`Found docket number: ${docketNumber}`);
        
        // Extract additional data from the row with more flexible patterns
        let otn = '';
        let filingDate = '';
        
        // Try multiple OTN patterns
        let otnMatch = rowText.match(/OTN:\s*([A-Z]\s?\d+\s?\d+\s?\d+)/);
        if (!otnMatch) {
          otnMatch = rowText.match(/OTN\s+([A-Z]\d+)/);
        }
        if (!otnMatch) {
          otnMatch = rowText.match(/([A-Z]\d{8,})/); // Generic pattern for OTN-like codes
        }
        if (otnMatch) {
          otn = otnMatch[1].replace(/\s+/g, '');
        }
        
        // Try multiple date patterns for filing date
        let dateMatch = rowText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (!dateMatch) {
          dateMatch = rowText.match(/(\d{4}-\d{1,2}-\d{1,2})/);
        }
        if (!dateMatch) {
          dateMatch = rowText.match(/(\d{1,2}-\d{1,2}-\d{4})/);
        }
        if (dateMatch) {
          filingDate = dateMatch[1];
        }
        
        console.log(`Row text for debugging: "${rowText}"`);
        console.log(`Extracted - OTN: "${otn}", Filing Date: "${filingDate}"`);
        
        const caseData = {
          docketNumber,
          filingDate,
          otn
        };
        
        console.log(`Extracted case data:`, caseData);
        searchResults.push(caseData);
      }
    }
    
    console.log(`✅ Found ${searchResults.length} matching cases for ${firstName} ${lastName}`);
    
    // Store results in accumulator in internal field for serializer to process
    acc.data._personSearchData = {
      searchCriteria: {
        firstName,
        lastName,
        dob
      },
      foundCases: searchResults
    };
    
    return acc;
    
  } catch (error) {
    console.log(`❌ Error during person search for ${firstName} ${lastName}:`, error);
    throw error;
  } finally {
    // Always release browser back to pool
    browserPool.release(browserInstance);
  }
};

export const scrape = {
  summary: downloadFile({ type: FileType.Summary }),
  docket: downloadFile({ type: FileType.DocketSheet }),
  personSearch
};