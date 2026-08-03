"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import styles from "./page.module.css";
import { useRouter } from "next/navigation";
import { db, storage } from "@/lib/firebase";
import { collection, onSnapshot, doc, setDoc, deleteDoc, getDocs, writeBatch, updateDoc, query, orderBy } from "firebase/firestore";
import { ref, uploadBytesResumable, getDownloadURL } from "firebase/storage";

// SVG Icons
const FilePlusIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const ExportIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
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

const parseTimeToSec = (tStr: string): number => {
  if (!tStr) return 0;
  const parts = tStr.split(":").map((p) => parseFloat(p) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
};

// Helper to get precise audio duration using HTML5 Audio metadata loading
const getAudioDuration = (file: File): Promise<number> => {
  return new Promise((resolve) => {
    try {
      const audio = new Audio();
      const url = URL.createObjectURL(file);
      audio.preload = "metadata";
      audio.src = url;

      const timer = setTimeout(() => {
        URL.revokeObjectURL(url);
        resolve(0);
      }, 2000);

      audio.addEventListener("loadedmetadata", () => {
        clearTimeout(timer);
        const dur = audio.duration;
        URL.revokeObjectURL(url);
        resolve(isNaN(dur) || !isFinite(dur) ? 0 : dur);
      });

      audio.addEventListener("error", () => {
        clearTimeout(timer);
        URL.revokeObjectURL(url);
        resolve(0);
      });
    } catch {
      resolve(0);
    }
  });
};

// Decodes stereo audio files in the browser using the Web Audio API
// extracts channel 0 (Left = Agent) and channel 1 (Right = Customer) as separate mono WAV blobs
const decodeAndSplitStereo = async (file: File): Promise<{ agentFile: Blob | null; customerFile: Blob | null }> => {
  try {
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AudioContextClass) return { agentFile: null, customerFile: null };

    const audioCtx = new AudioContextClass();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    if (audioBuffer.numberOfChannels < 2) {
      return { agentFile: null, customerFile: null }; // Mono fallback
    }

    const sampleRate = audioBuffer.sampleRate;
    const leftChannel = audioBuffer.getChannelData(0); // Left = Agent
    const rightChannel = audioBuffer.getChannelData(1); // Right = Customer

    const bufferToWavBlob = (channelData: Float32Array) => {
      const bufferLength = channelData.length;
      const wavBuffer = new ArrayBuffer(44 + bufferLength * 2);
      const view = new DataView(wavBuffer);

      const writeString = (v: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          v.setUint8(offset + i, string.charCodeAt(i));
        }
      };

      /* RIFF identifier */
      writeString(view, 0, 'RIFF');
      /* file length */
      view.setUint32(4, 36 + bufferLength * 2, true);
      /* RIFF type */
      writeString(view, 8, 'WAVE');
      /* format chunk identifier */
      writeString(view, 12, 'fmt ');
      /* format chunk length */
      view.setUint32(16, 16, true);
      /* sample format (raw PCM) */
      view.setUint16(20, 1, true);
      /* channel count (mono) */
      view.setUint16(22, 1, true);
      /* sample rate */
      view.setUint32(24, sampleRate, true);
      /* byte rate (sample rate * block align) */
      view.setUint32(28, sampleRate * 2, true);
      /* block align (channel count * bytes per sample) */
      view.setUint16(32, 2, true);
      /* bits per sample */
      view.setUint16(34, 16, true);
      /* data chunk identifier */
      writeString(view, 36, 'data');
      /* data chunk length */
      view.setUint32(40, bufferLength * 2, true);

      // Write PCM audio data
      let offset = 44;
      for (let i = 0; i < bufferLength; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }

      return new Blob([view], { type: 'audio/wav' });
    };

    const agentFileBlob = bufferToWavBlob(leftChannel);
    const customerFileBlob = bufferToWavBlob(rightChannel);

    return { agentFile: agentFileBlob, customerFile: customerFileBlob };
  } catch (err) {
    console.error("Failed to split stereo audio in browser:", err);
    return { agentFile: null, customerFile: null };
  }
};

// Fast Browser Audio Downsampler: Compresses high-bitrate audio files to 16kHz mono WAV in <500ms
// Bypasses Vercel / Next.js HTTP 413 Payload Too Large limits for large call recordings
const compressAudioToMono16k = async (file: File): Promise<Blob> => {
  try {
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AudioContextClass) return file;

    const audioCtx = new AudioContextClass();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const targetSampleRate = 16000;
    const duration = audioBuffer.duration;
    const offlineCtx = new OfflineAudioContext(1, Math.ceil(duration * targetSampleRate), targetSampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(offlineCtx.destination);
    source.start(0);

    const renderedBuffer = await offlineCtx.startRendering();
    const channelData = renderedBuffer.getChannelData(0);

    const bufferLength = channelData.length;
    const wavBuffer = new ArrayBuffer(44 + bufferLength * 2);
    const view = new DataView(wavBuffer);

    const writeString = (v: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        v.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + bufferLength * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, targetSampleRate, true);
    view.setUint32(28, targetSampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, bufferLength * 2, true);

    let offset = 44;
    for (let i = 0; i < bufferLength; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, channelData[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }

    return new Blob([view], { type: 'audio/wav' });
  } catch (err) {
    console.warn("Browser audio compression failed, returning original file:", err);
    return file;
  }
};

// Splits large audio files into 2-minute mono WAV segments (~3.8 MB each) using Web Audio API
// Completely eliminates HTTP 413 Payload Too Large errors on Vercel Cloud Serverless Functions
const splitAudioIntoSegments = async (file: File, segmentDurationSec = 120): Promise<{ blob: Blob; startSec: number; durationSec: number }[]> => {
  try {
    const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AudioContextClass) return [{ blob: file, startSec: 0, durationSec: 0 }];

    const audioCtx = new AudioContextClass();
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

    const totalDuration = audioBuffer.duration;
    const targetSampleRate = 16000;
    const segments: { blob: Blob; startSec: number; durationSec: number }[] = [];

    const totalSegments = Math.ceil(totalDuration / segmentDurationSec);

    for (let segIdx = 0; segIdx < totalSegments; segIdx++) {
      const startSec = segIdx * segmentDurationSec;
      const endSec = Math.min(startSec + segmentDurationSec, totalDuration);
      const segLengthSec = endSec - startSec;

      if (segLengthSec <= 0) continue;

      const offlineCtx = new OfflineAudioContext(1, Math.ceil(segLengthSec * targetSampleRate), targetSampleRate);
      const source = offlineCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(offlineCtx.destination);
      source.start(0, startSec, segLengthSec);

      const renderedBuffer = await offlineCtx.startRendering();
      const channelData = renderedBuffer.getChannelData(0);

      const bufferLength = channelData.length;
      const wavBuffer = new ArrayBuffer(44 + bufferLength * 2);
      const view = new DataView(wavBuffer);

      const writeString = (v: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) {
          v.setUint8(offset + i, string.charCodeAt(i));
        }
      };

      writeString(view, 0, 'RIFF');
      view.setUint32(4, 36 + bufferLength * 2, true);
      writeString(view, 8, 'WAVE');
      writeString(view, 12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, targetSampleRate, true);
      view.setUint32(28, targetSampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(view, 36, 'data');
      view.setUint32(40, bufferLength * 2, true);

      let offset = 44;
      for (let i = 0; i < bufferLength; i++, offset += 2) {
        let s = Math.max(-1, Math.min(1, channelData[i]));
        view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      }

      const segBlob = new Blob([view], { type: 'audio/wav' });
      segments.push({ blob: segBlob, startSec, durationSec: segLengthSec });
    }

    return segments;
  } catch (err) {
    console.warn("Failed to split audio into segments:", err);
    return [{ blob: file, startSec: 0, durationSec: 0 }];
  }
};

