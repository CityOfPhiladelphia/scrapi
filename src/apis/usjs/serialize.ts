/** Main entry point - re-exports serialize functions */
import { summary } from './serialize/summary.js';
import { docket } from './serialize/docket.js';

export const serialize = {
  summary,
  docket
};
