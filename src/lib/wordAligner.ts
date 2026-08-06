/**
 * High-Precision Word-Level Audio Alignment & Batch Splicing Engine
 */

export interface WordMetadata {
  word: string;
  start: number;
  end: number;
  speaker?: string;
}

/**
 * Ensures that a transcript line has precise word-level timestamps.
 * If words array is missing, interpolates timestamps proportionally.
 */
export function ensureWordTimestamps(
  item: { text: string; time: string; words?: WordMetadata[]; startSec?: number; endSec?: number },
  nextTurnTimeSec?: number
): WordMetadata[] {
  if (Array.isArray(item.words) && item.words.length > 0) {
    return item.words;
  }

  const text = (item.text || "").trim();
  if (!text) return [];

  const rawWords = text.split(/\s+/).filter(Boolean);
  if (rawWords.length === 0) return [];

  // Parse start time in seconds
  let startSec = item.startSec;
  if (typeof startSec !== "number") {
    const parts = (item.time || "00:00:00").split(":").map(Number);
    if (parts.length === 3) startSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) startSec = parts[0] * 60 + parts[1];
    else startSec = 0;
  }

  let endSec = item.endSec;
  if (typeof endSec !== "number" || endSec <= startSec) {
    const estimatedLen = Math.max(1.2, rawWords.length * 0.32);
    if (typeof nextTurnTimeSec === "number" && nextTurnTimeSec > startSec) {
      endSec = Math.min(nextTurnTimeSec, startSec + estimatedLen);
    } else {
      endSec = startSec + estimatedLen;
    }
  }

  const totalDuration = Math.max(0.4, endSec - startSec);
  const totalChars = rawWords.reduce((acc, w) => acc + w.length, 0);

  const wordMetas: WordMetadata[] = [];
  let currentStart = startSec;

  for (let i = 0; i < rawWords.length; i++) {
    const w = rawWords[i];
    const weight = totalChars > 0 ? w.length / totalChars : 1 / rawWords.length;
    const wordDuration = Math.max(0.12, totalDuration * weight);
    const wordEnd = i === rawWords.length - 1 ? endSec : Math.min(endSec, currentStart + wordDuration);

    wordMetas.push({
      word: w,
      start: Number(currentStart.toFixed(3)),
      end: Number(wordEnd.toFixed(3))
    });

    currentStart = wordEnd;
  }

  return wordMetas;
}

/**
 * Computes word alignment diff using Longest Common Subsequence (LCS).
 * Identifies kept words and exact [startSec, endSec] cut ranges of deleted words.
 */
