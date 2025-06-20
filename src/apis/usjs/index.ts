import { router } from '../../index.js';
import { validate } from '@phila/philaroute';
import { scrape } from './scrape.js';
import { serialize } from './serialize.js';

export enum USJSRoute { 
    Summary = '/usjs/v1/summary',
    Docket = '/usjs/v1/docket',
};


/** USJS Site Scraper pipelines 
 *  https://ujsportal.pacourts.us
*/
export const usjs = () => {     
    // Court Summary Retrieval and Parsing
    const summary = router.path(USJSRoute.Summary);

    summary.get([
        validate.parameters(['docketNum']),
        scrape.summary,
        serialize.summary
    ]);

}