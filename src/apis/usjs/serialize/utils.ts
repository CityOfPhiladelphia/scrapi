/** Pure parsing utility functions */
import type { KVMatch } from '../types.js';

/** Name parsing utility function */
export function parseName(fullName: string): [string, string, string] {
  // Empty or null
  if (!fullName || !fullName.trim()) {
    console.warn("parseName: Empty or null name provided");
    return ["", "", ""];
  }

  // Case 1: format like "Last, First M."
  if (fullName.includes(",")) {
    const [lastPart, rest] = fullName.split(",", 2).map(s => s.trim());
    const parts = rest.split(" ").filter(part => Boolean(part));
    const first = parts[0] || "";
    const middle = (parts[1] || "").replace(/\./g, ""); // strip periods
    return [first, middle, lastPart];
  }

  // Case 2: Format like "First Middle Last"
  const parts = fullName.split(" ").filter(Boolean);
  switch (parts.length) {
    case 1: {
      const [last] = parts;
      return ["", "", last];
    }
    case 2: {
      const [first, last] = parts;
      return [first, "", last];
    }
    case 3: {
      const [first, middle, last] = parts;
      return [first, middle.replace(/\./g, ""), last];
    }
    default: {
      // Unrecognized format: preserve original
      return ["", "", fullName];
    }
  }
}

/** Extract value from line using regex key-value pattern */
export const keyValueMatch = ({ line, regex }: KVMatch): string => {
  const match = line.match(regex);

  if (match && match[1]) return match[1].replaceAll('|', '').trim();
  return '';
};
