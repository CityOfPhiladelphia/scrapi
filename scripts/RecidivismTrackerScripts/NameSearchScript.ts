// NameSearchScript.ts - Search by name and DOB, generate links tab
// Based on New_UJS_scriptV4.ts structure and styling

// API Response Types (matching existing working code structure)
interface Person {
    firstName?: string;
    lastName?: string;
    dob?: string;
    race?: string;
    sex?: string;
}

interface Case {
    docketNumber?: string;
    otn?: string;
    filingDate?: string;
    status?: string;
    summaryUrl?: string;
    docketUrl?: string;
}

interface PersonSearchResult {
    searchCriteria: {
        firstName: string;
        lastName: string;
        dob: string;
    };
    foundCases: Case[];
    totalCount: number;
}

interface PersonSearchResponse {
    valid?: unknown;
    _personSearchData?: unknown;
    response: PersonSearchResult;
}

// Input validation function for names
function validateName(name: string, fieldName: string): { isValid: boolean; errorMessage?: string } {
    if (!name || name.trim().length === 0) {
        return {
            isValid: false,
            errorMessage: `${fieldName} cannot be empty. Please enter a ${fieldName.toLowerCase()}.`
        };
    }

    const namePattern = /^[a-zA-Z\s'-]+$/;
    if (!namePattern.test(name)) {
        return {
            isValid: false,
            errorMessage: `Invalid ${fieldName.toLowerCase()} format: '${name}'. Only letters, spaces, hyphens, and apostrophes are allowed.`
        };
    }

    if (name.length < 2) {
        return {
            isValid: false,
            errorMessage: `${fieldName} '${name}' is too short. Must be at least 2 characters.`
        };
    }

    return { isValid: true };
}

// Input validation function for date of birth
function validateDateOfBirth(dob: string): { isValid: boolean; errorMessage?: string } {
    if (!dob || dob.trim().length === 0) {
        return {
            isValid: false,
            errorMessage: `Date of birth cannot be empty. Please enter a date in MM/DD/YYYY format.`
        };
    }

    const datePattern = /^\d{1,2}\/\d{1,2}\/\d{4}$/;
    if (!datePattern.test(dob)) {
        return {
            isValid: false,
            errorMessage: `Invalid date format: '${dob}'. Please use MM/DD/YYYY format (e.g., 01/15/1990).`
        };
    }

    const dateParts = dob.split('/');
    const month = parseInt(dateParts[0]);
    const day = parseInt(dateParts[1]);
    const year = parseInt(dateParts[2]);

    if (month < 1 || month > 12) {
        return {
            isValid: false,
            errorMessage: `Invalid month: ${month}. Month must be between 1 and 12.`
        };
    }

    if (day < 1 || day > 31) {
        return {
            isValid: false,
            errorMessage: `Invalid day: ${day}. Day must be between 1 and 31.`
        };
    }

    if (year < 1900 || year > new Date().getFullYear()) {
        return {
            isValid: false,
            errorMessage: `Invalid year: ${year}. Year must be between 1900 and ${new Date().getFullYear()}.`
        };
    }

    return { isValid: true };
}

// Remove common name suffixes for better matching
function removeSuffixes(name: string): string {
    const suffixes = ['Jr', 'Sr', 'II', 'III', 'IV', 'V'];
    let cleanName = name.trim();

    for (const suffix of suffixes) {
        const patterns = [
            new RegExp(`\\s+${suffix}\\.?$`, 'i'),     // " Jr" or " Jr."
            new RegExp(`\\s*,\\s*${suffix}\\.?$`, 'i') // ", Jr" or ", Jr."
        ];

        for (const pattern of patterns) {
            if (pattern.test(cleanName)) {
                cleanName = cleanName.replace(pattern, '');
                break;
            }
        }
    }

    return cleanName.trim();
}

// Convert date from MM/DD/YYYY to YYYY-MM-DD for API
function convertDateFormat(mmddyyyy: string): string {
    const parts = mmddyyyy.split('/');
    const month = parts[0].padStart(2, '0');
    const day = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
}

async function main(workbook: ExcelScript.Workbook) {
    console.log(`NameSearchScript started at ${new Date().toLocaleTimeString()}`);

    const apiPersonUrl = "https://xpyab0tpx5.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/person";

   
    // Prepare input sheet with name/DOB input form
    const inputSheet = workbook.getActiveWorksheet();
    inputSheet.setName("Input");

    // Set font size 16 for input area
    inputSheet.getRange("C:E").getFormat().getFont().setSize(16);

    // Create table headers in row 3
    inputSheet.getRange("C3:E3").setValues([["First Name", "Last Name", "Date of Birth (MM/DD/YYYY)"]]);
    inputSheet.getRange("C3:E3").getFormat().getFont().setBold(true);
    inputSheet.getRange("C3:E3").getFormat().getFill().setColor("#DDEEFF"); // Light blue for header

    // Highlight input cells in yellow
    inputSheet.getRange("C4:E4").getFormat().getFill().setColor("#FFFFCC"); // Yellow for input

    // Add borders to table
    inputSheet.getRange("C3:E4").getFormat().getRangeBorder(ExcelScript.BorderIndex.edgeTop).setStyle(ExcelScript.BorderLineStyle.continuous);
    inputSheet.getRange("C3:E4").getFormat().getRangeBorder(ExcelScript.BorderIndex.edgeBottom).setStyle(ExcelScript.BorderLineStyle.continuous);
    inputSheet.getRange("C3:E4").getFormat().getRangeBorder(ExcelScript.BorderIndex.edgeLeft).setStyle(ExcelScript.BorderLineStyle.continuous);
    inputSheet.getRange("C3:E4").getFormat().getRangeBorder(ExcelScript.BorderIndex.edgeRight).setStyle(ExcelScript.BorderLineStyle.continuous);
    inputSheet.getRange("C3:E4").getFormat().getRangeBorder(ExcelScript.BorderIndex.insideHorizontal).setStyle(ExcelScript.BorderLineStyle.continuous);
    inputSheet.getRange("C3:E4").getFormat().getRangeBorder(ExcelScript.BorderIndex.insideVertical).setStyle(ExcelScript.BorderLineStyle.continuous);

    // Auto-fit columns
    inputSheet.getRange("C3:E4").getFormat().autofitColumns();

    // Read input values from row 4
    const firstNameValue = String(inputSheet.getRange("C4").getValue()).trim();
    const lastNameValue = String(inputSheet.getRange("D4").getValue()).trim();

    // Handle date input - could be a serial number or string
    const dobRawValue = inputSheet.getRange("E4").getValue();
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

    // Debug logging to see what we're reading
    console.log(`Debug - First Name: "${firstNameValue}" (length: ${firstNameValue.length})`);
    console.log(`Debug - Last Name: "${lastNameValue}" (length: ${lastNameValue.length})`);
    console.log(`Debug - DOB Raw: ${dobRawValue}, Converted: "${dobValue}" (length: ${dobValue.length})`);

    // Validate inputs
    if (!firstNameValue || !lastNameValue || !dobValue) {
        console.log("✅ Input table is ready. Please enter data in row 4:");
        console.log("   - First Name in cell C4");
        console.log("   - Last Name in cell D4");
        console.log("   - Date of Birth in cell E4 (MM/DD/YYYY format)");
        console.log("   Or paste tab-separated values: FirstName[TAB]LastName[TAB]MM/DD/YYYY");
        console.log("Then run the script again.");
        return;
    }

    // Validate first name
    const firstNameValid = validateName(firstNameValue, "First Name");
    if (!firstNameValid.isValid) {
        inputSheet.getRange("C4").getFormat().getFill().setColor("#FFE6E6"); // Pale red
        console.log(`❌ ${firstNameValid.errorMessage}`);
        return;
    }

    // Validate last name
    const lastNameValid = validateName(lastNameValue, "Last Name");
    if (!lastNameValid.isValid) {
        inputSheet.getRange("D4").getFormat().getFill().setColor("#FFE6E6"); // Pale red
        console.log(`❌ ${lastNameValid.errorMessage}`);
        return;
    }

    // Validate date of birth
    const dobValid = validateDateOfBirth(dobValue);
    if (!dobValid.isValid) {
        inputSheet.getRange("E4").getFormat().getFill().setColor("#FFE6E6"); // Pale red
        console.log(`❌ ${dobValid.errorMessage}`);
        return;
    }

    // Clear any previous error highlighting
    inputSheet.getRange("C4").getFormat().getFill().clear();
    inputSheet.getRange("D4").getFormat().getFill().clear();
    inputSheet.getRange("E4").getFormat().getFill().clear();

    // Clean names by removing suffixes
    const cleanFirstName = removeSuffixes(firstNameValue);
    const cleanLastName = removeSuffixes(lastNameValue);

    console.log(`Searching for: ${cleanFirstName} ${cleanLastName}, DOB: ${dobValue}`);
    if (cleanFirstName !== firstNameValue || cleanLastName !== lastNameValue) {
        console.log(`Cleaned names: ${cleanFirstName} ${cleanLastName} (removed suffixes)`);
    }

    try {
        // Convert date format for API (MM/DD/YYYY to YYYY-MM-DD)
        const apiDateFormat = convertDateFormat(dobValue);

        // Build the person search URL
        const personSearchUrl = `${apiPersonUrl}?firstName=${encodeURIComponent(cleanFirstName)}&lastName=${encodeURIComponent(cleanLastName)}&dob=${encodeURIComponent(apiDateFormat)}`;
        console.log(`Person Search URL: ${personSearchUrl}`);

        // Call person search API
        const personResponse = await fetch(personSearchUrl, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!personResponse.ok) {
            console.log(`❌ Person search failed: ${personResponse.status} ${personResponse.statusText}`);
            return;
        }

        const apiResponse: PersonSearchResponse = await personResponse.json();

        console.log(`API Response:`, JSON.stringify(apiResponse, null, 2));

        if (!apiResponse.response?.foundCases || apiResponse.response.foundCases.length === 0) {
            console.log("No cases found for the specified person.");

            // Create empty Links tab to show no results
            let linksSheet = workbook.getWorksheet("Links") || workbook.addWorksheet("Links");
            linksSheet.getRange("A:Z").clear();

            // Header table
            linksSheet.getRange("A1:C1").setValues([["Name", "Date of Birth", "Records Found"]]);
            linksSheet.getRange("A1:C1").getFormat().getFont().setBold(true);
            linksSheet.getRange("A1:C1").getFormat().getFill().setColor("#DDEEFF"); // Blue header
            linksSheet.getRange("A1:C1").getFormat().getFont().setSize(16);

            linksSheet.getRange("A2:C2").setValues([[`${firstNameValue} ${lastNameValue}`, dobValue, 0]]);
            linksSheet.getRange("A2:C2").getFormat().getFill().setColor("#FFFFCC"); // Yellow value row
            linksSheet.getRange("A2:C2").getFormat().getFont().setSize(16);

            linksSheet.getRange("A4").setValue("No records found for this person.");
            linksSheet.getRange("A4").getFormat().getFont().setItalic(true);
            linksSheet.getRange("A4").getFormat().getFont().setSize(16);

            linksSheet.getUsedRange().getFormat().autofitColumns();
            return;
        }

        // Use totalCount from API response
        const totalRecords = apiResponse.response.totalCount;
        const personData = apiResponse.response;
        console.log(`Found ${totalRecords} total records with ${personData.foundCases.length} cases returned.`);

        // Create or get Links sheet
        let linksSheet = workbook.getWorksheet("Links") || workbook.addWorksheet("Links");
        linksSheet.getRange("A:Z").clear();

        // Header table with search info
        linksSheet.getRange("A1:C1").setValues([["Name", "Date of Birth", "Records Found"]]);
        linksSheet.getRange("A1:C1").getFormat().getFont().setBold(true);
        linksSheet.getRange("A1:C1").getFormat().getFill().setColor("#DDEEFF"); // Blue header
        linksSheet.getRange("A1:C1").getFormat().getFont().setSize(16);

        linksSheet.getRange("A2:C2").setValues([[`${firstNameValue} ${lastNameValue}`, dobValue, totalRecords]]);
        linksSheet.getRange("A2:C2").getFormat().getFill().setColor("#FFFFCC"); // Yellow value row
        linksSheet.getRange("A2:C2").getFormat().getFont().setSize(16);

        // Dockets table headers
        linksSheet.getRange("A4:E4").setValues([["Docket Number", "Filing Date", "OTN", "Docket", "Court Summary"]]);
        linksSheet.getRange("A4:E4").getFormat().getFont().setBold(true);
        linksSheet.getRange("A4:E4").getFormat().getFill().setColor("#DDEEFF"); // Blue header
        linksSheet.getRange("A4:E4").getFormat().getFont().setSize(16);

        // Populate docket data
        let docketRow = 5;
        for (const caseItem of personData.foundCases) {
            const docketNumber = caseItem.docketNumber || "";
            const filingDate = caseItem.filingDate || "";

            // Truncate OTN to 8 characters if longer (removes claim number)
            let otn = caseItem.otn || "N/A";
            if (otn !== "N/A" && otn.length > 8) {
                otn = otn.substring(0, 8);
            }

            // Set basic info
            linksSheet.getRange(`A${docketRow}:C${docketRow}`).setValues([[docketNumber, filingDate, otn]]);

            // Add Docket link
            if (caseItem.docketUrl) {
                linksSheet.getRange(`D${docketRow}`).setHyperlink({
                    address: caseItem.docketUrl,
                    textToDisplay: "Docket PDF"
                });
                linksSheet.getRange(`D${docketRow}`).getFormat().getFont().setColor("#0066CC");
                linksSheet.getRange(`D${docketRow}`).getFormat().getFont().setUnderline(ExcelScript.RangeUnderlineStyle.single);
            } else {
                linksSheet.getRange(`D${docketRow}`).setValue("Not Available");
                linksSheet.getRange(`D${docketRow}`).getFormat().getFont().setColor("#999999");
            }

            // Add Court Summary link
            if (caseItem.summaryUrl) {
                linksSheet.getRange(`E${docketRow}`).setHyperlink({
                    address: caseItem.summaryUrl,
                    textToDisplay: "Summary PDF"
                });
                linksSheet.getRange(`E${docketRow}`).getFormat().getFont().setColor("#0066CC");
                linksSheet.getRange(`E${docketRow}`).getFormat().getFont().setUnderline(ExcelScript.RangeUnderlineStyle.single);
            } else {
                linksSheet.getRange(`E${docketRow}`).setValue("Not Available");
                linksSheet.getRange(`E${docketRow}`).getFormat().getFont().setColor("#999999");
            }

            // Set row font size
            linksSheet.getRange(`A${docketRow}:E${docketRow}`).getFormat().getFont().setSize(14);

            docketRow++;
        }

        // Auto-fit columns and final formatting
        linksSheet.getUsedRange().getFormat().autofitColumns();

        console.log(`✅ Links tab created with ${personData.foundCases.length} case records.`);
        console.log(`Completed at ${new Date().toLocaleTimeString()}`);

        // Switch to Links tab
        workbook.getWorksheet("Links").activate();

    } catch (error) {
        console.log(`❌ Error during search: ${error}`);
    }
}