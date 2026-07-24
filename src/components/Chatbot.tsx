"use client";

import React, { useState, useEffect, useRef } from "react";
import { MessageSquare, Send, X, Bot, Sparkles, HelpCircle } from "lucide-react";
import styles from "./Chatbot.module.css";

interface Message {
  sender: "user" | "bot";
  text: string;
  time: string;
}

export default function Chatbot() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      sender: "bot",
      text: "Hello! I am your CRM Assistant. I can help you with stats, QA scores, compliance guidelines, uploads, or user roles. Ask me anything!",
      time: "Just now",
    },
  ]);
  const [inputValue, setInputValue] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto scroll to bottom of messages
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const getBotResponse = (query: string): string => {
    const q = query.toLowerCase().trim();
    
    let allCalls: any[] = [];
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("all_calls_database");
      if (stored) {
        try {
          allCalls = JSON.parse(stored);
        } catch {}
      }
    }

    if (allCalls.length === 0) {
      return "There are currently no calls analyzed in the CRM database. Please upload audio files on the homepage to start analyzing.";
    }

    const totalCalls = allCalls.length;
    const avgScore = Math.round(allCalls.reduce((acc, c) => acc + c.score, 0) / totalCalls);
    const highQaCount = allCalls.filter(c => c.score >= 80).length;
    const highQaPct = Math.round((highQaCount / totalCalls) * 100);
    const uniqueAgents = Array.from(new Set(allCalls.map(c => c.agent))).filter(Boolean);

    if (q.includes("qa") || q.includes("score") || q.includes("average") || q.includes("compliance") || q.includes("performance")) {
      return `The current average QA Score across all calls in the database is **${avgScore}%**. The high QA score ratio (scores 80+) stands at **${highQaPct}%** of total calls.`;
    }

    if (q.includes("upload") || q.includes("uploaded") || q.includes("calls") || q.includes("total calls") || q.includes("how many calls")) {
      return `There are currently **${totalCalls} calls** in the database.`;
    }

    if (q.includes("user") || q.includes("users") || q.includes("active") || q.includes("login") || q.includes("logins") || q.includes("team") || q.includes("registered")) {
      return `We have **${uniqueAgents.length} active agents** detected in the call records: ${uniqueAgents.join(", ")}.`;
    }

    if (q.includes("top agent") || q.includes("best agent") || q.includes("rankings") || q.includes("leaderboard") || q.includes("best score") || q.includes("agent score") || q.includes("agent ranking")) {
      const agentScores: Record<string, { sum: number; count: number }> = {};
      allCalls.forEach(c => {
        if (!agentScores[c.agent]) agentScores[c.agent] = { sum: 0, count: 0 };
        agentScores[c.agent].sum += c.score;
        agentScores[c.agent].count += 1;
      });
      const leaderboard = Object.entries(agentScores).map(([name, data]) => ({
        name,
        avg: Math.round(data.sum / data.count)
      })).sort((a, b) => b.avg - a.avg);

      if (leaderboard.length > 0) {
        return `The top-performing agent is **${leaderboard[0].name}** with an average QA score of **${leaderboard[0].avg}%**, followed by ${leaderboard.slice(1).map(x => `**${x.name}** (${x.avg}%)`).join(", ")}.`;
      }
      return "No agent performance rankings available yet.";
    }

    if (q.includes("sentiment") || q.includes("happy") || q.includes("mood") || q.includes("frustrated") || q.includes("negative") || q.includes("positive") || q.includes("neutral")) {
      const pos = allCalls.filter(c => c.sentiment === "Positive").length;
      const neu = allCalls.filter(c => c.sentiment === "Neutral").length;
      const neg = allCalls.filter(c => c.sentiment === "Negative").length;
      return `Overall call sentiment breakdown of current records is: **${Math.round(pos/totalCalls*100)}% Positive**, **${Math.round(neu/totalCalls*100)}% Neutral**, and **${Math.round(neg/totalCalls*100)}% Negative**.`;
    }

    if (q.includes("category") || q.includes("categories") || q.includes("billing") || q.includes("support") || q.includes("tech") || q.includes("sales")) {
      const counts: Record<string, number> = {};
      allCalls.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
      const breakdownStr = Object.entries(counts).map(([cat, count]) => `**${cat}** (${count} calls)`).join(", ");
      return `Call categories breakdown: ${breakdownStr || "No categorized calls found"}.`;
    }

    if (q.includes("help") || q.includes("what can you do") || q.includes("hello") || q.includes("hi") || q.includes("hey") || q.includes("about") || q.includes("wassup") || q.includes("sup")) {
      return "Hi! I am here to help you analyze your CRM metrics. Ask me about average QA scores, total uploads, agent rankings, logins, or customer sentiment!";
    }

    // Default Fallback
    return "I'm sorry, I didn't quite catch that. You can ask me about:\n• *'What is our average QA score?'*\n• *'How many calls are in the database?'*\n• *'Who are the top agents?'*\n• *'What is the customer sentiment breakdown?'*";
  };

  const handleSend = async (text: string) => {
    if (!text.trim()) return;

    const currentTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    
    // Add user message
    const userMessage: Message = {
      sender: "user",
      text,
      time: currentTime,
    };
    
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputValue("");

    // Add a typing indicator
    const typingMessage: Message = {
      sender: "bot",
      text: "Typing...",
      time: currentTime,
    };
    setMessages(prev => [...prev, typingMessage]);

    const getCrmContext = () => {
      if (typeof window === "undefined") return null;
      const storedDb = localStorage.getItem("all_calls_database");
      const activeId = localStorage.getItem("active_call_id");
      
      let allCallsList: any[] = [];
      if (storedDb) {
        try {
          allCallsList = JSON.parse(storedDb);
        } catch (e) {
          console.error(e);
        }
      }

      const activeCall = allCallsList.find((c: any) => c.id === activeId) || null;

      const callSummaries = allCallsList.map((c: any) => ({
        id: c.id,
        agent: c.agent,
        date: c.date,
        dateStr: c.dateStr,
        duration: c.duration,
        score: c.score,
        status: c.status,
        sentiment: c.sentiment,
        category: c.category,
        agentTime: c.agentTime,
        customerTime: c.customerTime,
        silenceTime: c.silenceTime
      }));

      return {
        callSummaries,
        activeCall: activeCall ? {
          id: activeCall.id,
          agent: activeCall.agent,
          date: activeCall.date,
          duration: activeCall.duration,
          score: activeCall.score,
          status: activeCall.status,
          sentiment: activeCall.sentiment,
          category: activeCall.category,
          transcript: activeCall.transcript,
          evaluation: activeCall.evaluation
        } : null
      };
    };

    const crmContext = getCrmContext();

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: updatedMessages,
          crmContext,
        }),
      });

      const data = await response.json();
      
      setMessages(prev => {
        const filtered = prev.filter(m => m.text !== "Typing...");
        if (data.error) {
          console.error("Groq API error:", data.error);
          return [
            ...filtered,
            {
              sender: "bot",
              text: getBotResponse(text),
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            }
          ];
        }
        return [
          ...filtered,
          {
            sender: "bot",
            text: data.text,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }
        ];
      });
    } catch (err) {
      console.error("Fetch chatbot error, using local fallback:", err);
      setMessages(prev => {
        const filtered = prev.filter(m => m.text !== "Typing...");
        return [
          ...filtered,
          {
            sender: "bot",
            text: getBotResponse(text),
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          }
        ];
      });
    }
  };

  // Helper to format bot responses with basic markdown bold & bullet lists
  const formatMessageText = (text: string) => {
    return text.split("\n").map((line, i) => {
      // Basic replace for bold and italics
      let formattedLine = line;
      formattedLine = formattedLine.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      formattedLine = formattedLine.replace(/\*(.*?)\*/g, "<em>$1</em>");

      return (
        <p 
          key={i} 
          className={styles.messageLine} 
          dangerouslySetInnerHTML={{ __html: formattedLine }} 
        />
      );
    });
  };

  const suggestionPills = [
    "What is the average QA score?",
    "How many calls did we upload this week?",
    "Who is the top performing agent?",
    "What is the customer sentiment division?",
  ];

  return (
    <div className={styles.chatbotContainer}>
      {/* Floating Toggle Button */}
      <button 
        className={`${styles.chatbotToggle} ${isOpen ? styles.chatbotToggleActive : ""}`} 
        onClick={() => setIsOpen(!isOpen)}
        aria-label="Toggle chatbot"
      >
        {isOpen ? <X size={20} /> : <MessageSquare size={20} />}
      </button>

      {/* Chat Popover */}
      {isOpen && (
        <div className={styles.chatbotWindow}>
          {/* Header */}
          <div className={styles.chatbotHeader}>
            <div className={styles.chatbotHeaderInfo}>
              <div className={styles.botAvatar}>
                <Bot size={16} />
                <span className={styles.onlineDot} />
              </div>
              <div>
                <h3>CRM Assistant</h3>
                <span className={styles.onlineStatus}>Online & Ready</span>
              </div>
            </div>
            <div className={styles.headerActions}>
              <button onClick={() => setIsOpen(false)} aria-label="Minimize chat">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Messages Container */}
          <div className={styles.chatbotBody}>
            {messages.map((msg, index) => (
              <div 
                key={index} 
                className={`${styles.messageWrapper} ${
                  msg.sender === "user" ? styles.userMessageWrapper : styles.botMessageWrapper
                }`}
              >
                {msg.sender === "bot" && (
                  <div className={styles.messageAvatar}>
                    <Bot size={12} />
                  </div>
                )}
                <div className={styles.messageBubble}>
                  <div className={styles.messageText}>
                    {msg.text === "Typing..." ? (
                      <div className={styles.typingIndicator}>
                        <span />
                        <span />
                        <span />
                      </div>
                    ) : (
                      formatMessageText(msg.text)
                    )}
                  </div>
                  <span className={styles.messageTime}>{msg.time}</span>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Suggestion Pills */}
          <div className={styles.suggestionSection}>
            <div className={styles.suggestionTitle}>
              <Sparkles size={11} className={styles.sparkleIcon} />
              <span>Suggested Queries</span>
            </div>
            <div className={styles.suggestionsList}>
              {suggestionPills.map((pill, idx) => (
                <button 
                  key={idx} 
                  className={styles.suggestionPill}
                  onClick={() => handleSend(pill)}
                >
                  {pill}
                </button>
              ))}
            </div>
          </div>

          {/* Form Footer */}
          <form 
            className={styles.chatbotFooter}
            onSubmit={(e) => {
              e.preventDefault();
              handleSend(inputValue);
            }}
          >
            <input 
              type="text" 
              placeholder="Ask about calls, scorecards..."
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              className={styles.chatbotInput}
            />
            <button 
              type="submit" 
              className={styles.chatbotSendBtn}
              aria-label="Send message"
            >
              <Send size={14} />
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
