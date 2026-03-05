// configuration and constants
const api_config = {
  summary_URL: "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/summary",
  docket_URL: "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/docket"
} as const;

const worksheet_name = "Eligibility Determinations" as const;

const columns = {
  docket_number: 1,
  error_message: 2,
  first_name: 10,
  middle_name: 11,
  last_name: 12,
  aliases: 13,
  zip: 14,
  dob: 16,
  race: 17,
  sex: 18,
  case_status: 20,
  county: 21,
  charges: 22,
  disposition: 23,
  grades: 24,
  has_sentence: 25,
  dispositon_date: 28,
  has_warrant: 35, // Column AJ
  representation_type: 36, // Column AK
  next_action_docket: 37, // Column AL
  case_balance: 49,
  restitution_amount: 50, // Column AY
  restitution_owed_to: 51 // Column AZ
} as const;

const sentence_status = {
  yes: "Yes",
  no: "No (CVC, VWS, CCC, don't need to be paid)"
} as const;

const date_format = "mm/dd/yyyy" as const;

// type definitions
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
  casestatus?: string;
  representationType?: string;
  restitutionAmount?: string;
  restitutionOwedTo?: string;
  docketUrl?: string;
}

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

interface ErrorResponse {
  message?: string;
  error?: string;
  statusCode?: number;
  details?: string;
}

interface ApiResult {
  error?: string;
  person?: Person;
  cases?: Case[];
  summaryUrl?: string;
  zipcode?: string;
  balance?: string;
  assessment?: string;
  payments?: string;
  adjustments?: string;
  nonmonetary?: string;
  casestatus?: string;
  county?: string;
  docketUrl?: string;
  representationType?: string;
  restitutionAmount?: string;
  restitutionOwedTo?: string;
}

interface ProcessedData {
  summary?: ApiResult;
  financial?: ApiResult;
}

