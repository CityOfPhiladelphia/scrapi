interface PersonSearchResponse {
    response: {
        searchCriteria: {
            firstName: string;
            lastName: string;
            dob: string;
        };
        foundCases: Array<{
            docketNumber: string;
            filingDate: string;
            otn: string;
        }>;
        totalCount: number;
    };
}

// Real API response structure from working ED_refactor.ts
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

interface Case {
    docketNo?: string;
    procStatus?: string;
    caseStatus?: string;
    dcNo?: string;
    otn?: string;
    arrestDt?: string;
    dispDt?: string;
    dispJudge?: string;
    defenseAtty?: string;
    representationType?: string;
    nextActionDt?: string;
    charges?: Charge[];
}

interface Charge {
    seqNo?: string;
    statute?: string;
    grade?: string;
    description?: string;
    disposition?: string;
    sentence?: unknown[];
}

interface SummaryResponse {
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
    casestatus?: string;
    representationType?: string;
    restitutionAmount?: string;
    restitutionOwedTo?: string;
    docketUrl?: string;
}

// For docket endpoint (returns financial + case data)
interface DocketResponse {
    zipcode?: string;
    balance?: string;
    representationType?: string;
    person?: Person;
    cases?: Case[];
    [key: string]: unknown;
}

interface ParticipantData {
    cohortStartDate: string;
    cohortEndDate: string;
    firstName: string;
    lastName: string;
    dateOfBirth: string;
    selectedRow: number; // Add selected row to pass it around
}

interface FoundCase {
    docketNumber: string;
    filingDate: string;
    otn: string;
}

// Generational suffixes to remove from participant's last name for better search results
const GENERATIONAL_SUFFIXES = [
    // Numeric
    'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
    // Ordinal
    '1ST', '2ND', '3RD', '4TH', '5TH',
    // Relational
    'JR', 'JR.', 'JUNIOR',
    'SR', 'SR.', 'SENIOR',
    // Other suffixes that show up in court records
    'ESQ', 'ESQ.', // esquire - lawyers sometimes appear this way
] as const;

/**
 * Remove generational suffixes from a last name
 */
function removeSuffixes(name: string): string {
    if (!name) return name;

    let cleanedName = name.toUpperCase().trim();

    // Remove each suffix if found
    for (const suffix of GENERATIONAL_SUFFIXES) {
        // Remove suffix at end with optional comma and space
        const suffixPattern = new RegExp(`\\s*,?\\s*${suffix.replace('.', '\\.')}$`, 'i');
        cleanedName = cleanedName.replace(suffixPattern, '');
    }

    // Return with original case preserved for first letter
    return cleanedName.charAt(0) + cleanedName.slice(1).toLowerCase();
}

async function main(workbook: ExcelScript.Workbook): Promise<void> {
    console.log(`🚀 TG_TrackerScript started at ${new Date().toLocaleTimeString()}`);
    try {
        const participantData = readParticipantData(workbook);
        console.log(`✅ Successfully read participant data: ${participantData.firstName} ${participantData.lastName}, DOB: ${participantData.dateOfBirth}, Cohort: ${participantData.cohortStartDate} to ${participantData.cohortEndDate}`);
        const dobForApi = convertDobFormat(participantData.dateOfBirth);
        console.log(`🔄 Converted DOB for API: ${dobForApi}`);
        await findTargetDocket(participantData, dobForApi, workbook);
    } catch (error: unknown) {
        console.log("❌ Script error:", error);
        const worksheet = workbook.getActiveWorksheet();
        // Try to get selected row for error, default to 4 if not available
        const selectedRange = workbook.getSelectedRange();
        const selectedRow = selectedRange ? selectedRange.getRowIndex() + 1 : 4;
        worksheet.getRange(`L${selectedRow}`).setValue("SCRIPT ERROR");
    }
}