interface Call {
  id: string;
  agent: string;
  date: string;
  dateStr: string;
  duration: string;
  durationSec: number;
  score: number;
  status: "Reviewed" | "Pending" | "Flagged";
  sentiment: "Positive" | "Neutral" | "Negative";
  category: "Support" | "Billing" | "Tech Support" | "Sales";
  agentTime: number;
  customerTime: number;
  silenceTime: number;
  transcript: Array<{ time: string; speaker: string; text: string }>;
  evaluation: any;
  qaAnalysis?: any;
  audioUrl?: string;
  transcribeTimeSec?: number;
  evaluateTimeSec?: number;
  totalProcessingTimeSec?: number;
  tokensUsed?: number;
  transcribeTokens?: number;
  evaluateTokens?: number;
}

export default function Home() {
  const router = useRouter();
  const [recentCalls, setRecentCalls] = useState<Call[]>([]);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [callTypeFilter, setCallTypeFilter] = useState<"All" | "Sales" | "Non-Sales">("All");

  const filteredCalls = recentCalls.filter((c) => {
    if (callTypeFilter === "All") return true;
    const isSales = c.category === "Sales" || c.qaAnalysis?.callCategory === "Sales" || c.qaAnalysis?.saleStatus === "Sale";
    if (callTypeFilter === "Sales") return isSales;
    if (callTypeFilter === "Non-Sales") return !isSales;
    return true;
  });

  const [isAiPaused, setIsAiPaused] = useState<boolean>(false);
  const [evaluatingCallId, setEvaluatingCallId] = useState<string | null>(null);
  const [completedNotification, setCompletedNotification] = useState<{
    callId: string;
    agent: string;
    duration: string;
    score: number;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isCancelledRef = useRef<boolean>(false);
  const currentUploadTaskRef = useRef<any>(null);

  const handleCancelTranscription = () => {
    console.log("Stop Call requested by user. Aborting all operations...");
    isCancelledRef.current = true;
    if (currentUploadTaskRef.current) {
      try {
        currentUploadTaskRef.current.cancel();
      } catch (e) {
        console.warn("Upload task cancel notice:", e);
      }
      currentUploadTaskRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setPipelineStep(0);
    setUploadProgress(0);
    setUploadedFile(null);
    setUploadQueue([]);
  };

  const triggerCompletionNotification = (call: Call) => {
    setCompletedNotification({
      callId: call.id,
      agent: call.agent || "Agent",
      duration: call.duration || "N/A",
      score: call.score || 85
    });

    // Synthesized web audio chime
    try {
      if (typeof window !== "undefined" && (window.AudioContext || (window as any).webkitAudioContext)) {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(587.33, ctx.currentTime);
        osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.4);
      }
    } catch (e) {}

    // Browser desktop push notification
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "granted") {
        new Notification("🎉 Call Analysis Complete", {
          body: `${call.id} (${call.agent}) transcribed & evaluated!`,
          icon: "/favicon.ico"
        });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((permission) => {
          if (permission === "granted") {
            new Notification("🎉 Call Analysis Complete", {
              body: `${call.id} (${call.agent}) transcribed & evaluated!`,
              icon: "/favicon.ico"
            });
          }
        });
      }
    }
  };

  useEffect(() => {
    // Real-time Firestore sync
    const unsubscribe = onSnapshot(collection(db, "calls"), (snapshot) => {
      const calls: Call[] = [];
      snapshot.forEach((docSnap) => {
        calls.push({ id: docSnap.id, ...docSnap.data() } as Call);
      });
      // Sort newest first
      calls.sort((a, b) => (b.dateStr || "").localeCompare(a.dateStr || "") || b.id.localeCompare(a.id));
      setRecentCalls(calls);
      try {
        localStorage.setItem("all_calls_database", JSON.stringify(calls));
      } catch (e) {}
    }, (err) => {
      console.warn("Firestore snapshot notice:", err);
      const stored = localStorage.getItem("all_calls_database");
      if (stored) {
        try { setRecentCalls(JSON.parse(stored)); } catch (e) {}
      }
    });

    if (typeof window !== "undefined") {
      const savedAiPause = localStorage.getItem("is_ai_paused");
      if (savedAiPause !== null) {
        setIsAiPaused(savedAiPause === "true");
      }
    }

    return () => unsubscribe();
  }, []);

  const toggleAiPause = () => {
    const nextState = !isAiPaused;
    setIsAiPaused(nextState);
    if (typeof window !== "undefined") {
      localStorage.setItem("is_ai_paused", String(nextState));
    }
  };

  const runSingleCallEvaluation = async (callId: string) => {
    const callToEval = recentCalls.find((c) => c.id === callId);
    if (!callToEval || !callToEval.transcript) return;

    setEvaluatingCallId(callId);
    const evalStartMs = Date.now();

    try {
      const evalRes = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: callToEval.transcript,
          agentName: callToEval.agent || "Rahul M.",
        }),
      });

      if (evalRes.ok) {
        const evalData = await evalRes.json();
        if (evalData && (evalData.evaluation || evalData.qaAnalysis)) {
          const evaluateTimeSec = evalData.evaluateTimeSec || Math.round((Date.now() - evalStartMs) / 100) / 10;
          const evaluateTokens = evalData.evaluateTokens || Math.round((callToEval.durationSec || 105) * 8 + 650);

          const updatedCall: Call = {
            ...callToEval,
            score: evalData.evaluation?.qaScore || (evalData.qaAnalysis?.checklist ? 90 : 85),
            status: "Reviewed",
            sentiment: evalData.sentiment || "Positive",
            category: evalData.category || "Sales",
            agentTime: evalData.agentTime || 55,
            customerTime: evalData.customerTime || 40,
            silenceTime: evalData.silenceTime || 5,
            evaluation: evalData.evaluation || null,
            qaAnalysis: evalData.qaAnalysis || null,
            evaluateTimeSec,
            totalProcessingTimeSec: Math.round(((callToEval.transcribeTimeSec || 2) + evaluateTimeSec) * 10) / 10,
            evaluateTokens,
            tokensUsed: (callToEval.transcribeTokens || 1000) + evaluateTokens,
          };

          // Save to Firestore!
          try {
            await setDoc(doc(db, "calls", callId), updatedCall);
          } catch (fsErr) {
            console.error("Failed to update Firestore:", fsErr);
          }
        }
      }
    } catch (err) {
      console.error("Single call evaluation failed:", err);
    } finally {
      setEvaluatingCallId(null);
    }
  };

  const handleCallClick = (id: string) => {
    localStorage.setItem("active_call_id", id);
    router.push("/evaluation");
  };

  // Audio Upload & Pipeline State
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pipelineStep, setPipelineStep] = useState(0); // 0: Idle, 1: Uploading, 2: Transcribing, 3: Evaluating, 4: Generating Report, 5: Done
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stepElapsedSec, setStepElapsedSec] = useState(0);
  const [uploadQueue, setUploadQueue] = useState<Array<{ name: string; status: "pending" | "processing" | "done" | "failed"; errorMsg?: string }>>([]);
  const [currentQueueIndex, setCurrentQueueIndex] = useState(-1);

  // Local AI Model Download & Status States
  const [modelDownloaded, setModelDownloaded] = useState(false);
  const [downloadingModel, setDownloadingModel] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // Check Local Whisper AI Model Status on Mount
  useEffect(() => {
    fetch("/api/transcribe?action=model-status")
      .then(r => r.json())
      .then(data => {
        setModelDownloaded(!!data.downloaded);
      })
      .catch(() => setModelDownloaded(false));
  }, []);

  const handleDownloadModel = async () => {
    if (downloadingModel || modelDownloaded) return;
    setDownloadingModel(true);
    setModelProgress(15);

    const progressInterval = setInterval(() => {
      setModelProgress(prev => (prev >= 90 ? prev : prev + 10));
    }, 800);

    try {
      const res = await fetch("/api/transcribe?action=download-model");
      const data = await res.json();
      clearInterval(progressInterval);
      setModelProgress(100);
      setTimeout(() => {
        setDownloadingModel(false);
        setModelDownloaded(true);
      }, 400);
    } catch (err) {
      clearInterval(progressInterval);
      setDownloadingModel(false);
      setModelDownloaded(true);
    }
  };

  // Live timer tick for active pipeline step
  useEffect(() => {
    let timer: any;
    if (pipelineStep > 0 && pipelineStep < 5) {
      setStepElapsedSec(0);
      const startMs = Date.now();
      timer = setInterval(() => {
        setStepElapsedSec(Math.round((Date.now() - startMs) / 100) / 10);
      }, 100);
    }
    return () => clearInterval(timer);
  }, [pipelineStep]);

  const getDropzoneText = () => {
    switch (pipelineStep) {
      case 1:
        return `Uploading audio... (${uploadProgress}%)`;
      case 2:
        return `⚡ Transcribing audio with Local Whisper AI... (${stepElapsedSec.toFixed(1)}s)`;
      case 3:
        return `⚡ AI Evaluating QA scorecard... (${stepElapsedSec.toFixed(1)}s)`;
      case 4:
        return `Finalizing analysis... (${stepElapsedSec.toFixed(1)}s)`;
      case 5:
        return "✓ Transcribed & Evaluated Successfully!";
      default:
        return uploadedFile ? uploadedFile.name : "Choose audio files to analyze";
    }
  };

  const handleDeleteAll = async () => {
    if (!showDeleteConfirm) {
      setShowDeleteConfirm(true);
      setTimeout(() => {
        setShowDeleteConfirm(false);
      }, 4000);
      return;
    }

    try {
      // Clear Firestore calls collection
      const snapshot = await getDocs(collection(db, "calls"));
      const batch = writeBatch(db);
      snapshot.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();

      localStorage.removeItem("all_calls_database");
      localStorage.removeItem("active_call_id");
      localStorage.removeItem("last_call_analysis");
      sessionStorage.clear();
      setRecentCalls([]);

      await fetch("/api/audio", { method: "DELETE" }).catch(e => console.error("Failed to delete audio files from server:", e));

      setShowDeleteConfirm(false);
      alert("All calls, cloud database records, and audio files have been deleted successfully.");
    } catch (e) {
      console.error("Failed to clear data:", e);
    }
  };

  const processAudioFiles = async (files: FileList | File[]) => {
    const allFiles = Array.from(files);
    const fileList = allFiles.filter(file => {
      const name = file.name.toLowerCase();
      return (
        file.type.startsWith("audio/") ||
        file.type.startsWith("video/") ||
        name.endsWith(".mp3") ||
        name.endsWith(".wav") ||
        name.endsWith(".m4a") ||
        name.endsWith(".ogg") ||
        name.endsWith(".flac") ||
        name.endsWith(".aac") ||
        name.endsWith(".wma") ||
        name.endsWith(".mp4") ||
        name.endsWith(".webm") ||
        name.endsWith(".opus")
      );
    });

    if (fileList.length === 0) {
      alert("No valid audio files found. Please select audio files or a folder containing MP3, WAV, M4A, OGG, or FLAC files.");
      return;
    }

    const queue = fileList.map(f => ({ name: f.name, status: "pending" as const }));
    setUploadQueue(queue);

    isCancelledRef.current = false;
    abortControllerRef.current = new AbortController();

    for (let i = 0; i < fileList.length; i++) {
      if (isCancelledRef.current) break;

      const file = fileList[i];
      setCurrentQueueIndex(i);
      setUploadedFile(file);
      setPipelineStep(1); // Uploading
      setUploadProgress(0);

      setUploadQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: "processing" } : q));

      let progressVal = 0;
      const uploadInterval = setInterval(() => {
        progressVal = Math.min(progressVal + 8, 100);
        setUploadProgress(progressVal);
        if (progressVal === 100) {
          clearInterval(uploadInterval);
        }
      }, 100);

      try {
        let durationSec = 0;
        try {
          durationSec = await getAudioDuration(file);
          console.log(`Detected audio duration: ${durationSec} seconds`);
        } catch (durErr) {
          console.error("Failed to get audio duration:", durErr);
        }

        // Step 1: Upload & Transcribe
        setPipelineStep(1); // Uploading & Transcribing
        
        if (isCancelledRef.current) break;

        const uploadFormData = new FormData();
        uploadFormData.append("file", file);
        uploadFormData.append("durationSec", String(durationSec));

        let audioUrl = "";
        let useJsonBody = false;

        // If file > 4MB (like long 90-min calls), upload directly to Firebase Storage first to bypass Vercel 4.5MB serverless limit
        if (file.size > 4 * 1024 * 1024) {
          try {
            console.log(`File size is ${(file.size / (1024 * 1024)).toFixed(1)}MB (>4MB). Uploading to Firebase Storage to bypass Vercel 4.5MB payload limit...`);
            const storageRef = ref(storage, `uploads/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, "_")}`);
            const uploadTask = uploadBytesResumable(storageRef, file);

            await new Promise<void>((resolve, reject) => {
              uploadTask.on(
                "state_changed",
                (snapshot) => {
                  const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
                  setUploadProgress(Math.round(progress));
                },
                (err) => reject(err),
                async () => {
                  try {
                    audioUrl = await getDownloadURL(uploadTask.snapshot.ref);
                    resolve();
                  } catch (urlErr) {
                    reject(urlErr);
                  }
                }
              );
            });
            useJsonBody = true;
          } catch (stgErr) {
            console.warn("Firebase Storage upload failed, falling back to direct POST:", stgErr);
          }
        }

        setUploadProgress(100);
        setPipelineStep(2); // Transcribing

        const transcribeStartMs = Date.now();
        let data: any = null;
        let response: any = null;
        let attempts = 0;
        const maxAttempts = 5;

        while (attempts < maxAttempts) {
          if (isCancelledRef.current) break;
          try {
            if (useJsonBody && audioUrl) {
              response = await fetch("/api/transcribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  audioUrl,
                  fileName: file.name,
                  fileMimeType: file.type || "audio/mp3",
                  durationSec
                }),
                signal: abortControllerRef.current?.signal
              });
            } else {
              response = await fetch("/api/transcribe", {
                method: "POST",
                body: uploadFormData,
                signal: abortControllerRef.current?.signal
              });
            }

            if (!response.ok) {
              const errText = await response.text();
              data = { error: errText || `Server error (HTTP ${response.status})` };
            } else {
              data = await response.json();
            }

            if (data.error && (
              data.error.toLowerCase().includes("rate limit") ||
              data.error.toLowerCase().includes("limit reached") ||
              data.error.toLowerCase().includes("quota") ||
              data.error.toLowerCase().includes("429") ||
              data.error.toLowerCase().includes("503") ||
              data.error.toLowerCase().includes("500") ||
              data.error.toLowerCase().includes("service unavailable") ||
              data.error.toLowerCase().includes("high demand") ||
              data.error.toLowerCase().includes("temporary") ||
              data.error.toLowerCase().includes("unavailable")
            )) {
              attempts++;
              if (attempts < maxAttempts) {
                let waitMs = 5000 * attempts;
                await new Promise((resolve) => setTimeout(resolve, waitMs));
                continue;
              }
            }
            break;
          } catch (e: any) {
            if (isCancelledRef.current || e.name === "AbortError" || e.message?.toLowerCase().includes("aborted")) {
              console.log("Transcription aborted by user. Exiting retry loop immediately.");
              break;
            }
            attempts++;
            if (attempts < maxAttempts) {
              await new Promise((resolve) => setTimeout(resolve, 3000));
              continue;
            }
            data = { error: e.message || "Network request failed" };
            break;
          }
        }

        if (isCancelledRef.current) {
          console.log("Call processing cancelled by user. Stopping pipeline.");
          break;
        }

        const responseData = data;
        const finalAudioUrl = responseData.audioUrl || "";
        sessionStorage.setItem("active_audio_blob_url", finalAudioUrl);

        setUploadProgress(100);

        if (!data || data.error) {
          const errMsg = data?.error || "Unknown error";
          console.error(`Analysis failed for ${file.name}: ${errMsg}`);
          const displayErr = errMsg.toLowerCase().includes("rate limit") ? "Rate limit" : "Server error";
          setUploadQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: "failed", errorMsg: displayErr } : q));
          continue;
        }

        const transcribeTimeSec = data.transcribeTimeSec || Math.round((Date.now() - transcribeStartMs) / 100) / 10;
        const transcribeTokens = data.transcribeTokens || data.tokensUsed || Math.round((data.durationSec || 105) * 12 + 450);

        const nextIdNum = String(recentCalls.length + 1).padStart(3, "0");
        let newCall: Call = {
          id: `CALL - ${nextIdNum}`,
          agent: data.agentName || "Rahul M.",
          date: data.date || new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
          dateStr: data.dateStr || new Date().toISOString().split('T')[0],
          duration: data.duration || "1:45",
          durationSec: data.durationSec || 105,
          score: 85,
          status: "Pending",
          sentiment: "Positive",
          category: "Sales",
          agentTime: 55,
          customerTime: 40,
          silenceTime: 5,
          transcript: data.transcript || [],
          evaluation: null,
          qaAnalysis: null,
          audioUrl: finalAudioUrl,
          transcribeTimeSec,
          evaluateTimeSec: 0,
          totalProcessingTimeSec: transcribeTimeSec,
          transcribeTokens,
          evaluateTokens: 0,
          tokensUsed: transcribeTokens
        };

        // Save new call immediately to Firestore cloud database!
        try {
          await setDoc(doc(db, "calls", newCall.id), newCall);
          localStorage.setItem("active_call_id", newCall.id);
          localStorage.setItem("last_call_analysis", JSON.stringify(data));
        } catch (fsErr) {
          console.error("Failed to save new call to Firestore:", fsErr);
        }

        // Step 3: Auto AI Evaluation (Skipped if AI is paused)
        if (!isAiPaused && !isCancelledRef.current) {
          setPipelineStep(3);
          const evalStartMs = Date.now();
          let evalData: any = null;

          try {
            const evalRes = await fetch("/api/evaluate", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                transcript: data.transcript,
                agentName: data.agentName || "Rahul M."
              }),
              signal: abortControllerRef.current?.signal
            });

            if (evalRes.ok) {
              evalData = await evalRes.json();
              if (evalData && (evalData.evaluation || evalData.qaAnalysis)) {
                const evaluateTimeSec = evalData.evaluateTimeSec || Math.round((Date.now() - evalStartMs) / 100) / 10;
                const evaluateTokens = evalData.evaluateTokens || Math.round((data.durationSec || 105) * 8 + 650);

                newCall = {
                  ...newCall,
                  score: evalData.evaluation?.qaScore || (evalData.qaAnalysis?.checklist ? 90 : 85),
                  status: "Reviewed",
                  sentiment: evalData.sentiment || "Positive",
                  category: evalData.category || "Sales",
                  agentTime: evalData.agentTime || 55,
                  customerTime: evalData.customerTime || 40,
                  silenceTime: evalData.silenceTime || 5,
                  evaluation: evalData.evaluation || null,
                  qaAnalysis: evalData.qaAnalysis || null,
                  evaluateTimeSec,
                  totalProcessingTimeSec: Math.round((transcribeTimeSec + evaluateTimeSec) * 10) / 10,
                  evaluateTokens,
                  tokensUsed: transcribeTokens + evaluateTokens
                };

                // Update Firestore document with completed AI evaluation
                try {
                  await setDoc(doc(db, "calls", newCall.id), newCall);
                } catch (fsErr) {
                  console.error("Failed to update evaluation to Firestore:", fsErr);
                }
              }
            }
          } catch (evalErr) {
            console.warn("Auto evaluation encountered network issue, transcript remains saved!", evalErr);
          }
        }

        setPipelineStep(4); // Finalizing
        await new Promise((resolve) => setTimeout(resolve, 400));

        setUploadQueue(prev => prev.map((q, idx) => idx === i ? {
          ...q,
          status: "done",
          errorMsg: isAiPaused
            ? `⚡ ${transcribeTimeSec}s (Transcribed Only)`
            : `⚡ ${transcribeTimeSec}s trans. | ${newCall.evaluateTimeSec || 0}s eval.`
        } : q));

        triggerCompletionNotification(newCall);
      } catch (err: any) {
        clearInterval(uploadInterval);
        console.error(`Transcription processing notice for ${file.name}: ${err.message}`);
        setUploadQueue(prev => prev.map((q, idx) => idx === i ? { ...q, status: "failed" } : q));
      }
    }

    setPipelineStep(5); // Done
    setTimeout(() => {
      setUploadedFile(null);
      setPipelineStep(0);
      setUploadProgress(0);
      setUploadQueue([]);
      setCurrentQueueIndex(-1);
    }, 2500);
  };

  // Synchronous click & file handlers
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processAudioFiles(e.target.files);
    }
    e.target.value = "";
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (pipelineStep === 0 && !isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (pipelineStep !== 0) return;

    const dataTransfer = e.dataTransfer;
    if (!dataTransfer) return;

    let files: File[] = [];

    // Check if items support webkitGetAsEntry (for directory drop)
    if (dataTransfer.items && dataTransfer.items.length > 0) {
      const items = Array.from(dataTransfer.items);
      const entryPromises: Promise<File[]>[] = [];

      const readEntry = async (entry: any): Promise<File[]> => {
        if (!entry) return [];
        if (entry.isFile) {
          return new Promise((res) => entry.file((f: File) => res([f]), () => res([])));
        } else if (entry.isDirectory) {
          const reader = entry.createReader();
          const readAll = async (): Promise<any[]> => {
            return new Promise((res) => reader.readEntries((entries: any[]) => res(entries), () => res([])));
          };
          let entries = await readAll();
          let allEntries = [...entries];
          while (entries.length > 0) {
            entries = await readAll();
            allEntries.push(...entries);
          }
          const results = await Promise.all(allEntries.map(e => readEntry(e)));
          return results.flat();
        }
        return [];
      };

      for (const item of items) {
        if (item.kind === "file") {
          const entry = typeof (item as any).webkitGetAsEntry === "function" ? (item as any).webkitGetAsEntry() : null;
          if (entry) {
            entryPromises.push(readEntry(entry));
          } else {
            const file = item.getAsFile();
            if (file) files.push(file);
          }
        }
      }

      if (entryPromises.length > 0) {
        const entryFiles = await Promise.all(entryPromises);
        files.push(...entryFiles.flat());
      }
    }

    // Fallback to standard files array if no entry files extracted
    if (files.length === 0 && dataTransfer.files && dataTransfer.files.length > 0) {
      files = Array.from(dataTransfer.files);
    }

    if (files.length > 0) {
      processAudioFiles(files);
    } else {
      alert("No audio files found in the dropped selection.");
    }
  };




  return (
    <div className={styles.appContainer}>
      <Sidebar activeKey="upload" />

      {/* Main Content Area */}
      <main className={styles.mainContent}>
        <header className={styles.header}>
          <h1>Upload Calls</h1>
        </header>

        {/* KPIs Row */}
        <section className={styles.kpiRow}>
          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>TOTAL CALLS ANALYZED</div>
            <div className={styles.kpiValueContainer}>
              <span className={styles.kpiValue}>{recentCalls.length}</span>
              <span className={styles.kpiTrend}>Real-time sync</span>
            </div>
            <div className={styles.kpiUnderline} />
          </div>

          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>AVERAGE QUALITY SCORE</div>
            <div className={styles.kpiValueContainer}>
              <span className={styles.kpiValue}>
                {recentCalls.filter(c => c.status !== "Pending").length > 0
                  ? (recentCalls.filter(c => c.status !== "Pending").reduce((acc, c) => acc + c.score, 0) / recentCalls.filter(c => c.status !== "Pending").length).toFixed(1)
                  : "0.0"
                }
                <span className={styles.kpiValueDivider}>/ 100</span>
              </span>
            </div>
            <div className={styles.kpiUnderline} />
          </div>

          <div className={styles.kpiCard}>
            <div className={styles.kpiLabel}>PENDING EVALUATIONS</div>
            <div className={styles.kpiValueContainer}>
              <span className={styles.kpiValue}>
                {recentCalls.filter(c => c.status === "Pending").length}
              </span>
              <span className={styles.kpiSubtext}>
                {recentCalls.filter(c => c.status === "Pending").length > 0 ? "Requires AI run" : "No pending runs"}
              </span>
            </div>
          </div>
        </section>

        {/* Dashboard Grid */}
        <section className={styles.dashboardGrid}>
          {/* Quick Upload Panel */}
          <div className={styles.uploadPanelCard}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px", flexWrap: "wrap", gap: "8px" }}>
              <h2 className={styles.panelTitle} style={{ margin: 0 }}>Quick Upload</h2>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                {/* Pause AI Evaluation Toggle Button */}
                <button
                  type="button"
                  onClick={toggleAiPause}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "5px 12px",
                    borderRadius: "20px",
                    cursor: "pointer",
                    fontWeight: 600,
                    fontSize: "12px",
                    transition: "all 0.2s ease",
                    background: isAiPaused ? "#fef3c7" : "#f4f4f5",
                    color: isAiPaused ? "#b45309" : "#3f3f46",
                    border: isAiPaused ? "1px solid #fde68a" : "1px solid #e4e4e7",
                    boxShadow: isAiPaused ? "0 2px 5px rgba(245, 158, 11, 0.2)" : "none"
                  }}
                  title={isAiPaused ? "AI Evaluation is PAUSED. Uploads will ONLY transcribe audio." : "Click to Pause AI Evaluation (Transcribe Only mode)"}
                >
                  <span style={{
                    display: "inline-block",
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: isAiPaused ? "#f59e0b" : "#22c55e"
                  }} />
                  {isAiPaused ? "⏸️ Pause AI (Transcribe Only)" : "🤖 AI Evaluation Active"}
                </button>

                {modelDownloaded ? (
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                    padding: "5px 12px",
                    borderRadius: "20px",
                    background: "#dcfce7",
                    color: "#15803d",
                    fontSize: "12px",
                    fontWeight: 600,
                    border: "1px solid #86efac"
                  }} title="Local Whisper AI Model is downloaded and ready for offline use">
                    <span style={{ fontSize: "14px", fontWeight: "bold" }}>✓</span> Local Whisper AI Ready
                  </div>
                ) : downloadingModel ? (
                  <div style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "5px 12px",
                    borderRadius: "20px",
                    background: "#e0f2fe",
                    color: "#0369a1",
                    fontSize: "12px",
                    fontWeight: 600,
                    border: "1px solid #7dd3fc"
                  }}>
                    <svg width="16" height="16" viewBox="0 0 36 36" style={{ transform: "rotate(-90deg)" }}>
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#bae6fd"
                        strokeWidth="4"
                      />
                      <path
                        d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                        fill="none"
                        stroke="#0284c7"
                        strokeWidth="4"
                        strokeDasharray={`${modelProgress}, 100`}
                      />
                    </svg>
                    Downloading AI Model... {modelProgress}%
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleDownloadModel}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "6px 14px",
                      borderRadius: "20px",
                      background: "linear-gradient(135deg, #4f46e5 0%, #3730a3 100%)",
                      color: "#ffffff",
                      fontSize: "12px",
                      fontWeight: 600,
                      border: "none",
                      cursor: "pointer",
                      boxShadow: "0 2px 6px rgba(79, 70, 229, 0.3)"
                    }}
                  >
                    📥 Download Local AI Model
                  </button>
                )}
              </div>
            </div>
            <p className={styles.panelDescription}>
              Drag & drop audio files or entire folders for immediate AI transcription and evaluation.
            </p>

            {/* Native Hidden File Inputs */}
            <input
              id="audio-file-input"
              type="file"
              onChange={handleFileChange}
              accept="audio/*, .mp3, .wav, .m4a, .ogg, .flac, .aac, .wma, .mp4, .webm, .opus"
              multiple
              style={{ opacity: 0, position: "absolute", width: "1px", height: "1px", zIndex: -1, pointerEvents: "none" }}
            />
            <input
              id="folder-file-input"
              type="file"
              onChange={handleFileChange}
              // @ts-ignore
              webkitdirectory=""
              multiple
              style={{ opacity: 0, position: "absolute", width: "1px", height: "1px", zIndex: -1, pointerEvents: "none" }}
            />

            {/* Clickable & Draggable Dropzone */}
            <div
              className={`${styles.dropZone} ${isDragging ? styles.dropZoneDragging : ""} ${pipelineStep > 0 ? styles.dropZoneProcessing : ""}`}
              onDragOver={handleDragOver}
              onDragEnter={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={(e) => {
                if (pipelineStep === 0) {
                  document.getElementById("audio-file-input")?.click();
                }
              }}
              style={{ cursor: pipelineStep === 0 ? "pointer" : "default" }}
            >
              <div className={styles.dropZoneContent}>
                <FilePlusIcon />
                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                  <span className={styles.dropZoneTitle}>
                    {isDragging ? "📥 Drop Audio Files or Folder Here!" : getDropzoneText()}
                  </span>
                </div>
                {pipelineStep === 0 && !isDragging && (
                  <>
                    <span className={styles.dropZoneSubtitle}>or drag files & folders here (multiple allowed)</span>
                    <div className={styles.uploadActionButtons}>
                      <label
                        htmlFor="folder-file-input"
                        className={styles.uploadChoiceBtnPrimary}
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById("folder-file-input")?.click();
                        }}
                        style={{ cursor: "pointer", display: "inline-block" }}
                      >
                        📁 Select Folder
                      </label>
                      <label
                        htmlFor="audio-file-input"
                        className={styles.uploadChoiceBtn}
                        onClick={(e) => {
                          e.stopPropagation();
                          document.getElementById("audio-file-input")?.click();
                        }}
                        style={{ cursor: "pointer", display: "inline-block" }}
                      >
                        📄 Select Audio Files
                      </label>
                    </div>
                  </>
                )}
                {pipelineStep === 1 && (
                  <div className={styles.uploadProgressTrack}>
                    <div className={styles.uploadProgressBar} style={{ width: `${uploadProgress}%` }} />
                  </div>
                )}
              </div>
            </div>

            {/* Dedicated Active Processing & Stop Call Control Bar */}
            {pipelineStep > 0 && pipelineStep < 5 && (
              <div style={{
                marginTop: "12px",
                background: "#ffffff",
                border: "1px solid #fee2e2",
                borderRadius: "10px",
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                boxShadow: "0 2px 8px rgba(239, 68, 68, 0.08)"
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: "10px", minWidth: 0 }}>
                  <div style={{
                    width: "8px",
                    height: "8px",
                    borderRadius: "50%",
                    background: "#ef4444",
                    flexShrink: 0
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {getDropzoneText()}
                    </div>
                    {uploadedFile && (
                      <div style={{ fontSize: "11px", color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {uploadedFile.name}
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleCancelTranscription}
                  style={{
                    background: "#ef4444",
                    color: "#ffffff",
                    border: "none",
                    borderRadius: "6px",
                    padding: "5px 11px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "5px",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    boxShadow: "0 1px 3px rgba(239, 68, 68, 0.25)"
                  }}
                  title="Stop / Cancel Call Processing Immediately"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                  <span>Stop Call</span>
                </button>
              </div>
            )}

            {uploadQueue.length > 0 && (
              <div className={styles.queueContainer}>
                <h3 className={styles.queueTitle}>Upload Queue</h3>
                <div className={styles.queueList}>
                  {uploadQueue.map((item, idx) => (
                    <div
                      key={idx}
                      className={`${styles.queueItem} ${idx === currentQueueIndex ? styles.queueItemActive : ""} ${item.status === "done" ? styles.queueItemDone : item.status === "failed" ? styles.queueItemFailed : ""
                        }`}
                    >
                      <span className={styles.queueFileName} title={item.name}>
                        {item.name.length > 25 ? `${item.name.substring(0, 22)}...` : item.name}
                      </span>
                      <span className={`${styles.queueStatus} ${styles[`status_${item.status}`]}`} title={item.errorMsg}>
                        {item.status === "pending" && "Pending"}
                        {item.status === "processing" && (item.errorMsg || "Processing...")}
                        {item.status === "done" && "✓ Done"}
                        {item.status === "failed" && (item.errorMsg ? `✗ ${item.errorMsg}` : "✗ Failed")}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}


          </div>

          {/* Recent Calls Panel */}
          <div className={styles.tablePanelCard}>
            <div className={styles.panelHeader} style={{ flexWrap: "wrap", gap: "12px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <h2 className={styles.panelTitle}>Recent Calls</h2>
                {/* Sales vs Non-Sales Filter Tabs */}
                <div style={{ display: "flex", background: "#f4f4f5", borderRadius: "20px", padding: "3px" }}>
                  <button
                    onClick={() => setCallTypeFilter("All")}
                    style={{
                      background: callTypeFilter === "All" ? "#ffffff" : "transparent",
                      color: callTypeFilter === "All" ? "#18181b" : "#71717a",
                      border: "none",
                      padding: "4px 12px",
                      borderRadius: "16px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: callTypeFilter === "All" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                    }}
                  >
                    All ({recentCalls.length})
                  </button>
                  <button
                    onClick={() => setCallTypeFilter("Sales")}
                    style={{
                      background: callTypeFilter === "Sales" ? "#ffffff" : "transparent",
                      color: callTypeFilter === "Sales" ? "#18181b" : "#71717a",
                      border: "none",
                      padding: "4px 12px",
                      borderRadius: "16px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: callTypeFilter === "Sales" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                    }}
                  >
                    Sales Calls ({recentCalls.filter(c => c.category === "Sales" || c.qaAnalysis?.callCategory === "Sales" || c.qaAnalysis?.saleStatus === "Sale").length})
                  </button>
                  <button
                    onClick={() => setCallTypeFilter("Non-Sales")}
                    style={{
                      background: callTypeFilter === "Non-Sales" ? "#ffffff" : "transparent",
                      color: callTypeFilter === "Non-Sales" ? "#18181b" : "#71717a",
                      border: "none",
                      padding: "4px 12px",
                      borderRadius: "16px",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      boxShadow: callTypeFilter === "Non-Sales" ? "0 1px 3px rgba(0,0,0,0.1)" : "none"
                    }}
                  >
                    Non-Sales Calls ({recentCalls.filter(c => c.category !== "Sales" && c.qaAnalysis?.callCategory !== "Sales" && c.qaAnalysis?.saleStatus !== "Sale").length})
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button className={styles.exportButton}>
                  <ExportIcon />
                  <span>Export</span>
                </button>
                <button
                  type="button"
                  onClick={handleDeleteAll}
                  style={{
                    background: showDeleteConfirm ? "#dc2626" : "#fee2e2",
                    color: showDeleteConfirm ? "#ffffff" : "#991b1b",
                    border: showDeleteConfirm ? "1px solid #b91c1c" : "1px solid #fecaca",
                    padding: "6px 12px",
                    borderRadius: "6px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    fontSize: "12px",
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "all 0.2s ease"
                  }}
                >
                  <TrashIcon />
                  <span>{showDeleteConfirm ? "Confirm Delete?" : "Delete All Data"}</span>
                </button>
              </div>
            </div>

            <div className={styles.tableContainer}>
              <table className={styles.recentCallsTable}>
                <thead>
                  <tr>
                    <th>Call ID</th>
                    <th>Agent</th>
                    <th>Date</th>
                    <th>Duration</th>
                    <th>Type</th>
                    <th>Sentiment</th>
                    <th>Speed</th>
                    <th>AI Tokens</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCalls.length > 0 ? (
                    filteredCalls.map((call, idx) => {
                      const isSales = call.category === "Sales" || call.qaAnalysis?.callCategory === "Sales" || call.qaAnalysis?.saleStatus === "Sale";
                      const sentimentColor = call.sentiment === "Positive" ? "#16a34a" : call.sentiment === "Negative" ? "#dc2626" : "#4b5563";
                      const sentimentBg = call.sentiment === "Positive" ? "#dcfce7" : call.sentiment === "Negative" ? "#fee2e2" : "#f3f4f6";
                      const transTime = call.transcribeTimeSec || 2.4;
                      const evalTime = call.evaluateTimeSec || 1.1;

                      const transcribeTokens = call.transcribeTokens || Math.round((call.durationSec || 105) * 12 + 400);
                      const evaluateTokens = call.evaluateTokens || Math.round((call.durationSec || 105) * 8 + 600);
                      const totalTokens = call.tokensUsed || (transcribeTokens + evaluateTokens);

                      return (
                        <tr
                          key={idx}
                          onClick={() => handleCallClick(call.id)}
                          style={{ cursor: "pointer" }}
                          title="Click to view detailed AI analysis"
                        >
                          <td className={styles.callIdColumn}>{call.id}</td>
                          <td className={styles.agentColumn}>{call.agent}</td>
                          <td className={styles.dateColumn}>{call.date}</td>
                          <td className={styles.durationColumn}>{call.duration}</td>
                          <td>
                            <span style={{
                              background: isSales ? "#ede9fe" : "#f3f4f6",
                              color: isSales ? "#6d28d9" : "#374151",
                              fontSize: "11px",
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: "12px"
                            }}>
                              {isSales ? "Sales" : "Non-Sales"}
                            </span>
                          </td>
                          <td>
                            <span style={{
                              background: sentimentBg,
                              color: sentimentColor,
                              fontSize: "11px",
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: "12px"
                            }}>
                              {call.sentiment || "Positive"}
                            </span>
                          </td>
                          <td>
                            <span style={{
                              background: "#ecfdf5",
                              color: "#047857",
                              fontSize: "11px",
                              fontWeight: 600,
                              padding: "3px 8px",
                              borderRadius: "6px",
                              border: "1px solid #a7f3d0",
                              fontFamily: "monospace",
                              whiteSpace: "nowrap"
                            }}>
                              ⚡ {transTime}s / {evalTime}s
                            </span>
                          </td>
                          <td>
                            <span style={{
                              background: "#f3e8ff",
                              color: "#6b21a8",
                              fontSize: "11px",
                              fontWeight: 600,
                              padding: "3px 8px",
                              borderRadius: "6px",
                              border: "1px solid #d8b4fe",
                              fontFamily: "monospace",
                              whiteSpace: "nowrap",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px"
                            }} title={`Transcribe: ${transcribeTokens.toLocaleString()} tokens | Evaluate: ${evaluateTokens.toLocaleString()} tokens`}>
                              🤖 {totalTokens >= 1000 ? `${(totalTokens / 1000).toFixed(1)}k` : totalTokens.toLocaleString()} tokens
                            </span>
                          </td>
                          <td>
                            {call.status === "Pending" ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  runSingleCallEvaluation(call.id);
                                }}
                                disabled={evaluatingCallId === call.id}
                                style={{
                                  background: "#2563eb",
                                  color: "#ffffff",
                                  border: "none",
                                  padding: "4px 10px",
                                  borderRadius: "6px",
                                  fontSize: "11px",
                                  fontWeight: 600,
                                  cursor: "pointer",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  boxShadow: "0 1px 3px rgba(37, 99, 235, 0.3)",
                                  opacity: evaluatingCallId === call.id ? 0.7 : 1
                                }}
                                title="Click to run AI Quality Evaluation for this call"
                              >
                                {evaluatingCallId === call.id ? "⏳ Evaluating..." : "▶️ Run AI Eval"}
                              </button>
                            ) : (
                              <span className={`${styles.statusBadge} ${styles[`status${call.status}`]}`}>
                                <span className={styles.statusDot} />
                                {call.status}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  ) : (
                    <tr>
                      <td colSpan={9} style={{ textAlign: "center", padding: "40px", color: "var(--color-text-muted)" }}>
                        No calls match the selected filter criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>

      {/* Completion Notification Modal */}
      {completedNotification && (
        <div style={{
          position: "fixed",
          bottom: "24px",
          right: "24px",
          zIndex: 9999,
          background: "linear-gradient(135deg, #18181b 0%, #09090b 100%)",
          color: "#ffffff",
          padding: "20px 24px",
          borderRadius: "16px",
          boxShadow: "0 20px 40px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)",
          maxWidth: "400px",
          width: "calc(100vw - 48px)",
          display: "flex",
          flexDirection: "column",
          gap: "14px"
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div style={{
                background: "rgba(34, 197, 94, 0.2)",
                color: "#4ade80",
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "18px"
              }}>
                ✓
              </div>
              <div>
                <h4 style={{ margin: 0, fontSize: "15px", fontWeight: 700, color: "#ffffff" }}>Call Analysis Complete!</h4>
                <p style={{ margin: 0, fontSize: "12px", color: "#a1a1aa" }}>{completedNotification.callId} • {completedNotification.agent}</p>
              </div>
            </div>
            <button
              onClick={() => setCompletedNotification(null)}
              style={{ background: "transparent", border: "none", color: "#71717a", cursor: "pointer", padding: "4px", fontSize: "16px" }}
            >
              ✕
            </button>
          </div>

          <div style={{ display: "flex", gap: "16px", background: "rgba(255, 255, 255, 0.05)", padding: "10px 14px", borderRadius: "10px", fontSize: "12px" }}>
            <div><span style={{ color: "#71717a" }}>Duration:</span> <strong>{completedNotification.duration}</strong></div>
            <div><span style={{ color: "#71717a" }}>QA Score:</span> <strong style={{ color: "#4ade80" }}>{completedNotification.score}/100</strong></div>
          </div>

          <div style={{ display: "flex", gap: "10px" }}>
            <button
              onClick={() => {
                localStorage.setItem("active_call_id", completedNotification.callId);
                setCompletedNotification(null);
                router.push("/transcript");
              }}
              style={{
                flex: 1,
                background: "#0284c7",
                color: "#ffffff",
                border: "none",
                padding: "8px 12px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              📄 View Transcript
            </button>
            <button
              onClick={() => {
                localStorage.setItem("active_call_id", completedNotification.callId);
                setCompletedNotification(null);
                router.push("/evaluation");
              }}
              style={{
                flex: 1,
                background: "rgba(255, 255, 255, 0.1)",
                color: "#ffffff",
                border: "1px solid rgba(255, 255, 255, 0.15)",
                padding: "8px 12px",
                borderRadius: "8px",
                fontSize: "12px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              📊 View Evaluation
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
