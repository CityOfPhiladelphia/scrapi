# USJS API Excel Office Script Integration

### Getting Started

1. **Download the Script**
   - Navigate to [`scripts/CourtDataExcelScript.ts`](../scripts/CourtDataExcelScript.ts)
   - Copy the entire file content

2. **Set Up Excel Online**
   - Open Excel Online (office.com)
   - Create a new blank workbook
   - In column A, starting at A2, enter the docket numbers you want to search
   - Go to **Automate** → **New Script**
   - Delete the default code and paste the `CourtDataExcelScript.ts` content
   - Save the script with a name like "Court Data Scraper"

3. **Add a Button (Optional)**
   - Go to **Automate** → **Button**
   - Select your saved script
   - Choose a button style and position
   - The button will appear on your worksheet for easy one-click execution

4. **Run the Script**
   - Click **Run** in the script editor, or
   - Click your custom button if you created one
   - The script will process all docket numbers and create multiple worksheets with organized data

### Data Output Structure

The script creates **5 worksheets** with the following data:

| Worksheet | Description | Key Columns |
|-----------|-------------|-------------|
| **Person Info** | Defendant personal details | Name (parsed), Address, DOB, Physical descriptors, Aliases |
| **Cases** | Case-level information | Docket No, Status, OTN, Arrest/Disposition dates, Judge, Attorney |
| **Charges** | Individual charges and sentences | Statute, Grade, Description, Disposition, Sentence details |
| **Financial Info** | Court costs and payments | Zip Code, Balance, Assessments, Payments, Adjustments |
| **Links** | Document access | Court Summary URLs, Docket Sheet URLs, Raw JSON API links |

#### Person Info Sheet
- **Columns**: Docket Searched, First Name, Middle, Last Name, Address, DOB, Race, Sex, Eyes, Hair, Aliases
- **Purpose**: Demographic and identifying information for each defendant
- **Features**: Automatic name parsing (handles "Last, First" and "First Last" formats)

#### Cases Sheet  
- **Columns**: Docket No, Status, DC No, OTN, Arrest Date, Disp Date, Judge, Defense Atty, Num Charges, Original Docket
- **Purpose**: High-level case information and processing status
- **Features**: Charge count summary, cross-reference to searched docket number

#### Charges Sheet
- **Columns**: Docket No, Seq, Statute, Grade, Description, Disposition, Sentence Date, Sentence Type, Sentence Length
- **Purpose**: Detailed breakdown of each criminal charge and associated sentences
- **Features**: Multiple rows per case if multiple charges/sentences exist

#### Financial Info Sheet
- **Columns**: Docket No, Zip Code, Balance, Assessment, Payments, Adjustments, Non-Monetary
- **Purpose**: Court costs, fines, and payment history
- **Features**: Current balance calculations and payment tracking

#### Links Sheet
- **Columns**: Docket No, Court Summary URL, Docket Sheet URL
- **Row 2**: Clickable "Summary" and "Docket" links to court documents
- **Row 3**: "View Raw JSON" links to API endpoints for debugging
- **Purpose**: Direct access to source court documents and raw API data

### Features

✅ **Automatic Error Handling**: Continues processing if individual docket lookups fail  
✅ **Rate Limiting**: Built-in 150ms delay between requests to avoid overwhelming the court system  
✅ **Professional Formatting**: Auto-sized columns, colored headers, blue hyperlinks  
✅ **Data Validation**: Handles missing or malformed court data gracefully  
✅ **Performance Optimized**: Moved error handling outside loops for better Excel performance  

### API Endpoints

The script connects to these live endpoints:

- **Summary API**: `https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/summary`
- **Docket API**: `https://ocyjm4kh1i.execute-api.us-east-1.amazonaws.com/prod/usjs/v1/docket`

### Troubleshooting

**Common Issues:**
- **"Cannot find namespace 'ExcelScript'"**: This is normal - ignore these errors when copying code
- **Script runs but no data**: Check that docket numbers are in the correct format (e.g., "CP-51-CR-0001234-2023")
- **Timeout errors**: UPDATE

**Performance Tips:**
- Ensure stable internet connection for court system access
- Run during off-peak hours for faster court system response

### Data Sources

All data is scraped from the Pennsylvania Unified Judicial System Web Portal using automated browser technology (Playwright). The API respects court system rate limits and includes appropriate delays between requests.

---

*For technical details about the underlying API architecture, see the main project README.*