function readParticipantData(workbook: ExcelScript.Workbook): ParticipantData {
    const worksheet = workbook.getActiveWorksheet();

    // Get the selected range to determine which row to read from
    const selectedRange = workbook.getSelectedRange();
    if (!selectedRange) {
        throw new Error("Please select a row to process");
    }

    // Get the first row of the selection
    const selectedRow = selectedRange.getRowIndex() + 1; // Convert to 1-based Excel row number

    console.log(`📍 Processing selected row: ${selectedRow}`);

    // Hardcoded cohort dates for this version
    const cohortStartValue = "07/07/2025";
    const cohortEndValue = "08/01/2025";

    // Read participant data from columns: D=firstName, E=lastName, F=dob
    const firstNameValue = String(worksheet.getRange(`D${selectedRow}`).getValue()).trim();
    const lastNameValue = String(worksheet.getRange(`E${selectedRow}`).getValue()).trim();
    const dobRawValue = worksheet.getRange(`F${selectedRow}`).getValue();


    // Convert DOB from Excel format to string
    let dobValue = "";

    if (typeof dobRawValue === "number") {
        // Convert Excel serial date to MM/DD/YYYY string more reliably
        // Excel epoch is 1/1/1900, but we need to account for Excel's leap year bug
        const excelEpoch = new Date(1899, 11, 30); // December 30, 1899 (Excel's true epoch)
        const jsDate = new Date(excelEpoch.getTime() + dobRawValue * 86400 * 1000);

        const month = (jsDate.getMonth() + 1).toString().padStart(2, '0');
        const day = jsDate.getDate().toString().padStart(2, '0');
        const year = jsDate.getFullYear().toString();
        dobValue = `${month}/${day}/${year}`;
    } else {
        dobValue = String(dobRawValue).trim();
    }

    console.log(`Using hardcoded cohort dates: ${cohortStartValue} to ${cohortEndValue}. Reading from tracker columns: D${selectedRow}="${firstNameValue}", E${selectedRow}="${lastNameValue}", F${selectedRow}="${dobValue}"`);

    // Validate required fields
    if (!firstNameValue || !lastNameValue || !dobValue) {
        throw new Error(`Missing required participant data in tracker columns. Please check D${selectedRow} (firstName), E${selectedRow} (lastName), F${selectedRow} (DOB)`);
    }

    return {
        cohortStartDate: cohortStartValue,
        cohortEndDate: cohortEndValue,
        firstName: firstNameValue,
        lastName: lastNameValue,
        dateOfBirth: dobValue,
        selectedRow: selectedRow
    };
}

function convertExcelValue(value: string | number | boolean | Date | null | undefined, expectedType: "date" | "string"): string {
    if (value === null || value === undefined) {
        return "";
    }

    if (expectedType === "date" && typeof value === "number") {
        // Convert Excel serial date to JavaScript Date
        // Excel epoch starts January 1, 1900 (with leap year bug adjustment)
        const excelEpoch = new Date(1900, 0, 1);
        const jsDate = new Date(excelEpoch.getTime() + (value - 2) * 24 * 60 * 60 * 1000);

        // Return in MM/DD/YYYY format for consistency
        return `${(jsDate.getMonth() + 1).toString().padStart(2, '0')}/${jsDate.getDate().toString().padStart(2, '0')}/${jsDate.getFullYear()}`;
    }

    if (expectedType === "date" && value instanceof Date) {
        // Already a Date object
        return `${(value.getMonth() + 1).toString().padStart(2, '0')}/${value.getDate().toString().padStart(2, '0')}/${value.getFullYear()}`;
    }

    // For strings, booleans, or other types, just convert to string
    return value.toString().trim();
}

function convertDobFormat(dobString: string): string {
    // Convert from "mm/dd/yyyy" to "yyyy-mm-dd"
    const dobParts = dobString.trim().split('/');
    if (dobParts.length !== 3) {
        throw new Error(`Invalid DOB format: "${dobString}". Expected mm/dd/yyyy`);
    }

    const [month, day, year] = dobParts;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

async function fetchSummaryData(docketNumber: string): Promise<SummaryResponse | null> {
    const API_BASE_URL = "https://xpyab0tpx5.execute-api.us-east-1.amazonaws.com/prod";
    const apiUrl = `${API_BASE_URL}/usjs/v1/summary?docketNum=${encodeURIComponent(docketNumber)}`;

    try {
        console.log(`Fetching summary data for: ${docketNumber}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.log(`Summary API error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data: SummaryResponse = await response.json();
        console.log("Summary data fetched successfully");
        return data;

    } catch (error) {
        console.log("Error fetching summary data:", error);
        return null;
    }
}

async function fetchDocketData(docketNumber: string): Promise<DocketResponse | null> {
    const API_BASE_URL = "https://xpyab0tpx5.execute-api.us-east-1.amazonaws.com/prod";
    const apiUrl = `${API_BASE_URL}/usjs/v1/docket?docketNum=${encodeURIComponent(docketNumber)}`;

    try {
        console.log(`Fetching docket data for: ${docketNumber}`);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);

        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            console.log(`Docket API error: ${response.status} ${response.statusText}`);
            return null;
        }

        const data: DocketResponse = await response.json();
        console.log("Docket data fetched successfully");
        return data;

    } catch (error) {
        console.log("Error fetching docket data:", error);
        return null;
    }
}

