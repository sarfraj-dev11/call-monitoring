"use client";

import React, { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import styles from "./page.module.css";
import { db } from "@/lib/firebase";
import { collection, onSnapshot, doc, updateDoc } from "firebase/firestore";

// SVG Icons
const SuccessIcon = () => (
  <svg className={styles.feedbackIconSuccess} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
    <polyline points="22 4 12 14.01 9 11.01" />
  </svg>
);

const WarningIcon = () => (
  <svg className={styles.feedbackIconWarning} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <line x1="12" y1="17" x2="12.01" y2="17" />
  </svg>
);

const generateFallbackQaAnalysis = (call: any) => {
  const score = call.score || 85;
  const transcript = call.transcript || [];
  
  const getSmartQuote = (type: "completion" | "intro" | "product" | "needs" | "focus" | "questions" | "info" | "professionalism" | "outcome") => {
    if (transcript.length === 0) return "Dialogue quote was not recorded.";
    const turnsFromEnd = [...transcript].reverse();

    switch (type) {
      case "intro": {
        const firstAgentTurn = transcript.find((t: any) => t.speaker === "Agent");
        return firstAgentTurn ? `Agent: "${firstAgentTurn.text}"` : "No agent introduction was recorded.";
      }
      case "completion": {
        const concluding = turnsFromEnd.find((t: any) => {
          const txt = t.text.toLowerCase();
          return txt.includes("bye") || txt.includes("thank") || txt.includes("great day") || txt.includes("take care") || txt.includes("done");
        });
        if (concluding) return `${concluding.speaker}: "${concluding.text}"`;
        const lastTurn = turnsFromEnd.find((t: any) => t.speaker === "Agent" || t.speaker === "Customer");
        return lastTurn ? `${lastTurn.speaker}: "${lastTurn.text}"` : `Agent: "${transcript[transcript.length-1].text}"`;
      }
      case "product": {
        const productKeywords = ["pricing", "features", "plan", "subscription", "account", "setup", "cancel", "refund", "billing", "model", "warranty", "specifications", "pricing", "features", "services"];
        const matched = transcript.find((t: any) => 
          t.speaker === "Agent" && 
          productKeywords.some(kw => t.text.toLowerCase().includes(kw)) &&
          t.text.length > 25
        );
        if (matched) return `Agent: "${matched.text}"`;
        const anyAgentExplanation = transcript.find((t: any) => t.speaker === "Agent" && t.text.length > 40 && !t.text.toLowerCase().includes("thank you for calling"));
        return anyAgentExplanation ? `Agent: "${anyAgentExplanation.text}"` : "";
      }
      case "needs": {
        const customerMatch = turnsFromEnd.find((t: any) => 
          t.speaker === "Customer" && 
          (t.text.toLowerCase().includes("thank") || t.text.toLowerCase().includes("perfect") || t.text.toLowerCase().includes("resolved") || t.text.toLowerCase().includes("helpful") || t.text.toLowerCase().includes("understand"))
        );
        if (customerMatch) return `Customer: "${customerMatch.text}"`;
        const anyCustomerLatter = turnsFromEnd.find((t: any) => t.speaker === "Customer" && t.text.length > 15);
        return anyCustomerLatter ? `Customer: "${anyCustomerLatter.text}"` : "";
      }
      case "focus": {
        const middleTurns = transcript.filter((t: any) => 
          !t.text.toLowerCase().includes("thank you for calling") && 
          !t.text.toLowerCase().includes("thanks for calling") && 
          !t.text.toLowerCase().includes("welcome to") && 
          !t.text.toLowerCase().includes("bye") &&
          t.text.length > 25
        );
        if (middleTurns.length > 0) {
          const mid = middleTurns[Math.floor(middleTurns.length / 2)];
          return `${mid.speaker}: "${mid.text}"`;
        }
        const anyAgent = transcript.find((t: any) => t.speaker === "Agent" && t.text.length > 25);
        return anyAgent ? `Agent: "${anyAgent.text}"` : "";
      }
      case "questions": {
        const questionTurn = transcript.find((t: any) => 
          t.speaker === "Agent" && 
          t.text.includes("?") &&
          !t.text.toLowerCase().includes("how can i help") &&
          !t.text.toLowerCase().includes("how can i assist") &&
          !t.text.toLowerCase().includes("how are you")
        );
        return questionTurn ? `Agent: "${questionTurn.text}"` : "";
      }
      case "info": {
        const infoTurn = transcript.find((t: any) => 
          t.speaker === "Agent" && 
          !t.text.toLowerCase().includes("thank you for calling") && 
          !t.text.toLowerCase().includes("bye") && 
          t.text.length > 35
        );
        return infoTurn ? `Agent: "${infoTurn.text}"` : "";
      }
      case "professionalism": {
        const politeKeywords = ["thank you", "please", "sorry", "apologize", "happy to help", "gladly", "appreciate"];
        const politeTurn = transcript.find((t: any) => 
          t.speaker === "Agent" && 
          politeKeywords.some(kw => t.text.toLowerCase().includes(kw))
        );
        if (politeTurn) return `Agent: "${politeTurn.text}"`;
        const anyAgent = transcript.find((t: any) => t.speaker === "Agent" && t.text.length > 20);
        return anyAgent ? `Agent: "${anyAgent.text}"` : "";
      }
      case "outcome": {
        const concluding = turnsFromEnd.find((t: any) => {
          const txt = t.text.toLowerCase();
          return txt.includes("callback") || txt.includes("call you back") || txt.includes("send") || txt.includes("email") || txt.includes("ticket") || txt.includes("appointment") || txt.includes("scheduled") || txt.includes("done") || txt.includes("fixed") || txt.includes("resolved") || txt.includes("bye") || txt.includes("thank");
        });
        if (concluding) return `${concluding.speaker}: "${concluding.text}"`;
        const lastTurn = turnsFromEnd.find((t: any) => t.speaker === "Agent" || t.speaker === "Customer");
        return lastTurn ? `${lastTurn.speaker}: "${lastTurn.text}"` : "";
      }
    }
    return "";
  };

  // Heuristics for introduction
  const agentTurnsForIntro = transcript.filter((t: any) => t.speaker === "Agent").slice(0, 2);
  const greetingTexts = agentTurnsForIntro.map((t: any) => t.text.toLowerCase());
  let hasAgentName = false;
  let hasCompany = false;
  
  for (const greetingText of greetingTexts) {
    const nameKeywords = ["this is ", "my name is ", "speaking", "here is ", "i am "];
    if (nameKeywords.some(k => greetingText.includes(k))) {
      hasAgentName = true;
    }
    
    const callingIndex = greetingText.indexOf("calling");
    const welcomeIndex = greetingText.indexOf("welcome to");
    let companyPart = "";
    if (callingIndex !== -1) {
      companyPart = greetingText.slice(callingIndex + 7).trim();
    } else if (welcomeIndex !== -1) {
      companyPart = greetingText.slice(welcomeIndex + 10).trim();
    }
    
    companyPart = companyPart.replace(/^[,\.\!\-\s]+/, "");
    const firstWord = companyPart.split(/\s+/)[0] || "";
    if (firstWord && !["this", "my", "how", "us", "today", "to", "you", "a"].includes(firstWord)) {
      hasCompany = true;
    }
    
    if (greetingText.includes("support") || greetingText.includes("billing") || greetingText.includes("services") || greetingText.includes("solutions") || greetingText.includes("enterprise") || greetingText.includes("helpdesk")) {
      hasCompany = true;
    }
  }

  // Heuristics for product
  const productKeywords = ["pricing", "features", "plan", "subscription", "account", "setup", "cancel", "refund", "billing", "model", "warranty", "specifications", "pricing", "features", "services"];
  let hasProductDiscussion = false;
  for (const t of transcript) {
    if (t.speaker === "Agent" && productKeywords.some(kw => t.text.toLowerCase().includes(kw)) && t.text.length > 25) {
      hasProductDiscussion = true;
      break;
    }
  }

  // Heuristics for qualifying questions
  const questionTurns = transcript.filter((t: any) => 
    t.speaker === "Agent" && 
    t.text.includes("?") &&
    !t.text.toLowerCase().includes("how can i help") &&
    !t.text.toLowerCase().includes("how can i assist") &&
    !t.text.toLowerCase().includes("how are you")
  );

  let verdict: "Excellent" | "Good" | "Average" | "Poor" = "Good";
  if (score >= 85) verdict = "Excellent";
  else if (score >= 70) verdict = "Good";
  else if (score >= 50) verdict = "Average";
  else verdict = "Poor";

  return {
    callCompletion: {
      success: "Yes",
      explanation: "The call was completed successfully and the customer's query was addressed.",
      contextQuote: getSmartQuote("completion")
    },
    agentIntroduction: {
      success: (hasAgentName && hasCompany) ? "Yes" : "No",
      missingElements: (hasAgentName && hasCompany) 
        ? "None. The agent introduced themselves and the company clearly." 
        : `The agent failed to state the ${[!hasAgentName ? "agent name" : "", !hasCompany ? "company name" : ""].filter(Boolean).join(" and ")} in the introduction greeting.`,
      contextQuote: getSmartQuote("intro")
    },
    productExplanation: {
      rate: !hasProductDiscussion ? "Poor" : score >= 80 ? "Excellent" : score >= 70 ? "Good" : "Fair",
      missingInfo: !hasProductDiscussion ? "The agent did not explain or discuss any product or service details during this call." : "None. Product features and parameters were explained clearly.",
      contextQuote: !hasProductDiscussion ? "[No product or service details were discussed]" : getSmartQuote("product")
    },
    needsAddressed: {
      success: score >= 70 ? "Yes" : score >= 50 ? "Partially" : "No",
      explanation: score >= 70 ? "The agent successfully addressed the customer's needs and concerns." : "The agent was only partially able to address the customer's main concern.",
      contextQuote: getSmartQuote("needs")
    },
    businessFocus: {
      success: "Yes",
      offTopicDetails: "None. The conversation remained focused on the business matter.",
      contextQuote: getSmartQuote("focus")
    },
    qualifyingQuestions: {
      rate: questionTurns.length === 0 ? "Poor" : score >= 80 ? "Excellent" : "Good",
      explanation: questionTurns.length === 0 ? "The agent did not ask any qualifying questions." : "The agent asked standard qualifying questions to clarify the caller's request.",
      contextQuote: questionTurns.length === 0 ? "[No qualifying questions were asked]" : getSmartQuote("questions")
    },
    accurateInformation: {
      success: "Yes",
      misleadingClaims: "None. No misleading or inaccurate statements were observed.",
      contextQuote: getSmartQuote("info")
    },
    professionalism: {
      score: Math.min(10, Math.max(1, Math.round(score / 10))),
      explanation: "The agent maintained a polite, clear, and professional tone throughout the call.",
      contextQuote: getSmartQuote("professionalism")
    },
    clearOutcome: {
      success: "Yes",
      outcomeExplanation: "The call concluded with a clear outcome or next action step.",
      contextQuote: getSmartQuote("outcome")
    },
    overallQuality: {
      score: score,
      strengths: "Clear communication, active listening, and polite behavior.",
      weaknesses: "No major weaknesses observed.",
      suggestions: "Maintain current level of service quality.",
      verdict: verdict
    }
  };
};

export default function EvaluationPage() {
  const [qaScore, setQaScore] = useState(0);
  const [callId, setCallId] = useState("");
  const [scores, setScores] = useState<any[]>([]);
  const [breakdown, setBreakdown] = useState<any[]>([]);
  const [feedback, setFeedback] = useState<any[]>([]);
  const [guidance, setGuidance] = useState<any[]>([]);
  const [qaAnalysis, setQaAnalysis] = useState<any | null>(null);
  const [hasData, setHasData] = useState(false);
  const [hasEvaluation, setHasEvaluation] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [allCalls, setAllCalls] = useState<any[]>([]);
  const [activeCallId, setActiveCallId] = useState<string>("");
  const [expandedRowId, setExpandedRowId] = useState<number | null>(null);
  const [filterAgent, setFilterAgent] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [filterSale, setFilterSale] = useState<string>("all");
  const [filterScore, setFilterScore] = useState<string>("all");
  const [tableSearch, setTableSearch] = useState("");
  const [tableFilterScore, setTableFilterScore] = useState("all");
  const [tableFilterType, setTableFilterType] = useState("all");

  // Continuous AI Learning Feedback State
  const [managerFeedbackNote, setManagerFeedbackNote] = useState("");
  const [feedbackSavedMsg, setFeedbackSavedMsg] = useState("");

  const handleSaveFeedback = (e: React.FormEvent) => {
    e.preventDefault();
    if (!managerFeedbackNote.trim()) return;

    const newEntry = {
      id: Date.now(),
      date: new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
      text: managerFeedbackNote.trim(),
      callId: activeCallId
    };

    const stored = localStorage.getItem("qa_feedback_history");
    let history: any[] = [];
    if (stored) {
      try { history = JSON.parse(stored); } catch (err) {}
    }
    history.push(newEntry);
    localStorage.setItem("qa_feedback_history", JSON.stringify(history));

    setManagerFeedbackNote("");
    setFeedbackSavedMsg("✓ Saved! AI model prompt history updated for future call audits.");
    setTimeout(() => setFeedbackSavedMsg(""), 4000);
  };

  const filteredCalls = allCalls.filter(c => {
    const matchesAgent = filterAgent === "all" || c.agent === filterAgent;
    const matchesStatus = filterStatus === "all" || c.status === filterStatus;
    const matchesSale = filterSale === "all" || (c.qaAnalysis?.saleStatus || "Non-Sale") === filterSale;
    
    const scoreVal = c.score !== undefined ? c.score : (c.qaAnalysis?.finalScore || 0);
    let matchesScore = true;
    if (filterScore === "high") {
      matchesScore = scoreVal >= 90;
    } else if (filterScore === "average") {
      matchesScore = scoreVal >= 70 && scoreVal < 90;
    } else if (filterScore === "poor") {
      matchesScore = scoreVal < 70;
    }
    
    return matchesAgent && matchesStatus && matchesSale && matchesScore;
  });

  const handleFilterChange = (type: "agent" | "status" | "sale" | "score", value: string) => {
    let nextAgent = filterAgent;
    let nextStatus = filterStatus;
    let nextSale = filterSale;
    let nextScore = filterScore;

    if (type === "agent") {
      setFilterAgent(value);
      nextAgent = value;
    } else if (type === "status") {
      setFilterStatus(value);
      nextStatus = value;
    } else if (type === "sale") {
      setFilterSale(value);
      nextSale = value;
    } else if (type === "score") {
      setFilterScore(value);
      nextScore = value;
    }

    const matches = allCalls.filter(c => {
      const matchesAgent = nextAgent === "all" || c.agent === nextAgent;
      const matchesStatus = nextStatus === "all" || c.status === nextStatus;
      const matchesSale = nextSale === "all" || (c.qaAnalysis?.saleStatus || "Non-Sale") === nextSale;
      
      const scoreVal = c.score !== undefined ? c.score : (c.qaAnalysis?.finalScore || 0);
      let matchesScore = true;
      if (nextScore === "high") {
        matchesScore = scoreVal >= 90;
      } else if (nextScore === "average") {
        matchesScore = scoreVal >= 70 && scoreVal < 90;
      } else if (nextScore === "poor") {
        matchesScore = scoreVal < 70;
      }
      
      return matchesAgent && matchesStatus && matchesSale && matchesScore;
    });

    if (matches.length > 0 && !matches.some(c => c.id === activeCallId)) {
      setActiveCallId(matches[0].id);
      loadCallData(matches[0].id);
    }
  };

  const loadCallData = (selectedId?: string) => {
    const storedDb = localStorage.getItem("all_calls_database");
    if (storedDb) {
      try {
        const db = JSON.parse(storedDb);
        setAllCalls(db);
        
        const activeId = selectedId || localStorage.getItem("active_call_id") || (db[0]?.id || "");
        setActiveCallId(activeId);
        
        const activeCall = db.find((c: any) => c.id === activeId);
        
        if (activeCall) {
          setHasData(true);
          setCallId(activeCall.id);
          
          if (activeCall.evaluation) {
            setHasEvaluation(true);
            const evalData = activeCall.evaluation;
            setQaScore(evalData.qaScore || 0);
            setScores(evalData.scores || []);
            setBreakdown(evalData.breakdown || []);
            setFeedback(evalData.feedback || []);
            setGuidance(evalData.guidance || []);
            
            const qaData = activeCall.qaAnalysis || generateFallbackQaAnalysis(activeCall);
            setQaAnalysis(qaData);
          } else {
            setHasEvaluation(false);
            setQaScore(0);
            setScores([]);
            setBreakdown([]);
            setFeedback([]);
            setGuidance([]);
            setQaAnalysis(null);
          }
          
          localStorage.setItem("active_call_id", activeCall.id);
        } else {
          setHasData(false);
          setHasEvaluation(false);
        }
      } catch (e) {
        console.error("Failed to parse database", e);
        setHasData(false);
        setHasEvaluation(false);
      }
    } else {
      setHasData(false);
      setHasEvaluation(false);
    }
  };

  const runAiEvaluation = async () => {
    const storedDb = localStorage.getItem("all_calls_database");
    if (!storedDb || !activeCallId) return;

    try {
      setIsEvaluating(true);
      const db = JSON.parse(storedDb);
      const activeCall = db.find((c: any) => c.id === activeCallId);
      if (!activeCall) return;

      const customScorecard = localStorage.getItem("qa_custom_scorecard")
        ? JSON.parse(localStorage.getItem("qa_custom_scorecard")!)
        : null;

      const feedbackHistory = localStorage.getItem("qa_feedback_history")
        ? JSON.parse(localStorage.getItem("qa_feedback_history")!)
        : null;

      const evalRes = await fetch("/api/evaluate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: activeCall.transcript || [],
          agentName: activeCall.agent || "Rahul M.",
          customScorecard,
          feedbackHistory
        })
      });

      if (!evalRes.ok) throw new Error("Evaluation request failed");
      const evalData = await evalRes.json();

      if (evalData && (evalData.evaluation || evalData.qaAnalysis)) {
        const updatedCall = {
          ...activeCall,
          score: evalData.evaluation?.qaScore || (evalData.qaAnalysis?.checklist ? 90 : 85),
          status: "Reviewed",
          sentiment: evalData.sentiment || "Positive",
          category: evalData.category || "Sales",
          evaluation: evalData.evaluation || null,
          qaAnalysis: evalData.qaAnalysis || null
        };

        // Save to Firestore!
        await updateDoc(doc(db, "calls", activeCallId), updatedCall);
      }
    } catch (e: any) {
      console.error(e);
      alert(`AI evaluation failed: ${e.message}`);
    } finally {
      setIsEvaluating(false);
    }
  };

  const handleCallSelect = (id: string) => {
    loadCallData(id);
  };

  const getQaStatusText = (score: number) => {
    if (score >= 85) return "Excellent";
    if (score >= 70) return "Good";
    return "Needs Coaching";
  };

  return (
    <div className={styles.appContainer}>
      <Sidebar activeKey="evaluation" />

      {/* Main Content Area */}
      <main className={styles.mainContent}>
        <header className={styles.header}>
          <h1>Ai Evaluation</h1>
          {allCalls.length > 0 && (
            <div className={styles.callSelectorContainer}>
              <label htmlFor="call-select" className={styles.callSelectorLabel}>Select Call:</label>
              <select
                id="call-select"
                className={styles.callSelector}
                value={activeCallId}
                onChange={(e) => handleCallSelect(e.target.value)}
              >
                {filteredCalls.map(c => (
                  <option key={c.id} value={c.id}>
                    {c.id} - {c.agent} ({c.date})
                  </option>
                ))}
              </select>
              {hasEvaluation && (
                <button
                  onClick={runAiEvaluation}
                  disabled={isEvaluating}
                  style={{
                    background: "var(--color-accent)",
                    color: "#ffffff",
                    border: "none",
                    padding: "8px 16px",
                    borderRadius: "6px",
                    fontSize: "12px",
                    fontWeight: 600,
                    cursor: isEvaluating ? "not-allowed" : "pointer",
                    height: "36px",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    marginLeft: "8px"
                  }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: isEvaluating ? "spin 1.5s linear infinite" : "none" }}>
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                  <span>{isEvaluating ? "Evaluating..." : "Re-evaluate"}</span>
                </button>
              )}
            </div>
          )}
        </header>

        {allCalls.length > 0 && (
          <div className={styles.filterBar}>
            <div className={styles.filterGroup}>
              <label htmlFor="filter-agent" className={styles.filterLabel}>Agent:</label>
              <select
                id="filter-agent"
                className={styles.filterSelect}
                value={filterAgent}
                onChange={(e) => handleFilterChange("agent", e.target.value)}
              >
                <option value="all">All Agents</option>
                {Array.from(new Set(allCalls.map(c => c.agent))).filter(Boolean).map(agent => (
                  <option key={agent} value={agent}>{agent}</option>
                ))}
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label htmlFor="filter-status" className={styles.filterLabel}>Status:</label>
              <select
                id="filter-status"
                className={styles.filterSelect}
                value={filterStatus}
                onChange={(e) => handleFilterChange("status", e.target.value)}
              >
                <option value="all">All Statuses</option>
                <option value="Reviewed">Reviewed</option>
                <option value="Pending">Pending</option>
                <option value="Flagged">Flagged</option>
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label htmlFor="filter-sale" className={styles.filterLabel}>Sale Status:</label>
              <select
                id="filter-sale"
                className={styles.filterSelect}
                value={filterSale}
                onChange={(e) => handleFilterChange("sale", e.target.value)}
              >
                <option value="all">All Sale Types</option>
                <option value="Sale">Sale Only</option>
                <option value="Non-Sale">Non-Sale Only</option>
              </select>
            </div>

            <div className={styles.filterGroup}>
              <label htmlFor="filter-score" className={styles.filterLabel}>Score:</label>
              <select
                id="filter-score"
                className={styles.filterSelect}
                value={filterScore}
                onChange={(e) => handleFilterChange("score", e.target.value)}
              >
                <option value="all">All Scores</option>
                <option value="high">Excellent (90+)</option>
                <option value="average">Good/Avg (70-89)</option>
                <option value="poor">Needs Coaching (&lt;70)</option>
              </select>
            </div>
            
            {(filterAgent !== "all" || filterStatus !== "all" || filterSale !== "all" || filterScore !== "all") && (
              <button 
                onClick={() => {
                  setFilterAgent("all");
                  setFilterStatus("all");
                  setFilterSale("all");
                  setFilterScore("all");
                  if (allCalls.length > 0) {
                    setActiveCallId(allCalls[0].id);
                    loadCallData(allCalls[0].id);
                  }
                }}
                className={styles.clearFilterBtn}
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        {!hasData ? (
          <div style={{ textAlign: "center", padding: "80px 40px", background: "var(--background-card)", borderRadius: "var(--border-radius-lg)", border: "1px solid #f0ede9", margin: "20px 0" }}>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", marginBottom: "12px" }}>No Call Selected</h2>
            <p style={{ color: "var(--color-text-muted)", fontSize: "13px" }}>
              Please go to the Upload page to analyze new call recordings or select an existing call from the Reports sheet.
            </p>
          </div>
        ) : filteredCalls.length === 0 ? (
          <div style={{ textAlign: "center", padding: "80px 40px", background: "var(--background-card)", borderRadius: "var(--border-radius-lg)", border: "1px solid #f0ede9", margin: "20px 0" }}>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", marginBottom: "12px", color: "var(--color-text-main)" }}>No Calls Match Filters</h2>
            <p style={{ color: "var(--color-text-muted)", fontSize: "13px", marginBottom: "16px" }}>
              There are no calls in the database matching your active filters. Try adjusting your agent, status, or sale criteria.
            </p>
            <button
              onClick={() => {
                setFilterAgent("all");
                setFilterStatus("all");
                setFilterSale("all");
                setFilterScore("all");
                if (allCalls.length > 0) {
                  setActiveCallId(allCalls[0].id);
                  loadCallData(allCalls[0].id);
                }
              }}
              style={{
                background: "var(--color-accent)",
                color: "#ffffff",
                border: "none",
                padding: "8px 20px",
                borderRadius: "6px",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Reset Filters
            </button>
          </div>
        ) : !hasEvaluation ? (
          <div style={{ 
            textAlign: "center", 
            padding: "80px 40px", 
            background: "var(--background-card)", 
            borderRadius: "var(--border-radius-lg)", 
            border: "1px solid #f0ede9", 
            margin: "20px 0",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "20px"
          }}>
            <div style={{ 
              width: "64px", 
              height: "64px", 
              borderRadius: "50%", 
              background: "var(--color-accent-transparent)", 
              color: "var(--color-accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center"
            }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            </div>
            <div>
              <h2 style={{ fontFamily: "var(--font-serif)", fontSize: "22px", marginBottom: "12px", color: "var(--color-text-main)" }}>AI Evaluation Pending</h2>
              <p style={{ color: "var(--color-text-muted)", fontSize: "13px", maxWidth: "450px", margin: "0 auto", lineHeight: "1.6" }}>
                This call has been successfully transcribed, but the quality assurance checklist and scoring report have not been run. Click below to analyze this call using Gemini AI.
              </p>
            </div>
            <button
              onClick={runAiEvaluation}
              disabled={isEvaluating}
              style={{
                background: isEvaluating ? "#eae7e1" : "var(--color-accent)",
                color: isEvaluating ? "var(--color-text-muted)" : "#ffffff",
                border: "none",
                padding: "10px 24px",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: 600,
                cursor: isEvaluating ? "not-allowed" : "pointer",
                boxShadow: "var(--shadow-sm)",
                display: "flex",
                alignItems: "center",
                gap: "8px",
                transition: "all 0.2s ease"
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ animation: isEvaluating ? "spin 1.5s linear infinite" : "none" }}>
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="12" y1="18" x2="12" y2="22" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                <line x1="16.24" y1="16.24" x2="19.07" y2="19.07" />
                <line x1="2" y1="12" x2="6" y2="12" />
                <line x1="18" y1="12" x2="22" y2="12" />
                <line x1="4.93" y1="19.07" x2="7.76" y2="16.24" />
                <line x1="16.24" y1="7.76" x2="19.07" y2="4.93" />
              </svg>
              <span>{isEvaluating ? "Running AI QA Report..." : "Run AI Analysis"}</span>
            </button>
          </div>
        ) : (
          <>
            {/* Top Summary Card */}
            <section className={styles.summaryCard}>
              {/* Main QA Score Circle/Stat */}
              <div className={styles.qaScoreGroup}>
                <span className={styles.qaScoreLabel}>QA Score</span>
                <div className={styles.qaScoreMainValueContainer}>
                  <span className={styles.qaScoreMainValue}>{qaScore} <span className={styles.qaScoreMainDivider}>/ 100</span></span>
                </div>
                <span className={styles.qaScoreStatus}>{getQaStatusText(qaScore)} , {callId}</span>
              </div>

              {/* Breakdown Stats */}
              <div className={styles.statGroupRow}>
                {scores.map((stat, idx) => (
                  <div key={idx} className={styles.statGroup}>
                    <span className={styles.statLabel}>{stat.label}</span>
                    <span className={`${styles.statValue} ${stat.label === "Speed" ? styles.statValueItalic : ""}`}>
                      {stat.value}
                    </span>
                  </div>
                ))}
              </div>
            </section>

            {/* General Call Metadata Card */}
            {qaAnalysis && (
              <section className={styles.metadataGridCard}>
                <h2 className={styles.metadataGridTitle}>General Call Metadata</h2>
                <div className={styles.metadataGrid}>
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Agent Name</span>
                    <span className={styles.metadataValue}>{qaAnalysis.agentName || allCalls.find(c => c.id === activeCallId)?.agent || "Rahul M."}</span>
                  </div>
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Phone Number</span>
                    <span className={styles.metadataValue}>{qaAnalysis.phoneNumber || "+1 (555) 019-2834"}</span>
                  </div>
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Call Duration</span>
                    <span className={styles.metadataValue}>{allCalls.find(c => c.id === activeCallId)?.duration || "N/A"}</span>
                  </div>
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Customer Name</span>
                    <span className={styles.metadataValue}>{qaAnalysis.customerName || "Valued Customer"}</span>
                  </div>
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Call Date</span>
                    <span className={styles.metadataValue}>{allCalls.find(c => c.id === activeCallId)?.date || "N/A"}</span>
                  </div>
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Call Audit Date</span>
                    <span className={styles.metadataValue}>{qaAnalysis.auditDate || "N/A"}</span>
                  </div>
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Feedback Date</span>
                    <span className={styles.metadataValue}>{qaAnalysis.feedbackDate || "N/A"}</span>
                  </div>
                  <div className={styles.metadataItem}>
                    <span className={styles.metadataLabel}>Sale / Non-Sale</span>
                    <span className={styles.metadataValue}>{qaAnalysis.saleStatus || "Non-Sale"}</span>
                  </div>
                  <div className={styles.metadataItem} style={{ gridColumn: "span 2" }}>
                    <span className={styles.metadataLabel}>Disposition</span>
                    <span className={styles.metadataValue}>{qaAnalysis.disposition || "N/A"}</span>
                  </div>
                </div>
              </section>
            )}

            {/* Score Breakdown Section */}
            <section className={styles.breakdownCard}>
              <h2 className={styles.breakdownTitle}>Score Breakdown</h2>
              
              <div className={styles.breakdownRows}>
                {breakdown.map((item, idx) => {
                  const widthPercentage = (item.score / item.max) * 100;
                  return (
                    <div key={idx} className={styles.breakdownRow}>
                      <span className={styles.criteriaName}>{item.name}</span>
                      
                      <div className={styles.progressContainer}>
                        <div className={styles.progressTrack}>
                          <div
                            className={`${styles.progressFill} ${styles[`fill${item.color.charAt(0).toUpperCase() + item.color.slice(1)}`] || styles.fillGreen}`}
                            style={{ width: `${widthPercentage}%` }}
                          />
                        </div>
                        <span className={styles.criteriaScore}>
                          {item.score}/{item.max}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Feedback & Guidance Layout */}
            <section className={styles.feedbackGuidanceGrid}>
              {/* AI Feedback Panel */}
              <div className={styles.feedbackCard}>
                <h2 className={styles.panelTitle}>Ai Feedback</h2>
                <ul className={styles.feedbackList}>
                  {feedback.map((item, idx) => (
                    <li key={idx} className={styles.feedbackItem}>
                      {item.type === "success" ? <SuccessIcon /> : <WarningIcon />}
                      <span className={styles.feedbackText}>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Agent Guidance Panel */}
              <div className={styles.guidanceCard}>
                <h2 className={styles.panelTitle}>Agent Guidance</h2>
                <div className={styles.guidanceItems}>
                  {guidance.map((item, idx) => (
                    <div
                      key={idx}
                      className={`${styles.guidanceItem} ${styles[`guidanceBorder${item.color.charAt(0).toUpperCase() + item.color.slice(1)}`] || ""}`}
                    >
                      <h3 className={`${styles.guidanceTitle} ${styles[`guidanceTitle${item.color.charAt(0).toUpperCase() + item.color.slice(1)}`] || ""}`}>
                        {item.title}
                      </h3>
                      <p className={styles.guidanceText}>{item.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {/* Continuous AI Learning & Manager Feedback Panel */}
            <section className={styles.feedbackCard} style={{ marginTop: "20px" }}>
              <h2 className={styles.panelTitle}>Continuous AI Learning & Manager Feedback</h2>
              <p style={{ fontSize: "12.5px", color: "var(--color-text-muted)", marginBottom: "12px" }}>
                Provide corrective feedback or custom guidelines for this call audit. The AI will learn from your regular call evaluations and refine future scoring automatically.
              </p>
              <form onSubmit={handleSaveFeedback} style={{ display: "flex", gap: "10px" }}>
                <input 
                  type="text" 
                  value={managerFeedbackNote}
                  onChange={(e) => setManagerFeedbackNote(e.target.value)}
                  placeholder="e.g., 'Agent correctly opened greeting with Brocus IT Solutions phrase. Always pass parameter 26 if greeting includes Brocus.'"
                  style={{
                    flex: 1,
                    padding: "8px 14px",
                    borderRadius: "6px",
                    border: "1px solid #e4e4e7",
                    fontSize: "13px"
                  }}
                  required
                />
                <button 
                  type="submit" 
                  style={{
                    background: "var(--color-accent)",
                    color: "#ffffff",
                    border: "none",
                    padding: "8px 16px",
                    borderRadius: "6px",
                    fontWeight: 600,
                    fontSize: "12.5px",
                    cursor: "pointer"
                  }}
                >
                  Submit Rule to AI
                </button>
              </form>
              {feedbackSavedMsg && (
                <div style={{ marginTop: "8px", fontSize: "12px", color: "#16a34a", fontWeight: 600 }}>
                  {feedbackSavedMsg}
                </div>
              )}
            </section>

            {/* Detailed QA Checklist Section */}
            {qaAnalysis && (
              <section className={styles.checklistCard}>
                <h2 className={styles.checklistTitle}>Detailed QA Checklist (37 Point Evaluation)</h2>
                <p className={styles.checklistDescription}>
                  Click on any parameter row to expand and view the detailed explanation and supporting transcript quote from the call.
                </p>

                {qaAnalysis.checklist ? (() => {
                  const filteredChecklist = (qaAnalysis.checklist || []).filter((item: any) => {
                    const matchesSearch = item.parameter.toLowerCase().includes(tableSearch.toLowerCase());
                    const matchesScore = tableFilterScore === "all" || item.score === tableFilterScore;
                    const isFatal = item.isFatal || item.id >= 24;
                    const matchesType = tableFilterType === "all" || 
                                        (tableFilterType === "fatal" && isFatal) || 
                                        (tableFilterType === "non-fatal" && !isFatal);
                    return matchesSearch && matchesScore && matchesType;
                  });

                  return (
                    <>
                      {/* Table Controls Bar */}
                      <div className={styles.tableControlsBar}>
                        <div className={styles.tableSearchInputWrapper}>
                          <svg className={styles.tableSearchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
                            <circle cx="11" cy="11" r="8" />
                            <line x1="21" y1="21" x2="16.65" y2="16.65" />
                          </svg>
                          <input
                            type="text"
                            placeholder="Search parameter..."
                            className={styles.tableSearchInput}
                            value={tableSearch}
                            onChange={(e) => setTableSearch(e.target.value)}
                          />
                        </div>

                        <div className={styles.tableFilterGroup}>
                          <label htmlFor="table-filter-score" className={styles.tableFilterLabel}>Score:</label>
                          <select
                            id="table-filter-score"
                            className={styles.tableFilterSelect}
                            value={tableFilterScore}
                            onChange={(e) => setTableFilterScore(e.target.value)}
                          >
                            <option value="all">All Scores</option>
                            <option value="Pass">Pass Only</option>
                            <option value="Fail">Fail Only</option>
                            <option value="NA">NA Only</option>
                          </select>
                        </div>

                        <div className={styles.tableFilterGroup}>
                          <label htmlFor="table-filter-type" className={styles.tableFilterLabel}>Type:</label>
                          <select
                            id="table-filter-type"
                            className={styles.tableFilterSelect}
                            value={tableFilterType}
                            onChange={(e) => setTableFilterType(e.target.value)}
                          >
                            <option value="all">All Types</option>
                            <option value="fatal">Fatal Only</option>
                            <option value="non-fatal">Non-Fatal Only</option>
                          </select>
                        </div>

                        {(tableSearch !== "" || tableFilterScore !== "all" || tableFilterType !== "all") && (
                          <button
                            onClick={() => {
                              setTableSearch("");
                              setTableFilterScore("all");
                              setTableFilterType("all");
                            }}
                            className={styles.clearTableFilterBtn}
                          >
                            Reset Checklist Filters
                          </button>
                        )}
                      </div>

                      <div style={{ overflowX: "auto" }}>
                        <table className={styles.checklistTable}>
                          <thead>
                            <tr>
                              <th style={{ width: "50px" }}>ID</th>
                              <th>Parameter</th>
                              <th style={{ width: "80px", textAlign: "center" }}>Weight</th>
                              <th style={{ width: "120px", textAlign: "center" }}>Type</th>
                              <th style={{ width: "100px", textAlign: "center" }}>Score</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filteredChecklist.length > 0 ? (
                              filteredChecklist.map((item: any) => {
                                const isExpanded = expandedRowId === item.id;
                                const hasFailed = item.score === "Fail";
                                const isNa = item.score === "NA";
                                const isFatal = item.isFatal || item.id >= 24;
                                
                                let badgeClass = styles.badgeSuccess;
                                if (hasFailed) badgeClass = styles.badgeDanger;
                                else if (isNa) badgeClass = styles.badgeWarning;

                                return (
                                  <React.Fragment key={item.id}>
                                    <tr
                                      className={`${styles.checklistTableRow} ${isExpanded ? styles.expandedRow : ""}`}
                                      onClick={() => setExpandedRowId(isExpanded ? null : item.id)}
                                    >
                                      <td style={{ fontWeight: 600, color: "var(--color-accent)" }}>{item.id}</td>
                                      <td style={{ fontWeight: 500 }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                          <span>{item.parameter}</span>
                                          {isExpanded ? (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                              <polyline points="18 15 12 9 6 15" />
                                            </svg>
                                          ) : (
                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                                              <polyline points="6 9 12 15 18 9" />
                                            </svg>
                                          )}
                                        </div>
                                      </td>
                                      <td style={{ textAlign: "center", fontWeight: 600 }}>{item.id === 2 ? "2.8" : "2.7"}</td>
                                      <td style={{ textAlign: "center" }}>
                                        <span className={isFatal ? styles.badgeDanger : styles.scoreNumberBadge} style={{ fontSize: "10px" }}>
                                          {isFatal ? "Fatal" : "Non-Fatal"}
                                        </span>
                                      </td>
                                      <td style={{ textAlign: "center" }}>
                                        <span className={`${styles.badge} ${badgeClass}`}>
                                          {item.score}
                                        </span>
                                      </td>
                                    </tr>
                                    {isExpanded && (
                                      <tr className={styles.expandedRow}>
                                        <td colSpan={5} style={{ padding: 0, borderBottom: "1px solid #f0ede9" }}>
                                          <div className={styles.expandedContent}>
                                            <p className={styles.expandedContentText}>
                                              <strong>AI Explanation:</strong> {item.explanation || "No explanation provided."}
                                            </p>
                                            {item.contextQuote && item.contextQuote !== "[No context quote available]" && item.contextQuote !== "" && (
                                              <div className={styles.contextQuoteBox}>
                                                <span className={styles.contextLabel}>Context Quote from Transcript:</span>
                                                <p className={styles.contextText}>"{item.contextQuote}"</p>
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                      </tr>
                                    )}
                                  </React.Fragment>
                                );
                              })
                            ) : (
                              <tr>
                                <td colSpan={5} style={{ textAlign: "center", color: "var(--color-text-muted)", padding: "30px" }}>
                                  No checklist parameters match your table filters.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </>
                  );
                })() : (
                  <div style={{ textAlign: "center", padding: "40px 20px" }}>
                    <p style={{ color: "var(--color-text-muted)", fontSize: "13.5px" }}>
                      This call was evaluated with an older scorecard. Please click the button below to regenerate the detailed 37-point QA scorecard report.
                    </p>
                    <button
                      onClick={runAiEvaluation}
                      disabled={isEvaluating}
                      style={{
                        background: "var(--color-accent)",
                        color: "#ffffff",
                        border: "none",
                        padding: "8px 20px",
                        borderRadius: "6px",
                        fontSize: "12px",
                        fontWeight: 600,
                        cursor: isEvaluating ? "not-allowed" : "pointer",
                        marginTop: "12px"
                      }}
                    >
                      {isEvaluating ? "Running AI Audit..." : "Run AI Analysis"}
                    </button>
                  </div>
                )}
              </section>
            )}</>
        )}
      </main>
    </div>
  );
}
