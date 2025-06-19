import type { APIGWV1Payload } from "@phila/philaroute/dist/aws.d.ts";
import { router } from "./router.js";

export const main = async (event: APIGWV1Payload) => {
    console.log("Event received:", event);
    return await router.routeToPath(event);
} 