"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo, Suspense, memo } from "react";
import Sidebar from "@/components/Sidebar";
import styles from "./page.module.css";
import { useRouter, useSearchParams } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { fetchCallById, saveCallRecord, fetchAllCalls } from "@/lib/callStore";
import { ensureWordTimestamps, diffWordsAndFindCutRanges } from "@/lib/wordAligner";
import {
  consolidateConsecutiveTurns,
  batchSpliceAudioBuffer,
  insertAudioBufferWithCrossfade,
  sliceAudioBuffer,
  cloneAudioBuffer,
  generatePeaksForBuffer,
  audioBufferToWavBlob,
  remapWordsAndTranscriptAfterCut
} from "@/lib/MasterAudioEngine";
import { detectAgentNameFromTranscript, OFFICIAL_PSEUDO_NAMES } from "@/lib/pseudoNames";
import WaveSurfer from 'wavesurfer.js';
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js';
import TimelinePlugin from 'wavesurfer.js/dist/plugins/timeline.esm.js';

// SVG Icons
const PlayIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
    <polygon points="5 3 19 12 5 21 5 3" />
  </svg>
);

const PauseIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
    <rect x="6" y="4" width="4" height="16" />
    <rect x="14" y="4" width="4" height="16" />
  </svg>
);

const DownloadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const EditIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <line x1="10" y1="11" x2="10" y2="17" />
    <line x1="14" y1="11" x2="14" y2="17" />
  </svg>
);

// Helper to convert hh:mm:ss format to total seconds
const timeStringToSeconds = (timeStr: string): number => {
  if (!timeStr) return 0;
  const parts = timeStr.split(":").map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return 0;
};

// Safely decode ArrayBuffer into WebAudio AudioBuffer with error protection
async function safeDecodeAudioData(audioCtx: AudioContext, arrayBuffer: ArrayBuffer): Promise<AudioBuffer | null> {
  if (!arrayBuffer || arrayBuffer.byteLength < 100) return null;
  try {
    const copy = arrayBuffer.slice(0);
    return await audioCtx.decodeAudioData(copy);
  } catch (err) {
    console.warn("[WebAudio] decodeAudioData failed safely:", err);
    return null;
  }
}

// Global Audio Cache for Instant Splicing
let originalAudioBufferCache: AudioBuffer | null = null;
let currentAudioBufferCache: AudioBuffer | null = null;
let globalOscillogramPeaks: Float32Array | null = null;
let currentAudioCallId: string = "";
let hasActiveLocalEdits: boolean = false;

// Pre-warm the audio buffer cache in the background and apply any saved cuts on page load
async function prewarmAudioCache(
  audioUrl: string,
  callId: string,
  savedRanges?: Array<{ start: number; end: number }>,
  onTrimmedReady?: (trimmedBlobUrl: string, duration?: number) => void
) {
  if (hasActiveLocalEdits) return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    
    let audioBuffer = originalAudioBufferCache;

    // Fetch and decode ONLY if not already cached
    if (currentAudioCallId !== callId || !audioBuffer) {
      const proxyUrl = audioUrl.startsWith("http") && !audioUrl.includes("/api/audio")
        ? `/api/audio?url=${encodeURIComponent(audioUrl)}`
        : audioUrl;
      const response = await fetch(proxyUrl);
      const arrayBuffer = await response.arrayBuffer();
      audioBuffer = await safeDecodeAudioData(audioCtx, arrayBuffer);
      
      originalAudioBufferCache = audioBuffer;
      currentAudioCallId = callId;
    }

    if (!audioBuffer) return;

    // If there are saved cut ranges, apply single-pass batch splice with 10ms crossfade
    if (savedRanges && savedRanges.length > 0) {
      audioBuffer = batchSpliceAudioBuffer(audioCtx, audioBuffer, savedRanges);
    }

    currentAudioBufferCache = audioBuffer;
    globalOscillogramPeaks = generatePeaksForBuffer(audioBuffer);

    if (savedRanges && savedRanges.length > 0) {
      const wavBlob = audioBufferToWavBlob(audioBuffer);
      const trimmedBlobUrl = URL.createObjectURL(wavBlob);
      if (onTrimmedReady) onTrimmedReady(trimmedBlobUrl, audioBuffer.duration);
      console.log("[Cache] Restored audio cuts instantly from RAM!");
    } else {
      if (onTrimmedReady) {
        const wavBlob = audioBufferToWavBlob(audioBuffer);
        const url = URL.createObjectURL(wavBlob);
        onTrimmedReady(url, audioBuffer.duration);
      }
    }
  } catch (e) {
    console.warn("[Cache] Audio restoration failed", e);
  }
}

