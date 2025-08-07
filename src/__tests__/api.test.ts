import { it, describe, expect } from 'vitest';
import { config } from 'dotenv';

config();

describe('e2e', () =>{ 

    it('should work ', async () => { 
        // Pull docket Num from .env;
        const res = await fetch(process.env.API_ENDPOINT + '?docketNum=' + process.env.DOCKET_TEST, {
            headers: {
                'x-api-key': process.env.API_KEY!
            },
            method: 'GET',
        })
        console.dir(JSON.stringify(await res.json()), { depth: null });
        expect(res.status).toBe(200);
    }, { timeout: 90000 });
}) 