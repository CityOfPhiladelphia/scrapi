import { describe, it, expect } from 'vitest';
import { main } from '../index.js';
import { scrape } from '../apis/usjs/scrape.js'
import { USJSRoute } from '../apis/usjs/index.js';
import { serialize } from '../apis/usjs/serialize.js';
import { RestAccumulator } from '@phila/philaroute/dist/types.js';
import { config } from 'dotenv';

describe.skip('e2e vs deployed endpoint', () => { 

    it('Should return 200', async () => { 
        const res = await fetch(process.env.API_ENDPOINT + '?docketNum=' + process.env.DOCKET_TEST, { 
            headers: {
                'x-api-key': process.env.API_KEY!
            }
        });
        console.dir(res.statusText)

        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toBeDefined();
        console.dir(data);
    }, { timeout: 90000 })
})

describe.skip('Local', () => { 
    it('should run', async () => { 
        const result = await main({
            httpMethod: 'GET',
            path: USJSRoute.Summary,
            queryStringParameters: {
                docketNum: process.env.DOCKET_TEST
            }
        } as any);

        console.dir(result);
        expect(result).toBeDefined();

        });
    })


    describe('Scape test', () => { 

        it('should run', async () => { 
            const result = await scrape.docket({ 
                data: {
                    valid: {
                        parameters: {
                            docketNum: process.env.DOCKET_TEST
                        }
                        }
                    },
                    response: {}
                });

            console.dir(result.response.body);
            expect(result).toBeDefined();
            }, { timeout: 90000 })

        it('should Serialize', async () => { 
            const result = await serialize.docket({ response: {} } as RestAccumulator);
            console.dir(result.response.body);
            expect(result).toBeDefined();
        })
        })

