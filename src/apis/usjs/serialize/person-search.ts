import type { RestAccumulator } from '@phila/philaroute/dist/types.d.ts';

/** Person search serializer - returns structured case data */
export const personSearch = async (acc: RestAccumulator): Promise<RestAccumulator> => {
  console.log('📋 Serializing person search results...');
  
  // Get the search results from the internal field
  const searchData = acc.data._personSearchData;
  
  if (!searchData) {
    throw new Error('No person search results found in accumulator');
  }
  
  // Create final response with totalCount
  acc.data.response = {
    searchCriteria: searchData.searchCriteria,
    foundCases: searchData.foundCases,
    totalCount: searchData.foundCases.length
  };
  
  console.log(`✅ Serialized ${searchData.foundCases.length} cases for person search`);
  
  return acc;
};