async function fetchPersonSearchData(firstName: string, lastName: string, dobForApi: string): Promise<PersonSearchResponse> {
    const API_BASE_URL = "https://xpyab0tpx5.execute-api.us-east-1.amazonaws.com/prod";
    const apiUrl = `${API_BASE_URL}/usjs/v1/person?firstName=${encodeURIComponent(firstName)}&lastName=${encodeURIComponent(lastName)}&dob=${dobForApi}`;

    console.log("About to fetch:", apiUrl);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    try {
        const response = await fetch(apiUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            signal: controller.signal
        });

        console.log("Fetch completed, status:", response.status);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorText}`);
        }

        const responseText = await response.text();
        console.log("Raw API response:", responseText);

        return JSON.parse(responseText) as PersonSearchResponse;
    } finally {
        clearTimeout(timeoutId);
    }
}

function normalizeDocketNumber(value: string): string {
    return value.trim().toUpperCase();
}

function parseCaseDate(value: string): Date | null {
    const raw = value?.trim();
    if (!raw) return null;

    if (raw.includes('/')) {
        const parts = raw.split('/');
        if (parts.length === 3) {
            const [month, day, year] = parts;
            const parsed = new Date(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`);
            return isNaN(parsed.getTime()) ? null : parsed;
        }
    }

    const parsed = new Date(raw);
    return isNaN(parsed.getTime()) ? null : parsed;
}

function hasOtn(caseRecord: FoundCase): boolean {
    return !!caseRecord.otn?.trim();
}

function mergeCaseRecords(existingCase: FoundCase | undefined, incomingCase: FoundCase): FoundCase {
    if (!existingCase) return incomingCase;

    const existingDate = parseCaseDate(existingCase.filingDate);
    const incomingDate = parseCaseDate(incomingCase.filingDate);

    if (existingDate && incomingDate) {
        if (incomingDate.getTime() > existingDate.getTime()) {
            return incomingCase;
        }
        if (incomingDate.getTime() < existingDate.getTime()) {
            return existingCase;
        }
        if (hasOtn(incomingCase) && !hasOtn(existingCase)) {
            return incomingCase;
        }
        return existingCase;
    }

    if (incomingDate && !existingDate) {
        return incomingCase;
    }

    if (existingDate && !incomingDate) {
        return existingCase;
    }

    if (hasOtn(incomingCase) && !hasOtn(existingCase)) {
        return incomingCase;
    }

    return {
        docketNumber: existingCase.docketNumber,
        filingDate: existingCase.filingDate || incomingCase.filingDate,
        otn: existingCase.otn || incomingCase.otn
    };
}

function extractCasesFromSummary(summaryData: SummaryResponse | null): FoundCase[] {
    const relatedCases: FoundCase[] = [];

    for (const caseData of summaryData?.cases || []) {
        const docketNumber = (caseData.docketNo || '').trim();
        if (!docketNumber) continue;

        relatedCases.push({
            docketNumber,
            filingDate: (caseData.arrestDt || caseData.dispDt || '').trim(),
            otn: (caseData.otn || '').trim()
        });
    }

    return relatedCases;
}

function resolveOtnForCase(
    targetCase: { docketNumber: string; otn: string },
    summaryData: SummaryResponse | null,
    docketData: DocketResponse | null
): string {
    const directOtn = targetCase.otn?.trim();
    if (directOtn) return directOtn;

    const targetDocket = normalizeDocketNumber(targetCase.docketNumber);

    const summaryMatch = (summaryData?.cases || []).find((c) => normalizeDocketNumber((c.docketNo || '').trim()) === targetDocket);
    const summaryOtn = (summaryMatch?.otn || '').trim();
    if (summaryOtn) return summaryOtn;

    const docketMatch = (docketData?.cases || []).find((c) => normalizeDocketNumber((c.docketNo || '').trim()) === targetDocket);
    const docketOtn = (docketMatch?.otn || '').trim();
    if (docketOtn) return docketOtn;

    return 'N/A';
}

function extractCasesFromCaseList(caseList: Case[] | undefined): FoundCase[] {
    const extracted: FoundCase[] = [];

    for (const caseData of caseList || []) {
        const docketNumber = (caseData.docketNo || '').trim();
        if (!docketNumber) continue;

        extracted.push({
            docketNumber,
            filingDate: (caseData.arrestDt || caseData.dispDt || '').trim(),
            otn: (caseData.otn || '').trim()
        });
    }

    return extracted;
}

