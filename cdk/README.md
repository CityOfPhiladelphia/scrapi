# CDK Deployment Guide

This project uses [AWS CDK](https://docs.aws.amazon.com/cdk/v2/guide/home.html) (Cloud Development Kit) to define and deploy its AWS infrastructure. The stack provisions all resources needed to run the Scrapi API in a serverless environment.

---

## Stack Constructs

The CDK stack (`ScrapiStack`) provisions the following AWS resources:

- **Lambda Function**  
  - Runs the Scrapi API code.
  - Uses the Node.js 22.x runtime.
  - Allocated 2048 MB memory and 3 minutes timeout.
  - Includes a Lambda Layer for Chromium (for Playwright browser automation).
  - Bundles and deploys the code from `src/dist/scrapi.zip`.

- **API Gateway (REST API)**  
  - Proxies all HTTP requests to the Lambda function.
  - Configured with a usage plan and API key for access control.

- **API Key & Usage Plan**  
  - An API key is generated and attached to a usage plan.
  - The usage plan is associated with the deployed API stage.

- **CloudFormation Outputs**  
  - The deployed API Gateway URL.
  - The generated API key.

---

## Deployment Steps

### 1. Install Dependencies

From the `cdk` directory:

```sh
npm install
```

### 2. Build the CDK Project

```sh
npm run build
```

### 3. Deploy the Stack

You can deploy to different AWS profiles using the provided scripts:

- **Deploy to Sandbox:**
  ```sh
  npm run deploy:sandbox
  ```
- **Deploy to Personal:**
  ```sh
  npm run deploy:personal
  ```

> These scripts use the `--require-approval never` flag for non-interactive deployments.

### 4. Destroy the Stack

To remove all resources created by the stack:

```sh
npm run destroy
```

---

## Outputs

After deployment, the following outputs will be displayed:

- **ApiUrl:** The base URL of your deployed API Gateway.
- **APIKey:** The API key required for accessing the API.

---

## Notes

- The stack automatically builds and packages the application code from the `src` directory before deployment.
- The Lambda function is configured to run Chromium via a public Lambda Layer for browser-based scraping.
- All API routes are proxied through API Gateway to the Lambda handler.

---

For more details, see the CDK stack definition in  
[`cdk/lib/scrapi-stack.ts`](./lib/scrapi-stack.ts).