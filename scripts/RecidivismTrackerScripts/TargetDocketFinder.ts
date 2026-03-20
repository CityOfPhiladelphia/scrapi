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
  charges?: unknown[];
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
    try {
        const participantData = readParticipantData(workbook);
        const dobForApi = convertDobFormat(participantData.dateOfBirth);
        await findTargetDocket(participantData, dobForApi, workbook); // ← await it
    } catch (error: unknown) {
        console.log("Script error:", error);
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
  const selectedRow = selectedRange.getRowIndex();
  
  // Read raw values from the selected row in specified columns (0-based indexing)
  const cohortStartValue: string | number | boolean | Date | null | undefined = worksheet.getCell(selectedRow, 2).getValue(); // Column C
  const cohortEndValue: string | number | boolean | Date | null | undefined = worksheet.getCell(selectedRow, 3).getValue();   // Column D
  const firstNameValue: string | number | boolean | Date | null | undefined = worksheet.getCell(selectedRow, 5).getValue();   // Column F
  const lastNameValue: string | number | boolean | Date | null | undefined = worksheet.getCell(selectedRow, 6).getValue();    // Column G
  const dobValue: string | number | boolean | Date | null | undefined = worksheet.getCell(selectedRow, 7).getValue();         // Column H
  
  // Convert Excel values to strings, handling dates properly
  const cohortStartDate = convertExcelValue(cohortStartValue, "date");
  const cohortEndDate = convertExcelValue(cohortEndValue, "date");
  const firstName = convertExcelValue(firstNameValue, "string");
  const lastName = convertExcelValue(lastNameValue, "string");
  const dateOfBirth = convertExcelValue(dobValue, "date");
  
  // Validate required fields
  if (!cohortStartDate || !cohortEndDate || !firstName || !lastName || !dateOfBirth) {
    throw new Error(`Missing required participant data in row ${selectedRow + 1}. Please check columns C, D, F, G, H`);
  }
  
  return {
    cohortStartDate,
    cohortEndDate,
    firstName,
    lastName,
    dateOfBirth
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
  const API_BASE_URL = "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod";
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
  const API_BASE_URL = "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod";
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

function populateExcelColumns(workbook: ExcelScript.Workbook, summaryData: SummaryResponse | null, docketData: DocketResponse | null): void {
  console.log("Starting populateExcelColumns function");
  const worksheet = workbook.getActiveWorksheet();
  const selectedRange = workbook.getSelectedRange();
  
  if (!selectedRange) {
    console.log("No selected range for populating data");
    return;
  }
  
  const selectedRow = selectedRange.getRowIndex();
  console.log(`Working with row: ${selectedRow}`);
  
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
  
  // Populate columns based on available data
  // Column 8 (I) - Age (calculate from DOB)
  const dob = summaryPerson?.dob || docketPerson?.dob;
  const age = calculateAge(dob || "");
  if (age !== undefined) {
    worksheet.getCell(selectedRow, 8).setValue(age);
    console.log(`Set age: ${age} (calculated from DOB: ${dob})`);
  }
  
  // Column 9 (J) - Gender (sex in API)
  const gender = summaryPerson?.sex || docketPerson?.sex;
  if (gender) {
    worksheet.getCell(selectedRow, 9).setValue(gender);
    console.log(`Set gender: ${gender}`);
  }
  
  // Column 10 (K) - Race
  const race = summaryPerson?.race || docketPerson?.race;
  if (race) {
    worksheet.getCell(selectedRow, 10).setValue(race);
    console.log(`Set race: ${race}`);
  }
  
  // Column 11 (L) - Hispanic or Latino/a/x? (not in current API structure)
  // This field may not be available in the current API
  console.log("Ethnicity field not found in current API structure");
  
  // Column 12 (M) - Zip Code
  const zipCode = docketData?.zipcode || summaryData?.person?.address;
  if (zipCode) {
    worksheet.getCell(selectedRow, 12).setValue(zipCode);
    console.log(`Set zip code: ${zipCode}`);
  }
  
  // Column 28 (AC) - OTN # (from summary/docket responses only)
  const otn = summaryData?.cases?.[0]?.otn || docketData?.cases?.[0]?.otn || 'N/A';
  worksheet.getCell(selectedRow, 28).setValue(otn);
  console.log(`Set OTN: ${otn}`);
  
  console.log("Finished populateExcelColumns function");
}

async function findTargetDocket(participantData: ParticipantData, dobForApi: string, workbook: ExcelScript.Workbook): Promise<void> {
  
  // Clean last name by removing generational suffixes for better search results
  const cleanedLastName = removeSuffixes(participantData.lastName);
  console.log(`Name cleaning: "${participantData.lastName}" → "${cleanedLastName}"`);
  
  const API_BASE_URL = "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod";
  const apiUrl = `${API_BASE_URL}/usjs/v1/person?firstName=${encodeURIComponent(participantData.firstName)}&lastName=${encodeURIComponent(cleanedLastName)}&dob=${dobForApi}`;
  
  try {
    console.log("About to fetch:", apiUrl);
    
    // Add timeout to prevent hanging
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const response = await fetch(apiUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    console.log("Fetch completed, status:", response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log("API returned error status:", response.status);
      console.log("Error response:", errorText);
      throw new Error(`API call failed: ${response.status} ${response.statusText} - ${errorText}`);
    }
    
    const responseText = await response.text();
    console.log("Raw API response:", responseText);
    
    let data: PersonSearchResponse;
    try {
      data = JSON.parse(responseText);
    } catch (parseError) {
      console.log("JSON parse error:", parseError);
      throw new Error("Invalid JSON response from API");
    }
    
    console.log(`Found ${data.response.totalCount} dockets`);
    
    // Step 4: Find target docket based on timing criteria
    console.log("About to call findClosestDocket...");
    const targetDocket = findClosestDocket(data.response.foundCases, participantData);
    console.log("findClosestDocket completed, result:", targetDocket);
    
    // Step 5: If we found a valid docket, fetch detailed data and populate Excel
    if (targetDocket !== "No eligible docket found") {
      try {
        // Fetch detailed data from summary and docket endpoints
        console.log("Fetching additional data for target docket...");
        const [summaryData, docketData] = await Promise.all([
          fetchSummaryData(targetDocket),
          fetchDocketData(targetDocket)
        ]);
        console.log("API calls completed");
        console.log("Summary data:", summaryData ? "received" : "null");
        console.log("Docket data:", docketData ? "received" : "null");
        
        // Populate Excel columns with the fetched data
        console.log("Populating Excel columns...");
        populateExcelColumns(workbook, summaryData, docketData);
        console.log("Excel columns populated successfully");
      } catch (populateError) {
        console.log("Error in data fetching or Excel population:", populateError);
      }
    } else {
      console.log("Skipping detailed data fetch - no eligible docket found");
    }
    
    // Step 6: Log the target result
    console.log("About to call writeTargetToSpreadsheet...");
    writeTargetToSpreadsheet(workbook, targetDocket);
    console.log("writeTargetToSpreadsheet completed");
    console.log("Done.");
    
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.log("Error name:", error.name);
      console.log("Error message:", error.message);
      console.log("Error stack:", error.stack);
      
      if (error.name === 'AbortError') {
        console.log("API call timed out after 30 seconds");
      } else if (error.message.includes('Load failed')) {
        console.log("Load failed - likely causes:");
        console.log("1. CORS policy blocking the request");
        console.log("2. API Gateway URL is incorrect");
        console.log("3. SSL certificate issues");
        console.log("4. API endpoint does not exist");
        console.log("Try testing this URL directly in a browser:");
        console.log(apiUrl);
      } else if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
        console.log("Network error - Office Scripts may block external API calls");
        console.log("Possible solutions:");
        console.log("1. Run in Excel for the web with external data connections enabled");
        console.log("2. Check if your organization allows external API calls in Office Scripts");
        console.log("3. Consider using Power Automate or other alternatives for API calls");
      } else {
        console.log("API error:", error.message);
      }
    } else {
      console.log("API error:", error);
    }
    
    // Write error message to spreadsheet for debugging
    writeTargetToSpreadsheet(workbook, "API_ERROR");
  }
}

function findClosestDocket(foundCases: Array<{docketNumber: string, filingDate: string, otn: string}>, participantData: ParticipantData): string {
  // Parse cohort dates
  const cohortStart = new Date(participantData.cohortStartDate);
  const cohortEnd = new Date(participantData.cohortEndDate);
  
  if (isNaN(cohortStart.getTime()) || isNaN(cohortEnd.getTime())) {
    throw new Error(`Invalid cohort dates: Start="${participantData.cohortStartDate}", End="${participantData.cohortEndDate}"`);
  }
  
  // Filter eligible dockets:
  // - Filing date must be on or before cohort start date
  // - Filing date must not be after cohort end date
  const eligibleDockets = foundCases
    .map(docket => {
      // Parse filing date (handle multiple formats)
      let filingDate: Date;
      try {
        if (docket.filingDate.includes('/')) {
          // MM/DD/YYYY format
          const parts = docket.filingDate.split('/');
          filingDate = new Date(`${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`);
        } else {
          // Assume ISO format or other standard format
          filingDate = new Date(docket.filingDate);
        }
      } catch (error: unknown) {
        return null;
      }
      
      return {
        ...docket,
        filingDateParsed: filingDate
      };
    })
    .filter(docket => docket !== null) // Remove unparseable dates
    .filter(docket => {
      // Must be on or before cohort start date
      const beforeStart = docket.filingDateParsed <= cohortStart;
      // Must not be after cohort end date  
      const notAfterEnd = docket.filingDateParsed <= cohortEnd;
      
      return beforeStart && notAfterEnd;
    })
    // Sort by filing date descending (most recent first)
    .sort((a, b) => b.filingDateParsed.getTime() - a.filingDateParsed.getTime());
  
  // Return the most recent eligible docket (closest to cohort start date but not after)
  const result = eligibleDockets.length > 0 ? eligibleDockets[0].docketNumber : "No eligible docket found";
  console.log(`Eligible dockets: ${eligibleDockets.length}`);
  return result;
}

function writeTargetToSpreadsheet(workbook: ExcelScript.Workbook, targetDocket: string): void {
  // Simple output: just show the target docket (no longer writing to column A)
  console.log(`Target: ${targetDocket}`);
}