// input validation
function validateDocketNumber(docketNum: string): ValidationResult {
  if (!docketNum?.trim()) {
    return {
      isValid: false,
      errorMessage: "Docket number cannot be empty. Please enter a docket number."
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

  // Require at least one dash
  if (!docketNum.includes('-')) {
    return {
      isValid: false,
      errorMessage: `Invalid docket format: '${docketNum}'. Must contain at least one dash (e.g., CP-51-MD-0004672-2025).`
    };
  }

  return { isValid: true };
}

// Fetch data
async function fetchApiData(url: string, docketNum: string): Promise<ApiResult> {
  try {
    const response = await fetch(`${url}?docketNum=${encodeURIComponent(docketNum)}`, {
      method: 'GET'
    });

    if (response.ok) {
      return await response.json();
    } else {
      // Try to get detailed error message from response body
      let errorDetail = `${response.status}: ${response.statusText}`;

      try {
        const errorText = await response.text();
        if (errorText) {
          // Try to parse as JSON first
          try {
            const errorJson: ErrorResponse = JSON.parse(errorText);
            if (errorJson.message) {
              errorDetail = `${response.status}: ${errorJson.message}`;
            } else if (errorJson.error) {
              errorDetail = `${response.status}: ${errorJson.error}`;
            } else {
              errorDetail = `${response.status}: ${errorText}`;
            }
          } catch {
            // Not JSON, use raw text (truncate if too long)
            const truncatedText = errorText.length > 100 ? errorText.substring(0, 100) + "..." : errorText;
            errorDetail = `${response.status}: ${truncatedText}`;
          }
        }
      } catch {
        // If we can't read the response body, fall back to basic error
        errorDetail = `${response.status}: ${response.statusText}`;
      }

      return { error: `API Error ${errorDetail}` };
    }
  } catch (error) {
    console.log(`Failed to fetch from ${url}:`, error);
    // Include more details from the network error
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { error: `Network Error: ${errorMessage}` };
  }
}

async function fetchAllData(docketNum: string): Promise<ProcessedData> {
  const summary: ApiResult = await fetchApiData(api_config.summary_URL, docketNum);
  const financial: ApiResult = await fetchApiData(api_config.docket_URL, docketNum);

  return { summary, financial };
}

// data extraction
function extractZipCode(financial?: FinancialResponse, person?: Person): string {
  if (financial?.zipcode) {
    return financial.zipcode;
  }

  const address = person?.address || "";
  const zipMatch = address.match(/\b\d{5}(?:-\d{4})?\b/);
  return zipMatch?.[0] || "";
}

function getCasesForDocket(cases: Case[] | undefined, docketNum: string): Case[] {
  const normalizedDocket = docketNum.toUpperCase();
  return cases?.filter(c => c.docketNo?.toUpperCase() === normalizedDocket) || [];
}

function extractChargeData(
  cases: Case[] | undefined,
  docketNum: string,
  extractor: (charge: Charge) => string | undefined
): string[] {
  const docketCases = getCasesForDocket(cases, docketNum);
  const values: string[] = [];

  for (const caseData of docketCases) {
    for (const charge of caseData.charges || []) {
      const value = extractor(charge);
      if (value?.trim()) {
        values.push(value);
      }
    }
  }

  return values;
}

function hasSignificantSentence(cases: Case[] | undefined, docketNum: string): boolean {
  const docketCases = getCasesForDocket(cases, docketNum);
  const significantTypes = ['probation', 'confinement', 'diversion'];

  for (const caseData of docketCases) {
    for (const charge of caseData.charges || []) {
      for (const sentence of charge.sentence || []) {
        const sentType = sentence.sentenceType?.toLowerCase() || "";
        if (significantTypes.some(type => sentType.includes(type))) {
          return true;
        }
      }
    }
  }

  return false;
}

function getDispositionDate(cases: Case[] | undefined, docketNum: string): string {
  const docketCase = getCasesForDocket(cases, docketNum)
    .find(c => c.dispDt?.trim());
  return docketCase?.dispDt || "";
}

function hasActiveWarrant(cases: Case[] | undefined): string {
  if (!cases) return "No";

  const hasWarrant = cases.some(caseData =>
    caseData.procStatus?.toLowerCase().includes('warrant')
  );

  return hasWarrant ? "Yes" : "No";
}

function getNextActionDocket(cases: Case[] | undefined): string {
  if (!cases) return "";

  // Look through all cases to find one with a Next Action Date
  for (const caseData of cases) {
    if (caseData.nextActionDt?.trim()) {
      // Found a case with a next action date
      return caseData.docketNo || "";
    }
  }

  return "";
}

function getRepresentationType(cases: Case[] | undefined, docketNum: string): string {
  const docketCase = getCasesForDocket(cases, docketNum)
    .find(c => c.defenseAtty?.trim());

  if (!docketCase?.defenseAtty) {
    return "Blank ";
  }

  const lines = docketCase.defenseAtty.split('\n').map(line => line.trim()).filter(line => line);

  // Find the "ATTORNEY INFORMATION" header
  const attorneyInfoIndex = lines.findIndex(line =>
    line.toLowerCase().includes('attorney information')
  );

  if (attorneyInfoIndex === -1 || lines.length < attorneyInfoIndex + 3) {
    // If we can't find the structured format, fall back to basic pattern matching
    const attorneyInfo = docketCase.defenseAtty.toLowerCase();

    if (attorneyInfo.includes('public defender') || attorneyInfo.includes('public')) {
      return "Public Defender";
    }
    if (attorneyInfo.includes('court appointed')) {
      return "Court appointed attorney";
    }
    if (attorneyInfo.includes('private') || attorneyInfo.includes('retained')) {
      return "Private attorney";
    }
    if (attorneyInfo.includes('pro se') || attorneyInfo.includes('self represented')) {
      return "Blank ";
    }

    return "Blank ";
  }

  // Parse the structured format:
  // Line 1: "ATTORNEY INFORMATION"
  // Line 2: Attorney's name
  // Line 3: Representation type
  const representationTypeLine = lines[attorneyInfoIndex + 2]?.toLowerCase().trim();

  if (!representationTypeLine) {
    return "Blank ";
  }

  // Map the representation type to dropdown values
  if (representationTypeLine.includes('public')) {
    return "Public Defender";
  }
  if (representationTypeLine.includes('court appointed')) {
    return "Court appointed attorney";
  }
  if (representationTypeLine.includes('private')) {
    return "Private attorney";
  }
  if (representationTypeLine.includes('pro se') || representationTypeLine.includes('self')) {
    return "Blank ";
  }

  // If we have a structured format but can't categorize the type
  return "Blank ";
}

// sheets
class SheetPopulator {
  constructor(
    private sheet: ExcelScript.Worksheet,
    private rowIndex: number
  ) { }

  private setCell(column: number, value: string | number | boolean): void {
    this.sheet.getCell(this.rowIndex, column).setValue(value);
  }

  private setCellWithFormat(column: number, value: string | number | boolean, format: string): void {
    const cell = this.sheet.getCell(this.rowIndex, column);
    cell.setValue(value);
    cell.setNumberFormatLocal(format);
  }

  populatePersonData(person: Person): void {
    this.setCell(columns.first_name, person.firstName || "");
    this.setCell(columns.middle_name, person.middleName || "");
    this.setCell(columns.last_name, person.lastName || "");
    this.setCell(columns.aliases, (person.aliases || []).join(", "));
    this.setCellWithFormat(columns.dob, person.dob || "", date_format);
    this.setCell(columns.race, person.race || "");
    this.setCell(columns.sex, person.sex || "");
  }

  populateCaseData(docketNum: string, data: ProcessedData): void {
    const { summary, financial } = data;

    // Zip code
    const zip = extractZipCode(financial, summary?.person);
    this.setCell(columns.zip, zip);

    // Case status
    this.setCell(columns.case_status, financial?.casestatus || "");

    // County
    this.setCell(columns.county, financial?.county || "");

    // Charges, dispositions, and grades
    const charges = extractChargeData(summary?.cases, docketNum, c => c.description);
    const dispositions = extractChargeData(summary?.cases, docketNum, c => c.disposition);
    const grades = extractChargeData(summary?.cases, docketNum, c => c.grade);

    this.setCell(columns.charges, charges.join(", "));
    this.setCell(columns.disposition, dispositions.join(", "));
    this.setCell(columns.grades, grades.join(", "));

    // Sentence status
    const hasSentence = hasSignificantSentence(summary?.cases, docketNum);
    this.setCell(
      columns.has_sentence,
      hasSentence ? sentence_status.yes : sentence_status.no
    );

    // Disposition date
    const dispositionDate = getDispositionDate(summary?.cases, docketNum);
    this.setCellWithFormat(columns.dispositon_date, dispositionDate, date_format);

    // Warrant status
    const warrantStatus = hasActiveWarrant(summary?.cases);
    this.setCell(columns.has_warrant, warrantStatus);

    // Representation type
    let representationType = financial?.representationType || getRepresentationType(financial?.cases, docketNum);
    
    // Override old API responses with "Blank " 
    if (representationType && representationType.includes('NA, not a case from defenders')) {
      representationType = "Blank ";
    }
    
    this.setCell(columns.representation_type, representationType);

    // Next action docket
    const nextActionDocket = getNextActionDocket(summary?.cases);
    this.setCell(columns.next_action_docket, nextActionDocket);

    // Case balance
    if (financial?.balance) {
      this.setCell(columns.case_balance, financial.balance);
    }

    // Restitution amount
    if (financial?.restitutionAmount) {
      this.setCell(columns.restitution_amount, financial.restitutionAmount);
    }

    // Restitution owed to
    if (financial?.restitutionOwedTo) {
      this.setCell(columns.restitution_owed_to, financial.restitutionOwedTo);
    }
  }

  setError(message: string): void {
    this.setCell(columns.error_message, `ERROR: ${message}`);
  }

  clearRow(): void {
    // Clear all data columns except the docket number
    this.setCell(columns.error_message, "");
    this.setCell(columns.first_name, "");
    this.setCell(columns.middle_name, "");
    this.setCell(columns.last_name, "");
    this.setCell(columns.aliases, "");
    this.setCell(columns.zip, "");
    this.setCell(columns.dob, "");
    this.setCell(columns.race, "");
    this.setCell(columns.sex, "");
    this.setCell(columns.case_status, "");
    this.setCell(columns.county, "");
    this.setCell(columns.charges, "");
    this.setCell(columns.disposition, "");
    this.setCell(columns.grades, "");
    this.setCell(columns.has_sentence, "");
    this.setCellWithFormat(columns.dispositon_date, "", date_format);
    this.setCell(columns.has_warrant, "");
    this.setCell(columns.representation_type, "");
    this.setCell(columns.next_action_docket, "");
    this.setCell(columns.case_balance, "");
    this.setCell(columns.restitution_amount, "");
    this.setCell(columns.restitution_owed_to, "");
  }
}

// rows
async function processRow(
  sheet: ExcelScript.Worksheet,
  row: number,
  cachedPersonData?: Person
): Promise<void> {
  const rowIndex = row - 1; // Convert to 0-based
  const docketCell = sheet.getCell(rowIndex, columns.docket_number);
  const docketNum = docketCell.getValue()?.toString().trim();

  if (!docketNum) return;

  const populator = new SheetPopulator(sheet, rowIndex);

  // Validate docket number
  const validation = validateDocketNumber(docketNum);
  if (!validation.isValid) {
    console.log(`Skipping row ${row}: ${validation.errorMessage}`);
    populator.clearRow();
    populator.setError(validation.errorMessage!);
    return;
  }

  // Fetch data
  const data = await fetchAllData(docketNum);

  // Check for summary API errors
  if (data.summary && data.summary.error) {
    console.log(`Summary API error for ${docketNum}: ${data.summary.error}`);
    populator.setError(`Summary: ${data.summary.error}`);
    return;
  }

  // Check if we got person data
  if (!data.summary || !data.summary.person) {
    console.log(`No person data found for docket: ${docketNum}`);
    populator.setError(`No person data found for docket '${docketNum}'`);
    return;
  }

  // Check for financial API errors (but continue - financial is optional)
  if (data.financial && data.financial.error) {
    console.log(`Financial API warning for ${docketNum}: ${data.financial.error}`);
    populator.setError(`Financial: ${data.financial.error} (person data processed)`);
  }

  // Populate sheet
  if (cachedPersonData) {
    // Use cached person data (faster for subsequent rows)
    populator.populatePersonData(cachedPersonData);
  } else {
    // Use fresh person data (first row or when cache not available)
    populator.populatePersonData(data.summary.person);
  }
  populator.populateCaseData(docketNum, data);

  console.log(`Successfully processed row ${row}: ${docketNum}`);
}

//main
async function main(workbook: ExcelScript.Workbook): Promise<void> {
  const sheet = workbook.getWorksheet(worksheet_name);
  if (!sheet) {
    throw new Error(`${worksheet_name} worksheet not found.`);
  }

  const selectedRange = workbook.getSelectedRange();
  const startRow = selectedRange.getRowIndex(); // 0-based
  const rowCount = selectedRange.getRowCount();
  const startColumn = selectedRange.getColumnIndex();
  const columnCount = selectedRange.getColumnCount();

  // Validate that selection includes column B (docket number column)
  if (startColumn > columns.docket_number || startColumn + columnCount <= columns.docket_number) {
    console.log("Please select a range that includes column B (Docket Number column)");
    return;
  }

  console.log(`Processing ${rowCount} row(s) starting from row ${startRow + 1}...`);

  // Clear all selected rows with docket numbers as visual indicator
  console.log(`Clearing data from selected rows...`);
  for (let i = 0; i < rowCount; i++) {
    const currentRowIndex = startRow + i; // 0-based for getCell
    
    // Check if this row has a docket number
    const docketNum = sheet
      .getCell(currentRowIndex, columns.docket_number)
      .getValue()
      ?.toString()
      .trim();

    if (docketNum) {
      const populator = new SheetPopulator(sheet, currentRowIndex);
      populator.clearRow();
    }
  }
  console.log(`✅ Cleared all rows with docket numbers - processing will begin...`);

  let processedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];
  let cachedPersonData: Person | null = null;
  let cachedPersonIdentity: { firstName?: string; lastName?: string; dob?: string } | null = null;

  // Process each row in the selected range
  for (let i = 0; i < rowCount; i++) {
    const currentRow = startRow + i + 1; // Convert to 1-based
    const currentRowIndex = startRow + i; // 0-based for getCell
    
    // Check if this row has a docket number
    const docketNum = sheet
      .getCell(currentRowIndex, columns.docket_number)
      .getValue()
      ?.toString()
      .trim();

    if (!docketNum) {
      console.log(`Row ${currentRow}: Skipping - no docket number found`);
      continue;
    }

    try {
      console.log(`Processing row ${currentRow} (${i + 1}/${rowCount}): ${docketNum}`);
      
      // Check if we should use cached data or fetch fresh
      let shouldUseCache = false;
      let personMismatch = false;
      
      if (cachedPersonData && cachedPersonIdentity) {
        // We have cached data, but should we use it? Check if same person first
        try {
          const testData = await fetchAllData(docketNum);
          if (testData.summary && testData.summary.person) {
            const currentPerson = testData.summary.person;
            const isSamePerson = (
              currentPerson.firstName === cachedPersonIdentity.firstName &&
              currentPerson.lastName === cachedPersonIdentity.lastName &&
              currentPerson.dob === cachedPersonIdentity.dob
            );
            
            if (isSamePerson) {
              shouldUseCache = true;
              console.log(`  → Using cached person data for: ${cachedPersonIdentity.firstName} ${cachedPersonIdentity.lastName}`);
            } else {
              personMismatch = true;
              console.log(`  → WARNING: Different person detected!`);
              console.log(`    Expected: ${cachedPersonIdentity.firstName} ${cachedPersonIdentity.lastName} (DOB: ${cachedPersonIdentity.dob})`);
              console.log(`    Found: ${currentPerson.firstName} ${currentPerson.lastName} (DOB: ${currentPerson.dob})`);
              console.log(`    → Processing anyway with fresh data (no cache used)`);
            }
          }
        } catch (checkError) {
          console.log(`  → Warning: Could not verify person identity, processing with fresh data`);
        }
      }
      
      // Process the row
      if (shouldUseCache) {
        await processRow(sheet, currentRow, cachedPersonData!);
      } else {
        // First row or person mismatch - fetch fresh data
        if (!cachedPersonData) {
          console.log(`  → Fetching person data (will be cached for subsequent rows)`);
        }
        
        await processRow(sheet, currentRow);
        
        // Cache person data only if this is the first person or we cleared cache due to mismatch
        if (!cachedPersonData || personMismatch) {
          try {
            const data = await fetchAllData(docketNum);
            if (data.summary && data.summary.person) {
              cachedPersonData = data.summary.person;
              cachedPersonIdentity = {
                firstName: data.summary.person.firstName,
                lastName: data.summary.person.lastName,
                dob: data.summary.person.dob
              };
              
              if (!personMismatch) {
                console.log(`  → Person data cached: ${cachedPersonIdentity.firstName} ${cachedPersonIdentity.lastName}`);
              } else {
                console.log(`  → Person data updated in cache: ${cachedPersonIdentity.firstName} ${cachedPersonIdentity.lastName}`);
              }
            }
          } catch (cacheError) {
            console.log(`  → Warning: Could not cache person data, will fetch for each row`);
          }
        }
      }
      
      processedCount++;
    } catch (error) {
      errorCount++;
      const errorMessage = `Row ${currentRow} (${docketNum}): ${error instanceof Error ? error.message : String(error)}`;
      errors.push(errorMessage);
      console.log(`Error - ${errorMessage}`);
    }
  }

  // Summary report
  console.log(`\n=== Processing Complete ===`);
  console.log(`Total rows processed: ${processedCount}`);
  console.log(`Total errors: ${errorCount}`);
  
  if (errors.length > 0) {
    console.log(`\nErrors encountered:`);
    errors.forEach(error => console.log(`  • ${error}`));
  }
}

//*** INSUFFICIENT RESOURCES ***
//works, just very very very SLOWWW
//can we add a db?
//MJ are a very special case (alignment issues), and do not appear in CP/MC searches
//  ^^-- needs a special parser(docket sheet data won't load; sometimes summary): Bad Request: Docket Sheet does not contain a zip code
//address a few lingering alignment issues on regular dockets
//separate aliases by, not ; (may confuse regex pattern)
//omit real name from aliases
//address MI issue
//remove all emojis