export function repairJson(jsonStr: string): string {
  let cleaned = jsonStr.trim();

  // Strip markdown code fences if present
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "");
    cleaned = cleaned.replace(/\n?```$/, "");
    cleaned = cleaned.trim();
  }

  // Quick try
  try {
    JSON.parse(cleaned);
    return cleaned;
  } catch (e) {
    // Continue repairing
  }

  // 1. Handle unterminated strings
  let inString = false;
  let isEscaped = false;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (char === "\\" && !isEscaped) {
      isEscaped = true;
      continue;
    }
    if (char === '"' && !isEscaped) {
      inString = !inString;
    }
    isEscaped = false;
  }

  if (inString) {
    cleaned += '"';
  }

  // 2. Remove trailing comma or dangling colon/key if any
  cleaned = cleaned.replace(/,\s*$/, "");

  // 3. Balance brackets
  const stack: string[] = [];
  inString = false;
  isEscaped = false;

  for (let i = 0; i < cleaned.length; i++) {
    const char = cleaned[i];
    if (char === "\\" && !isEscaped) {
      isEscaped = true;
      continue;
    }
    if (char === '"' && !isEscaped) {
      inString = !inString;
    }
    if (!inString) {
      if (char === "{" || char === "[") {
        stack.push(char);
      } else if (char === "}") {
        if (stack.length > 0 && stack[stack.length - 1] === "{") {
          stack.pop();
        }
      } else if (char === "]") {
        if (stack.length > 0 && stack[stack.length - 1] === "[") {
          stack.pop();
        }
      }
    }
    isEscaped = false;
  }

  while (stack.length > 0) {
    const openChar = stack.pop();
    cleaned = cleaned.replace(/,\s*$/, "");
    if (openChar === "{") {
      cleaned += "}";
    } else if (openChar === "[") {
      cleaned += "]";
    }
  }

  return cleaned;
}

export function safeParseJson<T = any>(jsonStr: string): T {
  let cleaned = jsonStr.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, "");
    cleaned = cleaned.replace(/\n?```$/, "");
    cleaned = cleaned.trim();
  }

  // 1. Direct parse attempt
  try {
    return JSON.parse(cleaned) as T;
  } catch (e) {
    // Continue
  }

  // 2. Attempt repaired parse
  const repaired = repairJson(cleaned);
  try {
    return JSON.parse(repaired) as T;
  } catch (e) {
    // Continue
  }

  // 3. Progressive fallback: trim back to the last valid completed object '}' or array item
  let lastObjIdx = cleaned.lastIndexOf("}");
  while (lastObjIdx > 0) {
    const truncated = cleaned.slice(0, lastObjIdx + 1);
    const repairedTruncated = repairJson(truncated);
    try {
      return JSON.parse(repairedTruncated) as T;
    } catch (e2) {
      lastObjIdx = cleaned.lastIndexOf("}", lastObjIdx - 1);
    }
  }

  throw new Error("Unable to parse or repair JSON response.");
}
