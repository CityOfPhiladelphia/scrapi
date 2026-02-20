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
  const apiSummaryUrl = "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/summary";
  const apiDocketUrl = "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/docket";

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

  console.log(`📋 Processing ${inputData.length} docket numbers for identifier: ${personIdValue}`);

  // Create or get sheets
  let personSheet = workbook.getWorksheet("Person Info") || workbook.addWorksheet("Person Info");
  let casesSheet = workbook.getWorksheet("Cases") || workbook.addWorksheet("Cases");
  let chargesSheet = workbook.getWorksheet("Charges") || workbook.addWorksheet("Charges");
  let financialSheet = workbook.getWorksheet("Financial Info") || workbook.addWorksheet("Financial Info");
  let urlsSheet = workbook.getWorksheet("Links") || workbook.addWorksheet("Links");

  // Clear existing data
  personSheet.getRange("A:Z").clear();
  casesSheet.getRange("A:Z").clear();
  chargesSheet.getRange("A:Z").clear();
  financialSheet.getRange("A:Z").clear();
  urlsSheet.getRange("A:Z").clear();

  // Write headers
  personSheet.getRange("A1:L1").setValues([[
    "Person ID", "Docket Searched", "First Name", "Middle", "Last Name", "Address", "DOB", "Race", "Sex", "Eyes", "Hair", "Aliases"
  ]]);

  casesSheet.getRange("A1:N1").setValues([[ 
    "Person ID", "Priority", "Docket No", "Dispositions", "DC No", "OTN", "Arrest Date", "Disp Date", "Judge", "Defense Atty", "Num Charges", "Original Docket", "Status", "Is the debt balance greater than $0?"
  ]]);

  chargesSheet.getRange("A1:J1").setValues([[
    "Person ID", "Docket No", "Seq", "Statute", "Grade", "Description", "Disposition", "Sentence Date", "Sentence Type", "Sentence Length"
  ]]);

  financialSheet.getRange("A1:H1").setValues([[
    "Person ID", "Docket No", "Zip Code", "Balance", "Assessment", "Payments", "Adjustments", "Non-Monetary"
  ]]);

  urlsSheet.getRange("A1:D1").setValues([[
    "Person ID", "Docket No", "Court Summary URL", "Docket Sheet URL"
  ]]);

  // Data structures for processing
  const personDataByPersonId = new Map<string, Person>();
  const allCasesByPersonId = new Map<string, ProcessedCase[]>();
  const financialDataByDocket = new Map<string, FinancialResponse>();
  const urlDataByDocket = new Map<string, { summaryUrl: string; docketUrl: string }>();

  // Process each input docket number
  for (const input of inputData) {
    const { personId, docketNum } = input;

    // Validate inputs
    const personIdValidation = validatePersonId(personId);
    const docketValidation = validateDocketNumber(docketNum);

    if (!personIdValidation.isValid) {
      console.log(`❌ Person ID Validation Error: ${personIdValidation.errorMessage}`);
      continue;
    }

    if (!docketValidation.isValid) {
      console.log(`❌ Docket Validation Error: ${docketValidation.errorMessage}`);
      continue;
    }

    try {
      // Fetch summary data
      const response = await fetch(`${apiSummaryUrl}?docketNum=${encodeURIComponent(docketNum)}`, {
        method: 'GET'
      });

      if (!response.ok) {
        console.log(`Failed to fetch summary for ${docketNum}`);
        continue;
      }

      const data: ApiResponse = await response.json();

      // Store person data (will be consolidated later if multiple dockets for same person)
      if (data.person) {
        personDataByPersonId.set(personId, data.person);
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

    } catch (error: unknown) {
      console.log(`Processing failed for ${personId}/${docketNum}: ${error}`);
    }
  }

  // Collect all unique docket numbers from case results and fetch missing financial data
  console.log("🔍 Collecting additional financial data for discovered dockets...");
  const allDiscoveredDockets = new Set<string>();
  
  // Collect all docket numbers from case results
  for (const cases of allCasesByPersonId.values()) {
    for (const caseData of cases) {
      if (caseData.docketNo && caseData.docketNo.trim()) {
        allDiscoveredDockets.add(caseData.docketNo);
      }
    }
  }

  // Find dockets we don't have financial data for yet
  const missingFinancialDockets: string[] = [];
  for (const docketNo of allDiscoveredDockets) {
    if (!financialDataByDocket.has(docketNo)) {
      missingFinancialDockets.push(docketNo);
    }
  }

  console.log(`📊 Found ${missingFinancialDockets.length} additional dockets needing financial data`);

  // Fetch financial data for missing dockets in parallel batches
  const BATCH_SIZE = 8; // Process 8 dockets concurrently
  const docketChunks = chunkArray(missingFinancialDockets, BATCH_SIZE);
  
  for (let i = 0; i < docketChunks.length; i++) {
    const chunk = docketChunks[i];
    console.log(`🔄 Processing batch ${i + 1}/${docketChunks.length} (${chunk.length} dockets)`);
    
    // Process all dockets in this chunk simultaneously
    const promises = chunk.map(async (docketNo) => {
      try {
        const financeRes = await fetch(`${apiDocketUrl}?docketNum=${encodeURIComponent(docketNo)}`, {
          method: 'GET'
        });

        if (financeRes.ok) {
          const finance: FinancialResponse = await financeRes.json();
          financialDataByDocket.set(docketNo, finance);
          console.log(`✅ Got financial data for ${docketNo}`);
        } else {
          console.log(`❌ Failed to get financial data for ${docketNo}`);
        }
      } catch (error: unknown) {
        console.log(`❌ Error fetching financial data for ${docketNo}: ${error}`);
      }
    });

    // Wait for all requests in this batch to complete
    await Promise.all(promises);
    
    // Throttle between batches (not between individual requests)
    if (i < docketChunks.length - 1) { // Don't wait after the last batch
      await new Promise(resolve => setTimeout(resolve, 200)); // Slightly longer between batches
    }
  }

  console.log(`💰 Financial data collection complete. Total dockets: ${financialDataByDocket.size}`);

  // Write Person Info (one row per person ID)
  let personRow = 2;
  for (const [personId, person] of personDataByPersonId) {
    const firstDocketForPerson = inputData.find(input => input.personId === personId)?.docketNum || "";
    
    personSheet.getRange(`A${personRow}:L${personRow}`).setValues([[
      personId,
      firstDocketForPerson,
      person.firstName || "", person.middleName || "", person.lastName || "",
      person.address || "", person.dob || "",
      person.race || "", person.sex || "", person.eyes || "", person.hair || "",
      (person.aliases || []).join("; ")
    ]]);
    
    // Set DOB column (G) to mm/dd/yyyy format for this row
    personSheet.getRange(`G${personRow}`).setNumberFormatLocal("mm/dd/yyyy");
    personRow++;
  }

  // Process and write Cases (grouped, deduplicated, sorted)
  let caseRow = 2;
  for (const [personId, cases] of allCasesByPersonId) {
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

      // Within same priority, sort by disposition date (oldest first)
      const dateA = parseDispositionDate(a.dispDt);
      const dateB = parseDispositionDate(b.dispDt);
      return dateA.getTime() - dateB.getTime();
    });

    // Write cases for this person
    for (const caseData of sortedCases) {
      const priorityText = caseData.isEligibleDisposition ? "HIGH" : "LOW";
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
      casesSheet.getRange(`A${caseRow}:N${caseRow}`).setValues([[ 
        personId,
        priorityText,
        caseData.docketNo || "", allDispositions, caseData.dcNo || "",
        caseData.otn || "", caseData.arrestDt || "", caseData.dispDt || "",
        caseData.dispJudge || "", caseData.defenseAtty || "",
        (caseData.charges || []).length, caseData.originalDocketSearched, caseData.procStatus || "",
        isDebtGreaterThanZero
      ]]);

      // Format high priority cases with highlighting
      if (caseData.isEligibleDisposition) {
        const rowRange = casesSheet.getRange(`A${caseRow}:N${caseRow}`);
        rowRange.getFormat().getFont().setBold(true);
        rowRange.getFormat().getFill().setColor("#FFFFCC"); // Light yellow highlight
      }

      caseRow++;
    }
  }

  // Write Charges
  let chargeRow = 2;
  for (const [personId, cases] of allCasesByPersonId) {
    // Use the same deduplication and sorting logic
    const uniqueCases = new Map<string, ProcessedCase>();
    for (const caseData of cases) {
      const docketNo = caseData.docketNo || "";
      if (!uniqueCases.has(docketNo) || caseData.originalDocketSearched === docketNo) {
        uniqueCases.set(docketNo, caseData);
      }
    }

    const sortedCases = Array.from(uniqueCases.values()).sort((a, b) => {
      if (a.sortPriority !== b.sortPriority) {
        return a.sortPriority - b.sortPriority;
      }
      const dateA = parseDispositionDate(a.dispDt);
      const dateB = parseDispositionDate(b.dispDt);
      return dateA.getTime() - dateB.getTime();
    });

    for (const caseData of sortedCases) {
      if (caseData.charges && caseData.charges.length > 0) {
        for (const charge of caseData.charges) {
          const sentences: Sentence[] = charge.sentence || [];

          if (sentences.length > 0) {
            for (const sentence of sentences) {
              chargesSheet.getRange(`A${chargeRow}:J${chargeRow}`).setValues([[
                personId,
                caseData.docketNo || "", charge.seqNo || "", charge.statute || "",
                charge.grade || "", charge.description || "", charge.disposition || "",
                sentence.sentenceDt || "", sentence.sentenceType || "", sentence.sentenceLen || ""
              ]]);
              chargeRow++;
            }
          } else {
            chargesSheet.getRange(`A${chargeRow}:J${chargeRow}`).setValues([[
              personId,
              caseData.docketNo || "", charge.seqNo || "", charge.statute || "",
              charge.grade || "", charge.description || "", charge.disposition || "",
              "", "", ""
            ]]);
            chargeRow++;
          }
        }
      }
    }
  }

  // Write Financial Info
  let financeRow = 2;
  for (const input of inputData) {
    const finance = financialDataByDocket.get(input.docketNum);
    if (finance) {
      financialSheet.getRange(`A${financeRow}:H${financeRow}`).setValues([[
        input.personId,
        input.docketNum,
        finance.zipcode || "",
        finance.balance || "",
        finance.assessment || "",
        finance.payments || "",
        finance.adjustments || "",
        finance.nonmonetary || ""
      ]]);
      financeRow++;
    }
  }

  // Write URLs
  let urlRow = 2;
  for (const input of inputData) {
    const urlData = urlDataByDocket.get(input.docketNum);
    if (urlData) {
      urlsSheet.getRange(`A${urlRow}:D${urlRow}`).setValues([[
        input.personId,
        input.docketNum,
        urlData.summaryUrl,
        urlData.docketUrl
      ]]);

      // Auto-wrap the URLs
      urlsSheet.getRange(`C${urlRow}:D${urlRow}`).getFormat().setWrapText(true);
      urlRow++;
    }
  }

  // Format sheets
  function formatSheet(sheet: ExcelScript.Worksheet, headerRange: string) {
    const header = sheet.getRange(headerRange);
    header.getFormat().getFont().setBold(true);
    header.getFormat().getFill().setColor("#DDEEFF"); // blue
    header.getFormat().getFont().setSize(16);
    sheet.getUsedRange().getFormat().getFont().setSize(16);
    sheet.getUsedRange().getFormat().autofitColumns();
  }

  formatSheet(personSheet, "A1:L1");
  formatSheet(casesSheet, "A1:L1");
  formatSheet(chargesSheet, "A1:J1");
  formatSheet(financialSheet, "A1:H1");
  formatSheet(urlsSheet, "A1:D1");

  console.log("✅ Done! Cases are grouped by Person ID, deduplicated, and sorted by priority and disposition date.");
}