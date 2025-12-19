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
  charges: 22,
  disposition: 23,
  grades: 24,
  has_sentence: 25,
  dispositon_date: 28,
  case_balance: 49
} as const;

const sentence_status = {
  yes: "Yes",
  no:  "No (CVC, VWS, CCC, don't need to be paid)"
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
  docketUrl?: string;
}

interface ValidationResult {
  isValid: boolean;
  errorMessage?: string;
}

interface ProcessedData {
  summary?: ApiResponse;
  financial?: FinancialResponse;
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

  return { isValid: true };
}

// data fetching
async function fetchApiData<T>(url: string, docketNum: string): Promise<T | null> {
  try {
    const response = await fetch(`${url}?docketNum=${encodeURIComponent(docketNum)}`, {
      method: 'GET'
    });
    return response.ok ? await response.json() : null;
  } catch (error) {
    console.log(`Failed to fetch from ${url}:`, error);
    return null;
  }
}

async function fetchAllData(docketNum: string): Promise<ProcessedData> {
  const [summary, financial] = await Promise.all([
    fetchApiData<ApiResponse>(api_config.summary_URL, docketNum),
    fetchApiData<FinancialResponse>(api_config.docket_URL, docketNum)
  ]);

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
    this.setCell(columns.aliases, (person.aliases || []).join("; "));
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

    // Case balance
    if (financial?.balance) {
      this.setCell(columns.case_balance, financial.balance);
    }
  }

  setError(message: string): void {
    this.setCell(columns.error_message, `ERROR: ${message}`);
  }
}

// rows
async function processRow(
  sheet: ExcelScript.Worksheet,
  row: number
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
    populator.setError(validation.errorMessage!);
    return;
  }

  // Fetch data
  const data = await fetchAllData(docketNum);

  if (!data.summary?.person) {
    console.log(`No person data found for docket: ${docketNum}`);
    return;
  }

  // Populate sheet
  populator.populatePersonData(data.summary.person);
  populator.populateCaseData(docketNum, data);

  console.log(`Successfully processed row ${row}: ${docketNum}`);
}


//main
async function main(workbook: ExcelScript.Workbook): Promise<void> {
  const sheet = workbook.getWorksheet(worksheet_name);
  if (!sheet) {
    throw new Error(`${worksheet_name} worksheet not found.`);
  }

  const activeCell = workbook.getActiveCell();
  const activeRow = activeCell.getRowIndex() + 1; // Convert to 1-based
  const activeColumn = activeCell.getColumnIndex();

  if (activeColumn !== columns.docket_number) {
    console.log("Please select a cell in column B (Docket Number column)");
    return;
  }

  const docketNum = sheet
    .getCell(activeRow - 1, columns.docket_number)
    .getValue()
    ?.toString()
    .trim();

  if (!docketNum) {
    console.log("Selected cell in column B is empty. Please select a cell with a docket number.");
    return;
  }

  await processRow(sheet, activeRow);
}