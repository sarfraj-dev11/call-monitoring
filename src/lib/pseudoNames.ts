export const OFFICIAL_PSEUDO_NAMES: string[] = [
  "Adam Miller",
  "David Scotts",
  "Mike Ross",
  "Cassey Jones",
  "Mark Anderson",
  "John Woods",
  "Suzzane Daves",
  "Jared McAnn",
  "David White",
  "Ron Williams",
  "Richard Johnson",
  "Eva Wilson",
  "Nathan Brown",
  "Jenny White",
  "George Anthony",
  "Lisa Johnson",
];

// Mapping of common speech-to-text (STT) phonetic misrecognitions / variants to official pseudo names
const PSEUDO_NAME_VARIANTS: Record<string, string[]> = {
  "Adam Miller": [
    "atom miller",
    "attam miller",
    "addam miller",
    "adam millar",
    "adam miler",
    "atom miler",
    "addam miler",
    "adam muller",
  ],
  "David Scotts": [
    "david scott",
    "dave scotts",
    "dave scott",
    "david scots",
    "dave scots",
    "david skotts",
    "david skott",
  ],
  "Mike Ross": [
    "mike rose",
    "michael ross",
    "michael rose",
    "mike ros",
    "mikey ross",
  ],
  "Cassey Jones": [
    "casey jones",
    "kasey jones",
    "cassie jones",
    "cassy jones",
    "kassie jones",
    "kc jones",
    "casee jones",
    "cassey jonas",
  ],
  "Mark Anderson": [
    "marc anderson",
    "mark andersen",
    "marc andersen",
    "marck anderson",
  ],
  "John Woods": [
    "jon woods",
    "john wood",
    "jon wood",
    "john woodes",
    "jon woodes",
  ],
  "Suzzane Daves": [
    "suzanne daves",
    "suzanne davis",
    "suzzane davis",
    "suzan daves",
    "susan daves",
    "susan davis",
    "suzann daves",
    "suzy daves",
    "suzanne dave",
  ],
  "Jared McAnn": [
    "jared mccann",
    "jarred mcann",
    "jared mccan",
    "jared macann",
    "jarod mcann",
    "jarred mccann",
  ],
  "David White": [
    "dave white",
    "david wight",
    "david whyte",
    "dave whyte",
  ],
  "Ron Williams": [
    "ron william",
    "ronald williams",
    "ronald william",
    "ron wiliams",
    "ron wilson",
  ],
  "Richard Johnson": [
    "rich johnson",
    "richie johnson",
    "rick johnson",
    "richard jonson",
    "richard johnsen",
  ],
  "Eva Wilson": [
    "ava wilson",
    "eva willson",
    "eve wilson",
  ],
  "Nathan Brown": [
    "nate brown",
    "nathan browne",
    "nate browne",
  ],
  "Jenny White": [
    "jennie white",
    "jenney white",
    "jenny whyte",
    "jenni white",
  ],
  "George Anthony": [
    "george antony",
    "jorge anthony",
    "georg anthony",
    "george antoni",
  ],
  "Lisa Johnson": [
    "liza johnson",
    "lisa jonson",
    "liza jonson",
    "leeza johnson",
    "lisa johnsen",
  ],
};

/**
 * Normalizes an extracted agent name to match an official pseudo name from the list.
 * If the input name is a known phonetic variation or partial match, it returns the official pseudo name.
 */
export function normalizeAgentName(rawName: string): string {
  if (!rawName || typeof rawName !== "string") {
    return OFFICIAL_PSEUDO_NAMES[0]; // Default to "Adam Miller"
  }

  const cleanName = rawName.trim();
  const lowerInput = cleanName.toLowerCase();

  // 1. Direct case-insensitive match against official pseudo names
  for (const officialName of OFFICIAL_PSEUDO_NAMES) {
    if (officialName.toLowerCase() === lowerInput) {
      return officialName;
    }
  }

  // 2. Match against defined STT phonetic variants
  for (const [officialName, variants] of Object.entries(PSEUDO_NAME_VARIANTS)) {
    for (const variant of variants) {
      if (variant === lowerInput) {
        return officialName;
      }
    }
  }

  // 3. Substring / first name + last name fuzzy matching
  for (const officialName of OFFICIAL_PSEUDO_NAMES) {
    const [firstName, lastName] = officialName.toLowerCase().split(" ");
    if (lowerInput.includes(firstName) && (lowerInput.includes(lastName) || lowerInput.includes(lastName.replace(/s$/, "")))) {
      return officialName;
    }
  }

  // 4. Variant substring matching
  for (const [officialName, variants] of Object.entries(PSEUDO_NAME_VARIANTS)) {
    for (const variant of variants) {
      if (lowerInput.includes(variant)) {
        return officialName;
      }
    }
  }

  // Return cleanName if no match found
  return cleanName;
}

/**
 * Scans dialogue text and replaces any misheard/misrecognized pseudo name variants
 * with their corresponding official pseudo name.
 */
export function replacePseudoNamesInText(text: string): string {
  if (!text || typeof text !== "string") return text;

  let correctedText = text;

  // Replace variants using word boundaries
  for (const [officialName, variants] of Object.entries(PSEUDO_NAME_VARIANTS)) {
    for (const variant of variants) {
      // Escape special regex characters in variant
      const escapedVariant = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escapedVariant}\\b`, "gi");
      correctedText = correctedText.replace(regex, officialName);
    }
  }

  // Also fix case variations of official names if transcribed in lowercase or unusual casing
  for (const officialName of OFFICIAL_PSEUDO_NAMES) {
    const escapedName = officialName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escapedName}\\b`, "gi");
    correctedText = correctedText.replace(regex, officialName);
  }

  return correctedText;
}