export function diffWordsAndFindCutRanges(
  oldWords: WordMetadata[],
  newText: string
): { keptWords: WordMetadata[]; rangesToCut: Array<{ start: number; end: number }> } {
  const newRawWords = (newText || "").trim().split(/\s+/).filter(Boolean);

  if (newRawWords.length === 0) {
    // All words deleted -> cut entire turn duration
    if (oldWords.length > 0) {
      const start = oldWords[0].start;
      const end = oldWords[oldWords.length - 1].end;
      return { keptWords: [], rangesToCut: [{ start, end }] };
    }
    return { keptWords: [], rangesToCut: [] };
  }

  const clean = (s: string) => (s || "").toLowerCase().replace(/[^\w]/g, "");

  const m = oldWords.length;
  const n = newRawWords.length;

  // LCS Matrix DP table
  const dp = Array.from({ length: m + 1 }, () => new Int32Array(n + 1));

  for (let i = 1; i <= m; i++) {
    const oldClean = clean(oldWords[i - 1].word);
    for (let j = 1; j <= n; j++) {
      const newClean = clean(newRawWords[j - 1]);
      if (oldClean && newClean && (oldClean === newClean || oldClean.includes(newClean) || newClean.includes(oldClean))) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // Backtrack to build alignment
  let i = m;
  let j = n;
  const alignedOldIndexes = new Set<number>();
  const wordReplacements: Map<number, string> = new Map();

  while (i > 0 && j > 0) {
    const oldClean = clean(oldWords[i - 1].word);
    const newClean = clean(newRawWords[j - 1]);

    if (oldClean && newClean && (oldClean === newClean || oldClean.includes(newClean) || newClean.includes(oldClean))) {
      alignedOldIndexes.add(i - 1);
      wordReplacements.set(i - 1, newRawWords[j - 1]);
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }

  const keptWords: WordMetadata[] = [];
  const rangesToCut: Array<{ start: number; end: number }> = [];

  for (let idx = 0; idx < oldWords.length; idx++) {
    const w = oldWords[idx];
    if (alignedOldIndexes.has(idx)) {
      keptWords.push({
        ...w,
        word: wordReplacements.get(idx) || w.word
      });
    } else {
      if (typeof w.start === "number" && typeof w.end === "number" && w.end > w.start) {
        rangesToCut.push({ start: w.start, end: w.end });
      }
    }
  }

  return { keptWords, rangesToCut };
}

/**
 * Single-Pass Batch WebAudio Buffer Splicer with 10ms Cosine/Sine Crossfade.
 * Handles multiple cut ranges in a single pass to prevent timestamp drift.
 */
export function batchSpliceAudioBuffer(
  audioCtx: AudioContext,
  buffer: AudioBuffer,
  rangesToCut: Array<{ start: number; end: number }>
): AudioBuffer {
  if (!rangesToCut || rangesToCut.length === 0) return buffer;

  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const totalSamples = buffer.length;

  // 1. Sort cut ranges by startSec ascending
  const sorted = [...rangesToCut].sort((a, b) => a.start - b.start);

  // 2. Merge overlapping or adjacent cut ranges (within 30ms)
  const merged: Array<{ startSample: number; endSample: number }> = [];
  const gapThreshold = Math.floor(sampleRate * 0.03); // 30ms

  for (const r of sorted) {
    const startSample = Math.max(0, Math.floor(r.start * sampleRate));
    const endSample = Math.min(totalSamples, Math.ceil(r.end * sampleRate));
    if (endSample <= startSample) continue;

    if (merged.length === 0) {
      merged.push({ startSample, endSample });
    } else {
      const last = merged[merged.length - 1];
      if (startSample <= last.endSample + gapThreshold) {
        last.endSample = Math.max(last.endSample, endSample);
      } else {
        merged.push({ startSample, endSample });
      }
    }
  }

  if (merged.length === 0) return buffer;

  // 3. Calculate total cut samples
  let totalCutSamples = 0;
  for (const m of merged) {
    totalCutSamples += (m.endSample - m.startSample);
  }

  const newLength = totalSamples - totalCutSamples;
  if (newLength <= 0) return buffer;

  const trimmedBuffer = audioCtx.createBuffer(channels, newLength, sampleRate);

  // 10ms crossfade length (0.01s * sampleRate, max 480 samples)
  const fadeLength = Math.min(Math.floor(sampleRate * 0.01), 480);

  for (let ch = 0; ch < channels; ch++) {
    const oldData = buffer.getChannelData(ch);
    const newData = trimmedBuffer.getChannelData(ch);

    let readIndex = 0;
    let writeIndex = 0;

    for (const cut of merged) {
      // Copy kept section before cut
      const copyLen = cut.startSample - readIndex;
      if (copyLen > 0 && writeIndex < newLength) {
        const toCopy = Math.min(copyLen, newLength - writeIndex);
        newData.set(oldData.subarray(readIndex, readIndex + toCopy), writeIndex);

        // Apply Cosine Fade-Out to the last 10ms of the kept segment
        if (fadeLength > 0 && toCopy >= fadeLength) {
          const fadeStart = writeIndex + toCopy - fadeLength;
          for (let i = 0; i < fadeLength; i++) {
            const factor = Math.cos((i / fadeLength) * (Math.PI / 2));
            newData[fadeStart + i] *= factor;
          }
        }

        writeIndex += toCopy;
      }

      // Jump read index past cut
      readIndex = cut.endSample;
    }

    // Copy remaining kept section after last cut
    if (readIndex < totalSamples && writeIndex < newLength) {
      const remaining = Math.min(totalSamples - readIndex, newLength - writeIndex);
      const startWrite = writeIndex;
      newData.set(oldData.subarray(readIndex, readIndex + remaining), startWrite);

      // Apply Sine Fade-In to the first 10ms of the remaining segment
      if (fadeLength > 0 && remaining >= fadeLength) {
        for (let i = 0; i < fadeLength; i++) {
          const factor = Math.sin((i / fadeLength) * (Math.PI / 2));
          newData[startWrite + i] *= factor;
        }
      }
    }
  }

  return trimmedBuffer;
}
