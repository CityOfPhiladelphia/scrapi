# Adding and Registering a New API in Scrapi

This guide explains how to add a new API module to the Scrapi framework and register it so its routes are available via the main router.

---

## 1. Create Your API Directory

Inside `src/apis/`, create a new directory for your API.  
Example for an API called `myapi`:

```
src/apis/myapi/
```

---

## 2. Implement Your API Module

Create an `index.ts` file in your new API directory.  
Define your routes using the `router` and any middleware or handlers you need.
These all utilize the RestAccumulator type from the @phila/philaroute package. 

They can do anything you like, so long as they conform to the shape of: 
async (acc: RestAccumulator): Promise<RestAccumulator>.

That is, they should take an input of RestAccumulator and return a RestAccumulator. 

Generally this will mean you have a 'scraper' function and a parser. 

Pure functions using the @phila/philarouter framework are encouraged. 
Having a common interface and breaking them out as pure functions keeps them more orthogonal, easier to modify and easier to test against. 

**Example:**
Working Example: 
[USJS API](./usjs/index.ts)

Custom Example:
```typescript
// filepath: src/apis/myapi/index.ts
import { router } from '../../index.js';
import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts'

export enum MyApiRoute {
  Example = '/myapi/v1/example',
}

export const myapi = () => {
  const example = router.path(MyApiRoute.Example);

  example.get([
    // Example of a custom playwright function
    async (acc: RestAccumulator): Promise<RestAccumulator>  => {
      const result = myPlaywrightScript()
      acc.data.result ??= result;
      return acc;
    }
    // Example of a custom function
    async (acc: RestAccumulator): Promise<RestAccumulator> => {
      // Acc.data is now accessible to this next function

      acc.response.body = `Hello World! Here is ${JSON.stringify(acc.data)}`

      return acc;
    }
  ]);
};
```

---

## 3. Register Your API in the Main Router

Open `src/index.ts` and import your new API module.  
Call its registration function before exporting the handler.

**Example:**

```typescript
// filepath: src/index.ts
import { Router } from "@phila/philaroute";
import { usjs } from "./apis/usjs/index.js";
import { myapi } from "./apis/myapi/index.js"; // <-- Import your API

// Code defined outside the handler will run only on cold start
// and remain cached in memory
export const router = Router({
  cors: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Method': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }
});

// Register APIs
// Technically, you could just inline this here - 
// Having the registration external just keeps it more modular.
usjs();
myapi(); // <-- Register your API here

// Your Lambda handler 
export const main = async (event) => {
  return await router.routeToPath(event);
};
```

---

## 4.  Add Documentation

- Create a `Readme.md` in your API directory to document its endpoints and usage.
- Update the main project `Readme.md` to link to your new API.

---

## 5. Test Your API

- Run your project locally or deploy to your environment.
- Access your new endpoint (e.g., `/myapi/v1/example`) to verify it works.

---

**That's it!**  
You have added and registered a new API to the Scrapi framework.