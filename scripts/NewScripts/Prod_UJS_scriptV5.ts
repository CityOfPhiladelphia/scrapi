// Define types for API response
interface Sentence {
    sentenceDt?: string;
    sentenceType?: string;
    programPeriod?: string;
    sentenceLen?: string;
}

interface Charge {
    seqNo?: string;
    statute?: string;
    grade?: string;
    description?: string;
    disposition?: string;
    sentence?: Sentence[];
}

interface Case {
    docketNo?: string;
    procStatus?: string;
    dcNo?: string;
    otn?: string;
    arrestDt?: string;
    dispDt?: string;
    dispJudge?: string;
    defenseAtty?: string;
    charges?: Charge[];
}

interface Person {
    name?: string;
    firstName?: string;
    middleName?: string;
    lastName?: string;
    address?: string;
    dob?: string;
    eyes?: string;
    hair?: string;
    race?: string;
    sex?: string;
    aliases?: string[];
}

interface ApiResponse {
    person?: Person;
    cases?: Case[];
    summaryUrl?: string;
}

interface FinancialResponse {
    zipcode?: string;
    balance?: string;
    assessment?: string;
    payments?: string;
    adjustments?: string;
    nonmonetary?: string;
    docketUrl?: string;
}

interface PersonDocketInput {
    personId: string;
    docketNum: string;
}

interface ProcessedCase extends Case {
    personId: string;
    originalDocketSearched: string;
    isEligibleDisposition: boolean;
    sortPriority: number; // 1 = high priority (eligible), 2 = low priority (non-eligible)
}

interface PersonValidationResult {
    warning?: string;
}

// Validation function for person ID
function validatePersonId(personId: string): { isValid: boolean; errorMessage?: string } {
    if (!personId || personId.trim().length === 0) {
        return {
            isValid: false,
            errorMessage: `Person ID cannot be empty. Please enter a person ID.`
        };
    }

    if (personId.length < 2) {
        return {
            isValid: false,
            errorMessage: `Person ID '${personId}' is too short. Must be at least 2 characters.`
        };
    }

    return { isValid: true };
}

// Validation function for docket numbers
function validateDocketNumber(docketNum: string): { isValid: boolean; errorMessage?: string } {
    if (!docketNum || docketNum.trim().length === 0) {
        return {
            isValid: false,
            errorMessage: `Docket number cannot be empty. Please enter a docket number.`
        };
    }

    const basicPattern = /^[A-Z0-9\-]+$/i;

    if (!basicPattern.test(docketNum)) {
        return {
            isValid: false,
            errorMessage: `Invalid docket format: '${docketNum}'. Must contain only letters, numbers, and dashes.`
        };
    }

    if (docketNum.length < 5) {
        return {
            isValid: false,
            errorMessage: `Docket number '${docketNum}' is too short. Must be at least 5 characters.`
        };
    }

    return { isValid: true };
}