function isSameCalendarDate(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function inferRelatedOtn(targetCase: FoundCase, candidates: FoundCase[]): string {
    const directOtn = (targetCase.otn || '').trim();
    if (directOtn) return directOtn;

    const targetDate = parseCaseDate(targetCase.filingDate);

    const withParsedDate = candidates
        .map((candidate) => {
            const filingDateParsed = parseCaseDate(candidate.filingDate);
            const otn = (candidate.otn || '').trim();
            return filingDateParsed && otn
                ? {
                    ...candidate,
                    otn,
                    filingDateParsed
                }
                : null;
        })
        .filter((candidate) => candidate !== null);

    if (targetDate) {
        const sameDateCase = withParsedDate.find((candidate) => isSameCalendarDate(candidate.filingDateParsed, targetDate));
        if (sameDateCase) return sameDateCase.otn;

        const nearestCase = withParsedDate
            .map((candidate) => ({
                ...candidate,
                distance: Math.abs(candidate.filingDateParsed.getTime() - targetDate.getTime())
            }))
            .sort((a, b) => {
                if (a.distance !== b.distance) return a.distance - b.distance;
                return a.filingDateParsed.getTime() - b.filingDateParsed.getTime();
            })[0];

        if (nearestCase) return nearestCase.otn;
    }

    return 'N/A';
}

function resolveOriginalArrestCase(
    targetCase: FoundCase,
    expandedCases: FoundCase[],
    summaryData: SummaryResponse | null,
    docketData: DocketResponse | null,
    cohortStartDate: string
): FoundCase {
    const cohortStartParsed = parseCaseDate(cohortStartDate);
    const candidates = [
        targetCase,
        ...expandedCases,
        ...extractCasesFromCaseList(summaryData?.cases),
        ...extractCasesFromCaseList(docketData?.cases)
    ];

    const resolvedOtn = (() => {
        const exactMatchOtn = resolveOtnForCase(targetCase, summaryData, docketData);
        return exactMatchOtn !== 'N/A' ? exactMatchOtn : inferRelatedOtn(targetCase, candidates);
    })();
    const normalizedResolvedOtn = resolvedOtn.trim().toUpperCase();

    if (!normalizedResolvedOtn || normalizedResolvedOtn === 'N/A') {
        return {
            docketNumber: targetCase.docketNumber,
            filingDate: targetCase.filingDate,
            otn: 'N/A'
        };
    }

    const sameOtnCases = candidates
        .filter((candidate) => (candidate.otn || '').trim().toUpperCase() === normalizedResolvedOtn)
        .map((candidate) => {
            const filingDateParsed = parseCaseDate(candidate.filingDate);
            return filingDateParsed
                ? {
                    docketNumber: candidate.docketNumber,
                    filingDate: candidate.filingDate,
                    otn: (candidate.otn || '').trim(),
                    filingDateParsed
                }
                : null;
        })
        .filter((candidate) => candidate !== null)
        .filter((candidate) => !cohortStartParsed || candidate.filingDateParsed < cohortStartParsed)
        .sort((a, b) => a.filingDateParsed.getTime() - b.filingDateParsed.getTime());

    if (sameOtnCases.length > 0) {
        const originalCase = sameOtnCases[0];
        return {
            docketNumber: originalCase.docketNumber,
            filingDate: originalCase.filingDate,
            otn: originalCase.otn
        };
    }

    return {
        docketNumber: targetCase.docketNumber,
        filingDate: targetCase.filingDate,
        otn: resolvedOtn
    };
}

function pickSeedCases(foundCases: FoundCase[]): FoundCase[] {
    const seeds: FoundCase[] = [];

    const mjCase = foundCases.find((entry) => normalizeDocketNumber(entry.docketNumber).startsWith('MJ-'));
    const cpOrMcCase = foundCases.find((entry) => {
        const normalized = normalizeDocketNumber(entry.docketNumber);
        return normalized.startsWith('CP-') || normalized.startsWith('MC-');
    });
    const otnCase = foundCases.find((entry) => !!entry.otn?.trim());

    if (mjCase) seeds.push(mjCase);
    if (cpOrMcCase && !seeds.some((seed) => normalizeDocketNumber(seed.docketNumber) === normalizeDocketNumber(cpOrMcCase.docketNumber))) {
        seeds.push(cpOrMcCase);
    }
    if (otnCase && !seeds.some((seed) => normalizeDocketNumber(seed.docketNumber) === normalizeDocketNumber(otnCase.docketNumber))) {
        seeds.push(otnCase);
    }

    if (seeds.length === 0 && foundCases.length > 0) {
        seeds.push(foundCases[0]);
    }

    return seeds;
}

async function expandPersonSearchCases(initialCases: FoundCase[]): Promise<FoundCase[]> {
    const merged = new Map<string, FoundCase>();

    for (const entry of initialCases) {
        const normalizedDocket = normalizeDocketNumber(entry.docketNumber);
        merged.set(normalizedDocket, mergeCaseRecords(merged.get(normalizedDocket), entry));
    }

    const seedCases = pickSeedCases(initialCases);

    for (const seed of seedCases.slice(0, 3)) {
        const summaryData = await fetchSummaryData(seed.docketNumber);
        const relatedCases = extractCasesFromSummary(summaryData);

        for (const relatedCase of relatedCases) {
            const normalizedDocket = normalizeDocketNumber(relatedCase.docketNumber);
            const normalizedCase: FoundCase = {
                docketNumber: normalizedDocket,
                filingDate: relatedCase.filingDate || '',
                otn: relatedCase.otn || ''
            };
            merged.set(normalizedDocket, mergeCaseRecords(merged.get(normalizedDocket), normalizedCase));
        }
    }

    console.log(`Expanded case set from ${initialCases.length} to ${merged.size}`);
    return Array.from(merged.values());
}

function populateExcelColumns(workbook: ExcelScript.Workbook, summaryData: SummaryResponse | null, docketData: DocketResponse | null, mostRecentOtn: string, selectedRow: number): void {
    console.log("Starting populateExcelColumns function");
    const worksheet = workbook.getActiveWorksheet();

    console.log(`Populating tracker columns with data for row ${selectedRow}`);

    // Extract data from REAL API responses - prioritize summary over docket data
    const summaryPerson = summaryData?.person;
    const docketPerson = docketData?.person;

    console.log("Summary person available:", !!summaryPerson);
    console.log("Docket person available:", !!docketPerson);

    // Helper function to calculate age from DOB
    function calculateAge(dob: string): number | undefined {
        if (!dob) return undefined;

        try {
            // Parse DOB (assume MM/DD/YYYY or YYYY-MM-DD format)
            let dobDate: Date;
            if (dob.includes('/')) {
                const [month, day, year] = dob.split('/');
                dobDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
            } else {
                dobDate = new Date(dob);
            }

            const today = new Date();
            const age = today.getFullYear() - dobDate.getFullYear();
            const monthDiff = today.getMonth() - dobDate.getMonth();

            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dobDate.getDate())) {
                return age - 1;
            }
            return age;
        } catch {
            return undefined;
        }
    }

    // NEW column mappings for updated tracker:
    // G=age, H=gender, I=race, K=zip, Q=lastArrestDate, R=arrestingCounty, S=otn

    // Column G - Age (calculate from DOB in F{selectedRow})
    const dobFromInput = worksheet.getRange(`F${selectedRow}`).getValue();
    const dobString = convertExcelValue(dobFromInput, "date");
    const age = calculateAge(dobString);
    if (age !== undefined) {
        worksheet.getRange(`G${selectedRow}`).setValue(age);
        console.log(`Set age: ${age} (calculated from input DOB: ${dobString})`);
    }

    // Column H - Gender (sex in API)
    const gender = summaryPerson?.sex || docketPerson?.sex || "Not Available";
    worksheet.getRange(`H${selectedRow}`).setValue(gender);
    console.log(`Set gender: ${gender}`);

    // Column I - Race
    const race = summaryPerson?.race || docketPerson?.race || "Not Available";
    worksheet.getRange(`I${selectedRow}`).setValue(race);
    console.log(`Set race: ${race}`);

    // Column K - Zip Code
    const zipCode = docketData?.zipcode || extractZipFromAddress(summaryPerson?.address || docketPerson?.address) || "Not Available";
    worksheet.getRange(`K${selectedRow}`).setValue(zipCode);
    console.log(`Set zip code: ${zipCode}`);

    // Column S - OTN # (use the most recent one passed from search)
    worksheet.getRange(`S${selectedRow}`).setValue(mostRecentOtn);
    console.log(`Set OTN: ${mostRecentOtn}`);

    console.log("Finished populateExcelColumns function");
}

