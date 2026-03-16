/** Main entry point - re-exports serialize functions */
import { summary } from './serialize/summary.js';
import { docket } from './serialize/docket.js';
import { personSearch } from './serialize/person-search.js';

export const serialize = {
  summary,
  docket,
  personSearch
};
