import { Router } from "@phila/philaroute";
import { usjs } from "./apis/usjs/index.js";
import type { APIGWV1Payload } from "@phila/philaroute/dist/aws.d.ts";

/** Establish router outside handler  */
export const router = Router({
    cors: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Method': 'GET, OPTIONS',
        'Access-Control-Max-Age': '86400',
    }
});

/** Register Routes */
usjs();

export const main = async (event: APIGWV1Payload) => {
    console.log("Event received:", event);
    return await router.routeToPath(event);
} 