// Helper function to extract offense description from charges
function extractOffenseDescription(cases: Case[] | undefined): string | undefined {
    if (!cases || cases.length === 0) return undefined;

    // Get the most recent case with charges
    const caseWithCharges = cases.find(c => c.charges && Array.isArray(c.charges) && c.charges.length > 0);
    if (!caseWithCharges || !caseWithCharges.charges) return undefined;

    // Extract descriptions from charges (assuming charges have description field)
    const descriptions: string[] = [];
    for (const charge of caseWithCharges.charges) {
        const chargeWithDescription = charge as unknown as { description?: string };
        if (chargeWithDescription.description) {
            descriptions.push(chargeWithDescription.description);
        }
    }

    return descriptions.length > 0 ? descriptions.join(", ") : undefined;
}

// Helper function to extract zip code from address string
function extractZipFromAddress(address: string | undefined): string | undefined {
    if (!address) return undefined;

    // Look for 5-digit zip code pattern
    const zipMatch = address.match(/\b\d{5}(-\d{4})?\b/);
    return zipMatch ? zipMatch[0] : undefined;
}

async function findTargetDocket(participantData: ParticipantData, dobForApi: string, workbook: ExcelScript.Workbook): Promise<void> {

    const selectedRow = participantData.selectedRow;

    // Clean last name by removing generational suffixes for better search results
    const cleanedLastName = removeSuffixes(participantData.lastName);
    console.log(`Name cleaning: "${participantData.lastName}" → "${cleanedLastName}"`);

    try {
        const data = await fetchPersonSearchData(participantData.firstName, cleanedLastName, dobForApi);

        console.log(`Found ${data.response.totalCount} dockets`);

        if (!data.response.foundCases || data.response.foundCases.length === 0) {
            console.log("No cases found - populating with 'No Records' status");
            populateNoRecordsFound(workbook, selectedRow);
            return;
        }

        const expandedCases = await expandPersonSearchCases(data.response.foundCases);

        // Keep rearrest analysis on expanded set, but anchor arrest columns to raw person-search set
        const rearrestAnalysis = findTargetDocketAndRearrest(expandedCases, participantData);
        const arrestAnchorAnalysis = findTargetDocketAndRearrest(data.response.foundCases, participantData);
        console.log("Rearrest analysis:", rearrestAnalysis);
        console.log("Arrest anchor analysis:", arrestAnchorAnalysis);

        const arrestAnchorCase = arrestAnchorAnalysis.targetDocket || rearrestAnalysis.targetDocket;

        if (arrestAnchorCase) {
            try {
                // Fetch detailed data from summary and docket endpoints
                console.log("Fetching additional data for arrest anchor docket...");
                const [summaryData, docketData] = await Promise.all([
                    fetchSummaryData(arrestAnchorCase.docketNumber),
                    fetchDocketData(arrestAnchorCase.docketNumber)
                ]);

                console.log("API calls completed");
                console.log("Summary data:", summaryData ? "received" : "null");
                console.log("Docket data:", docketData ? "received" : "null");

                const originalArrestCase = resolveOriginalArrestCase(
                    arrestAnchorCase,
                    data.response.foundCases,
                    summaryData,
                    docketData,
                    participantData.cohortStartDate
                );
                console.log(`Resolved original arrest case: ${originalArrestCase.docketNumber} | ${originalArrestCase.filingDate} | ${originalArrestCase.otn}`);

                // Populate Excel columns with the fetched data
                console.log("Populating Excel columns...");
                populateExcelColumns(workbook, summaryData, docketData, originalArrestCase.otn || 'N/A', selectedRow);

                // Update last arrest date and county columns
                updateArrestInfo(workbook, originalArrestCase, selectedRow);

                console.log("Excel columns populated successfully");
            } catch (populateError) {
                console.log("Error in data fetching or Excel population:", populateError);
                populateErrorStatus(workbook, selectedRow);
            }

            // Always update rearrest information when target docket is found
            updateRearrestInfo(workbook, rearrestAnalysis.rearrestInfo, selectedRow);
        } else {
            console.log("No target docket found");
            populateNoRecordsFound(workbook, selectedRow);

            // Still check and update rearrest information even when no target docket
            updateRearrestInfo(workbook, rearrestAnalysis.rearrestInfo, selectedRow);
        }

        console.log("Done.");

    } catch (error: unknown) {
        if (error instanceof Error) {
            console.log("Error name:", error.name);
            console.log("Error message:", error.message);

            if (error.name === 'AbortError') {
                console.log("API call timed out after 30 seconds");
            } else if (error.message.includes('Load failed')) {
                console.log("Load failed - likely network/CORS issue");
            } else {
                console.log("API error:", error.message);
            }
        } else {
            console.log("API error:", error);
        }

        // Write error message for debugging
        populateErrorStatus(workbook, selectedRow);
    }
}

