import { writeFile } from 'node:fs/promises';
import { USJS_PDF_PATH } from '../../consts.js';
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';
import type { Page, Frame } from 'playwright';
import { FileType } from './types.js';
import { browserPool } from './browser-pool.js';

interface DocumentType {
  type: FileType
};

const searchByControlCandidates = (page: Page) => [
  page.getByTitle('Search By'),
  page.getByLabel(/Search By/i),
  page.locator('select[title="Search By"]'),
  page.locator('select[name*="SearchBy" i], select[id*="SearchBy" i]'),
  page.locator('select')
];

const selectSearchByOption = async (page: Page, optionText: string): Promise<void> => {
  const normalizedTarget = optionText.toLowerCase();

  for (const locator of searchByControlCandidates(page)) {
    const count = await locator.count();
    if (!count) continue;

    for (let i = 0; i < count; i++) {
      const control = locator.nth(i);

      try {
        await control.waitFor({ state: 'visible', timeout: 5000 });

        const optionLabels = (await control.locator('option').allTextContents())
          .map((label: string) => label.trim().toLowerCase());

        const hasTarget = optionLabels.some((label: string) => label.includes(normalizedTarget));
        if (!hasTarget) continue;

        const selected = await control.evaluate((node: unknown, targetText: string) => {
          if (!(node instanceof HTMLSelectElement)) return false;

          const match = Array.from(node.options).find((opt) =>
            (opt.textContent || '').trim().toLowerCase().includes(targetText)
          );

          if (!match) return false;
          node.value = match.value;
          node.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }, normalizedTarget);

        if (selected) return;
      } catch {
        // Continue trying other candidate controls.
      }
    }
  }

  throw new Error(`Could not find Search By control with option "${optionText}"`);
};

// Helper function to get document URLs without downloading
const getDocumentUrls = async (browserInstance: any, docketNum: string): Promise<{ summaryUrl?: string; docketUrl?: string }> => {
  const page = browserInstance.page;
  
  console.log(`🔗 Getting URLs for docket ${docketNum}`);
  
  // Anti-detection: Random delay
  await page.waitForTimeout(300 + Math.random() * 700);
  
  // Find and wait for search control
  try {
    await selectSearchByOption(page, 'Docket Number');
  } catch (error) {
    console.log(`Failed to find search control for ${docketNum}:`, error);
    return {};
  }

  const docketInput = page.getByTitle('Docket Number');
  await docketInput.fill(docketNum);
  await page.getByRole('button', { name: 'Search' }).nth(1).click();
  
  // Human-like delay after search
  await page.waitForTimeout(1500 + Math.random() * 1000);

  try {
    // Find the row with the docket number
    const docketRow = page.locator(`tr:has-text("${docketNum}")`);
    
    // Get both summary and docket links
    const summaryLink = docketRow.locator(`[href*="/Report/"]`).nth(1); // Summary is index 1
    const docketLink = docketRow.locator(`[href*="/Report/"]`).nth(0);   // Docket is index 0
    
    const summaryHref = await summaryLink.getAttribute('href').catch(() => null);
    const docketHref = await docketLink.getAttribute('href').catch(() => null);
    
    const summaryUrl = summaryHref ? `https://ujsportal.pacourts.us${summaryHref}` : undefined;
    const docketUrl = docketHref ? `https://ujsportal.pacourts.us${docketHref}` : undefined;
    
    console.log(`📄 URLs for ${docketNum} - Summary: ${summaryUrl ? 'Found' : 'Missing'}, Docket: ${docketUrl ? 'Found' : 'Missing'}`);
    
    return { summaryUrl, docketUrl };
    
  } catch (error) {
    console.log(`⚠️ Could not get URLs for ${docketNum}:`, error);
    return {};
  }
};


