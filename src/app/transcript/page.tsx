"use client";

import { useState, useEffect, useRef } from "react";
import Sidebar from "@/components/Sidebar";
import styles from "./page.module.css";
import { useRouter } from "next/navigation";

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

  // Playback state
  const [audioSrc, setAudioSrc] = useState<string>("");
  const [hasRealAudio, setHasRealAudio] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSec, setDurationSec] = useState(105);

  const audioRef = useRef<HTMLAudioElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLDivElement>(null);

  const loadCallData = (selectedId?: string) => {
    const storedDb = localStorage.getItem("all_calls_database");
    if (storedDb) {
      try {
        const db = JSON.parse(storedDb);
        setAllCalls(db);
        
        const activeId = selectedId || localStorage.getItem("active_call_id") || (db[0]?.id);
        setActiveCallId(activeId);
        
        const activeCall = db.find((c: any) => c.id === activeId);
        
        if (activeCall) {
          setHasData(true);
          setTranscriptData(activeCall.transcript || []);
          setMetadata([
            { label: "Call ID", value: activeCall.id, highlight: true },
            { label: "Agent", value: activeCall.agent || "AI Agent" },
            { label: "Date", value: activeCall.date || "N/A" },
            { label: "Duration", value: activeCall.duration || "N/A" },
            { label: "Language", value: "English" },
            { label: "AI Status", value: activeCall.status || "Pending" },
          ]);
          setDurationSec(activeCall.durationSec || 105);
          localStorage.setItem("active_call_id", activeCall.id);

          // Bind audio URL
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
        } else {
          setHasData(false);
        }
      } catch (e) {
        console.error("Failed to parse database", e);
        setHasData(false);
      }
    } else {
      setHasData(false);
    }
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
    setTranscriptData(updatedTranscript);

    // Save to database
    const storedDb = localStorage.getItem("all_calls_database");
    if (storedDb && activeCallId) {
      try {
        const db = JSON.parse(storedDb);
        const updatedDb = db.map((c: any) => {
          if (c.id === activeCallId) {
            return {
              ...c,
              transcript: updatedTranscript
            };
          }
          return c;
        });
        localStorage.setItem("all_calls_database", JSON.stringify(updatedDb));
      } catch (e) {
        console.error("Failed to save edited transcript", e);
      }
    }

    setEditingIndex(null);
    setEditingText("");
  };

  useEffect(() => {
    loadCallData();
  }, []);

  const handleCallSelect = (id: string) => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    loadCallData(id);
  };

  // Sync state with HTML5 audio
  useEffect(() => {
    if (!hasRealAudio || !audioRef.current) return;
    if (isPlaying) {
      audioRef.current.play().catch(e => console.error("Audio play error:", e));
    } else {
      audioRef.current.pause();
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

              {hasRealAudio ? (
                <a 
                  className={styles.downloadButton} 
                  href={audioSrc}
                  download="call-audio.mp3"
                  aria-label="Download audio"
                >
                  <DownloadIcon />
                </a>
              ) : (
                <button 
                  className={styles.downloadButton} 
                  style={{ opacity: 0.5, cursor: "not-allowed" }}
                  title="No audio file source available to download"
                  disabled
                >
                  <DownloadIcon />
                </button>
              )}
            </section>

            {/* Full Transcript Area */}
            <section className={styles.transcriptCard}>
              <div className={styles.transcriptHeader}>
                <h2>Full Transcript</h2>
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
                            <button 
                              className={styles.editTranscriptBtn}
                              onClick={(e) => {
                                e.stopPropagation();
                                startEditing(idx, message.text);
                              }}
                              title="Edit transcript line"
                            >
                              ✏️
                            </button>
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