interface CohortAnalysis {
    targetDocket: { docketNumber: string, filingDate: string, otn: string } | null;
    rearrestInfo: {
        hasRearrest: boolean;
        rearrrestDate: string | null;
        rearrrestCase: { docketNumber: string, filingDate: string, otn: string } | null;
    };
}

function findTargetDocketAndRearrest(foundCases: Array<{ docketNumber: string, filingDate: string, otn: string }>, participantData: ParticipantData): CohortAnalysis {
    // Parse cohort dates
    const cohortStart = new Date(participantData.cohortStartDate);
    const cohortEnd = new Date(participantData.cohortEndDate);

    if (isNaN(cohortStart.getTime()) || isNaN(cohortEnd.getTime())) {
        throw new Error(`Invalid cohort dates: Start="${participantData.cohortStartDate}", End="${participantData.cohortEndDate}"`);
    }

    console.log(`Cohort period: ${participantData.cohortStartDate} to ${participantData.cohortEndDate}`);

    // Parse all cases with dates
    const parsedCases = foundCases
        .map(docket => {
            const filingDate = parseCaseDate(docket.filingDate);
            if (!filingDate) {
                console.log(`Failed to parse filing date: ${docket.filingDate}`);
                return null;
            }

            return {
                ...docket,
                filingDateParsed: filingDate
            };
        })
        .filter(docket => docket !== null);

    // 1. Find target docket: Most recent case BEFORE cohort start date
    const preCohortCases = parsedCases
        .filter(docket => docket.filingDateParsed < cohortStart)
        .sort((a, b) => b.filingDateParsed.getTime() - a.filingDateParsed.getTime()); // Most recent first

    const targetDocket = preCohortCases.length > 0 ? preCohortCases[0] : null;

    if (targetDocket) {
        console.log(`Target docket found: ${targetDocket.docketNumber} (filed ${targetDocket.filingDate}) - closest to cohort start but before it`);
    } else {
        console.log('No target docket found - no cases filed before cohort start date');
    }

    // 2. Check for rearrest: ANY case AFTER cohort start date
    const postCohortCases = parsedCases
        .filter(docket => docket.filingDateParsed > cohortStart)
        .sort((a, b) => a.filingDateParsed.getTime() - b.filingDateParsed.getTime()); // Earliest first

    const hasRearrest = postCohortCases.length > 0;
    const rearrrestDate = hasRearrest ? postCohortCases[0].filingDate : null;
    const rearrrestCase = hasRearrest ? postCohortCases[0] : null;

    if (hasRearrest) {
        console.log(`Rearrest detected: ${postCohortCases[0].docketNumber} (filed ${rearrrestDate}) - occurred after cohort start`);
    } else {
        console.log('No rearrest detected - no cases filed after cohort start date');
    }

    return {
        targetDocket,
        rearrestInfo: {
            hasRearrest,
            rearrrestDate,
            rearrrestCase
        }
    };
}