const downloadFile = ({ type }: DocumentType) => async (acc: RestAccumulator): Promise<RestAccumulator> => {
  const { docketNum } = acc.data.valid.parameters as Record<string, string>;
  
  // Acquire browser from pool instead of creating new one
  const browserInstance = await browserPool.acquire();
  
  try {
    console.log(`🔗 Using browser ${browserInstance.id} for docket ${docketNum} (${type})`);
    
    // Ensure browser is navigated to search page
    await browserPool.ensureNavigated(browserInstance);
    
    const page = browserInstance.page;
    
    // Anti-detection: Random delay
    await page.waitForTimeout(300 + Math.random() * 700); // 300-1000ms
    
    try {
      await selectSearchByOption(page, 'Docket Number');
    } catch (error) {
      console.log(`Failed to find search control:`, error instanceof Error ? error.message : String(error));
      throw new Error(`Could not find search control: ${error instanceof Error ? error.message : String(error)}`);
    }

    const docketInput = page.getByTitle('Docket Number');
    await docketInput.fill(docketNum);
    await page.getByRole('button', { name: 'Search' }).nth(1).click();
    
    // Human-like delay after search
    await page.waitForTimeout(1500 + Math.random() * 1000); // 1.5-2.5s

    const noResultsLocator = page.locator('tr.no-records td').filter({ hasText: /No results found/i }).first();
    const hasExplicitNoResults = async (): Promise<boolean> => {
      return noResultsLocator.isVisible().catch(() => false);
    };

    if (await hasExplicitNoResults()) {
      throw new Error(`NO_RESULTS: No matching case found for docket ${docketNum}`);
    }

    // Find the row with your docket number first
    const docketRow = page.locator(`tr:has-text("${docketNum}")`);
    const index = type === FileType.DocketSheet ? 0 : 1;
    const link = docketRow.locator(`[href*="/Report/"]`).nth(index);

    // Capture the actual URL before clicking
    let reportUrl: string | null = null;
    try {
      reportUrl = await link.getAttribute('href');
    } catch (error) {
      if (await hasExplicitNoResults()) {
        throw new Error(`NO_RESULTS: No matching case found for docket ${docketNum}`);
      }
      throw new Error(`LOCATOR_TIMEOUT: Could not resolve report link for docket ${docketNum} (${type})`);
    }

    if (!reportUrl) {
      if (await hasExplicitNoResults()) {
        throw new Error(`NO_RESULTS: No matching case found for docket ${docketNum}`);
      }
      throw new Error(`LOCATOR_TIMEOUT: No report href found for docket ${docketNum} (${type})`);
    }
    const fullReportUrl = `https://ujsportal.pacourts.us${reportUrl}`;

    // Open the report URL in a new page within the same context so the spoofed user agent
    // is inherited — the PDF endpoint blocks requests from headless UA strings.
    // The server responds with Content-Disposition: attachment, so goto() aborts with
    // net::ERR_ABORTED and fires a download event instead — set up the listener first.
    const reportPage = await browserInstance.context.newPage();
    try {
      const [download] = await Promise.all([
        reportPage.waitForEvent('download', { timeout: 60000 }),
        reportPage.goto(fullReportUrl).catch(() => {}), // ERR_ABORTED is expected for downloads
      ]);

      const failure = await download.failure();
      if (failure) throw new Error(`Download failed: ${failure}`);

      const suggestedName = download.suggestedFilename();
      console.log(`📄 Downloaded: ${suggestedName}`);

      await download.saveAs(`${USJS_PDF_PATH}/${type}.pdf`);
    } finally {
      await reportPage.close();
    }

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
  let personSearchContext: Awaited<ReturnType<typeof browserInstance.browser.newContext>> | null = null;
  let personSearchPage: Page | null = null;
  
  try {
    console.log(`� Searching for person: ${firstName} ${lastName}, DOB: ${dob}`);

    // Person-search-only context override to stabilize fingerprinting for this endpoint.
    personSearchContext = await browserInstance.browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.1 Safari/537.36',
      viewport: { width: 1366, height: 768 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
      }
    });
    personSearchPage = await personSearchContext.newPage();
    personSearchPage.setDefaultTimeout(60000);
    personSearchPage.setDefaultNavigationTimeout(60000);
    await personSearchPage.goto('https://ujsportal.pacourts.us/CaseSearch', {
      waitUntil: 'networkidle',
      timeout: 45000
    });

    const page = personSearchPage;
    
    // Anti-detection: Random delay before search
    await page.waitForTimeout(300 + Math.random() * 700); // 300-1000ms
    
    // Find and wait for search control
    try {
      console.log(`🔍 Looking for search control with resilient selectors`);
      await selectSearchByOption(page, 'Participant Name');
      console.log(`Search control found, selecting Participant Name`);
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

    const hasResultSignals = async (): Promise<boolean> => {
      for (const frame of page.frames()) {
        const cellCount = await frame.locator('td[data-label="Docket Number"]').count().catch(() => 0);
        if (cellCount > 0) return true;

        const linkCount = await frame.locator('a[aria-label="Docket Sheet"][href*="docketNumber="]').count().catch(() => 0);
        if (linkCount > 0) return true;

        const navText = await frame.locator('#caseSearchResultGrid-mobile-navigation-text-field').first().textContent().catch(() => null);
        if (navText && /Viewing\s+row\s+\d+\s+of\s+\d+/i.test(navText)) return true;

        const noResultsVisible = await frame.locator('.no-results, [data-testid="no-results"]').first().isVisible().catch(() => false);
        const noResultsTextVisible = await frame.getByText(/no\s+(records|results)\s+found/i).first().isVisible().catch(() => false);
        if (noResultsVisible || noResultsTextVisible) return true;
      }

      return false;
    };

    const clickPreferredSearch = async (): Promise<boolean> => {
      const searchButtons = page.getByRole('button', { name: /^Search$/i });
      const count = await searchButtons.count();
      if (count <= 1) return false;

      const preferred = searchButtons.nth(1);
      const visible = await preferred.isVisible().catch(() => false);
      const disabled = await preferred.isDisabled().catch(() => true);
      if (!visible || disabled) return false;

      await preferred.click();
      console.log('Clicked preferred Search button at index 1');
      return true;
    };

    const clickDobFormSearch = async (): Promise<boolean> => {
      const clicked = await dobInput.evaluate((node: unknown) => {
        if (!(node instanceof HTMLInputElement)) return false;
        const form = node.form;
        if (!form) return false;

        const buttons = Array.from(form.querySelectorAll('button')) as HTMLButtonElement[];
        const searchButton = buttons.find((button) => {
          const label = (button.textContent || '').trim().toLowerCase();
          const aria = (button.getAttribute('aria-label') || '').trim().toLowerCase();
          const type = (button.getAttribute('type') || '').trim().toLowerCase();
          const isSearch = label === 'search' || aria === 'search';
          const isClickable = !button.disabled && (type === '' || type === 'button' || type === 'submit');
          return isSearch && isClickable;
        });

        if (!searchButton) return false;
        searchButton.click();
        return true;
      }).catch(() => false);

      if (clicked) {
        console.log('Clicked Search button from DOB form context');
      }

      return clicked;
    };

    const submitDobForm = async (): Promise<boolean> => {
      const submitted = await dobInput.evaluate((node: unknown) => {
        if (!(node instanceof HTMLInputElement)) return false;
        const form = node.form;
        if (!form) return false;

        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.submit();
        }
        return true;
      }).catch(() => false);

      if (submitted) {
        console.log('Submitted person search via DOB form requestSubmit');
      }

      return submitted;
    };

    const pressEnterSubmit = async (): Promise<boolean> => {
      await dobInput.press('Enter');
      console.log('Submitted person search via Enter key on DOB input');
      return true;
    };

    const submissionAttempts: Array<{ name: string; run: () => Promise<boolean> }> = [
      { name: 'preferred-search-index-1', run: clickPreferredSearch },
      { name: 'dob-form-search-button', run: clickDobFormSearch },
      { name: 'dob-form-request-submit', run: submitDobForm },
      { name: 'dob-enter-key', run: pressEnterSubmit }
    ];

    const runSubmissionAttempts = async (): Promise<boolean> => {
      for (const attempt of submissionAttempts) {
        const didSubmit = await attempt.run();
        if (!didSubmit) continue;

        await page.waitForTimeout(900 + Math.random() * 400);
        if (await hasResultSignals()) {
          console.log(`Search signals detected after submit attempt: ${attempt.name}`);
          return true;
        }
      }

      return false;
    };

    let attemptWithSignals = await runSubmissionAttempts();

    if (!attemptWithSignals) {
      console.log('No search-result signals detected across staged submit attempts');
    }
    
    // Brief additional delay before extraction polling.
    await page.waitForTimeout(600 + Math.random() * 300);

    // Extract search results
    const searchResults: any[] = [];

    const docketCellSelector = 'td[data-label="Docket Number"]';
    const reportLinkSelector = 'a[href*="docketNumber="]';
    const docketLinkSelector = 'a[aria-label="Docket Sheet"][href*="docketNumber="]';
    const docketNumberPattern = /^(CP|MC|MD|SU)-\d{2}-[A-Z]{2}-\d{7}-\d{4}$|^MJ-\d{5}-[A-Z]{2}-\d{7}-\d{4}$/;
    const docketPattern = /(CP|MC|MD|SU)-\d{2}-[A-Z]{2}-\d{7}-\d{4}|MJ-\d{5}-[A-Z]{2}-\d{7}-\d{4}/g;
    const toAbsoluteUrl = (href: string): string => (
      href.startsWith('http') ? href : `https://ujsportal.pacourts.us${href}`
    );

    const getCandidateFrames = (): Frame[] => page.frames();
    const countInFrames = async (selector: string): Promise<number> => {
      let total = 0;
      for (const frame of getCandidateFrames()) {
        total += await frame.locator(selector).count();
      }
      return total;
    };

    const noResultsVisibleInFrames = async (): Promise<boolean> => {
      for (const frame of getCandidateFrames()) {
        const noResultsVisible = await frame.locator('.no-results, [data-testid="no-results"]').first().isVisible().catch(() => false);
        const noResultsTextVisible = await frame.getByText(/no\s+(records|results)\s+found/i).first().isVisible().catch(() => false);
        if (noResultsVisible || noResultsTextVisible) {
          return true;
        }
      }
      return false;
    };

    const mobileRowsDetectedInFrames = async (): Promise<boolean> => {
      for (const frame of getCandidateFrames()) {
        const navText = await frame.locator('#caseSearchResultGrid-mobile-navigation-text-field').first().textContent().catch(() => null);
        if (!navText) continue;
        if (/Viewing\s+row\s+\d+\s+of\s+\d+/i.test(navText)) {
          return true;
        }
      }
      return false;
    };

    // Wait for either docket cells/links to appear or an explicit no-results state.
    const waitDeadline = Date.now() + 15000;
    while (Date.now() < waitDeadline) {
      const docketCellCount = await countInFrames(docketCellSelector);
      if (docketCellCount > 0) {
        break;
      }

      const docketLinkCount = await countInFrames(docketLinkSelector);
      if (docketLinkCount > 0) {
        break;
      }

      if (await mobileRowsDetectedInFrames()) {
        break;
      }

      if (await noResultsVisibleInFrames()) {
        break;
      }

      await page.waitForTimeout(250);
    }

    let docketCellCount = await countInFrames(docketCellSelector);
    let docketLinkCount = await countInFrames(docketLinkSelector);

    let mobileRowsDetected = await mobileRowsDetectedInFrames();
    let explicitNoResults = await noResultsVisibleInFrames();

    if (docketCellCount === 0 && docketLinkCount === 0 && !mobileRowsDetected && !explicitNoResults) {
      console.log('No search-result signals detected after first submit; retrying search once');
      attemptWithSignals = await runSubmissionAttempts();
      await page.waitForTimeout(1500 + Math.random() * 700);

      docketCellCount = await countInFrames(docketCellSelector);
      docketLinkCount = await countInFrames(docketLinkSelector);
      mobileRowsDetected = await mobileRowsDetectedInFrames();
      explicitNoResults = await noResultsVisibleInFrames();

      if (docketCellCount === 0 && docketLinkCount === 0 && !mobileRowsDetected && !explicitNoResults) {
        const tableCount = await countInFrames('table');
        const rowCount = await countInFrames('tr');
        const gridCount = await countInFrames('#caseSearchResultGrid');
        const searchButtonCount = await page.getByRole('button', { name: /^Search$/i }).count();
        console.log(`No-signal diagnostics: url=${page.url()}, searchButtons=${searchButtonCount}, tables=${tableCount}, rows=${rowCount}, grids=${gridCount}, docketCells=${docketCellCount}, docketLinks=${docketLinkCount}`);
      }
    }

    // Some pages hydrate cells/links slightly later than search submission.
    if (docketCellCount === 0 && docketLinkCount === 0) {
      await page.waitForTimeout(1000);
      docketCellCount = await countInFrames(docketCellSelector);
      docketLinkCount = await countInFrames(docketLinkSelector);
    }

    // Build a cross-frame lookup of report URLs by docket number.
    const reportUrlMap = new Map<string, { summaryUrl?: string; docketUrl?: string }>();
    for (const frame of getCandidateFrames()) {
      const reportLinks = frame.locator(reportLinkSelector);
      const reportLinkCount = await reportLinks.count();
      for (let i = 0; i < reportLinkCount; i++) {
        const href = await reportLinks.nth(i).getAttribute('href');
        if (!href) continue;

        const match = href.match(/[?&]docketNumber=([^&]+)/i);
        if (!match?.[1]) continue;

        const docketNumber = decodeURIComponent(match[1]).trim();
        if (!docketNumber) continue;

        const absoluteUrl = toAbsoluteUrl(href);
        const existing = reportUrlMap.get(docketNumber) || {};

        if (!existing.docketUrl && /DocketSheet/i.test(href)) {
          existing.docketUrl = absoluteUrl;
        }
        if (!existing.summaryUrl && /CourtSummary/i.test(href)) {
          existing.summaryUrl = absoluteUrl;
        }

        reportUrlMap.set(docketNumber, existing);
      }
    }

    const seenDockets = new Set<string>();
    const collectRowsFromFrames = async (): Promise<Array<{ docketNumber: string; filingDate: string; otn: string; docketHref: string; summaryHref: string; rowText: string }>> => {
      const collected: Array<{ docketNumber: string; filingDate: string; otn: string; docketHref: string; summaryHref: string; rowText: string }> = [];

      for (const frame of getCandidateFrames()) {
        const frameRows = await frame.evaluate(() => {
          const docketRegex = /(CP|MC|MD|SU)-\d{2}-[A-Z]{2}-\d{7}-\d{4}|MJ-\d{5}-[A-Z]{2}-\d{7}-\d{4}/;
          const rows = Array.from(document.querySelectorAll('table tbody tr'));
          return rows.flatMap((row) => {
            const getCell = (label: string): string => {
              const el = row.querySelector(`td[data-label="${label}"]`);
              return (el?.textContent || '').trim();
            };

            const parseDocketFromHref = (): string => {
              const anchors = Array.from(row.querySelectorAll('a[href*="docketNumber="]')) as HTMLAnchorElement[];
              for (const anchor of anchors) {
                const href = anchor.getAttribute('href') || '';
                const match = href.match(/[?&]docketNumber=([^&]+)/i);
                if (match?.[1]) {
                  return decodeURIComponent(match[1]).trim();
                }
              }
              return '';
            };

            const parseDocketFromCells = (): string => {
              const candidates = Array.from(row.querySelectorAll('td[data-label="Docket Number"]'))
                .map((cell) => (cell.textContent || '').trim())
                .filter(Boolean);
              for (const candidate of candidates) {
                if (docketRegex.test(candidate)) {
                  return candidate;
                }
              }
              return '';
            };

            const docketAnchor = row.querySelector('a[aria-label="Docket Sheet"], a[href*="DocketSheet"], a[href*="MdjDocketSheet"], a[href*="CpDocketSheet"]') as HTMLAnchorElement | null;
            const summaryAnchor = row.querySelector('a[aria-label="Court Summary"], a[href*="CourtSummary"], a[href*="MdjCourtSummary"], a[href*="CpCourtSummary"]') as HTMLAnchorElement | null;

            const rowText = (row.textContent || '').trim();
            const docketFromCells = parseDocketFromCells();
            const docketFromHref = parseDocketFromHref();
            const docketFromText = rowText.match(docketRegex)?.[0] || '';
            // Prefer docket from link query parameter: it is not affected by hidden sort cells.
            const docketNumber = docketFromHref || docketFromCells || docketFromText;

            if (!docketNumber || !docketRegex.test(docketNumber)) {
              return [];
            }

            return [{
              docketNumber,
              filingDate: getCell('Filing Date'),
              otn: getCell('OTN'),
              docketHref: docketAnchor?.getAttribute('href') || '',
              summaryHref: summaryAnchor?.getAttribute('href') || '',
              rowText
            }];
          });
        }).catch(() => [] as Array<{ docketNumber: string; filingDate: string; otn: string; docketHref: string; summaryHref: string; rowText: string }>);

        collected.push(...frameRows);
      }

      return collected;
    };

    let extractedRows = await collectRowsFromFrames();
    if (extractedRows.length === 0 && docketLinkCount > 0) {
      // Rows may hydrate after links become visible; retry once before fallback.
      await page.waitForTimeout(1200);
      extractedRows = await collectRowsFromFrames();
    }

    for (const entry of extractedRows) {
      if (!entry.docketNumber || !docketNumberPattern.test(entry.docketNumber) || seenDockets.has(entry.docketNumber)) {
        continue;
      }

      seenDockets.add(entry.docketNumber);

      let filingDate = entry.filingDate;
      if (!filingDate) {
        let dateMatch = entry.rowText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/);
        if (!dateMatch) {
          dateMatch = entry.rowText.match(/(\d{4}-\d{1,2}-\d{1,2})/);
        }
        if (!dateMatch) {
          dateMatch = entry.rowText.match(/(\d{1,2}-\d{1,2}-\d{4})/);
        }
        if (dateMatch) {
          filingDate = dateMatch[1];
        }
      }

      const mappedUrls = reportUrlMap.get(entry.docketNumber);

      const caseData = {
        docketNumber: entry.docketNumber,
        filingDate,
        otn: entry.otn || '',
        summaryUrl: entry.summaryHref ? toAbsoluteUrl(entry.summaryHref) : (mappedUrls?.summaryUrl || ''),
        docketUrl: entry.docketHref ? toAbsoluteUrl(entry.docketHref) : (mappedUrls?.docketUrl || '')
      };

      // Fill missing URLs from the global report-link map.
      if (mappedUrls) {
        if (!caseData.summaryUrl && mappedUrls.summaryUrl) {
          caseData.summaryUrl = mappedUrls.summaryUrl;
        }
        if (!caseData.docketUrl && mappedUrls.docketUrl) {
          caseData.docketUrl = mappedUrls.docketUrl;
        }
      }

      console.log(`Extracted case data:`, caseData);
      searchResults.push(caseData);
    }

    console.log(`Row extraction produced ${searchResults.length} cases before fallback`);

    // Fallback path if row extraction fails entirely: parse caseSearchResultGrid rows from raw HTML.
    if (searchResults.length === 0) {
      const htmlByFrame = await Promise.all(getCandidateFrames().map(async (frame) => frame.content().catch(() => '')));

      const decodeHtml = (value: string): string => (
        value
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim()
      );

      const extractTdByLabel = (rowHtml: string, label: string): string => {
        const rx = new RegExp(`<td[^>]*data-label=["']${label}["'][^>]*>([\\s\\S]*?)<\\/td>`, 'i');
        const match = rowHtml.match(rx);
        if (!match?.[1]) return '';
        return decodeHtml(match[1].replace(/<[^>]+>/g, ''));
      };

      const extractHref = (rowHtml: string, pattern: string): string => {
        const rx = new RegExp(`<a[^>]*href=["']([^"']*${pattern}[^"']*)["']`, 'i');
        const match = rowHtml.match(rx);
        return match?.[1] ? toAbsoluteUrl(decodeHtml(match[1])) : '';
      };

      for (const frameHtml of htmlByFrame) {
        if (!frameHtml) continue;

        const tableMatch = frameHtml.match(/<table[^>]*id=["']caseSearchResultGrid["'][^>]*>[\s\S]*?<\/table>/i);
        if (!tableMatch?.[0]) continue;

        const tbodyMatch = tableMatch[0].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
        if (!tbodyMatch?.[1]) continue;

        const rowMatches = tbodyMatch[1].match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
        for (const rowHtml of rowMatches) {
          const rowText = decodeHtml(rowHtml.replace(/<[^>]+>/g, ' '));
          const docketFromCell = extractTdByLabel(rowHtml, 'Docket Number');
          const docketFromHrefMatch = rowHtml.match(/[?&]docketNumber=([^&"']+)/i);
          const docketFromHref = docketFromHrefMatch?.[1] ? decodeURIComponent(docketFromHrefMatch[1]).trim() : '';
          const docketFromText = rowText.match(/(CP|MC|MD|SU)-\d{2}-[A-Z]{2}-\d{7}-\d{4}|MJ-\d{5}-[A-Z]{2}-\d{7}-\d{4}/)?.[0] || '';
          const docketNumber = docketFromHref || docketFromCell || docketFromText;

          if (!docketNumber || !docketNumberPattern.test(docketNumber) || seenDockets.has(docketNumber)) {
            continue;
          }

          seenDockets.add(docketNumber);

          const mappedUrls = reportUrlMap.get(docketNumber);
          const caseData = {
            docketNumber,
            filingDate: extractTdByLabel(rowHtml, 'Filing Date'),
            otn: extractTdByLabel(rowHtml, 'OTN'),
            summaryUrl: extractHref(rowHtml, 'CourtSummary|MdjCourtSummary|CpCourtSummary') || mappedUrls?.summaryUrl || '',
            docketUrl: extractHref(rowHtml, 'DocketSheet|MdjDocketSheet|CpDocketSheet') || mappedUrls?.docketUrl || ''
          };

          console.log(`Fallback case data:`, caseData);
          searchResults.push(caseData);
        }
      }

      // Final fallback: if grid parsing still yields nothing, use validated dockets from URL map.
      if (searchResults.length === 0) {
        for (const docketNumber of reportUrlMap.keys()) {
          if (!docketNumberPattern.test(docketNumber) || seenDockets.has(docketNumber)) {
            continue;
          }

          seenDockets.add(docketNumber);
          const mappedUrls = reportUrlMap.get(docketNumber);
          const caseData = {
            docketNumber,
            filingDate: '',
            otn: '',
            summaryUrl: mappedUrls?.summaryUrl || '',
            docketUrl: mappedUrls?.docketUrl || ''
          };
          console.log(`Fallback case data:`, caseData);
          searchResults.push(caseData);
        }
      }
    }

    // Enrich partially populated cases from raw frame HTML rows when locator extraction misses.
    const needsEnrichment = searchResults.some((item) => !item.filingDate || !item.otn || !item.summaryUrl || !item.docketUrl);
    if (needsEnrichment) {
      const htmlByFrame = await Promise.all(getCandidateFrames().map(async (frame) => frame.content().catch(() => '')));

      const decodeHtml = (value: string): string => (
        value
          .replace(/&amp;/g, '&')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .trim()
      );

      const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

      const extractRowValue = (rowHtml: string, label: string): string => {
        const rx = new RegExp(`<td[^>]*data-label=["']${escapeRegex(label)}["'][^>]*>([\\s\\S]*?)<\\/td>`, 'i');
        const match = rowHtml.match(rx);
        if (!match?.[1]) return '';
        return decodeHtml(match[1].replace(/<[^>]+>/g, ''));
      };

      const extractHref = (rowHtml: string, hrefPattern: string): string => {
        const rx = new RegExp(`<a[^>]*href=["']([^"']*${hrefPattern}[^"']*)["'][^>]*>`, 'i');
        const match = rowHtml.match(rx);
        return match?.[1] ? toAbsoluteUrl(decodeHtml(match[1])) : '';
      };

      for (const caseData of searchResults) {
        if (caseData.filingDate && caseData.otn && caseData.summaryUrl && caseData.docketUrl) {
          continue;
        }

        const docketEscaped = escapeRegex(caseData.docketNumber);
        const rowRegex = new RegExp(`<tr[^>]*>[\\s\\S]*?${docketEscaped}[\\s\\S]*?<\\/tr>`, 'i');

        for (const frameHtml of htmlByFrame) {
          if (!frameHtml) continue;
          const rowMatch = frameHtml.match(rowRegex);
          if (!rowMatch?.[0]) continue;

          const rowHtml = rowMatch[0];

          if (!caseData.filingDate) {
            caseData.filingDate = extractRowValue(rowHtml, 'Filing Date');
          }
          if (!caseData.otn) {
            caseData.otn = extractRowValue(rowHtml, 'OTN');
          }
          if (!caseData.summaryUrl) {
            caseData.summaryUrl = extractHref(rowHtml, 'CourtSummary|MdjCourtSummary|CpCourtSummary');
          }
          if (!caseData.docketUrl) {
            caseData.docketUrl = extractHref(rowHtml, 'DocketSheet|MdjDocketSheet|CpDocketSheet');
          }

          // Stop scanning frames once we found a matching row.
          break;
        }
      }
    }

    console.log(`Found ${searchResults.length} unique docket numbers to scan`);
    
    console.log(`✅ Found ${searchResults.length} matching cases for ${firstName} ${lastName}`);
    
    const summaryUrlCount = searchResults.filter((item) => item.summaryUrl).length;
    const docketUrlCount = searchResults.filter((item) => item.docketUrl).length;
    console.log(`✅ URL extraction summary - summary URLs: ${summaryUrlCount}/${searchResults.length}, docket URLs: ${docketUrlCount}/${searchResults.length}`);
    
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
    if (personSearchContext) {
      await personSearchContext.close().catch(() => undefined);
    }

    // Always release browser back to pool
    browserPool.release(browserInstance);
  }
};

export const scrape = {
  summary: downloadFile({ type: FileType.Summary }),
  docket: downloadFile({ type: FileType.DocketSheet }),
  personSearch
};