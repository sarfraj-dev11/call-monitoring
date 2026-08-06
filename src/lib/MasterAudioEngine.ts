/**
 * MasterAudioEngine.ts
 * Enterprise-Grade High-Precision Audio Splicing, Word-Level Alignment,
 * Crossfade Engine & State Synchronization Framework for Call Monitor AI
 */

export interface WordMetadata {
  word: string;
  start: number;
  end: number;
  speaker?: string;
}

export interface TranscriptItem {
  time: string;
  speaker: string;
  text: string;
  words?: WordMetadata[];
}

export interface CutRange {
  start: number;
  end: number;
}

export interface ClipboardPayload {
  audioBufferSlice: AudioBuffer | null;
  durationSec: number;
  transcriptSlice: Array<{
    speaker: string;
    text: string;
    relativeStart: number;
    relativeEnd: number;
    words?: WordMetadata[];
  }>;
}

export interface HistoryFrame {
  transcript: TranscriptItem[];
  audioBuffer: AudioBuffer | null;
  deletedRanges: CutRange[];
  durationSec: number;
  audioSrc?: string;
}

// 1. CONSOLIDATE CONSECUTIVE SPEAKER TURNS (Strict Customer -> Agent -> Customer alternation)
export function consolidateConsecutiveTurns(transcript: TranscriptItem[]): TranscriptItem[] {
  if (!Array.isArray(transcript) || transcript.length === 0) return [];

  const consolidated: TranscriptItem[] = [];
  for (const turn of transcript) {
    if (!turn || typeof turn !== "object") continue;
    const speaker = (turn.speaker || "Agent").trim();
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
      const lastTurn = consolidated[consolidated.length - 1];

      if (lastTurn.speaker.toLowerCase() === speaker.toLowerCase()) {
        // Merge consecutive same-speaker turns into a single dialogue block!
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

// 2. SAMPLE-EXACT AUDIO BUFFER SPLICING WITH 10ms COSINE/SINE CROSSFADE
export function batchSpliceAudioBuffer(
  audioCtx: AudioContext,
  buffer: AudioBuffer,
  rangesToCut: CutRange[]
): AudioBuffer {
  if (!rangesToCut || rangesToCut.length === 0) return buffer;

  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const totalSamples = buffer.length;

  const sorted = [...rangesToCut].sort((a, b) => a.start - b.start);
  const merged: Array<{ startSample: number; endSample: number }> = [];
  const gapThreshold = Math.floor(sampleRate * 0.03); // 30ms gap threshold

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

  let totalCutSamples = 0;
  for (const m of merged) {
    totalCutSamples += (m.endSample - m.startSample);
  }

  const newLength = totalSamples - totalCutSamples;
  if (newLength <= 0) return buffer;

  const trimmedBuffer = audioCtx.createBuffer(channels, newLength, sampleRate);
  const fadeLength = Math.min(Math.floor(sampleRate * 0.01), 480); // 10ms crossfade

  for (let ch = 0; ch < channels; ch++) {
    const oldData = buffer.getChannelData(ch);
    const newData = trimmedBuffer.getChannelData(ch);

    let readIndex = 0;
    let writeIndex = 0;

    for (const cut of merged) {
      const copyLen = cut.startSample - readIndex;
      if (copyLen > 0 && writeIndex < newLength) {
        const toCopy = Math.min(copyLen, newLength - writeIndex);
        newData.set(oldData.subarray(readIndex, readIndex + toCopy), writeIndex);

        if (fadeLength > 0 && toCopy >= fadeLength) {
          const fadeStart = writeIndex + toCopy - fadeLength;
          for (let i = 0; i < fadeLength; i++) {
            const factor = Math.cos((i / fadeLength) * (Math.PI / 2));
            newData[fadeStart + i] *= factor;
          }
        }
        writeIndex += toCopy;
      }
      readIndex = cut.endSample;
    }

    if (readIndex < totalSamples && writeIndex < newLength) {
      const remaining = Math.min(totalSamples - readIndex, newLength - writeIndex);
      const startWrite = writeIndex;
      newData.set(oldData.subarray(readIndex, readIndex + remaining), startWrite);

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

// 3. SAMPLE-EXACT AUDIO BUFFER INSERTION WITH CROSSFADE
export function insertAudioBufferWithCrossfade(
  audioCtx: AudioContext,
  mainBuffer: AudioBuffer,
  insertBuffer: AudioBuffer,
  insertTimeSec: number
): AudioBuffer {
  const sampleRate = mainBuffer.sampleRate;
  const channels = mainBuffer.numberOfChannels;
  const totalSamples = mainBuffer.length;
  const insertSamples = insertBuffer.length;

  const insertStartSample = Math.max(0, Math.min(totalSamples, Math.floor(insertTimeSec * sampleRate)));
  const newTotalSamples = totalSamples + insertSamples;

  const newBuffer = audioCtx.createBuffer(channels, newTotalSamples, sampleRate);
  const fadeLength = Math.min(Math.floor(sampleRate * 0.01), 480);

  for (let ch = 0; ch < channels; ch++) {
    const mainData = mainBuffer.getChannelData(ch);
    const insertData = insertBuffer.getChannelData(Math.min(ch, insertBuffer.numberOfChannels - 1));
    const newData = newBuffer.getChannelData(ch);

    // 1. Copy main audio before insertion point
    if (insertStartSample > 0) {
      newData.set(mainData.subarray(0, insertStartSample), 0);
      if (fadeLength > 0 && insertStartSample >= fadeLength) {
        const fadeStart = insertStartSample - fadeLength;
        for (let i = 0; i < fadeLength; i++) {
          const factor = Math.cos((i / fadeLength) * (Math.PI / 2));
          newData[fadeStart + i] *= factor;
        }
      }
    }

    // 2. Copy inserted audio
    const insertDestStart = insertStartSample;
    newData.set(insertData, insertDestStart);
    if (fadeLength > 0 && insertSamples >= fadeLength) {
      for (let i = 0; i < fadeLength; i++) {
        const factor = Math.sin((i / fadeLength) * (Math.PI / 2));
        newData[insertDestStart + i] *= factor;
      }
      const fadeStart = insertDestStart + insertSamples - fadeLength;
      for (let i = 0; i < fadeLength; i++) {
        const factor = Math.cos((i / fadeLength) * (Math.PI / 2));
        newData[fadeStart + i] *= factor;
      }
    }

    // 3. Copy main audio after insertion point
    if (insertStartSample < totalSamples) {
      const remainingSamples = totalSamples - insertStartSample;
      const postInsertDestStart = insertStartSample + insertSamples;
      newData.set(mainData.subarray(insertStartSample, totalSamples), postInsertDestStart);

      if (fadeLength > 0 && remainingSamples >= fadeLength) {
        for (let i = 0; i < fadeLength; i++) {
          const factor = Math.sin((i / fadeLength) * (Math.PI / 2));
          newData[postInsertDestStart + i] *= factor;
        }
      }
    }
  }

  return newBuffer;
}

// 4. SLICE AUDIO BUFFER FOR COPY/CUT
export function sliceAudioBuffer(
  audioCtx: AudioContext,
  buffer: AudioBuffer,
  startSec: number,
  endSec: number
): AudioBuffer {
  const sampleRate = buffer.sampleRate;
  const channels = buffer.numberOfChannels;
  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(buffer.length, Math.ceil(endSec * sampleRate));
  const frameCount = Math.max(1, endSample - startSample);

  const sliced = audioCtx.createBuffer(channels, frameCount, sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const fromData = buffer.getChannelData(ch);
    const toData = sliced.getChannelData(ch);
    toData.set(fromData.subarray(startSample, endSample), 0);
  }
  return sliced;
}

// 5. CLONE AUDIO BUFFER IMMUTABLY FOR UNDO/REDO HISTORY SNAPSHOTS
export function cloneAudioBuffer(audioCtx: AudioContext, buffer: AudioBuffer): AudioBuffer {
  const clone = audioCtx.createBuffer(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    clone.getChannelData(ch).set(buffer.getChannelData(ch));
  }
  return clone;
}

// 6. GENERATE NORMALIZED FLOAT32 PEAK SAMPLES (100 PEAKS / SEC)
export function generatePeaksForBuffer(buffer: AudioBuffer): Float32Array {
  const PEAKS_PER_SEC = 100;
  const totalPeaks = Math.max(100, Math.floor(buffer.duration * PEAKS_PER_SEC));
  const peaks = new Float32Array(totalPeaks);
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const samplesPerPeak = sampleRate / PEAKS_PER_SEC;

  for (let i = 0; i < totalPeaks; i++) {
    const startSample = Math.floor(i * samplesPerPeak);
    const endSample = Math.min(channelData.length, Math.floor((i + 1) * samplesPerPeak));
    let max = 0;
    for (let j = startSample; j < endSample; j++) {
      const val = Math.abs(channelData[j]);
      if (val > max) max = val;
    }
    peaks[i] = Math.max(0.04, max);
  }
  return peaks;
}

// 7. CONVERT AUDIO BUFFER TO WAV BLOB
export function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;

  const dataLength = buffer.length * blockAlign;
  const headerLength = 44;
  const totalLength = headerLength + dataLength;

  const arrayBuffer = new ArrayBuffer(totalLength);
  const view = new DataView(arrayBuffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, totalLength - 8, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, format, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeString(36, "data");
  view.setUint32(40, dataLength, true);

  let offset = 44;
  const channelData = [];
  for (let i = 0; i < numChannels; i++) {
    channelData.push(buffer.getChannelData(i));
  }

  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      let sample = channelData[ch][i];
      sample = Math.max(-1, Math.min(1, sample));
      const intSample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, intSample, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

// 8. ATOMIC TRANSCRIPT TIMELINE REMAPPER AFTER AUDIO CUT / DELETE
export function remapWordsAndTranscriptAfterCut(
  transcript: TranscriptItem[],
  cutStart: number,
  cutEnd: number
): TranscriptItem[] {
  if (!Array.isArray(transcript) || transcript.length === 0) return [];
  if (cutEnd <= cutStart) return transcript;

  const duration = cutEnd - cutStart;

  const updatedTranscript = transcript.map((item) => {
    let lineStartSec = 0;
    try {
      const parts = (item.time || "00:00:00").split(":");
      if (parts.length === 3) {
        lineStartSec = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
      } else if (parts.length === 2) {
        lineStartSec = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
      }
    } catch (e) {}

    let wordsMeta = item.words;
    if (!wordsMeta || !Array.isArray(wordsMeta) || wordsMeta.length === 0) {
      const textWords = (item.text || "").split(/\s+/).filter(Boolean);
      const estDuration = Math.max(0.5, textWords.length * 0.35);
      const wordLen = estDuration / (textWords.length || 1);
      wordsMeta = textWords.map((word: string, i: number) => ({
        word,
        start: lineStartSec + i * wordLen,
        end: lineStartSec + (i + 1) * wordLen
      }));
    }

    const keptWords: WordMetadata[] = [];
    for (const w of wordsMeta) {
      const wStart = Number(w.start) || 0;
      const wEnd = Number(w.end) || (wStart + 0.3);

      if (wStart >= cutStart && wEnd <= cutEnd) continue;
      if (wStart >= cutStart && wStart < cutEnd) continue;
      if (wEnd > cutStart && wEnd <= cutEnd) continue;

      if (wStart >= cutEnd) {
        keptWords.push({
          ...w,
          start: Math.max(0, wStart - duration),
          end: Math.max(0, wEnd - duration)
        });
      } else if (wEnd <= cutStart) {
        keptWords.push(w);
      } else if (wStart < cutStart && wEnd > cutStart) {
        keptWords.push({
          ...w,
          start: wStart,
          end: cutStart
        });
      }
    }

    if (keptWords.length === 0) return null;

    const newText = keptWords.map(w => (w.word || "").trim()).join(" ").trim();
    if (!newText) return null;

    const firstWordStart = keptWords[0].start;
    const hrs = Math.floor(firstWordStart / 3600);
    const mins = Math.floor((firstWordStart % 3600) / 60);
    const secs = Math.floor(firstWordStart % 60);
    const newTime = `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;

    return {
      ...item,
      text: newText,
      time: newTime,
      words: keptWords
    };
  }).filter(Boolean) as TranscriptItem[];

  return consolidateConsecutiveTurns(updatedTranscript);
}
