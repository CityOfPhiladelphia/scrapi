# USJS API 
## [usjs site](https://ujsportal.pacourts.us)


## `GET /usjs/v1/summary`

**Description:**  
Retrieves and parses a court summary from the Pennsylvania Unified Judicial System portal, given a docket number. 

### **Request**

- **Method:** `GET`
- **Query Parameters:**
  - `docketNum` (string, required): The docket number to retrieve the summary for.

**Example Request:**
```
GET /usjs/v1/summary?docketNum=MC-51-CR-1234567-2023
Headers: 'x-api-key': 'yourapikeyhere'
```

### **Response**

- **Status:** `200 OK`
- **Content-Type:** `application/json`
- **Body:**  
  Returns a JSON object representing the parsed court summary.

**Example Response:**
```json
{
  "docketNum": "MC-51-CR-1234567-2023",
  "defendant": {
    "name": "Jane Doe",
    "dob": "1990-01-01"
  },
  "charges": [
    {
      "statute": "18 § 2701",
      "description": "Simple Assault",
      "grade": "M2"
    }
  ],
  "status": "Active",
  "summary": "..."
}
```

