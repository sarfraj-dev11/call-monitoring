"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import styles from "./page.module.css";
import { useRouter } from "next/navigation";
import { Pencil, Trash2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { doc, updateDoc, onSnapshot, collection } from "firebase/firestore";

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

// Helper to convert AudioBuffer to WAV Blob for downloading trimmed calls
function audioBufferToWavBlob(buffer: AudioBuffer): Blob {
  const numOfChan = buffer.numberOfChannels;
  const length = buffer.length * numOfChan * 2 + 44;
  const out = new DataView(new ArrayBuffer(length));
  let channels: Float32Array[] = [];
  let sampleRate = buffer.sampleRate;
  let offset = 0;
  let pos = 0;

  function writeString(str: string) {
    for (let i = 0; i < str.length; i++) {
      out.setUint8(pos++, str.charCodeAt(i));
    }
  }

  function setUint16(data: number) {
    out.setUint16(pos, data, true);
    pos += 2;
  }

  function setUint32(data: number) {
    out.setUint32(pos, data, true);
    pos += 4;
  }

  writeString('RIFF');
  setUint32(length - 8);
  writeString('WAVE');
  writeString('fmt ');
  setUint32(16);
  setUint16(1);
  setUint16(numOfChan);
  setUint32(sampleRate);
  setUint32(sampleRate * 2 * numOfChan);
  setUint16(numOfChan * 2);
  setUint16(16);
  writeString('data');
  setUint32(length - pos - 4);

  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }

  while (offset < buffer.length) {
    for (let i = 0; i < numOfChan; i++) {
      let sample = Math.max(-1, Math.min(1, channels[i][offset]));
      sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
      out.setInt16(pos, sample, true);
      pos += 2;
    }
    offset++;
  }

  return new Blob([out], { type: 'audio/wav' });
}

