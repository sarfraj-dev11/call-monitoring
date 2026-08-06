"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import styles from "./Sidebar.module.css";

// SVG Icons
const PhoneIcon = () => (
  <svg className={styles.phoneLogoIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const UploadIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" />
  </svg>
);

const TranscriptIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
);

const EvaluationIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const ReportIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const UserIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

interface SidebarProps {
  activeKey: "upload" | "transcript" | "evaluation" | "report" | "user";
}

export default function Sidebar({ activeKey }: SidebarProps) {
  const router = useRouter();
  const [allCalls, setAllCalls] = useState<any[]>([]);
  const [activeCallId, setActiveCallId] = useState<string>("");

  useEffect(() => {
    const loadSidebarCalls = () => {
      if (typeof window !== "undefined") {
        const stored = localStorage.getItem("all_calls_database");
        if (stored) {
          try {
            const db = JSON.parse(stored);
            setAllCalls(db);
            const searchId = new URLSearchParams(window.location.search).get("id");
            const activeId = searchId || localStorage.getItem("active_call_id") || (db[0]?.id || "");
            setActiveCallId(activeId);
          } catch (e) {
            console.error("Failed to parse db in Sidebar", e);
          }
        }
      }
    };

    loadSidebarCalls();

    const handleStorage = (e: StorageEvent) => {
      if (e.key === "active_call_id" && e.newValue) {
        setActiveCallId(e.newValue);
      } else if (e.key === "all_calls_database") {
        loadSidebarCalls();
      }
    };

    let channel: BroadcastChannel | null = null;
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        channel = new BroadcastChannel("call_updates");
        channel.onmessage = (msg) => {
          if (msg.data?.type === "ACTIVE_CALL_CHANGED" && msg.data.callId) {
            setActiveCallId(msg.data.callId);
          } else {
            loadSidebarCalls();
          }
        };
      } catch (e) {}
    }

    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("storage", handleStorage);
      if (channel) channel.close();
    };
  }, []);

  const handleCallSelect = (id: string) => {
    if (!id) return;
    localStorage.setItem("active_call_id", id);
    setActiveCallId(id);
    if (typeof window !== "undefined") {
      if ("BroadcastChannel" in window) {
        try {
          const channel = new BroadcastChannel("call_updates");
          channel.postMessage({ type: "ACTIVE_CALL_CHANGED", callId: id });
          channel.close();
        } catch (e) {}
      }
      
      const currentPath = window.location.pathname;
      const searchParams = new URLSearchParams(window.location.search);
      if (searchParams.get("id") !== id) {
        router.push(`${currentPath}?id=${encodeURIComponent(id)}`);
      }
    }
  };

  return (
    <aside className={styles.sidebar}>
      <div className={styles.brand}>
        <PhoneIcon />
        <div className={styles.brandText}>
          <span className={styles.brandTitle}>Call monitor</span>
          <span className={styles.brandSubtitle}>AI Analysis</span>
        </div>
      </div>

      {allCalls.length > 0 && (
        <div className={styles.sidebarSelectorContainer}>
          <label htmlFor="sidebar-call-select" className={styles.sidebarSelectorLabel}>
            Active Call
          </label>
          <select
            id="sidebar-call-select"
            className={styles.sidebarSelector}
            value={activeCallId}
            onChange={(e) => handleCallSelect(e.target.value)}
          >
            {allCalls.map((c) => (
              <option key={c.id} value={c.id}>
                {c.id} - {c.agent}
              </option>
            ))}
          </select>
        </div>
      )}

      <nav className={styles.navigation}>
        <Link href="/" className={`${styles.navItem} ${activeKey === "upload" ? styles.navItemActive : ""}`}>
          <div className={styles.navItemLeft}>
            <UploadIcon />
            <span>Upload Calls</span>
          </div>
          {activeKey === "upload" && <div className={styles.activeDot} />}
        </Link>
        
        <Link href="/transcript" className={`${styles.navItem} ${activeKey === "transcript" ? styles.navItemActive : ""}`}>
          <div className={styles.navItemLeft}>
            <TranscriptIcon />
            <span>Transcript</span>
          </div>
          {activeKey === "transcript" && <div className={styles.activeDot} />}
        </Link>
        
        <Link href="/evaluation" className={`${styles.navItem} ${activeKey === "evaluation" ? styles.navItemActive : ""}`}>
          <div className={styles.navItemLeft}>
            <EvaluationIcon />
            <span>AI Evaluation</span>
          </div>
          {activeKey === "evaluation" && <div className={styles.activeDot} />}
        </Link>
        
        <Link href="/report" className={`${styles.navItem} ${activeKey === "report" ? styles.navItemActive : ""}`}>
          <div className={styles.navItemLeft}>
            <ReportIcon />
            <span>Report</span>
          </div>
          {activeKey === "report" && <div className={styles.activeDot} />}
        </Link>
        
        <Link href="/user" className={`${styles.navItem} ${activeKey === "user" ? styles.navItemActive : ""}`}>
          <div className={styles.navItemLeft}>
            <UserIcon />
            <span>User Management</span>
          </div>
          {activeKey === "user" && <div className={styles.activeDot} />}
        </Link>
      </nav>
    </aside>
  );
}
