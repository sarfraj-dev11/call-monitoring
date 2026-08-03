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
export const PSEUDO_NAME_VARIANTS: Record<string, string[]> = {
  "Adam Miller": [
    "atom miller",
    "attam miller",
    "addam miller",
    "adam millar",
    "adam miler",
    "atom miler",
    "addam miler",
    "adam muller",
    "adam",
    "atom",
    "addam",
  ],
  "David Scotts": [
    "david scott",
    "dave scotts",
    "dave scott",
    "david scots",
    "dave scots",
    "david skotts",
    "david skott",
    "david", // Defaults to David Scotts
    "dave",
  ],
  "Mike Ross": [
    "mike rose",
    "michael ross",
    "michael rose",
    "mike ros",
    "mikey ross",
    "mike",
    "michael",
    "mikey",
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
    "cassey",
    "casey",
    "kasey",
    "cassie",
    "cassy",
    "kassie",
  ],
  "Mark Anderson": [
    "marc anderson",
    "mark andersen",
    "marc andersen",
    "marck anderson",
    "mark",
    "marc",
    "marck",
  ],
  "John Woods": [
    "jon woods",
    "john wood",
    "jon wood",
    "john woodes",
    "jon woodes",
    "john",
    "jon",
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
    "suzzane",
    "suzanne",
    "suzan",
    "susan",
    "suzann",
    "suzy",
  ],
  "Jared McAnn": [
    "jared mccann",
    "jarred mcann",
    "jared mccan",
    "jared macann",
    "jarod mcann",
    "jarred mccann",
    "jared",
    "jarred",
    "jarod",
  ],
  "David White": [
    "david wight",
    "david whyte",
    "dave whyte",
    // Note: "david" and "dave" map to David Scotts above.
  ],
  "Ron Williams": [
    "ron william",
    "ronald williams",
    "ronald william",
    "ron wiliams",
    "ron wilson",
    "ron",
    "ronald",
  ],
  "Richard Johnson": [
    "rich johnson",
    "richie johnson",
    "rick johnson",
    "richard jonson",
    "richard johnsen",
    "richard",
    "rich",
    "richie",
    "rick",
  ],
  "Eva Wilson": [
    "ava wilson",
    "eva willson",
    "eve wilson",
    "eva",
    "ava",
    "eve",
  ],
  "Nathan Brown": [
    "nate brown",
    "nathan browne",
    "nate browne",
    "nathan",
    "nate",
  ],
  "Jenny White": [
    "jennie white",
    "jenney white",
    "jenny whyte",
    "jenni white",
    "jenny",
    "jennie",
    "jenney",
    "jenni",
  ],
  "George Anthony": [
    "george antony",
    "jorge anthony",
    "georg anthony",
    "george antoni",
    "george",
    "jorge",
    "georg",
  ],
  "Lisa Johnson": [
    "liza johnson",
    "lisa jonson",
    "liza jonson",
    "leeza johnson",
    "lisa johnsen",
    "lisa",
    "liza",
    "leeza",
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

  // 1. Normalize company name variations to official "Brocus IT Solutions"
  const companyPatterns: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /\b(?:brorker|broker|brok|brook|broken|boke)\s+(?:cite|site|city|society|secutity)\s*(?:solutions?|solution)?\b/gi, replacement: "Brocus IT Solutions" },
    { pattern: /\b(?:repple|reple|triple|riple|ripple)\s*(?:society)?\s*(?:solutions?|solution)?\b/gi, replacement: "Brocus IT Solutions" },
    { pattern: /\b(?:brocus|brokus|brocas|brokuss|broker)\s+(?:IT|it)\s*(?:solutions?|solution)?\b/gi, replacement: "Brocus IT Solutions" },
    { pattern: /\b(?:brocus|brokus|brocas)\s*(?:solutions?|solution)?\b/gi, replacement: "Brocus IT Solutions" },
  ];

  for (const item of companyPatterns) {
    correctedText = correctedText.replace(item.pattern, item.replacement);
  }

  // 2. Replace variants using word boundaries
  for (const [officialName, variants] of Object.entries(PSEUDO_NAME_VARIANTS)) {
    for (const variant of variants) {
      // Escape special regex characters in variant
      const escapedVariant = variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escapedVariant}\\b`, "gi");
      correctedText = correctedText.replace(regex, officialName);
    }
  }

  // 3. Also fix case variations of official names if transcribed in lowercase or unusual casing
  for (const officialName of OFFICIAL_PSEUDO_NAMES) {
    const escapedName = officialName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\b${escapedName}\\b`, "gi");
    correctedText = correctedText.replace(regex, officialName);
  }

  return correctedText;
}

/**
 * Finds the official pseudo name that has the "most letters matching" 
 * the transcribed text, checking against all phonetic variants and first names.
 */
export function findBestMatchingAgentName(text: string): string {
  const lowerText = text.toLowerCase();
  let bestName = "Adam Miller";
  let maxScore = 0;

  for (const officialName of OFFICIAL_PSEUDO_NAMES) {
    let currentMaxScore = 0;
    const variantsToCheck = [officialName.toLowerCase(), ...(PSEUDO_NAME_VARIANTS[officialName] || [])];
    
    for (const variant of variantsToCheck) {
      if (lowerText.includes(variant)) {
         currentMaxScore = Math.max(currentMaxScore, variant.length * 2); // Exact variant match = high score
      } else {
         // Substring match for partial matches
         const parts = variant.split(' ');
         let partScore = 0;
         for (const part of parts) {
           if (part.length > 2 && lowerText.includes(part)) {
             partScore += part.length;
           }
         }
         currentMaxScore = Math.max(currentMaxScore, partScore);
      }
    }
    
    if (currentMaxScore > maxScore) {
      maxScore = currentMaxScore;
      bestName = officialName;
    }
  }

  return bestName;
}
