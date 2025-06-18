import { validate, Router } from '@phila/philaroute';
import { serialize } from '@apis/usjs/serialize.js';
import { scrape } from "@apis/usjs/scrape.js";


export const router = Router({
    cors: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Method': 'GET, OPTIONS',
        'Access-Control-Max-Age': '86400',
    }
});



export enum USJSRoute { 
    Summary = 'usjs/v1/summary',
    Docket = 'usjs/v1/docket',
};

/** USJS Site Scraper pipelines */

// Court Summary Retrieval and Parsing
const summary = router.path(USJSRoute.Summary);


summary.get([
    validate.parameters(['docketNum']),
    scrape.summary,
    serialize.summary
]);



// Docket Retrieval and Parsing