// Simple same person validation - exits immediately on mismatch
function normalizeNamePart(value?: string): string {
    return (value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function getAliasLastNameCandidates(person: Person): Set<string> {
    const candidates = new Set<string>();

    const pushLastName = (name: string): void => {
        const normalized = normalizeNamePart(name);
        if (!normalized) return;

        if (normalized.includes(',')) {
            const beforeComma = normalized.split(',')[0].trim();
            if (beforeComma) candidates.add(beforeComma);
            return;
        }

        const parts = normalized.split(' ').filter((part) => part.length > 0);
        if (parts.length > 0) {
            candidates.add(parts[parts.length - 1]);
        }
    };

    if (person.lastName) {
        candidates.add(normalizeNamePart(person.lastName));
    }

    for (const alias of person.aliases || []) {
        pushLastName(alias);
    }

    return candidates;
}

function validateSamePerson(referencePerson: Person, currentPerson: Person, docketNum: string, inputSheet: ExcelScript.Worksheet): PersonValidationResult {
    // Check critical identifying fields
    if (referencePerson.dob && currentPerson.dob && referencePerson.dob !== currentPerson.dob) {
        // Highlight the offending docket cell in pale red
        highlightOffendingDocket(inputSheet, docketNum, "#FFE6E6");
        console.log(`❌ ERROR: Docket # ${docketNum} does not belong to participant.`);
        console.log(`   Date of Birth mismatch: "${referencePerson.dob}" vs "${currentPerson.dob}"`);
        throw new Error(`Docket # ${docketNum} does not belong to participant`);
    }

    if (referencePerson.lastName && currentPerson.lastName && referencePerson.lastName !== currentPerson.lastName) {
        const referenceLast = normalizeNamePart(referencePerson.lastName);
        const currentLast = normalizeNamePart(currentPerson.lastName);
        const referenceAliases = getAliasLastNameCandidates(referencePerson);
        const currentAliases = getAliasLastNameCandidates(currentPerson);

        const appearsAliasRelated =
            referenceAliases.has(currentLast) ||
            currentAliases.has(referenceLast);

        // Warn and continue so alias-heavy records still process.
        highlightOffendingDocket(inputSheet, docketNum, "#FFF4CC");

        const warning = appearsAliasRelated
            ? `⚠️ WARNING: Docket # ${docketNum} has a last-name variation resolved by aliases (${referencePerson.lastName} vs ${currentPerson.lastName}).`
            : `⚠️ WARNING: Docket # ${docketNum} has a last-name mismatch (${referencePerson.lastName} vs ${currentPerson.lastName}). Processing continued due to matching participant context.`;

        console.log(warning);
        return { warning };
    }

    return {};
}

// Highlight the cell containing the offending docket number
function highlightOffendingDocket(inputSheet: ExcelScript.Worksheet, docketNum: string, color: string): void {
    // Search for the docket number in the range E7:E100
    const docketRange = inputSheet.getRange("E7:E100");
    const values = docketRange.getValues();

    for (let i = 0; i < values.length; i++) {
        const cellValue = String(values[i][0]).trim();
        if (cellValue === docketNum) {
            const rowNumber = 7 + i; // E7 is row 7, so add i to get the actual row
            const cellAddress = `E${rowNumber}`;

            inputSheet.getRange(cellAddress).getFormat().getFill().setColor(color);
            console.log(`   Highlighted offending docket in cell ${cellAddress}`);
            break;
        }
    }
}

// Check if a case has eligible (conviction-like) disposition
function isEligibleDisposition(caseData: Case): boolean {
    if (!caseData.charges || caseData.charges.length === 0) {
        return true; // Default to eligible if no charge data
    }

    // Non-eligible dispositions (move to bottom)
    const nonEligibleDispositions = [
        'held for court',
        'withdrawn',
        'not guilty',
        'dismissed',
        'nolle prossed'
    ];

    // Check if ALL charges have non-eligible dispositions
    const allNonEligible = caseData.charges.every(charge => {
        if (!charge.disposition) return false; // Blank disposition = eligible
        return nonEligibleDispositions.some(nonEligible =>
            charge.disposition!.toLowerCase().includes(nonEligible.toLowerCase())
        );
    });

    return !allNonEligible; // If not all charges are non-eligible, then case is eligible
}

// Parse disposition date for sorting
function parseDispositionDate(dispDt?: string): Date {
    if (!dispDt) return new Date(0); // Put cases with no date at the very beginning
    return new Date(dispDt);
}

// Collect all dispositions from a case
function getAllDispositions(caseData: Case): string {
    if (!caseData.charges || caseData.charges.length === 0) {
        return "No charges";
    }

    const dispositions = caseData.charges
        .map(charge => charge.disposition || "No disposition")
        .filter((disp, index, arr) => arr.indexOf(disp) === index) // Remove duplicates
        .join("; ");

    return dispositions || "No disposition";
}

// Helper function to split array into chunks for parallel processing
function chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

async function main(workbook: ExcelScript.Workbook) {
    // Initialize timing tracking
    const scriptStartTime = Date.now();
    let phaseStartTime = scriptStartTime;

    console.log(`Script started at ${new Date().toLocaleTimeString()}`);

    const apiSummaryUrl = "https://xpyab0tpx5.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/summary";
    const apiDocketUrl = "https://xpyab0tpx5.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/docket";

    // Prepare input sheet with two mini tables
    const inputSheet = workbook.getActiveWorksheet();
    inputSheet.setName("Input");

    // Set font size 16 for entire column E
    inputSheet.getRange("E:E").getFormat().getFont().setSize(16);

    // First table: Unique Identifier
    inputSheet.getRange("E3").setValue("Unique Identifier");
    inputSheet.getRange("E3").getFormat().getFont().setBold(true);
    inputSheet.getRange("E3").getFormat().getFill().setColor("#DDEEFF"); // Light blue for header

    // Middle align the input cell for unique identifier
    inputSheet.getRange("E4").getFormat().setHorizontalAlignment(ExcelScript.HorizontalAlignment.center);

    // Grey out separator cell
    inputSheet.getRange("E5").getFormat().getFill().setColor("#D3D3D3"); // Light grey

    // Second table: Docket Numbers
    inputSheet.getRange("E6").setValue("Docket Numbers (1 - 100)                    ");
    inputSheet.getRange("E6").getFormat().getFont().setBold(true);
    inputSheet.getRange("E6").getFormat().getFill().setColor("#DDEEFF"); // Light blue for header

    inputSheet.getRange("E3:E6").getFormat().autofitColumns();

    // Reset any previous error highlighting in docket input cells
    const docketInputRange = inputSheet.getRange("E7:E100");
    docketInputRange.getFormat().getFill().clear();

    // Read Unique Identifier from E4 and Docket Numbers from E7:E100
    const personIdValue = String(inputSheet.getRange("E4").getValue()).trim();
    const docketNumValues = inputSheet.getRange("E7:E100").getValues();

    // Parse input data
    const inputData: PersonDocketInput[] = [];

    // Validate person ID
    if (!personIdValue) {
        console.log("❌ No Unique Identifier found in cell E4. Please enter a unique identifier.");
        return;
    }

    // Process all docket numbers
    for (let i = 0; i < docketNumValues.length; i++) {
        const docketNum = String(docketNumValues[i][0]).trim();

        if (docketNum) {
            inputData.push({ personId: personIdValue, docketNum });
        }
    }

    if (inputData.length === 0) {
        console.log("✅ Input sheet is ready. Enter your Unique Identifier in E4 and Docket Numbers starting at E7, then run the script again.");
        return;
    }

    const setupTime = Date.now() - phaseStartTime;
    phaseStartTime = Date.now();

    console.log(`Processing ${inputData.length} docket numbers for identifier: ${personIdValue} (setup: ${setupTime}ms)`);

    // Create or get sheets
    let casesSheet = workbook.getWorksheet("Cases") || workbook.addWorksheet("Cases");

    // Clear existing data
    casesSheet.getRange("A:Z").clear();

    // Write headers
    casesSheet.getRange("A4:L4").setValues([[
        "Unique Identifier", "Docket No", "Dispositions", "Status", "Is the debt balance greater than $0?", "DC No", "OTN", "Arrest Date", "Disp Date", "Judge", "Defense Atty", "Num Charges"
    ]]);

    // Data structures for processing
    const personDataByPersonId = new Map<string, Person>();
    const allCasesByPersonId = new Map<string, ProcessedCase[]>();
    const financialDataByDocket = new Map<string, FinancialResponse>();
    const urlDataByDocket = new Map<string, { summaryUrl: string; docketUrl: string }>();

    // Track processing statistics
    const processingStats = {
        validationErrors: [] as string[],
        fetchErrors: [] as string[],
        processingErrors: [] as string[],
        personWarnings: [] as string[],
        successCount: 0
    };

    // Process each input docket number
    try {
        for (const input of inputData) {
            const { personId, docketNum } = input;

            // Validate inputs
            const personIdValidation = validatePersonId(personId);
            const docketValidation = validateDocketNumber(docketNum);

            if (!personIdValidation.isValid) {
                processingStats.validationErrors.push(`Person ID: ${personIdValidation.errorMessage}`);
                continue;
            }

            if (!docketValidation.isValid) {
                processingStats.validationErrors.push(`Docket ${docketNum}: ${docketValidation.errorMessage}`);
                continue;
            }

            // Fetch summary data
            const response = await fetch(`${apiSummaryUrl}?docketNum=${encodeURIComponent(docketNum)}`, {
                method: 'GET'
            });

            if (!response.ok) {
                processingStats.fetchErrors.push(`Failed to fetch summary for ${docketNum}`);
                continue;
            }

            const data: ApiResponse | null = await response.json().catch((error) => {
                processingStats.processingErrors.push(`${personId}/${docketNum}: JSON parse error - ${error}`);
                return null;
            });

            if (!data) {
                continue;
            }

            processingStats.successCount++;

            // Store and validate person data
            if (data.person) {
                if (!personDataByPersonId.has(personId)) {
                    // First docket - store as reference
                    personDataByPersonId.set(personId, data.person);
                } else {
                    // Subsequent dockets - validate against reference
                    const referencePerson = personDataByPersonId.get(personId)!;
                    const validationResult = validateSamePerson(referencePerson, data.person, docketNum, inputSheet);
                    if (validationResult.warning) {
                        processingStats.personWarnings.push(validationResult.warning);
                    }
                }
            }

            // Process cases
            if (data.cases && data.cases.length > 0) {
                if (!allCasesByPersonId.has(personId)) {
                    allCasesByPersonId.set(personId, []);
                }

                for (const caseData of data.cases) {
                    const isEligible = isEligibleDisposition(caseData);
                    const processedCase: ProcessedCase = {
                        ...caseData,
                        personId,
                        originalDocketSearched: docketNum,
                        isEligibleDisposition: isEligible,
                        sortPriority: isEligible ? 1 : 2
                    };

                    allCasesByPersonId.get(personId)!.push(processedCase);
                }
            }

            // Fetch financial data
            const financeRes = await fetch(`${apiDocketUrl}?docketNum=${encodeURIComponent(docketNum)}`, {
                method: 'GET'
            });

            if (financeRes.ok) {
                const finance: FinancialResponse = await financeRes.json();
                financialDataByDocket.set(docketNum, finance);

                // Store URL data
                urlDataByDocket.set(docketNum, {
                    summaryUrl: data.summaryUrl || "",
                    docketUrl: finance.docketUrl || ""
                });
            }

            await new Promise(resolve => setTimeout(resolve, 150)); // throttle
        }
    } catch (error) {
        // Same person validation failed - exit immediately
        console.log(`❌ Script terminated: ${error}`);
        return;
    }

    // Log processing summary with timing
    const initialProcessingTime = Date.now() - phaseStartTime;
    const avgTimePerDocket = processingStats.successCount > 0 ? Math.round(initialProcessingTime / processingStats.successCount) : 0;
    phaseStartTime = Date.now();

    console.log(`Processing complete: ${processingStats.successCount}/${inputData.length} successful (${Math.round(initialProcessingTime / 1000)}s total, ${avgTimePerDocket}ms avg/docket)`);
    if (processingStats.validationErrors.length > 0) {
        console.log(`❌ ${processingStats.validationErrors.length} validation errors`);
    }
    if (processingStats.fetchErrors.length > 0) {
        console.log(`❌ ${processingStats.fetchErrors.length} fetch errors`);
    }
    if (processingStats.processingErrors.length > 0) {
        console.log(`❌ ${processingStats.processingErrors.length} processing errors`);
    }
    if (processingStats.personWarnings.length > 0) {
        console.log(`⚠️ ${processingStats.personWarnings.length} participant identity warnings`);
    }

    // Collect all unique docket numbers from case results and fetch missing financial data
    console.log("Collecting additional financial data for discovered dockets...");
    const allDiscoveredDockets = new Set<string>();

    // Collect all docket numbers from case results
    for (const cases of Array.from(allCasesByPersonId.values())) {
        for (const caseData of cases) {
            if (caseData.docketNo && caseData.docketNo.trim()) {
                allDiscoveredDockets.add(caseData.docketNo);
            }
        }
    }

    // Find dockets we don't have financial data for yet
    const missingFinancialDockets: string[] = [];
    for (const docketNo of Array.from(allDiscoveredDockets)) {
        if (!financialDataByDocket.has(docketNo)) {
            missingFinancialDockets.push(docketNo);
        }
    }

    console.log(`Found ${missingFinancialDockets.length} additional dockets needing financial data`);

    // Track financial data fetch statistics
    let financialSuccessCount = 0;
    let financialErrorCount = 0;

    // Fetch financial data for missing dockets in parallel batches
    const BATCH_SIZE = 8; // Process 8 dockets concurrently
    const docketChunks = chunkArray(missingFinancialDockets, BATCH_SIZE);

    for (let i = 0; i < docketChunks.length; i++) {
        const chunk = docketChunks[i];

        // Process all dockets in this chunk simultaneously
        const promises = chunk.map(async (docketNo) => {
            const financeRes = await fetch(`${apiDocketUrl}?docketNum=${encodeURIComponent(docketNo)}`, {
                method: 'GET'
            });

            if (financeRes.ok) {
                const finance: FinancialResponse | null = await financeRes.json().catch(() => {
                    financialErrorCount++;
                    return null;
                });

                if (finance) {
                    financialDataByDocket.set(docketNo, finance);
                    financialSuccessCount++;
                }
            } else {
                financialErrorCount++;
            }
        });

        // Wait for all requests in this batch to complete
        await Promise.all(promises);

        // Throttle between batches (not between individual requests)
        if (i < docketChunks.length - 1) { // Don't wait after the last batch
            await new Promise(resolve => setTimeout(resolve, 200)); // Slightly longer between batches
        }
    }

    const financialProcessingTime = Date.now() - phaseStartTime;
    const avgFinancialTime = missingFinancialDockets.length > 0 ? Math.round(financialProcessingTime / missingFinancialDockets.length) : 0;
    phaseStartTime = Date.now();

    console.log(`Financial data collection complete. Success: ${financialSuccessCount}, Errors: ${financialErrorCount}, Total: ${financialDataByDocket.size} (${Math.round(financialProcessingTime / 1000)}s total, ${avgFinancialTime}ms avg/docket)`);
    // Add person name table to Cases sheet (at the top)
    const firstPersonData: Person | undefined = Array.from(personDataByPersonId.values())[0];
    if (firstPersonData) {
        // Set person name headers at A1:C1 in Cases sheet
        casesSheet.getRange("A1:C1").setValues([[
            "First Name", "Middle", "Last Name"
        ]]);

        // Set person name values at A2:C2 in Cases sheet
        casesSheet.getRange("A2:C2").setValues([[
            firstPersonData.firstName || "",
            firstPersonData.middleName || "",
            firstPersonData.lastName || ""
        ]]);

        // Bold the headers
        casesSheet.getRange("A1:C1").getFormat().getFont().setBold(true);

        // Apply yellow highlight to the person name values row
        casesSheet.getRange("A2:C2").getFormat().getFill().setColor("#FFFFCC"); // Same yellow as high priority cases

        // Add DoB table at D1:D2
        casesSheet.getRange("D1").setValue("Date of Birth");
        casesSheet.getRange("D2").setValue(firstPersonData.dob || "");

        // Format DoB table to match other tables
        casesSheet.getRange("D1").getFormat().getFont().setBold(true);
        casesSheet.getRange("D1").getFormat().getFill().setColor("#DDEEFF"); // Blue header
        casesSheet.getRange("D1").getFormat().getFont().setSize(16);

        casesSheet.getRange("D2").getFormat().getFill().setColor("#FFFFCC"); // Yellow value
        casesSheet.getRange("D2").getFormat().getFont().setSize(16);
    }

    // Process and write Cases (grouped, deduplicated, sorted)
    let caseRow = 5;
    for (const [personId, cases] of Array.from(allCasesByPersonId.entries())) {
        // Deduplicate by docket number
        const uniqueCases = new Map<string, ProcessedCase>();
        for (const caseData of cases) {
            const docketNo = caseData.docketNo || "";
            if (!uniqueCases.has(docketNo) || caseData.originalDocketSearched === docketNo) {
                // Prefer the case where the searched docket matches the case docket
                uniqueCases.set(docketNo, caseData);
            }
        }

        // Convert to array and sort
        const sortedCases = Array.from(uniqueCases.values()).sort((a, b) => {
            // First sort by priority (eligible cases first)
            if (a.sortPriority !== b.sortPriority) {
                return a.sortPriority - b.sortPriority;
            }

            // Second sort by debt status (cases with debt > $0 first)
            const getHasDebt = (caseData: ProcessedCase): boolean => {
                const finance = financialDataByDocket.get(caseData.docketNo || "");
                if (finance && finance.balance) {
                    const cleanBalance = String(finance.balance).replace(/[$,\s]/g, "").trim();
                    const numericBalance = parseFloat(cleanBalance);
                    return !isNaN(numericBalance) && numericBalance > 0;
                }
                return false;
            };

            const aHasDebt = getHasDebt(a);
            const bHasDebt = getHasDebt(b);

            if (aHasDebt !== bHasDebt) {
                // Cases with debt come first (return -1), cases without debt go to bottom (return 1)
                return aHasDebt ? -1 : 1;
            }

            // Within same priority and debt status, sort by disposition date (oldest first)
            const dateA = parseDispositionDate(a.dispDt);
            const dateB = parseDispositionDate(b.dispDt);
            return dateA.getTime() - dateB.getTime();
        });

        // Write cases for this person
        for (const caseData of sortedCases) {
            // Skip cases without a docket number
            if (!caseData.docketNo || caseData.docketNo.trim() === "") {
                continue;
            }

            const allDispositions = getAllDispositions(caseData);

            // Determine if debt balance is greater than $0 for this specific docket
            let isDebtGreaterThanZero = "No"; // Default to No
            const finance = financialDataByDocket.get(caseData.docketNo || "");
            if (finance && finance.balance) {
                // Clean the balance string: remove commas, dollar signs, and whitespace
                const cleanBalance = String(finance.balance).replace(/[$,\s]/g, "").trim();
                const numericBalance = parseFloat(cleanBalance);
                if (!isNaN(numericBalance) && numericBalance > 0) {
                    isDebtGreaterThanZero = "Yes";
                }
            }
            casesSheet.getRange(`A${caseRow}:L${caseRow}`).setValues([[
                personId,
                caseData.docketNo || "", allDispositions, caseData.procStatus || "",
                isDebtGreaterThanZero, caseData.dcNo || "",
                caseData.otn || "", caseData.arrestDt || "", caseData.dispDt || "",
                caseData.dispJudge || "", caseData.defenseAtty || "",
                (caseData.charges || []).length
            ]]);

            // Format cases based on debt status and priority
            const rowRange = casesSheet.getRange(`A${caseRow}:L${caseRow}`);

            if (isDebtGreaterThanZero === "No") {
                // Light grey for no debt (disqualified)
                rowRange.getFormat().getFill().setColor("#D3D3D3"); // Light grey
            } else if (caseData.isEligibleDisposition) {
                // Yellow highlight for high priority cases with debt
                rowRange.getFormat().getFont().setBold(true);
                rowRange.getFormat().getFill().setColor("#FFFFCC"); // Light yellow highlight
            }

            caseRow++;
        }
    }

    // Add Total Records table at E1:E2
    const totalRecords = caseRow - 5; // Subtract 5 because caseRow started at 5
    casesSheet.getRange("E1").setValue("Total Records");
    casesSheet.getRange("E2").setValue(totalRecords);

    // Format Total Records table
    casesSheet.getRange("E1").getFormat().getFont().setBold(true);
    casesSheet.getRange("E1").getFormat().getFill().setColor("#DDEEFF"); // Blue header
    casesSheet.getRange("E1").getFormat().getFont().setSize(16);

    casesSheet.getRange("E2").getFormat().getFill().setColor("#FFFFCC"); // Yellow value
    casesSheet.getRange("E2").getFormat().getFont().setSize(16);

    // Format cases sheet - only specific header ranges get blue color
    const casesHeaderRange1 = casesSheet.getRange("A1:C1"); // Person name headers
    casesHeaderRange1.getFormat().getFont().setBold(true);
    casesHeaderRange1.getFormat().getFill().setColor("#DDEEFF"); // blue
    casesHeaderRange1.getFormat().getFont().setSize(16);

    const casesHeaderRangeDoB = casesSheet.getRange("D1"); // DoB header
    casesHeaderRangeDoB.getFormat().getFont().setBold(true);
    casesHeaderRangeDoB.getFormat().getFill().setColor("#DDEEFF"); // blue
    casesHeaderRangeDoB.getFormat().getFont().setSize(16);

    const casesHeaderRange2 = casesSheet.getRange("A4:L4"); // Cases table headers  
    casesHeaderRange2.getFormat().getFont().setBold(true);
    casesHeaderRange2.getFormat().getFill().setColor("#DDEEFF"); // blue
    casesHeaderRange2.getFormat().getFont().setSize(16);

    // Apply general formatting to cases sheet
    casesSheet.getUsedRange().getFormat().getFont().setSize(16);
    casesSheet.getUsedRange().getFormat().autofitColumns();

    const outputProcessingTime = Date.now() - phaseStartTime;
    const totalScriptTime = Date.now() - scriptStartTime;
    const totalDockets = inputData.length + missingFinancialDockets.length;
    const avgOverallTime = totalDockets > 0 ? Math.round(totalScriptTime / totalDockets) : 0;

    console.log(`✅ Done! Cases are grouped by Person ID, deduplicated, and sorted by priority and disposition date.`);
    console.log(`Performance Summary:`);
    console.log(`   Total execution time: ${Math.round(totalScriptTime / 1000)}s`);
    console.log(`   Initial processing: ${Math.round(initialProcessingTime / 1000)}s`);
    console.log(`   Financial data: ${Math.round(financialProcessingTime / 1000)}s`);
    console.log(`   Output generation: ${Math.round(outputProcessingTime / 1000)}s`);
    console.log(`   Overall rate: ${avgOverallTime}ms per docket`);
    console.log(`   Completed at ${new Date().toLocaleTimeString()}`);
}