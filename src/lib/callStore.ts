// Client-side helper for 100% local fast database storage

let lastNotifyTime = 0;

export function notifyCallUpdates() {
  const now = Date.now();
  if (now - lastNotifyTime < 1000) return;
  lastNotifyTime = now;

  if (typeof window !== "undefined" && "BroadcastChannel" in window) {
    try {
      const channel = new BroadcastChannel("call_updates");
      channel.postMessage({ type: "CALLS_UPDATED", timestamp: now });
      channel.close();
    } catch (e) {}
  }
}

export async function fetchAllCalls(forceRefresh: boolean = false) {
  if (!forceRefresh && typeof window !== "undefined") {
    try {
      const db = localStorage.getItem("all_calls_database") || localStorage.getItem("local_calls_cache");
      if (db) {
        const parsed = JSON.parse(db);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {}
  }

  try {
    const res = await fetch("/api/calls");
    if (res.ok) {
      const calls = await res.json();
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("all_calls_database", JSON.stringify(calls));
          localStorage.setItem("local_calls_cache", JSON.stringify(calls));
        } catch (e) {}
      }
      return calls;
    }
  } catch (err) {
    console.warn("API fetch error, using localStorage fallback:", err);
  }
  
  if (typeof window !== "undefined") {
    try {
      const db = localStorage.getItem("all_calls_database");
      if (db) return JSON.parse(db);
      const cached = localStorage.getItem("local_calls_cache");
      return cached ? JSON.parse(cached) : [];
    } catch (e) {}
  }
  return [];
}

export async function fetchCallById(id: string) {
  try {
    const res = await fetch(`/api/calls?id=${encodeURIComponent(id)}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn("API fetch error, using localStorage fallback:", err);
  }

  if (typeof window !== "undefined") {
    try {
      const cached = localStorage.getItem(`call_${id}`);
      return cached ? JSON.parse(cached) : null;
    } catch (e) {}
  }
  return null;
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

export async function saveCallRecord(callData: any) {
  // Always update localStorage first for 0.0001s instant UI update
  if (typeof window !== "undefined") {
    try {
      const safeData = { ...callData };
      if (safeData.transcript && Array.isArray(safeData.transcript)) {
        safeData.transcript = consolidateConsecutiveTurns(safeData.transcript).map((t: any) => ({
          ...t,
          words: undefined
        }));
      }
      localStorage.setItem(`call_${callData.id}`, JSON.stringify(safeData));
      localStorage.setItem("last_call_analysis", JSON.stringify(safeData));

      // Atomically update all_calls_database array in localStorage
      const dbStr = localStorage.getItem("all_calls_database") || "[]";
      let db: any[] = [];
      try { db = JSON.parse(dbStr); } catch (e) { db = []; }
      const idx = db.findIndex((c: any) => c.id === callData.id);
      if (idx >= 0) {
        db[idx] = { ...db[idx], ...safeData };
      } else {
        db.unshift(safeData);
      }
      localStorage.setItem("all_calls_database", JSON.stringify(db));
      localStorage.setItem("local_calls_cache", JSON.stringify(db));
    } catch (e) {}
  }

  // Persist full data to local JSON DB on disk
  try {
    const res = await fetch("/api/calls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(callData),
    });
    if (!res.ok) {
      console.warn("Save call record response not ok:", res.status);
    }
  } catch (err) {
    console.warn("Failed to save to local API DB (localStorage saved cleanly):", err);
  }

  try {
    notifyCallUpdates();
  } catch (e) {}
}

export async function deleteCallRecord(id: string) {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem(`call_${id}`);
      localStorage.removeItem(`history_stack_${id}`);
      const cachedStr = localStorage.getItem("all_calls_database");
      if (cachedStr) {
        const db = JSON.parse(cachedStr).filter((c: any) => c.id !== id);
        localStorage.setItem("all_calls_database", JSON.stringify(db));
        localStorage.setItem("local_calls_cache", JSON.stringify(db));
      }
      if (localStorage.getItem("active_call_id") === id) {
        localStorage.removeItem("active_call_id");
      }
      const lastCallStr = localStorage.getItem("last_call_analysis");
      if (lastCallStr) {
        try {
          const lastCall = JSON.parse(lastCallStr);
          if (lastCall.id === id) {
            localStorage.removeItem("last_call_analysis");
          }
        } catch(e) {}
      }
    } catch (e) {}
  }
  try {
    await fetch(`/api/calls?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  } catch (err) {}
  notifyCallUpdates();
}

export async function clearAllCallRecords() {
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem("last_call_analysis");
      localStorage.removeItem("all_calls_database");
      localStorage.removeItem("local_calls_cache");
      localStorage.removeItem("active_call_id");
    } catch (e) {}
  }
  try {
    await fetch("/api/calls?clearAll=true", { method: "DELETE" });
  } catch (err) {}
  notifyCallUpdates();
}
