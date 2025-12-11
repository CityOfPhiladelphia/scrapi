// Validation function for docket numbers
function validateDocketNumber(docketNum: string): { isValid: boolean; errorMessage?: string } {
  // Pattern: [A-Z]{2}-\d{2}-CR-\d{7}-\d{4}
  // Examples: MC-51-CR-0034177-2014, CP-02-CR-1234567-2020
  const docketPattern = /^[A-Z]{2}-\d{2}-CR-\d{7}-\d{4}$/;

  if (!docketPattern.test(docketNum)) {
    return {
      isValid: false,
      errorMessage: `Invalid docket format: '${docketNum}'. Expected format: XX-##-CR-#######-#### (e.g., MC-51-CR-0034177-2014)`
    };
  }

  return { isValid: true };
}

// --- New Workflow for Eligibility Determinations workbook ---
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

async function main(workbook: ExcelScript.Workbook) {
  const apiSummaryUrl = "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/summary";
  const apiDocketUrl = "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/docket";

  // Open the Eligibility Determinations worksheet
  const sheet = workbook.getWorksheet("Eligibility Determinations");
  if (!sheet) {
    throw new Error("Eligibility Determinations worksheet not found.");
  }

  // Find the last used row in the sheet
  const usedRange = sheet.getUsedRange();
  if (!usedRange) {
    console.log("No data found in the worksheet.");
    return;
  }

  const lastRow = usedRange.getRowCount();

  // Look for the first empty row with a docket number (user just added)
  let targetRow = -1;
  for (let row = 3; row <= lastRow + 1; row++) { // Check one row beyond last used
    const idCell = sheet.getCell(row - 1, 0); // A = col 0
    const idValue = idCell.getValue();
    const docketCell = sheet.getCell(row - 1, 1); // B = col 1 (0-based)
    const docketNum = docketCell.getValue()?.toString().trim();

    // Found a row where A is empty but B has a docket number (newly added)
    if ((!idValue || idValue === "") && docketNum) {
      targetRow = row;
      break;
    }
  }

  // If no new docket found, process all empty A cells with docket numbers
  if (targetRow === -1) {
    // Fallback: process all rows with empty A and filled B
    for (let row = 3; row <= lastRow; row++) {
      await processRow(sheet, row, apiSummaryUrl, apiDocketUrl);
    }
  } else {
    // Process just the newly added row
    await processRow(sheet, targetRow, apiSummaryUrl, apiDocketUrl);
  }
}

async function processRow(sheet: ExcelScript.Worksheet, row: number, apiSummaryUrl: string, apiDocketUrl: string) {
  const idCell = sheet.getCell(row - 1, 0); // A = col 0
  const idValue = idCell.getValue();
  const docketCell = sheet.getCell(row - 1, 1); // B = col 1 (0-based)
  const docketNum = docketCell.getValue()?.toString().trim();

  // Only process if A is empty and B (docket) is not empty
  if ((idValue !== null && idValue !== undefined && idValue !== "") || !docketNum) return;

  // Validate docket number format before processing
  const validation = validateDocketNumber(docketNum);
  if (!validation.isValid) {
    console.log(`❌ Skipping row ${row}: ${validation.errorMessage}`);
    // Optionally, you can mark the error in a cell
    sheet.getCell(row - 1, 2).setValue(`ERROR: ${validation.errorMessage}`); // Column C
    return; // Skip this row
  }

  // --- Unique Identifier in A ---
  if (row === 3) {
    idCell.setValue(1);
  } else {
    const prevId = sheet.getCell(row - 2, 0).getValue();
    idCell.setValue((typeof prevId === 'number' ? prevId : 0) + 1);
  }

  // Fetch summary data
  let data: ApiResponse | undefined;
  try {
    const response = await fetch(`${apiSummaryUrl}?docketNum=${encodeURIComponent(docketNum)}`, { method: 'GET' });
    if (response.ok) {
      data = await response.json();
    }
  } catch (e) {
    // skip on error
    return;
  }
  if (!data || !data.person) return;

  // Fetch financial data
  let finance: FinancialResponse | undefined;
  try {
    const financeRes = await fetch(`${apiDocketUrl}?docketNum=${encodeURIComponent(docketNum)}`, { method: 'GET' });
    if (financeRes.ok) {
      finance = await financeRes.json();
    }
  } catch (e) {
    // skip on error
  }

  // --- Direct Mappings ---
  // K (10): First
  sheet.getCell(row - 1, 10).setValue(data.person.firstName || "");
  // L (11): Middle Name or initial
  sheet.getCell(row - 1, 11).setValue(data.person.middleName || "");
  // M (12): Last name
  sheet.getCell(row - 1, 12).setValue(data.person.lastName || "");
  // N (13): Aliases
  sheet.getCell(row - 1, 13).setValue((data.person.aliases || []).join("; "));
  // O (14): Zip from most recent case
  let zip = "";
  if (finance && finance.zipcode) {
    zip = finance.zipcode;
  } else if (data.cases && data.cases.length > 0) {
    // fallback: try to get zip from address if present
    const addr = data.person.address || "";
    const zipMatch = addr.match(/\b\d{5}(?:-\d{4})?\b/);
    if (zipMatch) zip = zipMatch[0];
  }
  sheet.getCell(row - 1, 14).setValue(zip);
  // Q (16): DOB
  sheet.getCell(row - 1, 16).setValue(data.person.dob || "");
  // Set DOB cell to mm/dd/yyyy format
  sheet.getCell(row - 1, 16).setNumberFormatLocal("mm/dd/yyyy");
  // R (17): Race
  sheet.getCell(row - 1, 17).setValue(data.person.race || "");
  // S (18): Sex
  sheet.getCell(row - 1, 18).setValue(data.person.sex || "");
  // U (20): Case Status - get from docket data
  let caseStatus = "";
  if (finance && finance.casestatus) {
    caseStatus = finance.casestatus;
  }
  sheet.getCell(row - 1, 20).setValue(caseStatus);
  // W (22): Charges - collect all charge descriptions
  let chargeDescriptions: string[] = [];
  if (data.cases && data.cases.length > 0) {
    for (const caseData of data.cases) {
      if (caseData.charges && caseData.charges.length > 0) {
        for (const charge of caseData.charges) {
          if (charge.description) {
            chargeDescriptions.push(charge.description);
          }
        }
      }
    }
  }
  sheet.getCell(row - 1, 22).setValue(chargeDescriptions.join(", "));
  // AX (49): Case Balance
  if (finance && finance.balance) {
    sheet.getCell(row - 1, 49).setValue(finance.balance);
  }
}