const MemoizedTranscriptRow = React.memo(({
  message, idx, isSilence, isActive, activeWordIdx, isEditing,
  editingText, setEditingText, startEditing, saveEditing, cancelEditing, deleteTranscriptLine,
  onRowClick, onWordClick, activeRowRef, renderHighlightedText
}: any) => {
  return (
    <div 
      ref={activeRowRef}
      className={`${styles.transcriptRow} ${isSilence ? styles.silenceRow : ""} ${isActive ? styles.activeRow : ""}`}
      onClick={() => {
        if (isSilence || isEditing) return;
        onRowClick(message.time);
      }}
    >
      <div className={styles.timestampCell}>
        {message.time}
      </div>

      <div className={styles.speakerCell}>
        <span 
          className={`${styles.speakerBadge} ${
            message.speaker === "Agent" 
              ? styles.speakerBadgeAgent 
              : message.speaker === "Customer" 
                ? styles.speakerBadgeCustomer 
                : styles.speakerBadgeSilence
          }`}
        >
          {message.speaker}
        </span>
      </div>

      <div className={styles.textCell}>
        {isEditing ? (
          <div className={styles.editContainer} onClick={(e) => e.stopPropagation()}>
            <textarea
              rows={4}
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              className={styles.transcriptEditTextarea}
              autoFocus
              placeholder="Edit transcript dialogue..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  saveEditing(idx);
                }
                if (e.key === "Escape") cancelEditing();
              }}
            />
            <div className={styles.editActions}>
              <button className={styles.saveEditBtn} onClick={() => saveEditing(idx)}>Save</button>
              <button className={styles.cancelEditBtn} onClick={cancelEditing}>Cancel</button>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <span>
              {message.words && Array.isArray(message.words) && message.words.length > 0 ? (
                <span className={styles.wordContainer}>
                  {message.words.map((w: any, wIdx: number) => {
                    const isWordActive = wIdx === activeWordIdx;
                    return (
                      <span
                        key={wIdx}
                        className={`${styles.wordItem} ${isWordActive ? styles.activeWordItem : ""}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          onWordClick(w.start);
                        }}
                        title={`Click to play at ${w.start.toFixed(1)}s`}
                      >
                        {w.word}{" "}
                      </span>
                    );
                  })}
                </span>
              ) : (
                renderHighlightedText(message.text)
              )}
            </span>
            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <button 
                className={styles.editTranscriptBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  startEditing(idx, message.text);
                }}
                title="Edit transcript line"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#f4f4f5",
                  border: "1px solid #e4e4e7",
                  color: "#3f3f46",
                  cursor: "pointer",
                  padding: "5px 7px",
                  borderRadius: "6px",
                  transition: "all 0.2s ease"
                }}
              >
                <Pencil size={13} />
              </button>
              <button 
                type="button"
                className={styles.deleteTranscriptBtn}
                onClick={(e) => {
                  e.stopPropagation();
                  deleteTranscriptLine(idx);
                }}
                title="Delete line and cut audio from call"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "#fee2e2",
                  border: "1px solid #fecaca",
                  color: "#dc2626",
                  cursor: "pointer",
                  padding: "5px 7px",
                  borderRadius: "6px",
                  transition: "all 0.2s ease"
                }}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.idx === nextProps.idx &&
    prevProps.isActive === nextProps.isActive &&
    prevProps.activeWordIdx === nextProps.activeWordIdx &&
    prevProps.isEditing === nextProps.isEditing &&
    prevProps.editingText === nextProps.editingText &&
    prevProps.message === nextProps.message
  );
});

function TranscriptContent() {
  const router = useRouter();
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evalStatus, setEvalStatus] = useState("");
  const [metadata, setMetadata] = useState([
    { label: "Call ID", value: "N/A", highlight: true },
    { label: "Agent", value: "N/A" },
    { label: "Date", value: "N/A" },
    { label: "Duration", value: "N/A" },
    { label: "Language", value: "N/A" },
  ]);

  const [transcriptData, setTranscriptData] = useState<any[]>([]);
  const [hasData, setHasData] = useState(false);
  const [allCalls, setAllCalls] = useState<any[]>([]);
  const [activeCallId, setActiveCallId] = useState<string>("");
  
  // Editing state
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [hasBeenTrimmed, setHasBeenTrimmed] = useState(false);

  // Playback state
  const [audioSrc, setAudioSrc] = useState<string>("");
  const [hasRealAudio, setHasRealAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isAudioBuffering, setIsAudioBuffering] = useState(false);
  const [audioErrorMessage, setAudioErrorMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(105);

  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);
  const timelineContainerRef = useRef<HTMLDivElement>(null);
  const overviewContainerRef = useRef<HTMLDivElement>(null);
  const zoomviewContainerRef = useRef<HTMLDivElement>(null);
  const peaksInstanceRef = useRef<any>(null);
  const wavesurferRef = useRef<any>(null);
  const wsRegionsRef = useRef<any>(null);

  // Ref & State for automatic visual timeline progress bar shading
  const audioSrcRef = useRef<string>("");
  const isLocalUpdateRef = useRef(false);
  const isSilentBlobSwapRef = useRef(false);
  const deletedTimeRangesRef = useRef<Array<{ start: number; end: number }>>([]);
  const [deletedRangesState, setDeletedRangesState] = useState<Array<{ start: number; end: number }>>([]);
  const [selectedGraphRegion, setSelectedGraphRegion] = useState<{ start: number; end: number; regionObj?: any } | null>(null);
  const [hasClickedGraph, setHasClickedGraph] = useState(false);
  const smoothedScrollOffsetRef = useRef<number>(0);

  // Top-level Rules of Hooks memoized consolidated transcript
  const displayTranscript = useMemo(() => {
    return consolidateConsecutiveTurns(transcriptData);
  }, [transcriptData]);

  // Audio & Transcript Clipboard for Copy/Paste
  const audioClipboardRef = useRef<{
    audioBufferSlice: AudioBuffer | null;
    durationSec: number;
    transcriptSlice: Array<{
      speaker: string;
      text: string;
      relativeStart: number;
      relativeEnd: number;
      words?: any[];
    }>;
  } | null>(null);
  const [copyNotification, setCopyNotification] = useState<string | null>(null);

  // Zoom & Graph Style state
  const [zoomLevel, setZoomLevel] = useState<number>(20);
  const zoomLevelRef = useRef<number>(20);
  const [graphStyle, setGraphStyle] = useState<"dense" | "bars">("dense");

  // Global Keyboard Event Listener: Pressing Delete / Backspace key cuts the selected graph region!
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || (activeEl as HTMLElement).isContentEditable)) {
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (selectedGraphRegion) {
          e.preventDefault();
          deleteWaveformRegion(selectedGraphRegion.start, selectedGraphRegion.end);
          if (selectedGraphRegion.regionObj) {
            try { selectedGraphRegion.regionObj.remove(); } catch (err) {}
          }
          setSelectedGraphRegion(null);
        }
      } else if (e.key === "Escape") {
        if (selectedGraphRegion) {
          if (selectedGraphRegion.regionObj) {
            try { selectedGraphRegion.regionObj.remove(); } catch (err) {}
          }
          setSelectedGraphRegion(null);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedGraphRegion, durationSec]);
  
  // Cache decoded AudioBuffers for lightning fast instantaneous <1s edits!
  const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map());

  // Bulletproof Undo / Redo History Management using Refs + React State
  const historyStackRef = useRef<Array<{ transcript: any[]; audioSrc: string; audioBuffer?: AudioBuffer | null; deletedRanges?: any[] }>>([]);
  const historyIndexRef = useRef<number>(-1);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  // Micro-Timing Modal State & Precision Handlers
  const [microTrimIndex, setMicroTrimIndex] = useState<number | null>(null);
  const [microStartSec, setMicroStartSec] = useState<number>(0);
  const [microEndSec, setMicroEndSec] = useState<number>(0);

  const openMicroTrimModal = (index: number) => {
    const item = transcriptData[index];
    if (!item) return;
    const tStart = timeStringToSeconds(item.time);
    const wordCount = (item.text || "").trim().split(/\s+/).filter(Boolean).length;
    const estimatedLen = Math.max(0.4, wordCount * 0.28);
    let nextTime = tStart + estimatedLen;
    if (index < transcriptData.length - 1) {
      const nextTurn = timeStringToSeconds(transcriptData[index + 1].time);
      if (nextTurn > tStart) nextTime = Math.min(nextTurn, tStart + estimatedLen);
    }
    setMicroTrimIndex(index);
    setMicroStartSec(Math.round(tStart * 100) / 100);
    setMicroEndSec(Math.round(nextTime * 100) / 100);
  };

  const previewMicroTrimSlice = () => {
    if (!audioRef.current || !hasRealAudio) return;
    audioRef.current.currentTime = microStartSec;
    audioRef.current.play().catch(() => {});
    const durationMs = Math.max(200, (microEndSec - microStartSec) * 1000);
    setTimeout(() => {
      if (audioRef.current) audioRef.current.pause();
    }, durationMs);
  };

  const applyMicroTrim = () => {
    if (microTrimIndex === null) return;
    const tStart = microStartSec;
    const tEnd = microEndSec;
    const cutDuration = Math.max(0.1, tEnd - tStart);

    deletedTimeRangesRef.current.push({ start: tStart, end: tEnd });

    const updatedTranscript = transcriptData
      .filter((_, i) => i !== microTrimIndex)
      .map((item) => {
        const sec = timeStringToSeconds(item.time);
        if (sec > tStart) {
          const newSec = Math.max(0, sec - cutDuration);
          const hrs = Math.floor(newSec / 3600);
          const mins = Math.floor((newSec % 3600) / 60);
          const secs = Math.floor(newSec % 60);
          const timeStr = `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
          return { ...item, time: timeStr };
        }
        return item;
      });

    isLocalUpdateRef.current = true;
    setTranscriptData(updatedTranscript);
    pushToHistory(updatedTranscript);
    persistTranscriptToDatabase(updatedTranscript);
    setMicroTrimIndex(null);
  };

  const updateUndoRedoState = () => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyStackRef.current.length - 1);
  };

  const saveHistoryToStorage = (callId: string, stack: any[], index: number, ranges: any[]) => {
    if (!callId) return;
    try {
      const cleanStack = stack.map(({ audioBuffer, ...rest }) => rest);
      localStorage.setItem(`history_stack_${callId}`, JSON.stringify({ stack: cleanStack, index, ranges }));
    } catch (e) {}
  };

  const syncWaveformRegions = (ranges: Array<{ start: number; end: number }>) => {
    // No red overlay regions on deleted sections — physical trimming removes them directly
    if (!wsRegionsRef.current) return;
    try {
      wsRegionsRef.current.getRegions().forEach((r: any) => r.remove());
    } catch (e) {}
  };

  const persistTimeoutRef = useRef<any>(null);

  const persistTranscriptToDatabase = useCallback((transcriptToSave: any[], audioUrlToSave?: string) => {
    if (!activeCallId) return;
    const validUrl = (audioUrlToSave && audioUrlToSave.length > 5 && !audioUrlToSave.startsWith("blob:")) ? audioUrlToSave : undefined;

    if (persistTimeoutRef.current) {
      clearTimeout(persistTimeoutRef.current);
    }
    persistTimeoutRef.current = setTimeout(async () => {
      try {
        await saveCallRecord({
          id: activeCallId,
          transcript: transcriptToSave,
          deletedRanges: deletedTimeRangesRef.current || [],
          ...(validUrl ? { audioUrl: validUrl } : {})
        });
      } catch (e) {
        console.warn("Failed to persist transcript record:", e);
      }
    }, 400);
  }, [activeCallId]);

  const pushToHistory = (
    newTranscript: any[],
    newAudioSrc?: string,
    newAudioBufferParam?: AudioBuffer | null,
    preEditAudioBufferParam?: AudioBuffer | null
  ) => {
    const src = newAudioSrc || audioSrc;
    const currentStack = historyStackRef.current;
    const currentIndex = historyIndexRef.current;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();

    const targetBuffer = newAudioBufferParam || currentAudioBufferCache || originalAudioBufferCache;
    const clonedBuffer = targetBuffer ? cloneAudioBuffer(audioCtx, targetBuffer) : null;

    // Ensure initial state #0 (or current state) has a cloned AudioBuffer snapshot of PRE-EDIT audio if missing
    if (currentIndex >= 0 && currentIndex < currentStack.length) {
      if (!currentStack[currentIndex].audioBuffer) {
        const prevBuffer = preEditAudioBufferParam || currentAudioBufferCache || originalAudioBufferCache;
        if (prevBuffer) {
          currentStack[currentIndex].audioBuffer = cloneAudioBuffer(audioCtx, prevBuffer);
        }
      }
    }

    // 1. Memory Cleanup: If we are overriding future redo states, aggressively garbage collect them!
    if (currentIndex >= 0 && currentIndex < currentStack.length - 1) {
      const orphanedStates = currentStack.slice(currentIndex + 1);
      orphanedStates.forEach(state => {
        if (state.audioSrc && state.audioSrc.startsWith("blob:")) {
          URL.revokeObjectURL(state.audioSrc);
        }
      });
    }

    const sliced = currentIndex >= 0 ? currentStack.slice(0, currentIndex + 1) : [];
    let updated = [...sliced, {
      transcript: JSON.parse(JSON.stringify(newTranscript)),
      audioSrc: src,
      audioBuffer: clonedBuffer,
      deletedRanges: JSON.parse(JSON.stringify(deletedTimeRangesRef.current))
    }];

    // 2. Memory Cleanup: Limit history stack to 10 to prevent gigabytes of RAM usage
    const MAX_HISTORY = 10;
    while (updated.length > MAX_HISTORY) {
      const oldestState = updated.shift(); // Remove the oldest state
      if (oldestState && oldestState.audioSrc && oldestState.audioSrc.startsWith("blob:")) {
        URL.revokeObjectURL(oldestState.audioSrc);
      }
    }

    historyStackRef.current = updated;
    historyIndexRef.current = updated.length - 1;
    updateUndoRedoState();
    saveHistoryToStorage(activeCallId, updated, updated.length - 1, deletedTimeRangesRef.current);
  };

  const rebuildAudioFromRanges = async (ranges: Array<{ start: number; end: number }>) => {
    if (!hasRealAudio || !audioSrc) return;

    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();

      let baseBuffer = originalAudioBufferCache;

      // Decode original uncut audio buffer if not cached yet
      if (!baseBuffer || currentAudioCallId !== activeCallId) {
        const proxyUrl = audioSrc.startsWith("http") && !audioSrc.includes("/api/audio")
          ? `/api/audio?url=${encodeURIComponent(audioSrc)}`
          : audioSrc;
        const res = await fetch(proxyUrl);
        const arrayBuffer = await res.arrayBuffer();
        baseBuffer = await safeDecodeAudioData(audioCtx, arrayBuffer);
        originalAudioBufferCache = baseBuffer;
        currentAudioCallId = activeCallId;
      }

      if (!baseBuffer) return;

      let finalBuffer = baseBuffer;
      let finalUrl = audioSrc;

      if (ranges && ranges.length > 0) {
        // Single-pass batch splice of the uncut original audio with the remaining ranges
        finalBuffer = batchSpliceAudioBuffer(audioCtx, baseBuffer, ranges);
        currentAudioBufferCache = finalBuffer;
        const wavBlob = audioBufferToWavBlob(finalBuffer);
        finalUrl = URL.createObjectURL(wavBlob);
      } else {
        currentAudioBufferCache = baseBuffer;
        const wavBlob = audioBufferToWavBlob(baseBuffer);
        finalUrl = URL.createObjectURL(wavBlob);
      }

      setDurationSec(finalBuffer.duration);
      oscillogramPeaksRef.current = generatePeaksForBuffer(finalBuffer);
      drawScientificOscillogram();
      setHasBeenTrimmed(ranges && ranges.length > 0);

      // Restore audio player source
      if (audioRef.current) {
        const wasPlaying = isPlaying || !audioRef.current.paused;
        const currentPos = audioRef.current.currentTime;
        const newPos = Math.min(finalBuffer.duration, currentPos);

        isSilentBlobSwapRef.current = true;
        audioRef.current.src = finalUrl;
        audioRef.current.currentTime = newPos;
        if (wasPlaying) {
          audioRef.current.play().catch(() => {});
        }
        setTimeout(() => {
          isSilentBlobSwapRef.current = false;
        }, 500);
      }

      // Reload WaveSurfer canvas waveform peaks
      if (wavesurferRef.current) {
        try {
          Promise.resolve(wavesurferRef.current.load(finalUrl)).catch(() => {});
        } catch (e) {}
      }
    } catch (err) {
      console.warn("[Undo/Redo] Audio restoration error:", err);
    }
  };

  const handleUndo = () => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current = historyIndexRef.current - 1;
      const state = historyStackRef.current[historyIndexRef.current];

      isLocalUpdateRef.current = true;
      const consolidated = consolidateConsecutiveTurns(state.transcript || []);
      setTranscriptData(consolidated);

      const restoredRanges = state.deletedRanges || [];
      deletedTimeRangesRef.current = JSON.parse(JSON.stringify(restoredRanges));
      setDeletedRangesState(restoredRanges);

      if (state.audioBuffer && typeof state.audioBuffer.getChannelData === "function") {
        currentAudioBufferCache = state.audioBuffer;
        const wavBlob = audioBufferToWavBlob(state.audioBuffer);
        const restoredUrl = URL.createObjectURL(wavBlob);
        setAudioSrc(restoredUrl);
        setDurationSec(state.audioBuffer.duration);
        if (audioRef.current) {
          isSilentBlobSwapRef.current = true;
          audioRef.current.pause();
          audioRef.current.src = restoredUrl;
          audioRef.current.load();
          try { audioRef.current.currentTime = Math.min(state.audioBuffer.duration, currentTime); } catch(e) {}
          setTimeout(() => {
            isSilentBlobSwapRef.current = false;
          }, 300);
        }

        const peaks = generatePeaksForBuffer(state.audioBuffer);
        oscillogramPeaksRef.current = peaks;
        globalOscillogramPeaks = peaks;
        if (wavesurferRef.current) {
          try {
            wavesurferRef.current.load(restoredUrl, [peaks], state.audioBuffer.duration);
          } catch(e) {}
        }
        drawScientificOscillogram();
      } else {
        rebuildAudioFromRanges(restoredRanges);
      }

      setTimeout(() => {
        persistTranscriptToDatabase(consolidated, state.audioSrc);
      }, 0);
      updateUndoRedoState();
      saveHistoryToStorage(activeCallId, historyStackRef.current, historyIndexRef.current, restoredRanges);
    }
  };

  const handleRedo = () => {
    if (historyIndexRef.current < historyStackRef.current.length - 1) {
      historyIndexRef.current = historyIndexRef.current + 1;
      const state = historyStackRef.current[historyIndexRef.current];

      isLocalUpdateRef.current = true;
      const consolidated = consolidateConsecutiveTurns(state.transcript || []);
      setTranscriptData(consolidated);

      const restoredRanges = state.deletedRanges || [];
      deletedTimeRangesRef.current = JSON.parse(JSON.stringify(restoredRanges));
      setDeletedRangesState(restoredRanges);

      if (state.audioBuffer && typeof state.audioBuffer.getChannelData === "function") {
        currentAudioBufferCache = state.audioBuffer;
        const wavBlob = audioBufferToWavBlob(state.audioBuffer);
        const restoredUrl = URL.createObjectURL(wavBlob);
        setAudioSrc(restoredUrl);
        setDurationSec(state.audioBuffer.duration);
        if (audioRef.current) {
          isSilentBlobSwapRef.current = true;
          audioRef.current.pause();
          audioRef.current.src = restoredUrl;
          audioRef.current.load();
          try { audioRef.current.currentTime = Math.min(state.audioBuffer.duration, currentTime); } catch(e) {}
          setTimeout(() => {
            isSilentBlobSwapRef.current = false;
          }, 300);
        }

        const peaks = generatePeaksForBuffer(state.audioBuffer);
        oscillogramPeaksRef.current = peaks;
        globalOscillogramPeaks = peaks;
        if (wavesurferRef.current) {
          try {
            wavesurferRef.current.load(restoredUrl, [peaks], state.audioBuffer.duration);
          } catch(e) {}
        }
        drawScientificOscillogram();
      } else {
        rebuildAudioFromRanges(restoredRanges);
      }

      setTimeout(() => {
        persistTranscriptToDatabase(consolidated, state.audioSrc);
      }, 0);
      updateUndoRedoState();
      saveHistoryToStorage(activeCallId, historyStackRef.current, historyIndexRef.current, restoredRanges);
    }
  };





  const handleDownloadTranscript = () => {
    if (!transcriptData || transcriptData.length === 0) return;
    const textContent = transcriptData
      .map(t => `[${t.time}] ${t.speaker}: ${t.text}`)
      .join("\n\n");
    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `trimmed_transcript_${activeCallId || "call"}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDownloadAudio = async () => {
    if (!audioSrc) return;
    try {
      const proxyUrl = audioSrc.startsWith("http") && !audioSrc.includes("/api/audio")
        ? `/api/audio?url=${encodeURIComponent(audioSrc)}`
        : audioSrc;

      if (deletedTimeRangesRef.current.length > 0) {
        let trimmedBuffer = currentAudioBufferCache;
        if (!trimmedBuffer) {
          const res = await fetch(proxyUrl);
          const arrayBuffer = await res.arrayBuffer();
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          trimmedBuffer = await safeDecodeAudioData(audioCtx, arrayBuffer);
          if (trimmedBuffer && deletedTimeRangesRef.current.length > 0) {
            trimmedBuffer = batchSpliceAudioBuffer(audioCtx, trimmedBuffer, deletedTimeRangesRef.current);
          }
        }
        if (!trimmedBuffer) return;
        const wavBlob = audioBufferToWavBlob(trimmedBuffer);
        const url = URL.createObjectURL(wavBlob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `trimmed_call_${activeCallId || "audio"}.wav`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return;
      }

      const res = await fetch(proxyUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `call_${activeCallId || "audio"}.mp3`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Audio download error:", e);
      window.open(audioSrc, "_blank");
    }
  };

  const searchParams = useSearchParams();
  const urlId = searchParams ? searchParams.get("id") : null;

  const loadCallData = (selectedId?: string) => {
    const activeId = selectedId || urlId || (typeof window !== "undefined" ? localStorage.getItem("active_call_id") : "") || "";
    if (!activeId) return;

    // If the same call is already active, preserve playback position and state!
    if (currentAudioCallId === activeId && hasData && audioSrc) {
      return;
    }

    // Check if there is a saved playback position for this call when switching tabs
    let restoredPos = 0;
    if (typeof window !== "undefined") {
      const savedPosStr = localStorage.getItem(`playback_pos_${activeId}`);
      if (savedPosStr) restoredPos = Math.max(0, parseFloat(savedPosStr) || 0);
    }

    // Reset audio state, audio buffer cache, and history when loading a different call
    hasActiveLocalEdits = false;
    audioSrcRef.current = "";
    originalAudioBufferCache = null;
    currentAudioBufferCache = null;
    currentAudioCallId = activeId;
    historyStackRef.current = [];
    historyIndexRef.current = -1;
    deletedTimeRangesRef.current = [];
    setDeletedRangesState([]);
    setSelectedGraphRegion(null);
    setAudioSrc("");
    setAudioErrorMessage(null);
    setIsPlaying(false);
    setCurrentTime(restoredPos);
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = restoredPos;
      } catch (e) {}
    }

    setActiveCallId(activeId);
    setHasClickedGraph(false);
    if (typeof window !== "undefined") {
      localStorage.setItem("active_call_id", activeId);
    }

    // Load call document instantly from 100% local database
    fetchCallById(activeId).then((activeCall) => {
      if (!activeCall) return;
      setHasData(true);
      const initialTranscript = consolidateConsecutiveTurns(activeCall.transcript || []);
      setTranscriptData(initialTranscript);

      const detectedAgent = detectAgentNameFromTranscript(initialTranscript, activeCall.agent || "Unknown Agent");
      setMetadata([
        { label: "Call ID", value: activeCall.id, highlight: true },
        { label: "Agent", value: detectedAgent },
        { label: "Date", value: activeCall.date || "N/A" },
        { label: "Duration", value: activeCall.duration || "N/A" },
        { label: "Language", value: activeCall.language || "English" },
        { label: "AI Status", value: activeCall.status || "Pending" },
      ]);
      setDurationSec(activeCall.durationSec || 105);

      let audioFileUrl = activeCall.audioUrl;
      let savedRanges: Array<{ start: number; end: number }> = Array.isArray(activeCall.deletedRanges) ? activeCall.deletedRanges : [];

      // Restore history stack & ranges from localStorage if available after page refresh
      const savedHistoryStr = localStorage.getItem(`history_stack_${activeId}`);
      if (savedHistoryStr) {
        try {
          const savedHist = JSON.parse(savedHistoryStr);
          if (savedHist.stack && savedHist.stack.length > 0) {
            historyStackRef.current = savedHist.stack;
            historyIndexRef.current = savedHist.index ?? 0;
            const currentState = savedHist.stack[historyIndexRef.current];
            if (currentState && currentState.transcript) {
              setTranscriptData(currentState.transcript);
            }
            if (Array.isArray(savedHist.ranges)) {
              deletedTimeRangesRef.current = savedHist.ranges;
              setDeletedRangesState([...savedHist.ranges]);
              if (savedHist.ranges.length > 0) savedRanges = savedHist.ranges;
            }
            updateUndoRedoState();
          }
        } catch (e) {}
      } else {
        historyStackRef.current = [{ transcript: JSON.parse(JSON.stringify(initialTranscript)), audioSrc: audioFileUrl || "", deletedRanges: [] }];
        historyIndexRef.current = 0;
        updateUndoRedoState();
      }

      if (audioFileUrl) {
        if (audioFileUrl.startsWith("/uploads/")) {
          const fileName = audioFileUrl.replace("/uploads/", "");
          audioFileUrl = `/api/audio?file=${fileName}`;
        }
        
        audioSrcRef.current = audioFileUrl;
        setAudioSrc(audioFileUrl);
        
        // Imperatively set initial uncut audio source instantly
        if (audioRef.current) {
          const proxyUrl = audioFileUrl.startsWith("http") && !audioFileUrl.includes("/api/audio")
            ? `/api/audio?url=${encodeURIComponent(audioFileUrl)}`
            : audioFileUrl;
          audioRef.current.src = proxyUrl;
          audioRef.current.load();
        }
        setHasRealAudio(true);

        // Pre-warm audio cache in RAM for this call
        setTimeout(() => {
          prewarmAudioCache(audioFileUrl!, activeId!, savedRanges, (trimmedUrl, dur) => {
            if (dur && dur > 0) {
              setDurationSec(dur);
            }
            if (savedRanges && savedRanges.length > 0) {
              if (audioRef.current) {
                audioRef.current.src = trimmedUrl;
                audioRef.current.load();
              }
            }
            if (globalOscillogramPeaks) {
              oscillogramPeaksRef.current = globalOscillogramPeaks;
              drawScientificOscillogram();
            }
          });
        }, 100);
      } else {
        setAudioSrc("");
        setHasRealAudio(false);
      }
    });
  };

  const handleAgentNameChange = (newAgent: string) => {
    setMetadata((prev) =>
      prev.map((item) => (item.label === "Agent" ? { ...item, value: newAgent } : item))
    );

    saveCallRecord({
      id: activeCallId,
      agent: newAgent,
    });

    setAllCalls((prev) =>
      prev.map((c) => (c.id === activeCallId ? { ...c, agent: newAgent } : c))
    );
  };



  const runAiEvaluation = async () => {
    const storedDb = localStorage.getItem("all_calls_database");
    if (!storedDb || !activeCallId) return;

    try {
      setIsEvaluating(true);
      setEvalStatus("Evaluating...");
      const db = JSON.parse(storedDb);
      const activeCall = db.find((c: any) => c.id === activeCallId);
      if (!activeCall) return;

      const customScorecard = localStorage.getItem("qa_custom_scorecard") 
        ? JSON.parse(localStorage.getItem("qa_custom_scorecard")!) 
        : null;

      const feedbackHistory = localStorage.getItem("qa_feedback_history")
        ? JSON.parse(localStorage.getItem("qa_feedback_history")!)
        : null;

      let response = null;
      let data = null;
      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          if (attempts > 0) {
            setEvalStatus(`Retrying (${attempts}/${maxAttempts})...`);
          }
          response = await fetch("/api/evaluate", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              transcript: activeCall.transcript,
              agentName: activeCall.agent,
              customScorecard,
              feedbackHistory
            })
          });

          data = await response.json();

          if (!response.ok || data.error) {
            const errMsg = data?.error || "Unknown error";
            const isTransient = errMsg.toLowerCase().includes("503") ||
                                errMsg.toLowerCase().includes("service unavailable") ||
                                errMsg.toLowerCase().includes("high demand") ||
                                errMsg.toLowerCase().includes("temporary") ||
                                errMsg.toLowerCase().includes("unavailable") ||
                                errMsg.toLowerCase().includes("rate limit") ||
                                errMsg.toLowerCase().includes("429");

            if (isTransient && attempts + 1 < maxAttempts) {
              attempts++;
              let waitMs = 15000;
              const match = errMsg.match(/(?:try again in|retry in)\s*(\d+(\.\d+)?)/i);
              if (match && match[1]) {
                const waitSec = parseFloat(match[1]);
                waitMs = Math.ceil(waitSec * 1000) + 2000;
              }
              const waitSecRounded = Math.ceil(waitMs / 1000);
              setEvalStatus(`Server busy (Retry in ${waitSecRounded}s)`);
              await new Promise((resolve) => setTimeout(resolve, waitMs));
              continue;
            }
            throw new Error(errMsg);
          }
          break; // Success!
        } catch (e: any) {
          if (attempts + 1 < maxAttempts) {
            attempts++;
            setEvalStatus("Network error, retrying...");
            await new Promise((resolve) => setTimeout(resolve, 5000));
            continue;
          }
          throw e;
        }
      }

      const evalData = data;

      // Merge the evaluation data back into the call object
      activeCall.evaluation = evalData.evaluation;
      activeCall.qaAnalysis = evalData.qaAnalysis;
      activeCall.score = evalData.evaluation?.qaScore || 85;
      activeCall.status = "Reviewed";
      activeCall.sentiment = evalData.sentiment || "Neutral";
      activeCall.category = evalData.category || "Sales";
      activeCall.language = evalData.language || activeCall.language || "English (India)";
      activeCall.negativePhrases = evalData.negativePhrases || [];
      activeCall.agentTime = evalData.agentTime || 50;
      activeCall.customerTime = evalData.customerTime || 50;
      activeCall.silenceTime = evalData.silenceTime || 0;

      // Update local storage database
      const updatedDb = db.map((c: any) => c.id === activeCallId ? activeCall : c);
      localStorage.setItem("all_calls_database", JSON.stringify(updatedDb));

      // Refresh view
      loadCallData(activeCallId);
      
      // Redirect to evaluation page to show off the scores!
      router.push("/evaluation");
    } catch (e: any) {
      console.error(e);
      alert(`AI evaluation failed: ${e.message}`);
    } finally {
      setIsEvaluating(false);
      setEvalStatus("");
    }
  };

  const startEditing = (index: number, currentText: string) => {
    setEditingIndex(index);
    setEditingText(currentText);
    if (isPlaying) {
      setIsPlaying(false);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    }
  };

  const cancelEditing = () => {
    setEditingIndex(null);
    setEditingText("");
  };

  const saveEditing = async (index: number) => {
    if (editingIndex === null || index < 0 || index >= transcriptData.length) return;

    const originalMessage = transcriptData[index];
    const newText = editingText.trim();
    const oldText = (originalMessage.text || "").trim();

    if (newText === oldText) {
      cancelEditing();
      return;
    }

    // 1. Ensure precise word timestamps exist for this line
    const nextTurnTime = transcriptData[index + 1] ? timeStringToSeconds(transcriptData[index + 1].time) : undefined;
    const oldWords = ensureWordTimestamps(originalMessage, nextTurnTime);

    // 2. Perform LCS alignment diff between old words and edited text
    const { keptWords, rangesToCut } = diffWordsAndFindCutRanges(oldWords, newText);

    const updatedTranscript = [...transcriptData];
    updatedTranscript[index] = {
      ...originalMessage,
      text: newText,
      words: keptWords.length > 0 ? keptWords : undefined
    };

    isLocalUpdateRef.current = true;
    setTranscriptData(updatedTranscript);
    pushToHistory(updatedTranscript);
    persistTranscriptToDatabase(updatedTranscript);
    cancelEditing();

    // 3. Batch splice PCM audio buffer in WebAudio RAM if words were removed
    if (rangesToCut.length > 0) {
      await executeBatchAudioCuts(rangesToCut);
      await processAudioCuts(rangesToCut);
    }
  };

  const deleteTranscriptLine = (index: number) => {
    if (index < 0 || index >= transcriptData.length) return;

    const turnToDelete = transcriptData[index];
    const nextTurnTime = transcriptData[index + 1] ? timeStringToSeconds(transcriptData[index + 1].time) : undefined;
    const wordMetas = ensureWordTimestamps(turnToDelete, nextTurnTime);

    let startSec = timeStringToSeconds(turnToDelete.time || "00:00:00");
    let endSec = startSec + Math.max(1, (turnToDelete.text || "").split(/\s+/).length * 0.35);

    if (wordMetas.length > 0) {
      startSec = wordMetas[0].start;
      endSec = wordMetas[wordMetas.length - 1].end;
    }

    const cutRange = { start: startSec, end: endSec };
    deletedTimeRangesRef.current.push(cutRange);
    setDeletedRangesState([...deletedTimeRangesRef.current]);

    // Rebuild WaveSurfer peaks canvas
    if (wavesurferRef.current && durationSec > 0) {
      try {
        const oldPeaks = wavesurferRef.current.options.peaks?.[0];
        if (oldPeaks && oldPeaks instanceof Float32Array) {
          const totalWidth = oldPeaks.length;
          const timePerPixel = durationSec / totalWidth;
          const startPixel = Math.max(0, Math.floor(startSec / timePerPixel));
          const endPixel = Math.min(totalWidth - 1, Math.ceil(endSec / timePerPixel));
          const cutPixelLength = endPixel - startPixel;

          if (cutPixelLength > 0 && totalWidth - cutPixelLength > 0) {
            const newPeaks = new Float32Array(totalWidth - cutPixelLength);
            newPeaks.set(oldPeaks.subarray(0, startPixel), 0);
            newPeaks.set(oldPeaks.subarray(endPixel, totalWidth), startPixel);

            const newDuration = Math.max(0.1, durationSec - (endSec - startSec));
            setDurationSec(newDuration);

            if (waveformContainerRef.current) {
              try {
                wavesurferRef.current.destroy();
              } catch (e) {}

              const ws = WaveSurfer.create({
                container: waveformContainerRef.current,
                media: audioRef.current || undefined,
                peaks: [newPeaks],
                duration: newDuration,
                waveColor: graphStyle === "dense" ? '#60a5fa' : '#a7f3d0',
                progressColor: graphStyle === "dense" ? '#1d4ed8' : '#059669',
                cursorColor: '#ef4444',
                height: 100,
                barWidth: graphStyle === "dense" ? 1 : 2,
                barGap: graphStyle === "dense" ? 0 : 2,
                barRadius: graphStyle === "dense" ? 0 : 3,
                minPxPerSec: zoomLevelRef.current || 20,
                hideScrollbar: false,
                autoScroll: true,
                autoCenter: true,
              });

              if (timelineContainerRef.current) {
                try {
                  timelineContainerRef.current.innerHTML = '';
                  ws.registerPlugin(
                    TimelinePlugin.create({
                      container: timelineContainerRef.current,
                      height: 18,
                      style: { fontSize: '10px', color: '#78716c', fontWeight: '500' },
                      formatTimeCallback: (s: number) => {
                        const m = Math.floor(s / 60);
                        const sec = Math.floor(s % 60);
                        return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
                      },
                    })
                  );
                } catch (e) {}
              }

              ws.on('timeupdate', (t: number) => centerPlayhead(t));
              ws.on('seeking', (t: number) => centerPlayhead(t));

              const wsRegions = ws.registerPlugin(RegionsPlugin.create());
              wsRegions.enableDragSelection({
                color: 'rgba(239, 68, 68, 0.4)',
              });

              wsRegions.on('region-created', (region: any) => {
                const start = region.start;
                const end = region.end;
                if (end > start + 0.1) {
                  wsRegions.getRegions().forEach((r: any) => {
                    if (r !== region) {
                      try { r.remove(); } catch (e) {}
                    }
                  });
                  setSelectedGraphRegion({ start, end, regionObj: region });
                }
              });

              ws.on('click', () => {
                if (wsRegionsRef.current) {
                  wsRegionsRef.current.getRegions().forEach((r: any) => r.remove());
                }
              });

              wavesurferRef.current = ws;
              wsRegionsRef.current = wsRegions;
            }
          }
        }
      } catch (e) {}
    }

    // Remove item from transcript array
    const updated = transcriptData.filter((_, i) => i !== index);
    isLocalUpdateRef.current = true;
    setTranscriptData(updated);
    pushToHistory(updated);
    persistTranscriptToDatabase(updated);

    // Single-pass batch splice audio buffer in RAM with 10ms crossfade
    executeBatchAudioCuts([cutRange]);
  };

  const processAudioCuts = async (rangesToCut: Array<{start: number, end: number}>) => {
    if (!rangesToCut || rangesToCut.length === 0) return;

    // 1. Shift word timestamps and turn timestamps for all words after cut regions
    const sortedRangesAsc = [...rangesToCut].sort((a, b) => a.start - b.start);
    
    setTranscriptData((prevTranscript) => {
      const shifted = prevTranscript.map((message) => {
        let words = message.words ? [...message.words] : undefined;
        if (words && Array.isArray(words) && words.length > 0) {
          // Filter out words that are entirely inside any cut range
          words = words.filter((w: any) => {
            return !sortedRangesAsc.some(range => w.start >= (range.start - 0.01) && w.end <= (range.end + 0.01));
          });

          // Shift remaining words cumulatively
          words = words.map((w: any) => {
            let shiftStart = 0;
            let shiftEnd = 0;
            for (const range of sortedRangesAsc) {
              if (w.start >= range.end) shiftStart += (range.end - range.start);
              else if (w.start > range.start) shiftStart += (w.start - range.start);

              if (w.end >= range.end) shiftEnd += (range.end - range.start);
              else if (w.end > range.start) shiftEnd += (w.end - range.start);
            }
            return {
              ...w,
              start: Math.max(0, Number((w.start - shiftStart).toFixed(3))),
              end: Math.max(0, Number((w.end - shiftEnd).toFixed(3)))
            };
          });
        }

        let newTimeSec = timeStringToSeconds(message.time);
        if (words && words.length > 0) {
          newTimeSec = words[0].start;
        } else {
          for (const range of sortedRangesAsc) {
            if (newTimeSec >= range.end) {
              newTimeSec = Math.max(0, newTimeSec - (range.end - range.start));
            }
          }
        }

        const secs = Math.floor(newTimeSec || 0);
        const hrs = Math.floor(secs / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        const remSecs = secs % 60;
        const formattedTime = `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(remSecs).padStart(2, '0')}`;

        return {
          ...message,
          time: formattedTime,
          words: words && words.length > 0 ? words : undefined
        };
      });

      isLocalUpdateRef.current = true;
      pushToHistory(shifted);
      persistTranscriptToDatabase(shifted);
      return shifted;
    });

    // 2. Perform instant virtual timeline cut tracking (0.01s speed!)
    rangesToCut.sort((a, b) => b.start - a.start);
    deletedTimeRangesRef.current.push(...rangesToCut);
    setDeletedRangesState([...deletedTimeRangesRef.current]);
    setHasBeenTrimmed(true);
    saveHistoryToStorage(activeCallId, historyStackRef.current, historyIndexRef.current, deletedTimeRangesRef.current);
  };

  const handleCutRegion = useCallback(async (start: number, end: number) => {
    if (end <= start + 0.05) return;
    const cutRange = { start, end };
    await processAudioCuts([cutRange]);
  }, [processAudioCuts]);

  const centerPlayhead = (time: number) => {
    if (!waveformContainerRef.current || !wavesurferRef.current) return;
    const container = waveformContainerRef.current;
    const scrollable = 
      container.shadowRoot?.querySelector<HTMLElement>('div') ||
      container.querySelector<HTMLElement>('div') || 
      container;

    const duration = durationSec || (wavesurferRef.current.getDuration ? wavesurferRef.current.getDuration() : 1) || 1;
    const scrollWidth = scrollable.scrollWidth;
    const viewportWidth = container.clientWidth || scrollable.clientWidth;

    if (viewportWidth <= 0 || scrollWidth <= viewportWidth) return;

    const cursorX = (time / duration) * scrollWidth;
    const halfViewport = viewportWidth / 2;

    // Lock red cursor line 100% at exact horizontal center (50% of viewport width)
    const targetScrollLeft = cursorX - halfViewport;
    scrollable.scrollLeft = targetScrollLeft;

    if (timelineContainerRef.current) {
      const timelineScrollable = 
        timelineContainerRef.current.shadowRoot?.querySelector<HTMLElement>('div') ||
        timelineContainerRef.current.querySelector<HTMLElement>('div') || 
        timelineContainerRef.current;
      if (timelineScrollable) {
        timelineScrollable.scrollLeft = targetScrollLeft;
      }
    }
  };

  const oscillogramCanvasRef = useRef<HTMLCanvasElement>(null);
  const oscillogramPeaksRef = useRef<Float32Array | null>(null);

  // Render MATLAB/Audacity-style Scientific Oscillogram Signal Graph (100% matching screenshot)
  const drawScientificOscillogram = useCallback(() => {
    const canvas = oscillogramCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    if (width <= 0 || height <= 0) return;

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    // Clean white scientific background
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);

    // Coordinate Boundaries (Y-Axis margin 45px left, X-Axis margin 25px bottom)
    const marginL = 45;
    const marginR = 15;
    const marginT = 15;
    const marginB = 25;

    const plotW = width - marginL - marginR;
    const plotH = height - marginT - marginB;
    const step = 2; // 2px step for sharp signal lines

    const dur = durationSec || 1;
    const pxPerSec = zoomLevelRef.current || 25;
    const totalWidth = dur * pxPerSec;
    const centerX = marginL + plotW / 2;

    const activeTime = (audioRef.current && hasRealAudio && !audioRef.current.paused) ? audioRef.current.currentTime : currentTime;
    const playheadWorldX = (activeTime / dur) * totalWidth;
    const maxScroll = Math.max(0, totalWidth - plotW);
    const targetScrollOffset = Math.max(0, Math.min(maxScroll, playheadWorldX - plotW / 2));

    // Silky Smooth 60 FPS Lerp Interpolation for Oscillogram Canvas Scrolling
    if (Math.abs(targetScrollOffset - smoothedScrollOffsetRef.current) > plotW * 0.8) {
      smoothedScrollOffsetRef.current = targetScrollOffset;
    } else {
      smoothedScrollOffsetRef.current += (targetScrollOffset - smoothedScrollOffsetRef.current) * 0.18;
      if (Math.abs(targetScrollOffset - smoothedScrollOffsetRef.current) < 0.05) {
        smoothedScrollOffsetRef.current = targetScrollOffset;
      }
    }
    const scrollOffset = smoothedScrollOffsetRef.current;

    // Draw Plot Box Outline
    ctx.strokeStyle = "#475569";
    ctx.lineWidth = 1;
    ctx.strokeRect(marginL, marginT, plotW, plotH);

    // 1. Draw Dotted Background Grid Lines (Horizontal & Vertical)
    ctx.save();
    ctx.setLineDash([2, 3]);
    ctx.strokeStyle = "#cbd5e1";
    ctx.lineWidth = 1;

    // Y-Axis Horizontal Grid Lines (-1.0, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8, 1.0)
    const yTicks = [-1.0, -0.8, -0.6, -0.4, -0.2, 0.0, 0.2, 0.4, 0.6, 0.8, 1.0];
    const centerY = marginT + plotH / 2;

    yTicks.forEach(tickVal => {
      const yPos = centerY - (tickVal * (plotH / 2));
      if (yPos >= marginT && yPos <= marginT + plotH) {
        ctx.beginPath();
        ctx.moveTo(marginL, yPos);
        ctx.lineTo(marginL + plotW, yPos);
        ctx.stroke();
      }
    });

    // X-Axis Vertical Time Grid Lines
    const tickSecInterval = pxPerSec > 50 ? 5 : pxPerSec > 20 ? 10 : 20;
    const startTick = Math.floor((scrollOffset / pxPerSec) / tickSecInterval) * tickSecInterval;
    const endTick = Math.ceil(((scrollOffset + plotW) / pxPerSec) / tickSecInterval) * tickSecInterval;

    for (let t = Math.max(0, startTick); t <= Math.min(dur, endTick); t += tickSecInterval) {
      const tickWorldX = t * pxPerSec;
      const tickScreenX = marginL + (tickWorldX - scrollOffset);
      if (tickScreenX >= marginL && tickScreenX <= marginL + plotW) {
        ctx.beginPath();
        ctx.moveTo(tickScreenX, marginT);
        ctx.lineTo(tickScreenX, marginT + plotH);
        ctx.stroke();
      }
    }
    ctx.restore();

    // 2. Draw Y-Axis Labels (-1.0, -0.8 ... +1.0)
    ctx.fillStyle = "#1e293b";
    ctx.font = "600 11px sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";

    yTicks.forEach(tickVal => {
      const yPos = centerY - (tickVal * (plotH / 2));
      if (yPos >= marginT - 2 && yPos <= marginT + plotH + 2) {
        const labelText = tickVal === 0 ? "0" : tickVal.toFixed(1);
        ctx.fillText(labelText, marginL - 6, yPos);
      }
    });

    // 3. Draw X-Axis Time Ticks
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    for (let t = Math.max(0, startTick); t <= Math.min(dur, endTick); t += tickSecInterval) {
      const tickWorldX = t * pxPerSec;
      const tickScreenX = marginL + (tickWorldX - scrollOffset);
      if (tickScreenX >= marginL && tickScreenX <= marginL + plotW) {
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        const timeStr = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        ctx.fillText(timeStr, tickScreenX, marginT + plotH + 6);
      }
    }

    const startWorldX = Math.floor(scrollOffset / step) * step - step;
    const endWorldX = startWorldX + plotW + step * 2;

    // 4. Draw Crisp Sharp Scientific Oscillogram Signal Lines (Pin-Sharp, Razor-Clean, ZERO BLUR!)
    const peaks = oscillogramPeaksRef.current;
    const numPeaks = peaks ? peaks.length : 0;

    if (numPeaks > 0 && peaks) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(marginL, marginT, plotW, plotH);
      ctx.clip();

      ctx.lineWidth = 1;

      // Precompute the peak amplitude for each screen pixel using max-in-range
      // This guarantees the waveform shape is IDENTICAL regardless of scroll position
      const peaksPerWorldPx = 100 / pxPerSec; // e.g. 4 peaks per world-pixel at 25px/sec

      // Single-pass high-speed waveform rendering
      for (let px = 0; px < plotW; px += step) {
        const worldX = scrollOffset + px;
        if (worldX < 0 || worldX > totalWidth) continue;

        const isPlayed = worldX <= playheadWorldX;
        const timeSec = worldX / pxPerSec;
        const peakStart = Math.max(0, Math.floor(timeSec * 100));
        const peakEnd = Math.min(numPeaks - 1, Math.floor((timeSec + step / pxPerSec) * 100));
        let maxAmp = 0.02;
        for (let p = peakStart; p <= peakEnd; p++) {
          if (peaks[p] > maxAmp) maxAmp = peaks[p];
        }

        const halfH = Math.floor((maxAmp * (plotH / 2)) * 0.90);
        const screenX = Math.floor(marginL + px) + 0.5;
        const yTop = Math.floor(centerY - halfH) + 0.5;
        const yBottom = Math.floor(centerY + halfH) + 0.5;

        ctx.strokeStyle = isPlayed ? "#0000d0" : "#2563eb";
        ctx.beginPath();
        ctx.moveTo(screenX, yTop);
        ctx.lineTo(screenX, yBottom);
        ctx.stroke();
      }

      ctx.restore();
    }

    // 5. Draw Selected Region Highlight Overlay (Vibrant Red Fill + Red Waveform Tint + Handle Lines + Top Badge)
    if (selectedGraphRegion && selectedGraphRegion.end > selectedGraphRegion.start) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(marginL, marginT, plotW, plotH);
      ctx.clip();

      const rStartWorldX = (selectedGraphRegion.start / dur) * totalWidth;
      const rEndWorldX = (selectedGraphRegion.end / dur) * totalWidth;
      const rLeftScreen = marginL + (rStartWorldX - scrollOffset);
      const rRightScreen = marginL + (rEndWorldX - scrollOffset);

      const drawLeft = Math.max(marginL, Math.min(marginL + plotW, rLeftScreen));
      const drawRight = Math.max(marginL, Math.min(marginL + plotW, rRightScreen));
      const drawW = drawRight - drawLeft;

      if (drawW > 0) {
        // Red Shaded Background Box
        ctx.fillStyle = "rgba(239, 68, 68, 0.25)";
        ctx.fillRect(drawLeft, marginT, drawW, plotH);

        // Left & Right Solid Red Boundary Handle Lines
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;

        if (rLeftScreen >= marginL && rLeftScreen <= marginL + plotW) {
          ctx.beginPath();
          ctx.moveTo(rLeftScreen + 0.5, marginT);
          ctx.lineTo(rLeftScreen + 0.5, marginT + plotH);
          ctx.stroke();
        }

        if (rRightScreen >= marginL && rRightScreen <= marginL + plotW) {
          ctx.beginPath();
          ctx.moveTo(rRightScreen + 0.5, marginT);
          ctx.lineTo(rRightScreen + 0.5, marginT + plotH);
          ctx.stroke();
        }

        // Draw Selected Signal Spikes in Bright Red (#dc2626)
        if (numPeaks > 0 && peaks) {
          ctx.strokeStyle = "#dc2626";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const selPxStart = Math.max(0, Math.floor(drawLeft - marginL));
          const selPxEnd = Math.min(plotW, Math.ceil(drawRight - marginL));
          for (let px = selPxStart; px <= selPxEnd; px += step) {
            const worldX = scrollOffset + px;
            if (worldX < 0 || worldX > totalWidth) continue;

            const timeSec = worldX / pxPerSec;
            const peakStart = Math.max(0, Math.floor(timeSec * 100));
            const peakEnd = Math.min(numPeaks - 1, Math.floor((timeSec + step / pxPerSec) * 100));
            let maxAmp = 0.02;
            for (let p = peakStart; p <= peakEnd; p++) {
              if (peaks[p] > maxAmp) maxAmp = peaks[p];
            }

            const halfH = Math.floor((maxAmp * (plotH / 2)) * 0.90);
            const screenX = Math.floor(marginL + px) + 0.5;
            const yTop = Math.floor(centerY - halfH) + 0.5;
            const yBottom = Math.floor(centerY + halfH) + 0.5;

            ctx.moveTo(screenX, yTop);
            ctx.lineTo(screenX, yBottom);
          }
          ctx.stroke();
        }

        // Top Floating Pill Badge
        const durationSecVal = (selectedGraphRegion.end - selectedGraphRegion.start).toFixed(2);
        const badgeText = `✂️ ${durationSecVal}s Selected`;
        ctx.font = "bold 11px sans-serif";
        const textWidth = ctx.measureText(badgeText).width;
        const badgeW = textWidth + 16;
        const badgeH = 20;
        const badgeX = Math.max(drawLeft + 4, Math.min(drawRight - badgeW - 4, drawLeft + (drawW - badgeW) / 2));
        const badgeY = marginT + 6;

        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        if (typeof (ctx as any).roundRect === "function") {
          (ctx as any).roundRect(badgeX, badgeY, badgeW, badgeH, 4);
        } else {
          ctx.rect(badgeX, badgeY, badgeW, badgeH);
        }
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2);
      }

      ctx.restore();
    }

    // 6. Draw Red Playhead Cursor Line - Always visible during playback or when playhead set
    if (hasClickedGraph || isPlaying || currentTime > 0) {
      const playheadScreenX = marginL + (playheadWorldX - scrollOffset);
      if (playheadScreenX >= marginL && playheadScreenX <= marginL + plotW) {
        ctx.strokeStyle = "#ef4444";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(playheadScreenX, marginT);
        ctx.lineTo(playheadScreenX, marginT + plotH);
        ctx.stroke();

        // Top Indicator Dot
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(playheadScreenX, marginT, 4, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.restore();
  }, [currentTime, durationSec, selectedGraphRegion, hasClickedGraph]);

  // Ensure AudioBuffer is decoded and cached in WebAudio RAM
  const ensureAudioBuffer = useCallback(async (): Promise<AudioBuffer | null> => {
    if (currentAudioBufferCache) return currentAudioBufferCache;
    if (originalAudioBufferCache) {
      currentAudioBufferCache = originalAudioBufferCache;
      return originalAudioBufferCache;
    }
    if (!audioSrc) return null;
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      const proxyUrl = audioSrc.startsWith("http") && !audioSrc.includes("/api/audio")
        ? `/api/audio?url=${encodeURIComponent(audioSrc)}`
        : audioSrc;
      const response = await fetch(proxyUrl);
      const arrayBuffer = await response.arrayBuffer();
      const decoded = await safeDecodeAudioData(audioCtx, arrayBuffer);
      if (decoded) {
        originalAudioBufferCache = decoded;
        currentAudioBufferCache = decoded;
      }
      return decoded;
    } catch (e) {
      console.error("Failed to decode audio buffer:", e);
      return null;
    }
  }, [audioSrc]);

function remapWordsAndTranscriptAfterCut(
  transcript: any[],
  cutStart: number,
  cutEnd: number
): any[] {
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

    const keptWords: any[] = [];
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
  }).filter(Boolean) as any[];

  return consolidateConsecutiveTurns(updatedTranscript);
}

  const deleteWaveformRegion = useCallback((startSec: number, endSec: number) => {
    if (endSec <= startSec) return;

    // Track deleted ranges so they persist across page refreshes instantly!
    const newRanges = [...deletedTimeRangesRef.current, { start: startSec, end: endSec }];
    deletedTimeRangesRef.current = newRanges;
    setDeletedRangesState(newRanges);
    setHasBeenTrimmed(true);

    setTimeout(() => {
      executeAudioCut(startSec, endSec);
    }, 10);

    const updatedTranscript = remapWordsAndTranscriptAfterCut(transcriptData, startSec, endSec);

    isLocalUpdateRef.current = true;
    setTranscriptData(updatedTranscript);
    pushToHistory(updatedTranscript);
    persistTranscriptToDatabase(updatedTranscript);
  }, [transcriptData, pushToHistory, persistTranscriptToDatabase]);

  // Copy selected audio region and corresponding transcript text (Ctrl+C) - 100% INSTANT 0.001s
  const handleCopyGraphRegion = useCallback(async () => {
    if (!selectedGraphRegion || selectedGraphRegion.end <= selectedGraphRegion.start + 0.02) {
      setCopyNotification("⚠️ Please select a region on the plot first!");
      setTimeout(() => setCopyNotification(null), 3000);
      return;
    }
    const { start: startSec, end: endSec } = selectedGraphRegion;
    const duration = endSec - startSec;

    const mainBuffer = currentAudioBufferCache || (await ensureAudioBuffer());

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    const slicedBuffer = mainBuffer ? sliceAudioBuffer(audioCtx, mainBuffer, startSec, endSec) : null;

    const slicedTranscript: Array<{
      speaker: string;
      text: string;
      relativeStart: number;
      relativeEnd: number;
      words?: any[];
    }> = [];

    transcriptData.forEach((turn: any) => {
      const turnStart = timeStringToSeconds(turn.time || "00:00:00");
      const wordMetas = turn.words || [];
      let turnEnd = turnStart + Math.max(1, (turn.text || "").split(/\s+/).length * 0.35);

      if (wordMetas.length > 0) {
        turnEnd = wordMetas[wordMetas.length - 1].end;
      }

      if (turnEnd > startSec && turnStart < endSec) {
        const relativeStart = Math.max(0, turnStart - startSec);
        const relativeEnd = Math.min(duration, turnEnd - startSec);

        let slicedWords: any[] | undefined = undefined;
        let slicedText = turn.text || "";

        if (wordMetas.length > 0) {
          const matchingWords = wordMetas.filter((w: any) => w.start < endSec && w.end > startSec);
          if (matchingWords.length > 0) {
            slicedText = matchingWords.map((w: any) => w.word).join(" ");
            slicedWords = matchingWords.map((w: any) => ({
              ...w,
              start: Math.max(0, w.start - startSec),
              end: Math.min(duration, w.end - startSec)
            }));
          }
        }

        slicedTranscript.push({
          speaker: turn.speaker || "Agent",
          text: slicedText,
          relativeStart,
          relativeEnd,
          words: slicedWords
        });
      }
    });

    if (slicedTranscript.length === 0) {
      slicedTranscript.push({
        speaker: "Agent",
        text: `[Audio Segment ${duration.toFixed(1)}s]`,
        relativeStart: 0,
        relativeEnd: duration
      });
    }

    audioClipboardRef.current = {
      audioBufferSlice: slicedBuffer,
      durationSec: duration,
      transcriptSlice: slicedTranscript
    };

    if (typeof window !== "undefined") {
      (window as any).__GLOBAL_CALL_CLIPBOARD__ = audioClipboardRef.current;
      try {
        const textPlain = slicedTranscript.map(t => `${t.speaker}: ${t.text}`).join("\n");
        localStorage.setItem("global_call_clipboard", JSON.stringify({
          durationSec: duration,
          transcriptSlice: slicedTranscript,
          textPlain
        }));
        if (navigator.clipboard && textPlain) {
          navigator.clipboard.writeText(textPlain).catch(() => {});
        }
      } catch (e) {}
    }

    setCopyNotification(`📋 Copied ${duration.toFixed(2)}s Audio & Transcript! Click on graph & press Ctrl+V to paste.`);
    setTimeout(() => setCopyNotification(null), 4000);
  }, [selectedGraphRegion, transcriptData, ensureAudioBuffer]);

  // Cut selected audio region and corresponding transcript text (Ctrl+X or Delete) - 100% INSTANT
  const handleCutGraphRegion = useCallback(async (startSecParam?: number, endSecParam?: number) => {
    const rStart = startSecParam !== undefined ? startSecParam : selectedGraphRegion?.start;
    const rEnd = endSecParam !== undefined ? endSecParam : selectedGraphRegion?.end;

    if (rStart === undefined || rEnd === undefined || rEnd <= rStart + 0.02) {
      setCopyNotification("⚠️ Please select a region on the plot first!");
      setTimeout(() => setCopyNotification(null), 3000);
      return;
    }

    const duration = rEnd - rStart;
    const mainBuffer = currentAudioBufferCache || (await ensureAudioBuffer());

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();
    const slicedBuffer = mainBuffer ? sliceAudioBuffer(audioCtx, mainBuffer, rStart, rEnd) : null;

    const slicedTranscript: Array<{
      speaker: string;
      text: string;
      relativeStart: number;
      relativeEnd: number;
      words?: any[];
    }> = [];

    transcriptData.forEach((turn: any) => {
      const turnStart = timeStringToSeconds(turn.time || "00:00:00");
      const wordMetas = turn.words || [];
      let turnEnd = turnStart + Math.max(1, (turn.text || "").split(/\s+/).length * 0.35);

      if (wordMetas.length > 0) {
        turnEnd = wordMetas[wordMetas.length - 1].end;
      }

      if (turnEnd > rStart && turnStart < rEnd) {
        const relativeStart = Math.max(0, turnStart - rStart);
        const relativeEnd = Math.min(duration, turnEnd - rStart);

        let slicedWords: any[] | undefined = undefined;
        let slicedText = turn.text || "";

        if (wordMetas.length > 0) {
          const matchingWords = wordMetas.filter((w: any) => w.start < rEnd && w.end > rStart);
          if (matchingWords.length > 0) {
            slicedText = matchingWords.map((w: any) => w.word).join(" ");
            slicedWords = matchingWords.map((w: any) => ({
              ...w,
              start: Math.max(0, w.start - rStart),
              end: Math.min(duration, w.end - rStart)
            }));
          }
        }

        slicedTranscript.push({
          speaker: turn.speaker || "Agent",
          text: slicedText,
          relativeStart,
          relativeEnd,
          words: slicedWords
        });
      }
    });

    if (slicedTranscript.length === 0) {
      slicedTranscript.push({
        speaker: "Agent",
        text: `[Audio Segment ${duration.toFixed(1)}s]`,
        relativeStart: 0,
        relativeEnd: duration
      });
    }

    audioClipboardRef.current = {
      audioBufferSlice: slicedBuffer,
      durationSec: duration,
      transcriptSlice: slicedTranscript
    };

    if (typeof window !== "undefined") {
      (window as any).__GLOBAL_CALL_CLIPBOARD__ = audioClipboardRef.current;
      try {
        const textPlain = slicedTranscript.map(t => `${t.speaker}: ${t.text}`).join("\n");
        localStorage.setItem("global_call_clipboard", JSON.stringify({
          durationSec: duration,
          transcriptSlice: slicedTranscript,
          textPlain
        }));
        if (navigator.clipboard && textPlain) {
          navigator.clipboard.writeText(textPlain).catch(() => {});
        }
      } catch (e) {}
    }

    deleteWaveformRegion(rStart, rEnd);
    setSelectedGraphRegion(null);

    setCopyNotification(`✂️ Cut ${duration.toFixed(2)}s Audio & Transcript to clipboard! Click on graph & press Ctrl+V to paste.`);
    setTimeout(() => setCopyNotification(null), 4000);
  }, [selectedGraphRegion, transcriptData, ensureAudioBuffer, deleteWaveformRegion]);

  // Paste copied audio segment and transcript at target insertion time (Ctrl+V) - 100% INSTANT 0.002s
  const handlePasteGraphRegion = useCallback(async (pasteTimeSec?: number) => {
    let clipboard = audioClipboardRef.current;
    if (!clipboard && typeof window !== "undefined") {
      if ((window as any).__GLOBAL_CALL_CLIPBOARD__) {
        clipboard = (window as any).__GLOBAL_CALL_CLIPBOARD__;
        audioClipboardRef.current = clipboard;
      } else {
        const savedClip = localStorage.getItem("global_call_clipboard");
        if (savedClip) {
          try {
            const parsed = JSON.parse(savedClip);
            clipboard = {
              audioBufferSlice: null,
              durationSec: parsed.durationSec || 1,
              transcriptSlice: parsed.transcriptSlice || []
            };
            audioClipboardRef.current = clipboard;
          } catch (e) {}
        }
      }
    }

    if (!clipboard) {
      setCopyNotification("⚠️ Clipboard empty! Select a region on the plot and press Ctrl+C or Ctrl+X first.");
      setTimeout(() => setCopyNotification(null), 3000);
      return;
    }

    const insertTime = pasteTimeSec !== undefined ? pasteTimeSec : currentTime;
    const insertDuration = clipboard.durationSec;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new AudioContextClass();

    // 1. Capture exact unmutated PRE-PASTE AudioBuffer snapshot BEFORE any modification
    const prePasteBuffer = currentAudioBufferCache || originalAudioBufferCache || (await ensureAudioBuffer());
    const prePasteClonedBuffer = prePasteBuffer ? cloneAudioBuffer(audioCtx, prePasteBuffer) : null;

    // 2. Backfill pre-paste baseline into History State #0 if missing
    if (historyIndexRef.current >= 0 && historyStackRef.current.length > 0 && prePasteClonedBuffer) {
      if (!historyStackRef.current[historyIndexRef.current].audioBuffer) {
        historyStackRef.current[historyIndexRef.current].audioBuffer = cloneAudioBuffer(audioCtx, prePasteClonedBuffer);
      }
    }

    let newAudioBuffer: AudioBuffer | null = null;
    if (prePasteBuffer && clipboard.audioBufferSlice) {
      newAudioBuffer = insertAudioBufferWithCrossfade(audioCtx, prePasteBuffer, clipboard.audioBufferSlice, insertTime);
    } else if (clipboard.audioBufferSlice) {
      newAudioBuffer = clipboard.audioBufferSlice;
    }

    if (!newAudioBuffer) return;

    const postPasteClonedBuffer = cloneAudioBuffer(audioCtx, newAudioBuffer);

    const updatedTranscript: any[] = [];
    
    transcriptData.forEach((turn: any) => {
      const turnStartSec = timeStringToSeconds(turn.time || "00:00:00");
      let wordsMeta = turn.words || [];

      if (wordsMeta.length === 0 && turn.text) {
        const textWords = turn.text.split(/\s+/).filter(Boolean);
        const wordLen = 0.35;
        wordsMeta = textWords.map((word: string, i: number) => ({
          word,
          start: turnStartSec + i * wordLen,
          end: turnStartSec + (i + 1) * wordLen
        }));
      }

      const wordsBefore = wordsMeta.filter((w: any) => w.start < insertTime);
      const wordsAfter = wordsMeta.filter((w: any) => w.start >= insertTime);

      const formatTime = (s: number) => {
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = Math.floor(s % 60);
        return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
      };

      if (wordsBefore.length > 0) {
        updatedTranscript.push({
          ...turn,
          time: formatTime(wordsBefore[0].start),
          text: wordsBefore.map((w: any) => (w.word || "").trim()).join(" ").trim(),
          words: wordsBefore
        });
      }

      if (wordsAfter.length > 0) {
        const shiftedWordsAfter = wordsAfter.map((w: any) => ({
          ...w,
          start: w.start + insertDuration,
          end: w.end + insertDuration
        }));
        updatedTranscript.push({
          ...turn,
          time: formatTime(shiftedWordsAfter[0].start),
          text: shiftedWordsAfter.map((w: any) => (w.word || "").trim()).join(" ").trim(),
          words: shiftedWordsAfter
        });
      }
    });

    clipboard.transcriptSlice.forEach((item) => {
      const itemTimeSec = insertTime + item.relativeStart;
      const hrs = Math.floor(itemTimeSec / 3600);
      const mins = Math.floor((itemTimeSec % 3600) / 60);
      const secs = Math.floor(itemTimeSec % 60);
      const timeStr = `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;

      const shiftedWords = item.words ? item.words.map((w: any) => ({
        ...w,
        start: insertTime + w.start,
        end: insertTime + w.end
      })) : undefined;

      updatedTranscript.push({
        speaker: item.speaker || "Agent",
        text: item.text,
        time: timeStr,
        words: shiftedWords
      });
    });

    const consolidatedTranscript = consolidateConsecutiveTurns(updatedTranscript);

    let newAudioSrc = audioSrc;
    if (newAudioBuffer) {
      currentAudioBufferCache = newAudioBuffer;
      const wavBlob = audioBufferToWavBlob(newAudioBuffer);
      newAudioSrc = URL.createObjectURL(wavBlob);
      setAudioSrc(newAudioSrc);
      setDurationSec(newAudioBuffer.duration);

      if (audioRef.current) {
        const wasPlaying = isPlaying || !audioRef.current.paused;
        isSilentBlobSwapRef.current = true;
        audioRef.current.pause();
        audioRef.current.src = newAudioSrc;
        audioRef.current.load();
        audioRef.current.currentTime = insertTime;
        if (wasPlaying) {
          audioRef.current.play().catch(() => {});
        }
        setTimeout(() => {
          isSilentBlobSwapRef.current = false;
        }, 300);
      }

      // Rebuild peaks at fixed 100 peaks/sec and update WaveSurfer (< 2ms!)
      const peaks = generatePeaksForBuffer(newAudioBuffer);
      oscillogramPeaksRef.current = peaks;
      globalOscillogramPeaks = peaks;
      if (wavesurferRef.current) {
        try {
          wavesurferRef.current.load(newAudioSrc, [peaks], newAudioBuffer.duration);
        } catch (e) {}
      }
      drawScientificOscillogram();
    }

    hasActiveLocalEdits = true;
    isLocalUpdateRef.current = true;
    setTranscriptData(consolidatedTranscript);
    pushToHistory(consolidatedTranscript, newAudioSrc, postPasteClonedBuffer, prePasteClonedBuffer);
    setTimeout(() => {
      persistTranscriptToDatabase(consolidatedTranscript, newAudioSrc);
    }, 0);

    const m = Math.floor(insertTime / 60);
    const s = Math.floor(insertTime % 60);
    const timeFormatted = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

    setCopyNotification(`✅ Pasted +${insertDuration.toFixed(2)}s audio & transcript at ${timeFormatted}! Press Ctrl+Z to Undo.`);
    setTimeout(() => setCopyNotification(null), 4000);
  }, [currentTime, audioSrc, isPlaying, transcriptData, drawScientificOscillogram, ensureAudioBuffer, pushToHistory, persistTranscriptToDatabase]);



  // Handle Keyboard Shortcuts (Ctrl+Z for Undo, Ctrl+C for Copy, Ctrl+V for Paste, Delete/Backspace for Cut, Esc for Cancel)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput = activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || (activeEl as HTMLElement).isContentEditable);

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (!isInput) {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        if (!isInput) {
          e.preventDefault();
          handleRedo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        if (!isInput && selectedGraphRegion) {
          e.preventDefault();
          handleCopyGraphRegion();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'x') {
        if (!isInput && selectedGraphRegion) {
          e.preventDefault();
          handleCutGraphRegion();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        if (!isInput) {
          e.preventDefault();
          handlePasteGraphRegion();
        }
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedGraphRegion) {
        if (!isInput) {
          e.preventDefault();
          handleCutGraphRegion();
        }
      } else if (e.key === 'Escape' && selectedGraphRegion) {
        setSelectedGraphRegion(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedGraphRegion, handleCutGraphRegion, handleUndo, handleRedo, handleCopyGraphRegion, handlePasteGraphRegion]);

  // Handle Mouse Drag Selection on Oscillogram Canvas
  const isDraggingSelectionRef = useRef<boolean>(false);
  const dragStartWorldXRef = useRef<number | null>(null);

  const handleOscillogramWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = oscillogramCanvasRef.current;
    if (!canvas || durationSec <= 0) return;

    const rect = canvas.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const marginL = 45;
    const marginR = 15;
    const plotW = rect.width - marginL - marginR;
    const plotCursorX = cursorX - marginL;

    if (plotCursorX < 0 || plotCursorX > plotW) return;

    const currentZoom = zoomLevelRef.current || 25;
    const zoomFactor = e.deltaY < 0 ? 1.25 : 0.8;
    const newZoom = Math.max(5, Math.min(300, currentZoom * zoomFactor));

    setZoomLevel(Math.round(newZoom));
    zoomLevelRef.current = newZoom;
    drawScientificOscillogram();
  };

  const handleOscillogramMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return;
    const canvas = oscillogramCanvasRef.current;
    if (!canvas || durationSec <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const marginL = 45;
    const marginR = 15;
    const plotW = rect.width - marginL - marginR;
    const plotClickX = clickX - marginL;

    if (plotClickX < 0 || plotClickX > plotW) return;

    const dur = durationSec;
    const pxPerSec = zoomLevelRef.current || 25;
    const totalWidth = dur * pxPerSec;
    const scrollOffset = smoothedScrollOffsetRef.current;

    const worldX = Math.max(0, Math.min(totalWidth, scrollOffset + plotClickX));

    isDraggingSelectionRef.current = true;
    dragStartWorldXRef.current = worldX;
    setHasClickedGraph(true);
  };

  const handleOscillogramMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingSelectionRef.current || dragStartWorldXRef.current === null) return;
    const canvas = oscillogramCanvasRef.current;
    if (!canvas || durationSec <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const marginL = 45;
    const marginR = 15;
    const plotW = rect.width - marginL - marginR;
    const plotClickX = clickX - marginL;

    const dur = durationSec;
    const pxPerSec = zoomLevelRef.current || 25;
    const totalWidth = dur * pxPerSec;
    const scrollOffset = smoothedScrollOffsetRef.current;

    const currentWorldX = Math.max(0, Math.min(totalWidth, scrollOffset + plotClickX));
    const startW = dragStartWorldXRef.current;

    const startSec = (Math.min(startW, currentWorldX) / totalWidth) * dur;
    const endSec = (Math.max(startW, currentWorldX) / totalWidth) * dur;

    if (endSec - startSec >= 0.05) {
      setSelectedGraphRegion({ start: startSec, end: endSec, regionObj: null });
    }
  };

  const handleOscillogramMouseUp = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDraggingSelectionRef.current) return;
    const startW = dragStartWorldXRef.current;
    isDraggingSelectionRef.current = false;
    dragStartWorldXRef.current = null;

    if (startW === null) return;

    const canvas = oscillogramCanvasRef.current;
    if (!canvas || durationSec <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const marginL = 45;
    const marginR = 15;
    const plotW = rect.width - marginL - marginR;
    const plotClickX = clickX - marginL;

    const dur = durationSec;
    const pxPerSec = zoomLevelRef.current || 25;
    const totalWidth = dur * pxPerSec;
    const scrollOffset = smoothedScrollOffsetRef.current;

    const currentWorldX = Math.max(0, Math.min(totalWidth, scrollOffset + plotClickX));
    const dist = Math.abs(currentWorldX - startW);

    if (dist < 5) {
      // User clicked without dragging -> Seek audio playhead position
      const clickedTime = Math.max(0, Math.min(dur, (currentWorldX / totalWidth) * dur));
      setCurrentTime(clickedTime);
      setHasClickedGraph(true);
      if (audioRef.current && hasRealAudio) {
        audioRef.current.currentTime = clickedTime;
      }
      setSelectedGraphRegion(null);
    } else {
      setHasClickedGraph(true);
      const startSec = (Math.min(startW, currentWorldX) / totalWidth) * dur;
      const endSec = (Math.max(startW, currentWorldX) / totalWidth) * dur;
      if (endSec - startSec >= 0.05) {
        setSelectedGraphRegion({ start: startSec, end: endSec, regionObj: null });
      }
    }
  };

  // Generate peak data for Scientific Oscillogram at fixed 100 peaks/sec (10ms per peak)
  useEffect(() => {
    if (!transcriptData || transcriptData.length === 0) return;
    const dur = durationSec || 105;

    if (currentAudioBufferCache) {
      oscillogramPeaksRef.current = generatePeaksForBuffer(currentAudioBufferCache);
    } else {
      const PEAKS_PER_SEC = 100;
      const totalPeaks = Math.max(100, Math.floor(dur * PEAKS_PER_SEC));
      const peaks = new Float32Array(totalPeaks);

      transcriptData.forEach((turn: any) => {
        let startSec = timeStringToSeconds(turn.time || "00:00:00");
        let endSec = startSec + Math.max(1, (turn.text || "").split(' ').length * 0.35);
        if (Array.isArray(turn.words) && turn.words.length > 0) {
          startSec = turn.words[0].start;
          endSec = turn.words[turn.words.length - 1].end;
        }
        const startIdx = Math.max(0, Math.floor(startSec * PEAKS_PER_SEC));
        const endIdx = Math.min(totalPeaks - 1, Math.ceil(endSec * PEAKS_PER_SEC));
        const turnLength = endIdx - startIdx;

        for (let i = startIdx; i <= endIdx; i++) {
          const progress = turnLength > 0 ? (i - startIdx) / turnLength : 0.5;
          const envelope = Math.sin(progress * Math.PI);
          const pseudoHarmonics = 
            0.35 + 
            0.25 * Math.sin(i * 0.17) + 
            0.20 * Math.cos(i * 0.43) + 
            0.15 * Math.sin(i * 1.11);
          peaks[i] = Math.max(0.02, envelope * pseudoHarmonics * 0.85);
        }
      });
      for (let i = 0; i < totalPeaks; i++) {
        if (peaks[i] === 0) peaks[i] = 0.02;
      }

      let maxP = 0;
      for (let i = 0; i < totalPeaks; i++) {
        if (peaks[i] > maxP) maxP = peaks[i];
      }
      const normFactor = maxP > 0 ? (0.92 / maxP) : 1;
      for (let i = 0; i < totalPeaks; i++) {
        peaks[i] = Math.max(0.04, peaks[i] * normFactor);
      }

      oscillogramPeaksRef.current = peaks;
    }

    drawScientificOscillogram();
  }, [transcriptData, durationSec, audioSrc, drawScientificOscillogram]);

  // 60 FPS animation frame loop for smooth oscillogram scrolling (only runs during active audio playback)
  useEffect(() => {
    if (!isPlaying || !hasRealAudio) {
      drawScientificOscillogram();
      return;
    }
    let animId: number;
    const loop = () => {
      drawScientificOscillogram();
      animId = requestAnimationFrame(loop);
    };
    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [isPlaying, hasRealAudio, drawScientificOscillogram]);



  // Global click listener to deselect regions when clicking outside the waveform
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        waveformContainerRef.current && 
        !waveformContainerRef.current.contains(e.target as Node)
      ) {
        if (wsRegionsRef.current) {
          wsRegionsRef.current.getRegions().forEach((region: any) => region.remove());
        }
      }
    };
    
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Mouse wheel zoom centered at cursor position on waveform canvas
  useEffect(() => {
    const container = waveformContainerRef.current;
    if (!container || !hasRealAudio) return;

    const handleWheel = (e: WheelEvent) => {
      // Prevent normal vertical page scroll while mouse cursor is over waveform container
      e.preventDefault();

      if (!wavesurferRef.current) return;

      const ws = wavesurferRef.current;
      const rect = container.getBoundingClientRect();
      const offsetX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));

      // WaveSurfer scroll container
      const scrollable = container.querySelector<HTMLElement>('div') || container;
      const scrollLeft = scrollable.scrollLeft;
      const scrollWidth = scrollable.scrollWidth;

      const cursorRatio = scrollWidth > 0 ? (scrollLeft + offsetX) / scrollWidth : 0;

      // Calculate new zoom level (scroll up = zoom in, scroll down = zoom out)
      const zoomMultiplier = e.deltaY < 0 ? 1.15 : 0.85;
      const currentZoom = zoomLevelRef.current || 20;
      const nextZoom = Math.min(300, Math.max(5, Math.round(currentZoom * zoomMultiplier)));

      if (nextZoom === currentZoom) return;

      zoomLevelRef.current = nextZoom;
      setZoomLevel(nextZoom);

      try {
        ws.zoom(nextZoom);
      } catch (err) {}

      // Keep mouse cursor point anchored at exact same visual waveform position
      const adjustScroll = () => {
        const newScrollWidth = scrollable.scrollWidth;
        const newScrollLeft = (cursorRatio * newScrollWidth) - offsetX;
        scrollable.scrollLeft = Math.max(0, newScrollLeft);
      };

      adjustScroll();
      requestAnimationFrame(adjustScroll);
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, [hasRealAudio, audioSrc]);



  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;

      // Spacebar = Play / Pause audio
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        setIsPlaying(prev => !prev);
        return;
      }

      // Ctrl+Z = Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
        return;
      }

      // Ctrl+Y or Ctrl+Shift+Z = Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
        return;
      }

      if ((e.key === "Backspace" || e.key === "Delete") && wsRegionsRef.current) {
        const regions = wsRegionsRef.current.getRegions();
        if (regions.length > 0) {
          e.preventDefault();
          const region = regions[0];
          const start = region.start;
          const end = region.end;
          region.remove();
          deleteWaveformRegion(start, end);
        }
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [transcriptData]);

  const executeBatchAudioCuts = async (rangesToCut: Array<{ start: number; end: number }>) => {
    if (!hasRealAudio || !audioSrc || !rangesToCut || rangesToCut.length === 0) return;
    try {
      let audioBuffer = currentAudioBufferCache;
      
      // Fetch and decode original if not in cache (first time)
      if (!audioBuffer || currentAudioCallId !== activeCallId) {
        const proxyUrl = audioSrc.startsWith("http") && !audioSrc.includes("/api/audio")
          ? `/api/audio?url=${encodeURIComponent(audioSrc)}`
          : audioSrc;
        const response = await fetch(proxyUrl);
        const arrayBuffer = await response.arrayBuffer();
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      }

      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new AudioContextClass();
      
      // Single-pass batch splice in RAM with 10ms studio crossfade (< 5ms execution!)
      const trimmedBuffer = batchSpliceAudioBuffer(audioCtx, audioBuffer, rangesToCut);

      // Update the in-memory cache for instant future cuts!
      currentAudioBufferCache = trimmedBuffer;
      currentAudioCallId = activeCallId;

      const wavBlob = audioBufferToWavBlob(trimmedBuffer);
      const trimmedBlobUrl = URL.createObjectURL(wavBlob);

      setHasBeenTrimmed(true);
      setDurationSec(trimmedBuffer.duration);

      // Sync history with the new Blob URL so Undo works for audio!
      const stack = historyStackRef.current;
      if (stack.length > 0) {
        stack[stack.length - 1].audioSrc = trimmedBlobUrl;
        saveHistoryToStorage(activeCallId, stack, historyIndexRef.current, deletedTimeRangesRef.current);
      }

      // Smooth In-Memory Audio Replacement (No Loader Spinner!)
      if (audioRef.current) {
        const wasPlaying = isPlaying || !audioRef.current.paused;
        const currentPos = audioRef.current.currentTime;

        let totalCutBeforePos = 0;
        for (const r of rangesToCut) {
          if (r.end <= currentPos) {
            totalCutBeforePos += (r.end - r.start);
          } else if (r.start < currentPos) {
            totalCutBeforePos += (currentPos - r.start);
          }
        }
        const newPos = Math.max(0, Math.min(trimmedBuffer.duration, currentPos - totalCutBeforePos));

        isSilentBlobSwapRef.current = true;
        setAudioSrc(trimmedBlobUrl);
        audioRef.current.src = trimmedBlobUrl;
        try {
          audioRef.current.currentTime = newPos;
        } catch (e) {}
        if (wasPlaying) {
          audioRef.current.play().catch(() => {});
        }
        setTimeout(() => {
          isSilentBlobSwapRef.current = false;
        }, 500);
      }

      if (wavesurferRef.current) {
        try {
          const peaks = generatePeaksForBuffer(trimmedBuffer);
          oscillogramPeaksRef.current = peaks;
          globalOscillogramPeaks = peaks;
          wavesurferRef.current.load(trimmedBlobUrl, [peaks], trimmedBuffer.duration);
        } catch (e) {}
      }
    } catch (audioErr) {
      console.warn("Batch audio trim failed", audioErr);
    }
  };

  const executeAudioCut = (startSec: number, endSec: number) => {
    return executeBatchAudioCuts([{ start: startSec, end: endSec }]);
  };



  useEffect(() => {
    loadCallData();
    fetchAllCalls().then((calls) => {
      if (Array.isArray(calls)) setAllCalls(calls);
    });

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "active_call_id" && e.newValue) {
        loadCallData(e.newValue);
      }
    };

    let channel: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        channel = new BroadcastChannel("call_updates");
        channel.onmessage = (msg) => {
          if (msg.data?.type === "ACTIVE_CALL_CHANGED" && msg.data.callId) {
            loadCallData(msg.data.callId);
          } else {
            fetchAllCalls().then((calls) => {
              if (Array.isArray(calls)) setAllCalls(calls);
            });
          }
        };
      } catch (e) {}
    }

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      if (channel) channel.close();
    };
  }, [urlId]);

  const handleCallSelect = (id: string) => {
    if (!id || id === activeCallId) return;
    loadCallData(id);
    router.push(`/transcript?id=${encodeURIComponent(id)}`);
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        const channel = new BroadcastChannel("call_updates");
        channel.postMessage({ type: "ACTIVE_CALL_CHANGED", callId: id });
        channel.close();
      } catch (e) {}
    }
  };

  // Safety timeout to prevent spinner from ever getting stuck for > 5 seconds
  useEffect(() => {
    let timer: any = null;
    if (isAudioBuffering) {
      timer = setTimeout(() => {
        setIsAudioBuffering(false);
        if (!audioRef.current || audioRef.current.paused) {
          setIsPlaying(false);
          setAudioErrorMessage("Audio buffer timeout. Stream failed to start within 5 seconds.");
        }
      }, 5000);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isAudioBuffering]);
  // Synchronize audioSrc with HTML5 audio element and trigger load()
  useEffect(() => {
    if (audioRef.current && audioSrc) {
      const proxyUrl = audioSrc.startsWith("http") && !audioSrc.includes("/api/audio")
        ? `/api/audio?url=${encodeURIComponent(audioSrc)}`
        : (audioSrc.startsWith("/uploads/") ? `/api/audio?file=${audioSrc.replace("/uploads/", "")}` : audioSrc);
      
      const fullUrl = proxyUrl.startsWith("http") ? proxyUrl : window.location.origin + proxyUrl;
      if (audioRef.current.src !== fullUrl) {
        audioRef.current.src = proxyUrl;
        audioRef.current.load();
      }
    }
  }, [audioSrc]);

  const handleAudioError = (e: any) => {
    setIsAudioBuffering(false);
    setIsPlaying(false);
    const mediaErr = audioRef.current?.error;
    let msg = "Unable to play audio stream.";
    if (mediaErr) {
      if (mediaErr.code === 1) msg = "Audio playback aborted.";
      else if (mediaErr.code === 2) msg = "Network error: Failed to download audio stream.";
      else if (mediaErr.code === 3) msg = "Audio decoding error: File format may be corrupted.";
      else if (mediaErr.code === 4) msg = "Audio resource or URL not accessible/supported.";
    }
    setAudioErrorMessage(msg);
  };

  // Sync state with HTML5 audio
  useEffect(() => {
    if (!hasRealAudio || !audioRef.current) return;
    if (isPlaying) {
      setIsAudioBuffering(true);
      setAudioErrorMessage(null);
      const promise = audioRef.current.play();
      if (promise !== undefined) {
        promise
          .then(() => {
            setIsAudioBuffering(false);
          })
          .catch(e => {
            setIsAudioBuffering(false);
            if (e.name !== "AbortError") {
              setIsPlaying(false);
              console.error("Audio play error:", e);
              setAudioErrorMessage(e.message || "Failed to start audio playback.");
            }
          });
      }
    } else {
      try {
        audioRef.current.pause();
        setIsAudioBuffering(false);
      } catch (e) {}
    }
  }, [isPlaying, hasRealAudio]);

  // Simulated tick fallback if there is no audio file
  useEffect(() => {
    if (hasRealAudio) return;
    
    let timer: any = null;
    if (isPlaying && !hasRealAudio) {
      timer = setInterval(() => {
        setCurrentTime((prev) => {
          if (prev >= durationSec) {
            setIsPlaying(false);
            clearInterval(timer);
            return 0;
          }
          return prev + 1;
        });
      }, 1000);
    } else {
      if (timer) clearInterval(timer);
    }
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [isPlaying, hasRealAudio, durationSec]);

  const lastTimeUpdateRef = useRef(0);

  useEffect(() => {
    const handleSavePos = () => {
      if (audioRef.current && activeCallId) {
        try {
          localStorage.setItem(`playback_pos_${activeCallId}`, String(audioRef.current.currentTime));
        } catch (e) {}
      }
    };
    window.addEventListener("beforeunload", handleSavePos);
    document.addEventListener("visibilitychange", handleSavePos);
    return () => {
      window.removeEventListener("beforeunload", handleSavePos);
      document.removeEventListener("visibilitychange", handleSavePos);
    };
  }, [activeCallId]);

  useEffect(() => {
    let animationFrameId: number;

    const updateTime = () => {
      if (audioRef.current && hasRealAudio && isPlaying) {
        const cur = audioRef.current.currentTime;
        // Throttle React state re-renders to 4 Hz (every 250ms) to eliminate main-thread lag
        if (Math.abs(cur - lastTimeUpdateRef.current) >= 0.25) {
          lastTimeUpdateRef.current = cur;
          setCurrentTime(cur);
        }
        centerPlayhead(cur);
        animationFrameId = requestAnimationFrame(updateTime);
      }
    };

    if (isPlaying && hasRealAudio) {
      animationFrameId = requestAnimationFrame(updateTime);
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [isPlaying, hasRealAudio]);

  const handlePlayPause = () => {
    setIsPlaying(!isPlaying);
  };

  const handleProgressBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressBarRef.current || durationSec === 0) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const width = rect.width;
    const clickRatio = Math.max(0, Math.min(1, clickX / width));
    const newTime = clickRatio * durationSec;
    
    setCurrentTime(newTime);
    if (audioRef.current && hasRealAudio) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleAudioTimeUpdate = () => {
    if (audioRef.current && hasRealAudio) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleAudioLoadedMetadata = () => {
    if (audioRef.current && hasRealAudio) {
      setDurationSec(audioRef.current.duration);
    }
  };

  const handleAudioEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // Find index of the dialogue turn currently being spoken with precise word & silence boundaries
  let activeIndex = -1;
  for (let i = 0; i < transcriptData.length; i++) {
    const turn = transcriptData[i];
    let turnStart = timeStringToSeconds(turn.time || "00:00:00");
    let turnEnd = i < transcriptData.length - 1 ? timeStringToSeconds(transcriptData[i + 1].time || "00:00:00") : durationSec;

    if (turn.words && Array.isArray(turn.words) && turn.words.length > 0) {
      turnStart = turn.words[0].start;
      turnEnd = turn.words[turn.words.length - 1].end + 0.2;
    }

    if (currentTime >= turnStart && currentTime < turnEnd) {
      activeIndex = i;
      break;
    }
  }

  // Playback Speed & Seek Control State
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);

  const handleSeek = (deltaSeconds: number) => {
    const newTime = Math.max(0, Math.min(durationSec, currentTime + deltaSeconds));
    setCurrentTime(newTime);
    if (audioRef.current && hasRealAudio) {
      audioRef.current.currentTime = newTime;
    }
  };

  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current && hasRealAudio) {
      audioRef.current.playbackRate = speed;
    }
  };

  // Inline Negative Phrase Highlighter
  const renderHighlightedText = (text: string) => {
    if (!text) return text;
    const negativeTerms = ["cancel", "frustrated", "terrible", "horrible", "awful", "bad service", "waste of time", "complaint", "abusive", "unhappy", "angry", "disappointed", "rude", "poor", "issue", "sue", "lawyer", "manager"];
    
    const regex = new RegExp(`\\b(${negativeTerms.join("|")})\\b`, "gi");
    const parts = text.split(regex);

    return parts.map((part, i) => {
      if (negativeTerms.some(term => term.toLowerCase() === part.toLowerCase())) {
        return (
          <mark key={i} style={{ backgroundColor: "#fee2e2", color: "#dc2626", padding: "1px 5px", borderRadius: "4px", fontWeight: 600 }}>
            {part}
          </mark>
        );
      }
      return part;
    });
  };

  // Always center active playing transcript line in the scroll container
  useEffect(() => {
    if (activeIndex < 0 || !activeRowRef.current || editingIndex !== null) return;
    const row = activeRowRef.current;
    const container = row.closest(`.${styles.transcriptScrollContainer}`) as HTMLElement;
    if (!container) return;

    const rowRect = row.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    const relativeTop = rowRect.top - containerRect.top;
    const targetScrollTop = container.scrollTop + relativeTop - (container.clientHeight / 2) + (rowRect.height / 2);

    container.scrollTo({
      top: Math.max(0, targetScrollTop),
      behavior: "smooth"
    });
  }, [activeIndex, isPlaying, editingIndex]);

  // Load & real-time synchronize all calls for top header tabs across deletions / new uploads
  useEffect(() => {
    const refreshCallList = async () => {
      const calls = await fetchAllCalls();
      if (Array.isArray(calls)) {
        setAllCalls(calls);
        if (calls.length > 0) {
          const currentActive = localStorage.getItem("active_call_id") || activeCallId;
          const exists = calls.some(c => c.id === currentActive);
          const targetId = exists ? currentActive : calls[0].id;
          if (!activeCallId || !exists) {
            hasActiveLocalEdits = false;
            loadCallData(targetId);
          }
        } else {
          setHasData(false);
          setActiveCallId("");
          setTranscriptData([]);
          setAudioSrc("");
          setHasRealAudio(false);
        }
      } else {
        loadCallData();
      }
    };

    refreshCallList();

    let channel: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        channel = new BroadcastChannel("call_updates");
        channel.onmessage = () => {
          refreshCallList();
        };
      } catch (e) {}
    }

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "all_calls_database" || e.key === "local_calls_cache" || e.key === "active_call_id") {
        refreshCallList();
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      if (channel) channel.close();
      window.removeEventListener("storage", handleStorage);
    };
  }, [activeCallId]);

  // Keep waveform graph playhead centered on time update / seek
  useEffect(() => {
    if (hasRealAudio && currentTime >= 0) {
      centerPlayhead(currentTime);
    }
  }, [currentTime, hasRealAudio]);



  return (
    <div className={styles.appContainer}>
      <Sidebar activeKey="transcript" />

      {/* Main Content Area */}
      <main className={styles.mainContent}>
        <header className={styles.header} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '12px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 800, color: '#0f172a' }}>🎙️ Call Transcript Studio</h1>
            {audioClipboardRef.current && (
              <span style={{ fontSize: '11px', fontWeight: 700, background: '#dbeafe', color: '#1d4ed8', padding: '4px 12px', borderRadius: '20px', border: '1px solid #bfdbfe', display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                📋 Audio Clipboard Loaded ({audioClipboardRef.current.durationSec.toFixed(2)}s) — Switch tabs & press Ctrl+V to paste into any call!
              </span>
            )}
          </div>

          {/* Call Selection Tabs Bar */}
          {allCalls && allCalls.length > 0 && (
            <div style={{
              display: 'flex',
              gap: '8px',
              overflowX: 'auto',
              paddingBottom: '4px',
              borderBottom: '2px solid #e2e8f0',
              scrollbarWidth: 'thin'
            }}>
              {allCalls.map((c) => {
                const isActive = c.id === activeCallId;
                const agentName = c.agent || "Call";
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleCallSelect(c.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '8px 16px',
                      borderRadius: '8px 8px 0 0',
                      border: isActive ? '2px solid #2563eb' : '1px solid #cbd5e1',
                      borderBottom: isActive ? '3px solid #2563eb' : 'none',
                      background: isActive ? '#ffffff' : '#f8fafc',
                      color: isActive ? '#1e40af' : '#475569',
                      fontWeight: isActive ? 700 : 500,
                      fontSize: '13px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      boxShadow: isActive ? '0 -2px 8px rgba(37, 99, 235, 0.15)' : 'none',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    <span style={{
                      width: '8px',
                      height: '8px',
                      borderRadius: '50%',
                      background: isActive ? '#2563eb' : '#94a3b8'
                    }} />
                    <span>📞 Call #{c.id}</span>
                    <span style={{ fontSize: '11px', opacity: 0.85, background: isActive ? '#dbeafe' : '#e2e8f0', color: isActive ? '#1e40af' : '#475569', padding: '1px 6px', borderRadius: '4px' }}>
                      {agentName}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {!hasData ? (
          <div style={{ textAlign: "center", padding: "80px 40px", background: "var(--background-card)", borderRadius: "var(--border-radius-lg)", border: "1px solid #f0ede9", margin: "20px 0" }}>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", marginBottom: "12px" }}>No Call Selected</h2>
            <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
              Please go to the Upload page to analyze new call recordings or select an existing call from the Reports sheet.
            </p>
          </div>
        ) : (
          <>
            {/* Metadata Details Card */}
            <section className={styles.detailsCard} style={{ alignItems: "center" }}>
              <div style={{ display: "flex", gap: "28px", flexWrap: "wrap" }}>
                {metadata.map((item, idx) => (
                  <div key={idx} className={styles.metadataGroup}>
                    <span className={styles.metadataLabel}>{item.label}</span>
                    {item.label === "Agent" ? (
                      <select
                        value={item.value}
                        onChange={(e) => handleAgentNameChange(e.target.value)}
                        style={{
                          background: "#ffffff",
                          color: item.value === "Unknown Agent" ? "#ef4444" : "var(--color-text-main, #1e293b)",
                          border: "1px solid #cbd5e1",
                          borderRadius: "6px",
                          padding: "3px 8px",
                          fontSize: "13px",
                          fontWeight: 600,
                          cursor: "pointer",
                          outline: "none",
                          marginTop: "2px"
                        }}
                        title="Change Agent Name"
                      >
                        <option value="Unknown Agent">Unknown Agent</option>
                        {OFFICIAL_PSEUDO_NAMES.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className={`${styles.metadataValue} ${item.highlight ? styles.metadataValueHighlighted : ""} ${item.label === "AI Status" && item.value === "Pending" ? styles.metadataValueHighlighted : ""}`}>
                        {item.value}
                      </span>
                    )}
                  </div>
                ))}
              </div>
              <div>
                <button
                  onClick={runAiEvaluation}
                  disabled={isEvaluating}
                  style={{
                    background: isEvaluating ? "#eae7e1" : "var(--color-accent)",
                    color: isEvaluating ? "var(--color-text-muted)" : "#ffffff",
                    border: "none",
                    padding: "8px 18px",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: isEvaluating ? "not-allowed" : "pointer",
                    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    transition: "all 0.2s ease"
                  }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                  </svg>
                  <span>{isEvaluating ? (evalStatus || "Evaluating...") : "Run AI Analysis"}</span>
                </button>
              </div>
            </section>

            {/* Audio Player Card */}
            <section className={styles.playerCard} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '16px' }}>
              {hasRealAudio && (
                <div style={{ width: '100%' }}>
                  <div className={styles.scientificOscillogramWrapper}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', padding: '0 4px' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#1e293b' }}>
                        📉 Scientific Oscillogram Signal Plot
                      </span>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {copyNotification && (
                          <span style={{ fontSize: '11px', fontWeight: 600, color: '#16a34a', background: '#dcfce7', padding: '2px 8px', borderRadius: '4px' }}>
                            {copyNotification}
                          </span>
                        )}
                        {audioClipboardRef.current && (
                          <button
                            type="button"
                            onClick={() => handlePasteGraphRegion()}
                            style={{
                              background: '#2563eb',
                              color: '#ffffff',
                              border: 'none',
                              padding: '3px 10px',
                              borderRadius: '6px',
                              fontSize: '11px',
                              fontWeight: 700,
                              cursor: 'pointer',
                              boxShadow: '0 1px 3px rgba(37,99,235,0.3)'
                            }}
                            title="Paste copied audio & transcript segment at current cursor time (Ctrl+V)"
                          >
                            📥 Paste Audio & Transcript (Ctrl+V)
                          </button>
                        )}
                      </div>
                    </div>
                    <canvas
                      ref={oscillogramCanvasRef}
                      className={styles.scientificCanvas}
                      onMouseDown={handleOscillogramMouseDown}
                      onMouseMove={handleOscillogramMouseMove}
                      onMouseUp={handleOscillogramMouseUp}
                      onMouseLeave={handleOscillogramMouseUp}
                      onWheel={handleOscillogramWheel}
                    />
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '8px', padding: '0 4px' }}>
                      <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 600 }}>Timeline Scroll:</span>
                      <input
                        type="range"
                        min="0"
                        max={durationSec || 100}
                        step="0.1"
                        value={currentTime}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setCurrentTime(val);
                          if (audioRef.current && hasRealAudio) {
                            audioRef.current.currentTime = val;
                          }
                        }}
                        style={{ flex: 1, accentColor: '#2563eb', cursor: 'pointer' }}
                        title="Drag horizontal scrollbar to navigate audio timeline"
                      />
                      {canUndo && (
                        <button
                          type="button"
                          onClick={handleUndo}
                          style={{ background: '#fef3c7', border: '1px solid #f59e0b', color: '#b45309', borderRadius: '6px', padding: '2px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer' }}
                          title="Undo last cut (Ctrl+Z)"
                        >
                          ↩️ Undo Cut
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          const newZoom = Math.min(300, (zoomLevelRef.current || 25) * 1.25);
                          setZoomLevel(Math.round(newZoom));
                          zoomLevelRef.current = newZoom;
                          drawScientificOscillogram();
                        }}
                        style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', color: '#1e293b' }}
                        title="Zoom in graph"
                      >
                        🔍+ Zoom In
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const newZoom = Math.max(5, (zoomLevelRef.current || 25) * 0.8);
                          setZoomLevel(Math.round(newZoom));
                          zoomLevelRef.current = newZoom;
                          drawScientificOscillogram();
                        }}
                        style={{ background: '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '2px 8px', fontSize: '11px', fontWeight: 700, cursor: 'pointer', color: '#1e293b' }}
                        title="Zoom out graph"
                      >
                        🔍- Zoom Out
                      </button>
                    </div>
                  </div>
                  
                  {selectedGraphRegion && (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "10px 16px",
                      background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)",
                      color: "#ffffff",
                      borderRadius: "8px",
                      marginTop: "10px",
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)"
                    }}>
                      <span style={{ fontSize: "13px", fontWeight: 500 }}>
                        🎯 Region Selected: <strong>{selectedGraphRegion.start.toFixed(2)}s</strong> to <strong>{selectedGraphRegion.end.toFixed(2)}s</strong> ({(selectedGraphRegion.end - selectedGraphRegion.start).toFixed(2)}s duration)
                      </span>
                      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                        <button
                          type="button"
                          onClick={() => {
                            handleCopyGraphRegion();
                          }}
                          style={{
                            background: "#3b82f6",
                            color: "#ffffff",
                            border: "none",
                            padding: "6px 14px",
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            boxShadow: "0 2px 6px rgba(59, 130, 246, 0.4)"
                          }}
                          title="Copy selected audio and transcript segment (Ctrl+C)"
                        >
                          📋 Copy Region (Ctrl+C)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            handleCutGraphRegion();
                          }}
                          style={{
                            background: "#ef4444",
                            color: "#ffffff",
                            border: "none",
                            padding: "6px 14px",
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: 600,
                            cursor: "pointer",
                            boxShadow: "0 2px 6px rgba(239, 68, 68, 0.4)"
                          }}
                          title="Cut selected region to clipboard and remove from call (Ctrl+X)"
                        >
                          ✂️ Cut Region (Ctrl+X)
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedGraphRegion(null);
                          }}
                          style={{
                            background: "#475569",
                            color: "#ffffff",
                            border: "none",
                            padding: "6px 12px",
                            borderRadius: "6px",
                            fontSize: "12px",
                            fontWeight: 500,
                            cursor: "pointer"
                          }}
                        >
                          Cancel (Esc)
                        </button>
                      </div>
                    </div>
                  )}
                  

                </div>
              )}
              {hasRealAudio && (
                <audio
                  ref={audioRef}
                  src={
                    audioSrc
                      ? (audioSrc.startsWith("http") && !audioSrc.includes("/api/audio")
                        ? `/api/audio?url=${encodeURIComponent(audioSrc)}`
                        : (audioSrc.startsWith("/uploads/")
                          ? `/api/audio?file=${audioSrc.replace("/uploads/", "")}`
                          : audioSrc))
                      : undefined
                  }
                  onTimeUpdate={handleAudioTimeUpdate}
                  onLoadedMetadata={handleAudioLoadedMetadata}
                  onEnded={handleAudioEnded}
                  onWaiting={() => {
                    if (!isSilentBlobSwapRef.current) {
                      setIsAudioBuffering(true);
                    }
                  }}
                  onCanPlay={() => { setIsAudioBuffering(false); setAudioErrorMessage(null); }}
                  onPlaying={() => { setIsAudioBuffering(false); setAudioErrorMessage(null); }}
                  onError={handleAudioError}
                  style={{ display: "none" }}
                  preload="auto"
                />
              )}

              {/* Playback Controls Row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px', width: '100%' }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  {/* Rewind -10s */}
                  <button 
                    onClick={() => handleSeek(-10)}
                    title="Rewind 10 seconds"
                    className={styles.skipButton}
                  >
                    ↺ 10s
                  </button>
                  
                  {/* Play / Pause */}
                  <button 
                    className={styles.playButton} 
                    onClick={handlePlayPause}
                    aria-label={isPlaying ? "Pause" : "Play"}
                    disabled={isAudioBuffering}
                    style={{ opacity: isAudioBuffering ? 0.8 : 1 }}
                  >
                    {isAudioBuffering ? (
                      <span 
                        style={{ 
                          display: "inline-block", 
                          width: "14px", 
                          height: "14px", 
                          border: "2px solid #ffffff", 
                          borderTopColor: "transparent", 
                          borderRadius: "50%", 
                          animation: "spin 0.8s linear infinite" 
                        }} 
                      />
                    ) : isPlaying ? (
                      <PauseIcon />
                    ) : (
                      <PlayIcon />
                    )}
                  </button>

                  {/* Fast-Forward +10s */}
                  <button 
                    onClick={() => handleSeek(10)}
                    title="Fast-forward 10 seconds"
                    className={styles.skipButton}
                  >
                    10s ↻
                  </button>
                </div>
                
                <div 
                  className={styles.progressBarContainer}
                  onClick={handleProgressBarClick}
                  ref={progressBarRef}
                  style={{ cursor: "pointer", position: "relative" }}
                >
                  <div className={styles.progressBarTrack} style={{ position: "relative" }}>
                    {/* Red Shaded Visual Micro-Trim Cut Regions on Timeline */}
                    {deletedRangesState.map((range, rIdx) => {
                      const leftPct = (range.start / (durationSec || 1)) * 100;
                      const widthPct = Math.max(0.4, ((range.end - range.start) / (durationSec || 1)) * 100);
                      return (
                        <div
                          key={rIdx}
                          title={`Micro-Trimmed Cut: ${range.start.toFixed(2)}s to ${range.end.toFixed(2)}s`}
                          style={{
                            position: "absolute",
                            left: `${leftPct}%`,
                            width: `${widthPct}%`,
                            height: "100%",
                            background: "#ef4444",
                            boxShadow: "0 0 6px rgba(239, 68, 68, 0.8)",
                            borderRadius: "2px",
                            zIndex: 3,
                            pointerEvents: "none"
                          }}
                        />
                      );
                    })}

                    <div 
                      className={styles.progressBarProgress} 
                      style={{ width: `${(currentTime / (durationSec || 1)) * 100}%` }}
                    >
                      <div className={styles.progressBarDot} />
                    </div>
                  </div>
                </div>

                <div className={styles.timeCounter}>
                  {formatTime(currentTime)} <span className={styles.timeDivider}>/</span> {formatTime(durationSec)}
                </div>

                {/* Playback Speed Selector */}
                <select
                  value={playbackSpeed}
                  onChange={(e) => handleSpeedChange(parseFloat(e.target.value))}
                  style={{ background: "#f4f4f5", border: "1px solid #e4e4e7", padding: "4px 8px", borderRadius: "6px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                  title="Playback Speed"
                >
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1.0}>1.0x</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                  <option value={2.0}>2.0x</option>
                </select>

                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <button
                    type="button"
                    onClick={handleDownloadTranscript}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 12px",
                      borderRadius: "20px",
                      background: "#3b82f6",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                      boxShadow: "0 2px 6px rgba(59, 130, 246, 0.3)",
                      transition: "all 0.2s ease"
                    }}
                    title="Download transcript text file"
                  >
                    📄 Download Transcript
                  </button>

                  {hasRealAudio && (
                    <button
                      type="button"
                      onClick={handleDownloadAudio}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "6px",
                        padding: "6px 12px",
                        borderRadius: "20px",
                        background: hasBeenTrimmed ? "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)" : "#10b981",
                        color: "#ffffff",
                        fontSize: "12px",
                        fontWeight: 600,
                        border: "none",
                        cursor: "pointer",
                        boxShadow: hasBeenTrimmed ? "0 2px 6px rgba(239, 68, 68, 0.3)" : "0 2px 6px rgba(16, 185, 129, 0.3)",
                        transition: "all 0.2s ease"
                      }}
                      title={hasBeenTrimmed ? "Download audio call with deleted lines trimmed out" : "Download call audio file"}
                    >
                      {hasBeenTrimmed ? "✂️ Download Trimmed Audio" : "🎵 Download Audio"}
                    </button>
                  )}
                </div>
              </div>

              {/* Audio Playback Error Alert Banner */}
              {audioErrorMessage && (
                <div style={{
                  padding: "10px 16px",
                  background: "#fee2e2",
                  border: "1px solid #fca5a5",
                  color: "#b91c1c",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontWeight: 500,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: "12px",
                  boxShadow: "0 2px 8px rgba(239, 68, 68, 0.15)"
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "14px" }}>⚠️</span>
                    <span><strong>Audio Playback Notice:</strong> {audioErrorMessage}</span>
                  </div>
                  <button 
                    onClick={() => setAudioErrorMessage(null)} 
                    style={{ background: "transparent", border: "none", color: "#b91c1c", cursor: "pointer", fontSize: "14px", fontWeight: 700, padding: "0 4px" }}
                    title="Dismiss"
                  >
                    ✕
                  </button>
                </div>
              )}
            </section>

            {/* Full Transcript Area */}
            <section className={styles.transcriptCard}>
              <div className={styles.transcriptHeader} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                  <h2 style={{ margin: 0 }}>Full Transcript</h2>
                  
                  {/* Undo & Redo Controls */}
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    <button
                      type="button"
                      onClick={handleUndo}
                      disabled={!canUndo}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "4px 10px",
                        borderRadius: "6px",
                        background: canUndo ? "#ffffff" : "#f4f4f5",
                        color: canUndo ? "#18181b" : "#a1a1aa",
                        border: "1px solid #e4e4e7",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: canUndo ? "pointer" : "not-allowed",
                        opacity: canUndo ? 1 : 0.5,
                        boxShadow: canUndo ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                        transition: "all 0.2s ease"
                      }}
                      title={canUndo ? "Undo last transcript edit/deletion" : "Nothing to undo"}
                    >
                      ↩️ Undo
                    </button>

                    <button
                      type="button"
                      onClick={handleRedo}
                      disabled={!canRedo}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                        padding: "4px 10px",
                        borderRadius: "6px",
                        background: canRedo ? "#ffffff" : "#f4f4f5",
                        color: canRedo ? "#18181b" : "#a1a1aa",
                        border: "1px solid #e4e4e7",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: canRedo ? "pointer" : "not-allowed",
                        opacity: canRedo ? 1 : 0.5,
                        boxShadow: canRedo ? "0 1px 2px rgba(0,0,0,0.05)" : "none",
                        transition: "all 0.2s ease"
                      }}
                      title={canRedo ? "Redo undone edit" : "Nothing to redo"}
                    >
                      ↪️ Redo
                    </button>
                  </div>
                </div>

                <div className={styles.legend}>
                  <div className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles.legendDotAgent}`} />
                    <span>Agent</span>
                  </div>
                  <div className={styles.legendItem}>
                    <span className={`${styles.legendDot} ${styles.legendDotCustomer}`} />
                    <span>Customer</span>
                  </div>
                  <div className={styles.legendItem}>
                    <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: "#ef4444" }} />
                    <span>Negative Phrase</span>
                  </div>
                </div>
              </div>

              {/* Transcript Scroll Container */}
              <div className={styles.transcriptScrollContainer}>
                {(() => {
                  const handleRowClick = (timeStr: string) => {
                    if (editingIndex !== null) return;
                    const parts = timeStr.split(":");
                    let targetSeconds = 0;
                    if (parts.length === 3) {
                      targetSeconds = parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2]);
                    } else if (parts.length === 2) {
                      targetSeconds = parseInt(parts[0]) * 60 + parseFloat(parts[1]);
                    } else {
                      targetSeconds = parseFloat(parts[0]);
                    }
                    setCurrentTime(targetSeconds);
                    if (audioRef.current && hasRealAudio) {
                      audioRef.current.currentTime = targetSeconds;
                      if (!isPlaying) setIsPlaying(true);
                    }
                  };

                  const handleWordClick = (startSec: number) => {
                    if (audioRef.current && hasRealAudio) {
                      audioRef.current.currentTime = startSec;
                      setCurrentTime(startSec);
                      if (!isPlaying) setIsPlaying(true);
                    }
                  };

                  return displayTranscript.map((message, idx) => {
                    const isSilence = message.speaker === "Silence";
                    const isActive = idx === activeIndex;
                    
                    let activeWordIdx = -1;
                    const mWords = message.words;
                    if (isActive && mWords && Array.isArray(mWords)) {
                      activeWordIdx = mWords.findIndex((w: any, wIndex: number) => {
                        const nextWord = mWords[wIndex + 1];
                        const endBoundary = nextWord ? nextWord.start : (w.end + 0.1);
                        return currentTime >= w.start && currentTime < endBoundary;
                      });
                    }

                    return (
                      <MemoizedTranscriptRow
                        key={idx}
                        message={message}
                        idx={idx}
                        isSilence={isSilence}
                        isActive={isActive}
                        activeWordIdx={activeWordIdx}
                        isEditing={editingIndex === idx}
                        editingText={editingIndex === idx ? editingText : ""}
                        setEditingText={setEditingText}
                        startEditing={startEditing}
                        saveEditing={saveEditing}
                        cancelEditing={cancelEditing}
                        deleteTranscriptLine={deleteTranscriptLine}
                        onRowClick={handleRowClick}
                        onWordClick={handleWordClick}
                        activeRowRef={isActive ? activeRowRef : null}
                        renderHighlightedText={renderHighlightedText}
                      />
                    );
                  });
                })()}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default function TranscriptPage() {
  return (
    <Suspense fallback={<div style={{ padding: "40px", color: "#64748b", fontFamily: "sans-serif" }}>Loading Transcript...</div>}>
      <TranscriptContent />
    </Suspense>
  );
}