export default function TranscriptPage() {
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
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(105);

  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  // Ref to prevent onSnapshot from overwriting local user edits & undo/redo stack
  const isLocalUpdateRef = useRef(false);
  const deletedTimeRangesRef = useRef<Array<{ start: number; end: number }>>([]);

  // Bulletproof Undo / Redo History Management using Refs + React State
  const historyStackRef = useRef<Array<{ transcript: any[]; audioSrc: string }>>([]);
  const historyIndexRef = useRef<number>(-1);

  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const updateUndoRedoState = () => {
    setCanUndo(historyIndexRef.current > 0);
    setCanRedo(historyIndexRef.current < historyStackRef.current.length - 1);
  };

  const saveHistoryToStorage = (callId: string, stack: any[], index: number, ranges: any[]) => {
    if (!callId) return;
    try {
      localStorage.setItem(`history_stack_${callId}`, JSON.stringify({ stack, index, ranges }));
    } catch (e) {}
  };

  const pushToHistory = (newTranscript: any[], newAudioSrc?: string) => {
    const src = newAudioSrc || audioSrc;
    const currentStack = historyStackRef.current;
    const currentIndex = historyIndexRef.current;

    const sliced = currentIndex >= 0 ? currentStack.slice(0, currentIndex + 1) : [];
    const updated = [...sliced, { transcript: JSON.parse(JSON.stringify(newTranscript)), audioSrc: src }];

    historyStackRef.current = updated;
    historyIndexRef.current = updated.length - 1;
    updateUndoRedoState();
    saveHistoryToStorage(activeCallId, updated, updated.length - 1, deletedTimeRangesRef.current);
  };

  const handleUndo = () => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current = historyIndexRef.current - 1;
      const state = historyStackRef.current[historyIndexRef.current];

      isLocalUpdateRef.current = true;
      setTranscriptData(state.transcript);
      if (state.audioSrc && state.audioSrc !== audioSrc) {
        setAudioSrc(state.audioSrc);
        if (audioRef.current) {
          audioRef.current.src = state.audioSrc;
          audioRef.current.load();
        }
      }
      persistTranscriptToDatabase(state.transcript, state.audioSrc);
      updateUndoRedoState();
      saveHistoryToStorage(activeCallId, historyStackRef.current, historyIndexRef.current, deletedTimeRangesRef.current);
    }
  };

  const handleRedo = () => {
    if (historyIndexRef.current < historyStackRef.current.length - 1) {
      historyIndexRef.current = historyIndexRef.current + 1;
      const state = historyStackRef.current[historyIndexRef.current];

      isLocalUpdateRef.current = true;
      setTranscriptData(state.transcript);
      if (state.audioSrc && state.audioSrc !== audioSrc) {
        setAudioSrc(state.audioSrc);
        if (audioRef.current) {
          audioRef.current.src = state.audioSrc;
          audioRef.current.load();
        }
      }
      persistTranscriptToDatabase(state.transcript, state.audioSrc);
      updateUndoRedoState();
      saveHistoryToStorage(activeCallId, historyStackRef.current, historyIndexRef.current, deletedTimeRangesRef.current);
    }
  };

  const persistTranscriptToDatabase = async (transcriptToSave: any[], audioUrlToSave?: string) => {
    if (!activeCallId) return;
    const isBlob = audioUrlToSave?.startsWith("blob:");
    const validUrl = isBlob ? undefined : audioUrlToSave;

    try {
      const callRef = doc(db, "calls", activeCallId);
      await updateDoc(callRef, {
        transcript: transcriptToSave,
        deletedRanges: deletedTimeRangesRef.current || [],
        ...(validUrl ? { audioUrl: validUrl } : {})
      });
    } catch (e) {
      console.warn("Firestore transcript update notice:", e);
    }

    // Backup to localStorage
    const storedDb = localStorage.getItem("all_calls_database");
    if (storedDb) {
      try {
        const localDb = JSON.parse(storedDb);
        const updatedDb = localDb.map((c: any) => {
          if (c.id === activeCallId) {
            return {
              ...c,
              transcript: transcriptToSave,
              deletedRanges: deletedTimeRangesRef.current || [],
              ...(validUrl ? { audioUrl: validUrl } : {})
            };
          }
          return c;
        });
        localStorage.setItem("all_calls_database", JSON.stringify(updatedDb));
        setAllCalls(updatedDb);
      } catch (e) {}
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
        const res = await fetch(proxyUrl);
        const arrayBuffer = await res.arrayBuffer();
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        const audioCtx = new AudioContextClass();
        let trimmedBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        for (const range of deletedTimeRangesRef.current) {
          const sampleRate = trimmedBuffer.sampleRate;
          const channels = trimmedBuffer.numberOfChannels;
          const totalSamples = trimmedBuffer.length;
          const startSample = Math.max(0, Math.floor(range.start * sampleRate));
          const endSample = Math.min(totalSamples, Math.ceil(range.end * sampleRate));
          const cutLength = endSample - startSample;

          if (totalSamples - cutLength > 0) {
            const newBuffer = audioCtx.createBuffer(channels, totalSamples - cutLength, sampleRate);
            for (let ch = 0; ch < channels; ch++) {
              const oldData = trimmedBuffer.getChannelData(ch);
              const newData = newBuffer.getChannelData(ch);
              if (startSample > 0) newData.set(oldData.subarray(0, startSample), 0);
              if (endSample < totalSamples) newData.set(oldData.subarray(endSample, totalSamples), startSample);
            }
            trimmedBuffer = newBuffer;
          }
        }

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

  const loadCallData = (selectedId?: string) => {
    const activeId = selectedId || localStorage.getItem("active_call_id");
    if (!activeId) return;

    setActiveCallId(activeId);
    localStorage.setItem("active_call_id", activeId);

    // Real-Time Listener on active call document in Firestore
    const unsubscribe = onSnapshot(doc(db, "calls", activeId), (docSnap) => {
      if (isLocalUpdateRef.current) {
        isLocalUpdateRef.current = false;
        return;
      }

      if (docSnap.exists()) {
        setHasData(true);
        const activeCall = { id: docSnap.id, ...docSnap.data() } as any;
        const initialTranscript = activeCall.transcript || [];
        setTranscriptData(initialTranscript);
        setMetadata([
          { label: "Call ID", value: activeCall.id, highlight: true },
          { label: "Agent", value: activeCall.agent || "AI Agent" },
          { label: "Date", value: activeCall.date || "N/A" },
          { label: "Duration", value: activeCall.duration || "N/A" },
          { label: "Language", value: activeCall.language || "English" },
          { label: "AI Status", value: activeCall.status || "Pending" },
        ]);
        setDurationSec(activeCall.durationSec || 105);

        let audioFileUrl = activeCall.audioUrl || sessionStorage.getItem("active_audio_blob_url");
        if (audioFileUrl) {
          if (audioFileUrl.startsWith("/uploads/")) {
            const fileName = audioFileUrl.replace("/uploads/", "");
            audioFileUrl = `/api/audio?file=${fileName}`;
          }
          setAudioSrc(audioFileUrl);
          setHasRealAudio(true);
        } else {
          setAudioSrc("");
          setHasRealAudio(false);
        }

        if (Array.isArray(activeCall.deletedRanges)) {
          deletedTimeRangesRef.current = activeCall.deletedRanges;
        }

        // Restore history stack from localStorage if available after page refresh
        const savedHistoryStr = localStorage.getItem(`history_stack_${activeId}`);
        if (savedHistoryStr) {
          try {
            const savedHist = JSON.parse(savedHistoryStr);
            if (savedHist.stack && savedHist.stack.length > 0) {
              historyStackRef.current = savedHist.stack;
              historyIndexRef.current = savedHist.index ?? 0;
              if (Array.isArray(savedHist.ranges)) {
                deletedTimeRangesRef.current = savedHist.ranges;
              }
              updateUndoRedoState();
            }
          } catch (e) {}
        } else if (historyStackRef.current.length === 0) {
          historyStackRef.current = [{ transcript: JSON.parse(JSON.stringify(initialTranscript)), audioSrc: audioFileUrl || "" }];
          historyIndexRef.current = 0;
          updateUndoRedoState();
        }
      }
    }, (err) => {
      console.warn("Firestore call doc snapshot notice:", err);
    });

    return unsubscribe;
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
  };

  const cancelEditing = () => {
    setEditingIndex(null);
    setEditingText("");
  };

  const saveEditing = (index: number) => {
    const updatedTranscript = [...transcriptData];
    updatedTranscript[index] = {
      ...updatedTranscript[index],
      text: editingText
    };
    isLocalUpdateRef.current = true;
    setTranscriptData(updatedTranscript);
    pushToHistory(updatedTranscript);
    persistTranscriptToDatabase(updatedTranscript);

    setEditingIndex(null);
    setEditingText("");
  };

  const deleteTranscriptLine = async (index: number) => {
    const lineToDelete = transcriptData[index];
    if (!lineToDelete) return;

    const tStart = timeStringToSeconds(lineToDelete.time);
    let tEnd = tStart + 4.0;

    if (index < transcriptData.length - 1) {
      const nextTime = timeStringToSeconds(transcriptData[index + 1].time);
      if (nextTime > tStart) {
        tEnd = nextTime;
      }
    }

    const cutDuration = tEnd - tStart;

    // Track deleted time range for instant playback skipping
    deletedTimeRangesRef.current.push({ start: tStart, end: tEnd });

    // 1. Shift remaining transcript timestamps backwards by cutDuration
    const updatedTranscript = transcriptData
      .filter((_, i) => i !== index)
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

    // ⚡ INSTANT UI & UNDO UPDATE (< 1ms)! Zero lag!
    isLocalUpdateRef.current = true;
    setTranscriptData(updatedTranscript);
    pushToHistory(updatedTranscript);
    persistTranscriptToDatabase(updatedTranscript);

    // 2. Non-blocking Asynchronous Web Audio Trimming (Background Macro-task)
    if (hasRealAudio && audioSrc) {
      setTimeout(async () => {
        try {
          // Use CORS proxy for remote Firebase URLs to prevent fetch CORS errors
          const proxyUrl = audioSrc.startsWith("http") && !audioSrc.includes("/api/audio")
            ? `/api/audio?url=${encodeURIComponent(audioSrc)}`
            : audioSrc;
          const response = await fetch(proxyUrl);
          const arrayBuffer = await response.arrayBuffer();
          const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
          const audioCtx = new AudioContextClass();
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

          const sampleRate = audioBuffer.sampleRate;
          const channels = audioBuffer.numberOfChannels;
          const totalSamples = audioBuffer.length;

          const cutStartSample = Math.max(0, Math.floor(tStart * sampleRate));
          const cutEndSample = Math.min(totalSamples, Math.ceil(tEnd * sampleRate));
          const cutSampleLength = cutEndSample - cutStartSample;

          if (totalSamples - cutSampleLength > 0) {
            const trimmedBuffer = audioCtx.createBuffer(channels, totalSamples - cutSampleLength, sampleRate);
            for (let channel = 0; channel < channels; channel++) {
              const oldData = audioBuffer.getChannelData(channel);
              const newData = trimmedBuffer.getChannelData(channel);
              // Part 1: before cut
              if (cutStartSample > 0) {
                newData.set(oldData.subarray(0, cutStartSample), 0);
              }
              // Part 2: after cut
              if (cutEndSample < totalSamples) {
                newData.set(oldData.subarray(cutEndSample, totalSamples), cutStartSample);
              }
            }

            const wavBlob = audioBufferToWavBlob(trimmedBuffer);
            const trimmedBlobUrl = URL.createObjectURL(wavBlob);

            setAudioSrc(trimmedBlobUrl);
            setHasBeenTrimmed(true);
            setDurationSec(Math.round(trimmedBuffer.duration));

            // ⚡ FORCE HTML5 <audio> element to load the trimmed audio immediately!
            if (audioRef.current) {
              const wasPlaying = isPlaying || !audioRef.current.paused;
              audioRef.current.src = trimmedBlobUrl;
              audioRef.current.load();
              audioRef.current.currentTime = Math.max(0, Math.min(trimmedBuffer.duration, tStart));
              if (wasPlaying) {
                audioRef.current.play().catch(() => {});
              }
            }
          }
        } catch (audioErr) {
          console.warn("Background audio trimming handled asynchronously:", audioErr);
        }
      }, 10);
    }
  };

  useEffect(() => {
    loadCallData();
  }, []);

  const handleCallSelect = (id: string) => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch (e) {}
    }
    loadCallData(id);
  };

  // Sync state with HTML5 audio
  useEffect(() => {
    if (!hasRealAudio || !audioRef.current) return;
    if (isPlaying) {
      const promise = audioRef.current.play();
      if (promise !== undefined) {
        promise.catch(e => {
          if (e.name !== "AbortError") {
            console.error("Audio play error:", e);
          }
        });
      }
    } else {
      try {
        audioRef.current.pause();
      } catch (e) {}
    }
  }, [isPlaying, hasRealAudio]);

  // Simulated tick fallback if there is no audio file
  useEffect(() => {
    if (hasRealAudio) return;
    
    let timer: any = null;
    if (isPlaying) {
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
      const cur = audioRef.current.currentTime;
      // Skip over any deleted line time ranges instantly with clean margin
      for (const range of deletedTimeRangesRef.current) {
        if (cur >= range.start - 0.02 && cur < range.end) {
          const nextValidTime = range.end + 0.05;
          audioRef.current.currentTime = nextValidTime;
          setCurrentTime(nextValidTime);
          return;
        }
      }
      setCurrentTime(cur);
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

  // Find index of the dialogue turn currently being spoken
  let activeIndex = -1;
  for (let i = 0; i < transcriptData.length; i++) {
    const turnTime = timeStringToSeconds(transcriptData[i].time);
    if (turnTime <= currentTime) {
      activeIndex = i;
    } else {
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

  useEffect(() => {
    if (activeRowRef.current) {
      activeRowRef.current.scrollIntoView({
        behavior: "smooth",
        block: "nearest"
      });
    }
  }, [activeIndex]);

  return (
    <div className={styles.appContainer}>
      <Sidebar activeKey="transcript" />

      {/* Main Content Area */}
      <main className={styles.mainContent}>
        <header className={styles.header}>
          <h1>Transcript</h1>
          {allCalls.length > 0 && (
            <div className={styles.callSelectorContainer}>
              <label htmlFor="call-select" className={styles.callSelectorLabel}>Select Call:</label>
              <select
                id="call-select"
                className={styles.callSelector}
                value={activeCallId}
                onChange={(e) => handleCallSelect(e.target.value)}
              >
                {allCalls.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.id} - {c.agent} ({c.date})
                  </option>
                ))}
              </select>
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
                    <span className={`${styles.metadataValue} ${item.highlight ? styles.metadataValueHighlighted : ""} ${item.label === "AI Status" && item.value === "Pending" ? styles.metadataValueHighlighted : ""}`}>
                      {item.value}
                    </span>
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
            <section className={styles.playerCard}>
              {hasRealAudio && (
                <audio
                  ref={audioRef}
                  src={audioSrc}
                  onTimeUpdate={handleAudioTimeUpdate}
                  onLoadedMetadata={handleAudioLoadedMetadata}
                  onEnded={handleAudioEnded}
                  style={{ display: "none" }}
                />
              )}

              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {/* Rewind -10s */}
                <button 
                  onClick={() => handleSeek(-10)}
                  title="Rewind 10 seconds"
                  style={{ background: "#f4f4f5", border: "none", padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}
                >
                  ↺ 10s
                </button>
                
                {/* Play / Pause */}
                <button 
                  className={styles.playButton} 
                  onClick={handlePlayPause}
                  aria-label={isPlaying ? "Pause" : "Play"}
                >
                  {isPlaying ? <PauseIcon /> : <PlayIcon />}
                </button>

                {/* Fast-Forward +10s */}
                <button 
                  onClick={() => handleSeek(10)}
                  title="Fast-forward 10 seconds"
                  style={{ background: "#f4f4f5", border: "none", padding: "6px 10px", borderRadius: "6px", cursor: "pointer", fontSize: "12px", fontWeight: "600" }}
                >
                  10s ↻
                </button>
              </div>
              
              <div 
                className={styles.progressBarContainer}
                onClick={handleProgressBarClick}
                ref={progressBarRef}
                style={{ cursor: "pointer" }}
              >
                <div className={styles.progressBarTrack}>
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
                {transcriptData.map((message, idx) => {
                  const isSilence = message.speaker === "Silence";
                  return (
                    <div 
                      key={idx} 
                      ref={idx === activeIndex ? activeRowRef : null}
                      className={`${styles.transcriptRow} ${isSilence ? styles.silenceRow : ""} ${idx === activeIndex ? styles.activeRow : ""}`}
                      onClick={() => {
                        if (isSilence) return;
                        const targetSeconds = timeStringToSeconds(message.time);
                        setCurrentTime(targetSeconds);
                        if (audioRef.current && hasRealAudio) {
                          audioRef.current.currentTime = targetSeconds;
                          if (!isPlaying) {
                            setIsPlaying(true);
                          }
                        }
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
                        {editingIndex === idx ? (
                          <div style={{ display: "flex", gap: "8px", width: "100%" }}>
                            <input
                              type="text"
                              value={editingText}
                              onChange={(e) => setEditingText(e.target.value)}
                              className={styles.transcriptEditInput}
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") saveEditing(idx);
                                if (e.key === "Escape") cancelEditing();
                              }}
                            />
                            <button className={styles.saveEditBtn} onClick={() => saveEditing(idx)}>Save</button>
                            <button className={styles.cancelEditBtn} onClick={cancelEditing}>Cancel</button>
                          </div>
                        ) : (
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
                            <span>{renderHighlightedText(message.text)}</span>
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
                })}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
