import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "calls.json");

export interface CallRecord {
  id: string;
  agent?: string;
  customer?: string;
  date?: string;
  duration?: string;
  language?: string;
  status?: string;
  score?: number;
  audioUrl?: string;
  audioName?: string;
  audioSize?: string;
  transcript?: any[];
  overview?: any;
  categories?: any[];
  agentPerformance?: any;
  checklist?: any;
  createdAt?: number;
  updatedAt?: number;
  [key: string]: any;
}

function ensureDbExists() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), "utf8");
  }
}

export function consolidateConsecutiveTurns(transcript: any[]): any[] {
  if (!Array.isArray(transcript) || transcript.length === 0) return [];

  const consolidated: any[] = [];
  for (const turn of transcript) {
    if (!turn || typeof turn !== "object") continue;
    const speaker = turn.speaker || "Agent";
    const text = (turn.text || "").trim();
    if (!text) continue;

    if (consolidated.length === 0) {
      consolidated.push({
        ...turn,
        speaker,
        text,
        words: Array.isArray(turn.words) ? [...turn.words] : undefined
      });
    } else {
      const lastIndex = consolidated.length - 1;
      const lastTurn = consolidated[lastIndex];

      if (lastTurn.speaker === speaker) {
        // Merge consecutive dialogue lines for the same speaker!
        lastTurn.text = `${lastTurn.text} ${text}`.trim();
        if (Array.isArray(turn.words) && turn.words.length > 0) {
          if (!lastTurn.words) lastTurn.words = [];
          lastTurn.words = [...lastTurn.words, ...turn.words];
        }
      } else {
        consolidated.push({
          ...turn,
          speaker,
          text,
          words: Array.isArray(turn.words) ? [...turn.words] : undefined
        });
      }
    }
  }
  return consolidated;
}

export function getAllCalls(): CallRecord[] {
  try {
    ensureDbExists();
    const data = fs.readFileSync(DB_FILE, "utf8");
    const calls: CallRecord[] = JSON.parse(data || "[]");
    const consolidatedCalls = calls.map(call => {
      if (call.transcript && Array.isArray(call.transcript)) {
        return { ...call, transcript: consolidateConsecutiveTurns(call.transcript) };
      }
      return call;
    });
    return consolidatedCalls.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch (err) {
    console.error("Error reading local db calls.json:", err);
    return [];
  }
}

export function getCallById(id: string): CallRecord | null {
  const calls = getAllCalls();
  return calls.find((c) => c.id === id) || null;
}

export function saveCall(callData: CallRecord): CallRecord {
  ensureDbExists();
  const calls = getAllCalls();
  const index = calls.findIndex((c) => c.id === callData.id);

  const safeTranscript = callData.transcript && Array.isArray(callData.transcript) 
    ? consolidateConsecutiveTurns(callData.transcript)
    : callData.transcript;

  const updatedCall = {
    ...callData,
    transcript: safeTranscript,
    updatedAt: Date.now(),
    createdAt: callData.createdAt || (index >= 0 ? calls[index].createdAt : Date.now()),
  };

  if (index >= 0) {
    calls[index] = { ...calls[index], ...updatedCall };
  } else {
    calls.unshift(updatedCall);
  }

  fs.writeFileSync(DB_FILE, JSON.stringify(calls, null, 2), "utf8");
  return updatedCall;
}

export function deleteCall(id: string): boolean {
  ensureDbExists();
  let calls = getAllCalls();
  const initialLen = calls.length;
  calls = calls.filter((c) => c.id !== id);
  fs.writeFileSync(DB_FILE, JSON.stringify(calls, null, 2), "utf8");
  return calls.length < initialLen;
}

export function clearAllCalls(): boolean {
  ensureDbExists();
  fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), "utf8");
  return true;
}