function updateRearrestInfo(workbook: ExcelScript.Workbook, rearrestInfo: { hasRearrest: boolean, rearrrestDate: string | null, rearrrestCase: { docketNumber: string, filingDate: string, otn: string } | null }, selectedRow: number): void {
    const worksheet = workbook.getActiveWorksheet();

    // Column U - Rearrested? ('yes' or 'no')
    const rearrested = rearrestInfo.hasRearrest ? 'yes' : 'no';
    worksheet.getRange(`U${selectedRow}`).setValue(rearrested);
    console.log(`Set rearrested status: ${rearrested}`);

    // Column V - Date of Rearrest (only if rearrest occurred)
    if (rearrestInfo.hasRearrest && rearrestInfo.rearrrestDate) {
        worksheet.getRange(`V${selectedRow}`).setValue(rearrestInfo.rearrrestDate);
        console.log(`Set rearrest date: ${rearrestInfo.rearrrestDate}`);
    } else {
        worksheet.getRange(`V${selectedRow}`).setValue('');
        console.log('No rearrest date to set');
    }

    // Column X - Offense Description (only if rearrest occurred)
    if (rearrestInfo.hasRearrest && rearrestInfo.rearrrestCase) {
        // Fetch summary data for the rearrest case to get offense description
        fetchSummaryData(rearrestInfo.rearrrestCase.docketNumber).then((summaryData): void => {
            const offenseDescription = extractOffenseDescription(summaryData?.cases) || "Not Available";
            worksheet.getRange(`X${selectedRow}`).setValue(offenseDescription);
            console.log(`Set offense description for rearrest: ${offenseDescription}`);
        }).catch((error): void => {
            console.log("Error fetching rearrest offense description:", error);
            worksheet.getRange(`X${selectedRow}`).setValue("Error fetching data");
        });
    } else {
        worksheet.getRange(`X${selectedRow}`).setValue('');
        console.log('No rearrest - offense description left blank');
    }
}

