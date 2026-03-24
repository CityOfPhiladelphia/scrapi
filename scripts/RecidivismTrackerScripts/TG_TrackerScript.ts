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
  selectedRow: number; // Add selected row to pass it around
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
  
  // Updated for tracker columns: C=cohortStart, D=cohortEnd, I=firstName, J=lastName, K=dob
  // Read raw values from specified columns using getRange() with dynamic row
  const cohortStartRawValue = worksheet.getRange(`C${selectedRow}`).getValue();
  const cohortEndRawValue = worksheet.getRange(`D${selectedRow}`).getValue();
  const firstNameValue = String(worksheet.getRange(`I${selectedRow}`).getValue()).trim();
  const lastNameValue = String(worksheet.getRange(`J${selectedRow}`).getValue()).trim();
  const dobRawValue = worksheet.getRange(`K${selectedRow}`).getValue();
  
  
  // Convert Excel values to strings, handling dates properly
  let cohortStartValue = "";
  let cohortEndValue = "";
  let dobValue = "";
  
  // Convert cohort start date
  if (typeof cohortStartRawValue === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    const jsDate = new Date(excelEpoch.getTime() + cohortStartRawValue * 86400 * 1000);
    const month = (jsDate.getMonth() + 1).toString().padStart(2, '0');
    const day = jsDate.getDate().toString().padStart(2, '0');
    const year = jsDate.getFullYear().toString();
    cohortStartValue = `${month}/${day}/${year}`;
  } else {
    cohortStartValue = String(cohortStartRawValue).trim();
  }
  
  // Convert cohort end date
  if (typeof cohortEndRawValue === "number") {
    const excelEpoch = new Date(1899, 11, 30);
    const jsDate = new Date(excelEpoch.getTime() + cohortEndRawValue * 86400 * 1000);
    const month = (jsDate.getMonth() + 1).toString().padStart(2, '0');
    const day = jsDate.getDate().toString().padStart(2, '0');
    const year = jsDate.getFullYear().toString();
    cohortEndValue = `${month}/${day}/${year}`;
  } else {
    cohortEndValue = String(cohortEndRawValue).trim();
  }
  
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
  
  console.log(`Reading from tracker columns: C${selectedRow}="${cohortStartValue}", D${selectedRow}="${cohortEndValue}", I${selectedRow}="${firstNameValue}", J${selectedRow}="${lastNameValue}", K${selectedRow}="${dobValue}"`);
  
  // Validate required fields
  if (!cohortStartValue || !cohortEndValue || !firstNameValue || !lastNameValue || !dobValue) {
    throw new Error(`Missing required participant data in tracker columns. Please check C${selectedRow} (cohortStart), D${selectedRow} (cohortEnd), I${selectedRow} (firstName), J${selectedRow} (lastName), K${selectedRow} (DOB)`);
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
  
  // Updated column mappings for tracker using getRange():
  // L=age, M=gender, N=race, P=zip, AD=lastArrestDate, AF=arrestingCounty, AG=otn
  
  // Column L - Age (calculate from DOB in K{selectedRow})
  const dobFromInput = worksheet.getRange(`K${selectedRow}`).getValue();
  const dobString = convertExcelValue(dobFromInput, "date");
  const age = calculateAge(dobString);
  if (age !== undefined) {
    worksheet.getRange(`L${selectedRow}`).setValue(age);
    console.log(`Set age: ${age} (calculated from input DOB: ${dobString})`);
  }
  
  // Column M - Gender (sex in API)
  const gender = summaryPerson?.sex || docketPerson?.sex || "Not Available";
  worksheet.getRange(`M${selectedRow}`).setValue(gender);
  console.log(`Set gender: ${gender}`);
  
  // Column N - Race
  const race = summaryPerson?.race || docketPerson?.race || "Not Available";
  worksheet.getRange(`N${selectedRow}`).setValue(race);
  console.log(`Set race: ${race}`);
  
  // Column P - Zip Code
  const zipCode = docketData?.zipcode || extractZipFromAddress(summaryPerson?.address || docketPerson?.address) || "Not Available";
  worksheet.getRange(`P${selectedRow}`).setValue(zipCode);
  console.log(`Set zip code: ${zipCode}`);
  
  // Column AG - OTN # (use the most recent one passed from search)
  worksheet.getRange(`AG${selectedRow}`).setValue(mostRecentOtn);
  console.log(`Set OTN: ${mostRecentOtn}`);
  
  console.log("Finished populateExcelColumns function");
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
    
    if (!data.response.foundCases || data.response.foundCases.length === 0) {
      console.log("No cases found - populating with 'No Records' status");
      populateNoRecordsFound(workbook, selectedRow);
      return;
    }
    
    // Find target docket and check for rearrest
    const cohortAnalysis = findTargetDocketAndRearrest(data.response.foundCases, participantData);
    console.log("Cohort analysis:", cohortAnalysis);
    
    const mostRecentCase = cohortAnalysis.targetDocket;
    
    if (mostRecentCase) {
      try {
        // Fetch detailed data from summary and docket endpoints
        console.log("Fetching additional data for most recent docket...");
        const [summaryData, docketData] = await Promise.all([
          fetchSummaryData(mostRecentCase.docketNumber),
          fetchDocketData(mostRecentCase.docketNumber)
        ]);
        
        console.log("API calls completed");
        console.log("Summary data:", summaryData ? "received" : "null");
        console.log("Docket data:", docketData ? "received" : "null");
        
        // Populate Excel columns with the fetched data
        console.log("Populating Excel columns...");
        populateExcelColumns(workbook, summaryData, docketData, mostRecentCase.otn || 'N/A', selectedRow);
        
        // Update last arrest date and county columns
        updateArrestInfo(workbook, mostRecentCase, selectedRow);
        
        console.log("Excel columns populated successfully");
      } catch (populateError) {
        console.log("Error in data fetching or Excel population:", populateError);
        populateErrorStatus(workbook, selectedRow);
      }
      
      // Always update rearrest information when target docket is found
      updateRearrestInfo(workbook, cohortAnalysis.rearrestInfo, selectedRow);
    } else {
      console.log("No target docket found");
      populateNoRecordsFound(workbook, selectedRow);
      
      // Still check and update rearrest information even when no target docket
      updateRearrestInfo(workbook, cohortAnalysis.rearrestInfo, selectedRow);
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
  targetDocket: {docketNumber: string, filingDate: string, otn: string} | null;
  rearrestInfo: {
    hasRearrest: boolean;
    rearrrestDate: string | null;
  };
}

function findTargetDocketAndRearrest(foundCases: Array<{docketNumber: string, filingDate: string, otn: string}>, participantData: ParticipantData): CohortAnalysis {
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
  
  if (hasRearrest) {
    console.log(`Rearrest detected: ${postCohortCases[0].docketNumber} (filed ${rearrrestDate}) - occurred after cohort start`);
  } else {
    console.log('No rearrest detected - no cases filed after cohort start date');
  }
  
  return {
    targetDocket,
    rearrestInfo: {
      hasRearrest,
      rearrrestDate
    }
  };
}

function updateRearrestInfo(workbook: ExcelScript.Workbook, rearrestInfo: {hasRearrest: boolean, rearrrestDate: string | null}, selectedRow: number): void {
  const worksheet = workbook.getActiveWorksheet();
  
  // Column AI - Rearrested? ('yes' or 'no')
  const rearrested = rearrestInfo.hasRearrest ? 'yes' : 'no';
  worksheet.getRange(`AI${selectedRow}`).setValue(rearrested);
  console.log(`Set rearrested status: ${rearrested}`);
  
  // Column AJ - Date of Rearrest (only if rearrest occurred)
  if (rearrestInfo.hasRearrest && rearrestInfo.rearrrestDate) {
    worksheet.getRange(`AJ${selectedRow}`).setValue(rearrestInfo.rearrrestDate);
    console.log(`Set rearrest date: ${rearrestInfo.rearrrestDate}`);
  } else {
    worksheet.getRange(`AJ${selectedRow}`).setValue('');
    console.log('No rearrest date to set');
  }
}

function updateArrestInfo(workbook: ExcelScript.Workbook, mostRecentCase: {docketNumber: string, filingDate: string, otn: string}, selectedRow: number): void {
  const worksheet = workbook.getActiveWorksheet();
  
  // Column AD - Last Arrest Date (filing date)
  worksheet.getRange(`AD${selectedRow}`).setValue(mostRecentCase.filingDate);
  console.log(`Set last arrest date: ${mostRecentCase.filingDate}`);
  
  // Column AF - Arresting County (extract from docket number)
  const county = extractCountyFromDocket(mostRecentCase.docketNumber);
  worksheet.getRange(`AF${selectedRow}`).setValue(county);
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
  
  // Calculate age from input DOB
  const dobFromInput = worksheet.getRange(`K${selectedRow}`).getValue();
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
  
  // Set values in tracker columns
  if (age !== undefined) {
    worksheet.getRange(`L${selectedRow}`).setValue(age); // L - Age
  }
  worksheet.getRange(`M${selectedRow}`).setValue("No Records"); // M - Gender
  worksheet.getRange(`N${selectedRow}`).setValue("No Records"); // N - Race
  worksheet.getRange(`P${selectedRow}`).setValue("No Records"); // P - Zip
  worksheet.getRange(`AD${selectedRow}`).setValue("No Records"); // AD - Last Arrest Date
  worksheet.getRange(`AF${selectedRow}`).setValue("No Records"); // AF - County
  worksheet.getRange(`AG${selectedRow}`).setValue("No Records"); // AG - OTN
  worksheet.getRange(`AI${selectedRow}`).setValue("no"); // AI - Rearrested (default to 'no' for no records)
  worksheet.getRange(`AJ${selectedRow}`).setValue(""); // AJ - Date of Rearrest (empty for no records)
  
  console.log("Populated 'No Records' status in tracker columns");
}

function populateErrorStatus(workbook: ExcelScript.Workbook, selectedRow: number): void {
  const worksheet = workbook.getActiveWorksheet();
  
  // Set error values in tracker columns using getRange()
  worksheet.getRange(`L${selectedRow}`).setValue("ERROR"); // L - Age
  worksheet.getRange(`M${selectedRow}`).setValue("ERROR"); // M - Gender
  worksheet.getRange(`N${selectedRow}`).setValue("ERROR"); // N - Race
  worksheet.getRange(`P${selectedRow}`).setValue("ERROR"); // P - Zip
  worksheet.getRange(`AD${selectedRow}`).setValue("ERROR"); // AD - Last Arrest Date
  worksheet.getRange(`AF${selectedRow}`).setValue("ERROR"); // AF - County
  worksheet.getRange(`AG${selectedRow}`).setValue("ERROR"); // AG - OTN
  worksheet.getRange(`AI${selectedRow}`).setValue("ERROR"); // AI - Rearrested
  worksheet.getRange(`AJ${selectedRow}`).setValue("ERROR"); // AJ - Date of Rearrest
  
  console.log("Populated 'ERROR' status in tracker columns");
}