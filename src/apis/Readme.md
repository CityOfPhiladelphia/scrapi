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

**Example:**

```typescript
// filepath: src/apis/myapi/index.ts
import { router } from '../../index.js';

export enum MyApiRoute {
  Example = '/myapi/v1/example',
}

export const myapi = () => {
  const example = router.path(MyApiRoute.Example);

  example.get([
    async (ctx) => {
      ctx.body = { message: 'Hello from MyAPI!' };
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

export const router = Router({
  cors: {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Method': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
  }
});

// Register APIs
usjs();
myapi(); // <-- Register your API here

export const main = async (event) => {
  return await router.routeToPath(event);
};
```

---

## 4. (Optional) Add Documentation

- Create a `Readme.md` in your API directory to document its endpoints and usage.
- Update the main project `Readme.md` to link to your new API.

---

## 5. Test Your API

- Run your project locally or deploy to your environment.
- Access your new endpoint (e.g., `/myapi/v1/example`) to verify it works.

---

**That's it!**  
You have added and registered a new API to the Scrapi framework.