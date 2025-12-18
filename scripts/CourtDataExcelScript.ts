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

// Validation function for docket numbers
function validateDocketNumber(docketNum: string): { isValid: boolean; errorMessage?: string } {
  // Check for empty or whitespace-only strings
  if (!docketNum || docketNum.trim().length === 0) {
    return {
      isValid: false,
      errorMessage: `Docket number cannot be empty. Please enter a docket number.`
    };
  }

  // Basic check: contains letters, numbers, and dashes (more permissive)
  const basicPattern = /^[A-Z0-9\-]+$/i;
  
  if (!basicPattern.test(docketNum)) {
    return {
      isValid: false,
      errorMessage: `Invalid docket format: '${docketNum}'. Must contain only letters, numbers, and dashes.`
    };
  }

  // Check minimum length
  if (docketNum.length < 5) {
    return {
      isValid: false,
      errorMessage: `Docket number '${docketNum}' is too short. Must be at least 5 characters.`
    };
  }

  return { isValid: true };
}

async function main(workbook: ExcelScript.Workbook) {
  const apiSummaryUrl = "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/summary";
  const apiDocketUrl = "https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/docket";

  const inputSheet = workbook.getActiveWorksheet();
  const docketNums = inputSheet.getRange("A2:A100").getValues();

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
  personSheet.getRange("A1:K1").setValues([[
    "Docket Searched", "First Name", "Middle", "Last Name", "Address", "DOB", "Race", "Sex", "Eyes", "Hair", "Aliases"
  ]]);

  casesSheet.getRange("A1:J1").setValues([[
    "Docket No", "Status", "DC No", "OTN", "Arrest Date", "Disp Date", "Judge", "Defense Atty", "Num Charges", "Original Docket"
  ]]);

  chargesSheet.getRange("A1:I1").setValues([[
    "Docket No", "Seq", "Statute", "Grade", "Description", "Disposition", "Sentence Date", "Sentence Type", "Sentence Length"
  ]]);

  financialSheet.getRange("A1:G1").setValues([[
    "Docket No", "Zip Code", "Balance", "Assessment", "Payments", "Adjustments", "Non-Monetary"
  ]]);

  urlsSheet.getRange("A1:C1").setValues([[
    "Docket No", "Court Summary URL", "Docket Sheet URL"
  ]]);

  let personRow = 2;
  let caseRow = 2;
  let chargeRow = 2;
  let financeRow = 2;
  let urlRow = 2

  // Store JSON data for the first docket number
  let firstDocketSummaryJson = '';
  let firstDocketFinanceJson = '';

  // Process all docket numbers with error handling outside the loop
  async function processDocketNumber(docketNum: string): Promise<void> {
    try {
      // Fetch summary data
      const response = await fetch(`${apiSummaryUrl}?docketNum=${encodeURIComponent(docketNum)}`, {
        method: 'GET'
      });

      if (!response.ok) return;

      const data: ApiResponse = await response.json();

      // Store JSON for first docket number
      const isFirstDocket = String(docketNums[0][0]) === docketNum;
      if (isFirstDocket) {
        firstDocketSummaryJson = JSON.stringify(data, null, 2);
      }

      // Person Info
      if (data.person) {
        const p = data.person;
        personSheet.getRange(`A${personRow}:K${personRow}`).setValues([[
          docketNum,
          p.firstName || "", p.middleName || "", p.lastName || "",
          p.address || "", p.dob || "",
          p.race || "", p.sex || "", p.eyes || "", p.hair || "",
          (p.aliases || []).join("; ")
        ]]);
        // Set DOB column (F) to mm/dd/yyyy format for this row
        personSheet.getRange(`F${personRow}`).setNumberFormatLocal("mm/dd/yyyy");
        personRow++;
      }

      // Cases & Charges
      if (data.cases && data.cases.length > 0) {
        for (const c of data.cases) {
          casesSheet.getRange(`A${caseRow}:J${caseRow}`).setValues([[
            c.docketNo || "", c.procStatus || "", c.dcNo || "",
            c.otn || "", c.arrestDt || "", c.dispDt || "",
            c.dispJudge || "", c.defenseAtty || "",
            (c.charges || []).length, docketNum
          ]]);

          if (c.charges && c.charges.length > 0) {
            for (const ch of c.charges) {
              const sentences: Sentence[] = ch.sentence || [];

              if (sentences.length > 0) {
                for (const s of sentences) {
                  chargesSheet.getRange(`A${chargeRow}:I${chargeRow}`).setValues([[
                    c.docketNo || "", ch.seqNo || "", ch.statute || "",
                    ch.grade || "", ch.description || "", ch.disposition || "",
                    s.sentenceDt || "", s.sentenceType || "", s.sentenceLen || ""
                  ]]);
                  chargeRow++;
                }
              } else {
                chargesSheet.getRange(`A${chargeRow}:I${chargeRow}`).setValues([[
                  c.docketNo || "", ch.seqNo || "", ch.statute || "",
                  ch.grade || "", ch.description || "", ch.disposition || "",
                  "", "", ""
                ]]);
                chargeRow++;
              }
            }
          }
          caseRow++;
        }
      }

      // Fetch financial data - nested error handling moved inside
      const financeRes = await fetch(`${apiDocketUrl}?docketNum=${encodeURIComponent(docketNum)}`, {
        method: 'GET'
      });

      if (financeRes.ok) {
        const finance: FinancialResponse = await financeRes.json();
        
        // Store financial JSON for first docket number
        if (isFirstDocket) {
          firstDocketFinanceJson = JSON.stringify(finance, null, 2);
        }
        
        financialSheet.getRange(`A${financeRow}:G${financeRow}`).setValues([[
          docketNum,
          finance.zipcode || "",
          finance.balance || "",
          finance.assessment || "",
          finance.payments || "",
          finance.adjustments || "",
          finance.nonmonetary || ""
        ]]);
        financeRow++;

        //Fetch Links// seperate mapping
        if (data.summaryUrl) {
          urlsSheet.getRange(`A${urlRow}:C${urlRow}`).setValues([[
            docketNum,
            data.summaryUrl || "",
            finance.docketUrl || ""
          ]]);

          //Auto-wrap the URLs
          urlsSheet.getRange(`B${urlRow}:C${urlRow}`).getFormat().setWrapText(true);

          urlRow++;
        }
      }

      await new Promise(resolve => setTimeout(resolve, 150)); // throttle

    } catch (error: unknown) {
      console.log(`Processing failed for ${docketNum}: ${error}`);
    }
  }

  // Process all docket numbers with validation
  for (let i = 0; i < docketNums.length; i++) {
    const docketNum = docketNums[i][0];
    if (!docketNum) continue;

    const docketString = String(docketNum);
    const validation = validateDocketNumber(docketString);
    
    if (!validation.isValid) {
      console.log(`❌ Validation Error: ${validation.errorMessage}`);
      // Add error to person sheet for visibility
      personSheet.getRange(`A${personRow}:K${personRow}`).setValues([[
        docketString,
        `ERROR: ${validation.errorMessage}`,
        "", "", "", "", "", "", "", "", ""
      ]]);
      personRow++;
      continue; // Skip processing this docket number
    }

    await processDocketNumber(docketString);
  }

  function formatSheet(sheet: ExcelScript.Worksheet, headerRange: string) {
    const header = sheet.getRange(headerRange);
    header.getFormat().getFont().setBold(true);
    header.getFormat().getFill().setColor("#DDEEFF");//blue
    header.getFormat().getFont().setSize(16); // Set font size
    sheet.getUsedRange().getFormat().getFont().setSize(16); // Set font size
    sheet.getUsedRange().getFormat().autofitColumns();
  }

  formatSheet(personSheet, "A1:K1");
  formatSheet(casesSheet, "A1:J1");
  formatSheet(chargesSheet, "A1:I1");
  formatSheet(financialSheet, "A1:G1");
  formatSheet(urlsSheet, "A1:C1");

  // Format original Summary/Docket hyperlinks in B2 & C2
  const urlRange = urlsSheet.getRange("B2:C2");
  const values = urlRange.getValues();
  const summaryUrl = String(values[0][0]);
  const docketUrl = String(values[0][1]);

  if (summaryUrl && summaryUrl !== "") {
    urlRange.getCell(0, 0).setHyperlink({
      address: summaryUrl,
      textToDisplay: "Summary"
    });
  }

  if (docketUrl && docketUrl !== "") {
    urlRange.getCell(0, 1).setHyperlink({
      address: docketUrl,
      textToDisplay: "Docket"
    });
  }

  urlRange.getFormat().getFont().setSize(16);
  urlRange.getFormat().getFont().setColor("Blue");
  urlRange.getFormat().getFont().setUnderline(ExcelScript.RangeUnderlineStyle.single);

  // Add raw JSON hyperlinks to B3 and C3
  const firstDocketNum = String(docketNums[0][0]); // Get first docket number for raw JSON links

  if (firstDocketNum) {
    // Create raw JSON API URLs
    const rawSummaryUrl = `${apiSummaryUrl}?docketNum=${encodeURIComponent(firstDocketNum)}`;
    const rawDocketUrl = `${apiDocketUrl}?docketNum=${encodeURIComponent(firstDocketNum)}`;

    // Set hyperlinks in B3 and C3
    const summaryJsonCell = urlsSheet.getRange("B3");
    const docketJsonCell = urlsSheet.getRange("C3");

    summaryJsonCell.setHyperlink({
      address: rawSummaryUrl,
      textToDisplay: "View Raw JSON"
    });

    docketJsonCell.setHyperlink({
      address: rawDocketUrl,
      textToDisplay: "View Raw JSON"
    });

    // Format the raw JSON links
    const rawJsonRange = urlsSheet.getRange("B3:C3");
    rawJsonRange.getFormat().getFont().setSize(16);
    rawJsonRange.getFormat().getFont().setColor("Blue");
    rawJsonRange.getFormat().getFont().setUnderline(ExcelScript.RangeUnderlineStyle.single);

    // Add full JSON strings to B4 and C4
    const jsonDataRange = urlsSheet.getRange("B4:C4");
    jsonDataRange.setValues([[
      firstDocketSummaryJson,
      firstDocketFinanceJson
    ]]);
    
    // Format the JSON data cells
    jsonDataRange.getFormat().setWrapText(true);
    jsonDataRange.getFormat().getFont().setSize(10);
    jsonDataRange.getFormat().getFont().setName("Courier New"); // Monospace font for JSON
    jsonDataRange.getFormat().setVerticalAlignment(ExcelScript.VerticalAlignment.top);
    
    // Triple the width of column B (Summary column) and make column C standard width
    const summaryColumn = urlsSheet.getRange("B:B");
    const docketColumn = urlsSheet.getRange("C:C");
    
    // Set specific column widths - triple width for summary column
    summaryColumn.getFormat().setColumnWidth(300); // Triple width for summary
    docketColumn.getFormat().setColumnWidth(100);   // Standard width for docket
    
    // Make B4 cell much taller to show full JSON
    const summaryJsonDataCell = urlsSheet.getRange("B4");
    summaryJsonDataCell.getFormat().setRowHeight(400); // Increased height for JSON display
    
    // Auto-fit row height for other rows
    urlsSheet.getUsedRange().getFormat().autofitRows();
  }

  console.log("✅ Done!");
}