function updateArrestInfo(workbook: ExcelScript.Workbook, mostRecentCase: { docketNumber: string, filingDate: string, otn: string }, selectedRow: number): void {
    const worksheet = workbook.getActiveWorksheet();

    // Column Q - Last Arrest Date (filing date)
    worksheet.getRange(`Q${selectedRow}`).setValue(mostRecentCase.filingDate);
    console.log(`Set last arrest date: ${mostRecentCase.filingDate}`);

    // Column R - Arresting County (extract from docket number)
    const county = extractCountyFromDocket(mostRecentCase.docketNumber);
    worksheet.getRange(`R${selectedRow}`).setValue(county);
    console.log(`Set arresting county: ${county}`);
}

function extractCountyFromDocket(docketNumber: string): string {
    // Docket format: CP-51-CR-1234567-2024 or MC-51-CR-1234567-2024
    const countyMatch = docketNumber.match(/^[A-Z]{2}-(\d{2})-/);
    if (countyMatch) {
        const countyCode = countyMatch[1];
        // Map common Philadelphia area county codes
        switch (countyCode) {
            case '51': return 'Philadelphia';
            case '09': return 'Bucks';
            case '15': return 'Chester';
            case '23': return 'Delaware';
            case '46': return 'Montgomery';
            default: return `County ${countyCode}`;
        }
    }
    return 'Unknown';
}

function populateNoRecordsFound(workbook: ExcelScript.Workbook, selectedRow: number): void {
    const worksheet = workbook.getActiveWorksheet();

    // Calculate age from input DOB (now in column F)
    const dobFromInput = worksheet.getRange(`F${selectedRow}`).getValue();
    const dobString = convertExcelValue(dobFromInput, "date");

    // Helper function to calculate age from DOB
    function calculateAge(dob: string): number | undefined {
        if (!dob) return undefined;

        try {
            const [month, day, year] = dob.split('/');
            const dobDate = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));

            const today = new Date();
            let age = today.getFullYear() - dobDate.getFullYear();
            const monthDiff = today.getMonth() - dobDate.getMonth();

            if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dobDate.getDate())) {
                age--;
            }
            return age;
        } catch {
            return undefined;
        }
    }

    const age = calculateAge(dobString);

    // Set values in NEW tracker columns
    if (age !== undefined) {
        worksheet.getRange(`G${selectedRow}`).setValue(age); // G - Age
    }
    worksheet.getRange(`H${selectedRow}`).setValue("No Records"); // H - Gender
    worksheet.getRange(`I${selectedRow}`).setValue("No Records"); // I - Race
    worksheet.getRange(`K${selectedRow}`).setValue("No Records"); // K - Zip
    worksheet.getRange(`Q${selectedRow}`).setValue("No Records"); // Q - Last Arrest Date
    worksheet.getRange(`R${selectedRow}`).setValue("No Records"); // R - County
    worksheet.getRange(`S${selectedRow}`).setValue("No Records"); // S - OTN
    worksheet.getRange(`U${selectedRow}`).setValue("no"); // U - Rearrested (default to 'no' for no records)
    worksheet.getRange(`V${selectedRow}`).setValue(""); // V - Date of Rearrest (empty for no records)
    worksheet.getRange(`X${selectedRow}`).setValue(""); // X - Offense Description (empty for no records)
    // Note: AH (Reconvicted) and AI (Date of Reconviction) are left empty for now as they're not implemented

    console.log("Populated 'No Records' status in NEW tracker columns");
}

function populateErrorStatus(workbook: ExcelScript.Workbook, selectedRow: number): void {
    const worksheet = workbook.getActiveWorksheet();

    // Set error values in NEW tracker columns using getRange()
    worksheet.getRange(`G${selectedRow}`).setValue("Processing"); // G - Age
    worksheet.getRange(`H${selectedRow}`).setValue("Processing"); // H - Gender
    worksheet.getRange(`I${selectedRow}`).setValue("Processing"); // I - Race
    worksheet.getRange(`K${selectedRow}`).setValue("Processing"); // K - Zip
    worksheet.getRange(`Q${selectedRow}`).setValue("Processing"); // Q - Last Arrest Date
    worksheet.getRange(`R${selectedRow}`).setValue("Processing"); // R - County
    worksheet.getRange(`S${selectedRow}`).setValue("Processing"); // S - OTN
    worksheet.getRange(`U${selectedRow}`).setValue("Processing"); // U - Rearrested
    worksheet.getRange(`V${selectedRow}`).setValue("Processing"); // V - Date of Rearrest
    worksheet.getRange(`X${selectedRow}`).setValue("Processing"); // X - Offense Description
    // Note: AH (Reconvicted) and AI (Date of Reconviction) are left empty for now as they're not implemented

    console.log("Populated 'ERROR' status in NEW tracker columns");
}