# Scrapi
Scrapi is a framework for exposing a REST API interface for legacy systems that do not natively provide one. It leverages browser automation (via Playwright) to interact with web-based systems, scrape data on demand, and present it through a modern, documented API. This approach enables integration, automation, and data access for systems that are otherwise inaccessible to programmatic workflows.

This should be combined with low or no code automation tools to empower non-technical business owners to be able to own and change their own business logic with less reliance on technical support. 

User web automation is necessarily brittle; pick your use cases wisely!

## Key Features
* ### REST API for Legacy Systems:
Exposes endpoints for systems that lack modern APIs, enabling integration with new applications and services.

* #### Browser Automation:
Uses Playwright to automate interactions with web interfaces, simulating user actions to retrieve data.

* #### Extensible Routing:
Built on [@phila/philaroute](https://www.npmjs.com/package/@phila/philaroute) for flexible route definitions and middleware support.

* #### AWS Lambda Ready:
Designed for serverless deployment, with handlers compatible with AWS API Gateway and Lambda.

### Project Structure
*  index.ts — Main entry point, router setup, Lambda handler.
*  usjs — Example API for the Pennsylvania Unified Judicial System.
*  scrape.ts — Playwright-based scraping logic.
*  serialize.ts — Data transformation and response formatting.

## Current API's 
* [USJS](./src/apis/usjs/Readme.md)

## Getting Started: 
### Deployment:
* [CDK Documentation](./cdk/README.md)
* [Adding an API](./src/apis/Readme.md)