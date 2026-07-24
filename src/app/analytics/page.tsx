"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import styles from "./page.module.css";
import { 
  SlidersHorizontal, 
  ArrowLeft, 
  Users, 
  Clock, 
  Percent, 
  Award, 
  Search,
  ChevronDown
} from "lucide-react";
import Link from "next/link";

export default function AnalyticsPage() {
  const [allCalls, setAllCalls] = useState<any[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("all_calls_database");
      if (stored) {
        try {
          setAllCalls(JSON.parse(stored));
        } catch (e) {
          console.error("Failed to parse database", e);
        }
      }
    }
  }, []);

  const mockAllAgents = Array.from(new Set(allCalls.map(c => c.agent))).filter(Boolean) as string[];

  // Generate weekly call uploads data trend this week (Monday to Sunday) dynamically
  const getWeeklyUploadData = () => {
    const baseDate = allCalls.length > 0 
      ? new Date(Math.max(...allCalls.map(c => new Date(c.dateStr + "T00:00:00").getTime())))
      : new Date("2026-06-27T00:00:00");
    
    const result = [];
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    
    const dayOfWeek = baseDate.getDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(baseDate.getTime());
    monday.setDate(baseDate.getDate() + diffToMonday);

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime());
      d.setDate(monday.getDate() + i);
      const dateStr = d.toISOString().split("T")[0];
      const count = allCalls.filter(c => c.dateStr === dateStr).length;
      
      const dayName = days[d.getDay()];
      result.push({ day: dayName, count, dateStr });
    }
    
    const maxCount = Math.max(...result.map(r => r.count)) || 1;
    return result.map(r => ({
      ...r,
      maxPct: allCalls.length > 0 ? Math.round((r.count / maxCount) * 100) : 0
    }));
  };

  const weeklyUploadData = getWeeklyUploadData();

  // User logins timeline this week derived from actual call activity
  const userLogins = allCalls.map((call, index) => {
    let timeText = call.date;
    if (call.dateStr === "2026-06-27") {
      timeText = `Today, 10:${String(14 + index).padStart(2, '0')} AM`;
    } else if (call.dateStr === "2026-06-26") {
      timeText = `Yesterday, 04:${String(15 + index).padStart(2, '0')} PM`;
    } else {
      timeText = `${call.date}, 02:10 PM`;
    }
    return {
      name: call.agent || "AI Agent",
      role: "Agent",
      time: timeText,
      dateStr: call.dateStr
    };
  });

  // State Variables
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>(["Reviewed", "Pending", "Flagged"]);
  const [minScore, setMinScore] = useState<number>(0);
  const [searchQuery, setSearchQuery] = useState("");
  
  // Refined filter states
  const [dateFilter, setDateFilter] = useState<string>("all");
  const [customStartDate, setCustomStartDate] = useState<string>("");
  const [customEndDate, setCustomEndDate] = useState<string>("");
  const [isAgentDropdownOpen, setIsAgentDropdownOpen] = useState(false);
  const [agentSearchQuery, setAgentSearchQuery] = useState("");

  // Dynamic User Audit & Upload KPI calculations
  const getCustomRangeStats = (start: string, end: string) => {
    const filteredByRange = allCalls.filter(c => {
      if (start && c.dateStr < start) return false;
      if (end && c.dateStr > end) return false;
      return true;
    });

    const uniqueAgents = new Set(filteredByRange.map(c => c.agent));

    return {
      uploads: filteredByRange.length,
      active: uniqueAgents.size,
    };
  };

  const uniqueAgentsAll = new Set(allCalls.map(c => c.agent));
  const totalRegisteredUsers = uniqueAgentsAll.size;
  
  let activeThisWeek = 0;
  let totalCallsUploadedYet = allCalls.length;
  let uploadsThisWeek = 0;

  const today = new Date("2026-06-27T00:00:00");
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(today.getDate() - 7);

  const callsThisWeek = allCalls.filter(c => {
    const d = new Date(c.dateStr + "T00:00:00");
    return d >= sevenDaysAgo && d <= today;
  });
  uploadsThisWeek = callsThisWeek.length;
  activeThisWeek = new Set(callsThisWeek.map(c => c.agent)).size;

  if (dateFilter === "today") {
    const todayCalls = allCalls.filter(c => c.dateStr === "2026-06-27");
    activeThisWeek = new Set(todayCalls.map(c => c.agent)).size;
    totalCallsUploadedYet = todayCalls.length;
    uploadsThisWeek = todayCalls.length;
  } else if (dateFilter === "yesterday") {
    const yesterdayCalls = allCalls.filter(c => c.dateStr === "2026-06-26");
    activeThisWeek = new Set(yesterdayCalls.map(c => c.agent)).size;
    totalCallsUploadedYet = yesterdayCalls.length;
    uploadsThisWeek = yesterdayCalls.length;
  } else if (dateFilter === "7days") {
    activeThisWeek = new Set(callsThisWeek.map(c => c.agent)).size;
    totalCallsUploadedYet = callsThisWeek.length;
    uploadsThisWeek = callsThisWeek.length;
  } else if (dateFilter === "30days") {
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const thirtyDaysCalls = allCalls.filter(c => {
      const d = new Date(c.dateStr + "T00:00:00");
      return d >= thirtyDaysAgo && d <= today;
    });
    activeThisWeek = new Set(thirtyDaysCalls.map(c => c.agent)).size;
    totalCallsUploadedYet = thirtyDaysCalls.length;
    uploadsThisWeek = callsThisWeek.length;
  } else if (dateFilter === "custom" && (customStartDate || customEndDate)) {
    const stats = getCustomRangeStats(customStartDate, customEndDate);
    activeThisWeek = stats.active;
    totalCallsUploadedYet = stats.uploads;
    uploadsThisWeek = stats.uploads;
  }

  const handleStatusToggle = (status: string) => {
    setSelectedStatuses(prev => 
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    );
  };

  // Helper function to check if call date matches active filter relative to Jun 27, 2026
  const checkDateMatch = (dateStr: string, filter: string) => {
    if (filter === "all") return true;
    if (filter === "custom") {
      if (customStartDate && customEndDate) {
        return dateStr >= customStartDate && dateStr <= customEndDate;
      }
      if (customStartDate) {
        return dateStr >= customStartDate;
      }
      if (customEndDate) {
        return dateStr <= customEndDate;
      }
      return true;
    }
    const callDate = new Date(dateStr + "T00:00:00");
    const today = new Date("2026-06-27T00:00:00");
    
    if (filter === "today") {
      return callDate.getTime() === today.getTime();
    }
    if (filter === "yesterday") {
      const yesterday = new Date(today);
      yesterday.setDate(today.getDate() - 1);
      return callDate.getTime() === yesterday.getTime();
    }
    if (filter === "7days") {
      const limit = new Date(today);
      limit.setDate(today.getDate() - 7);
      return callDate.getTime() >= limit.getTime() && callDate.getTime() <= today.getTime();
    }
    if (filter === "30days") {
      const limit = new Date(today);
      limit.setDate(today.getDate() - 30);
      return callDate.getTime() >= limit.getTime() && callDate.getTime() <= today.getTime();
    }
    return true;
  };

  // Filter login timeline users based on selection period
  const filteredUserLogins = userLogins.filter(login => {
    if (dateFilter === "all") return true;
    if (dateFilter === "today") return login.dateStr === "2026-06-27";
    if (dateFilter === "yesterday") return login.dateStr === "2026-06-26";
    if (dateFilter === "7days") {
      return ["2026-06-27", "2026-06-26", "2026-06-25", "2026-06-24", "2026-06-23", "2026-06-22"].includes(login.dateStr);
    }
    if (dateFilter === "30days") return true;
    if (dateFilter === "custom") {
      if (customStartDate && customEndDate) {
        return login.dateStr >= customStartDate && login.dateStr <= customEndDate;
      }
      if (customStartDate) {
        return login.dateStr >= customStartDate;
      }
      if (customEndDate) {
        return login.dateStr <= customEndDate;
      }
      return true;
    }
    return true;
  });

  // Filter list of agents inside drop-down search
  const filteredDropdownAgents = mockAllAgents.filter(agent =>
    agent.toLowerCase().includes(agentSearchQuery.toLowerCase())
  );

  // Filter logic for dashboard calculations
  const filteredCalls = allCalls.filter(call => {
    const matchesAgent = selectedAgent ? call.agent === selectedAgent : true;
    const matchesStatus = selectedStatuses.includes(call.status);
    const matchesScore = call.score >= minScore;
    const matchesSearch = searchQuery 
      ? call.agent.toLowerCase().includes(searchQuery.toLowerCase()) || 
        call.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        call.category.toLowerCase().includes(searchQuery.toLowerCase())
      : true;
    const matchesDate = checkDateMatch(call.dateStr, dateFilter);
    return matchesAgent && matchesStatus && matchesScore && matchesSearch && matchesDate;
  });

  // KPI Calculations
  const totalCount = filteredCalls.length;
  const avgScore = totalCount > 0
    ? Math.round(filteredCalls.reduce((acc, c) => acc + c.score, 0) / totalCount)
    : 0;

  const avgDurationSec = totalCount > 0
    ? Math.round(filteredCalls.reduce((acc, c) => acc + c.durationSec, 0) / totalCount)
    : 0;

  const formatDurationHelper = (totalSeconds: number): string => {
    const roundedSeconds = Math.round(totalSeconds);
    const hrs = Math.floor(roundedSeconds / 3600);
    const mins = Math.floor((roundedSeconds % 3600) / 60);
    const secs = roundedSeconds % 60;

    if (hrs > 0) {
      return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
    }
    if (mins > 0) {
      return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
    }
    return `${secs}s`;
  };

  const avgDuration = totalCount > 0 ? formatDurationHelper(avgDurationSec) : "0s";

  // High QA score ratio (score >= 80)
  const highScoreCount = filteredCalls.filter(c => c.score >= 80).length;
  const highRatio = totalCount > 0
    ? Math.round((highScoreCount / totalCount) * 100)
    : 0;

  // Sentiment Breakdown %
  const positiveCount = filteredCalls.filter(c => c.sentiment === "Positive").length;
  const neutralCount = filteredCalls.filter(c => c.sentiment === "Neutral").length;
  const negativeCount = filteredCalls.filter(c => c.sentiment === "Negative").length;
  const totalDivisor = totalCount || 1;

  const sentimentPct = {
    positive: Math.round((positiveCount / totalDivisor) * 100),
    neutral: Math.round((neutralCount / totalDivisor) * 100),
    negative: Math.round((negativeCount / totalDivisor) * 100),
  };

  const sumPct = sentimentPct.positive + sentimentPct.neutral + sentimentPct.negative;
  if (sumPct > 0 && sumPct !== 100 && totalCount > 0) {
    const diff = 100 - sumPct;
    if (sentimentPct.positive >= sentimentPct.neutral && sentimentPct.positive >= sentimentPct.negative) {
      sentimentPct.positive += diff;
    } else if (sentimentPct.neutral >= sentimentPct.positive && sentimentPct.neutral >= sentimentPct.negative) {
      sentimentPct.neutral += diff;
    } else {
      sentimentPct.negative += diff;
    }
  }

  // Category statistics
  const categories = ["Support", "Tech Support", "Sales", "Billing"];
  const categoryStats = categories.map(name => {
    const count = filteredCalls.filter(c => c.category === name).length;
    const pct = Math.round((count / totalDivisor) * 100);
    return { name, count, pct };
  }).sort((a, b) => b.count - a.count);

  // Sparkline Chart Coordinates
  let sparklineLinePath = "M 0 35 L 100 35";
  let sparklinePath = "M 0 35 L 100 35 L 100 40 L 0 40 Z";
  if (totalCount > 0) {
    const points = filteredCalls.map((call, idx) => {
      const x = totalCount > 1 ? (idx / (totalCount - 1)) * 100 : 50;
      const y = 35 - (call.score / 100) * 30; // score 100 -> y=5, score 0 -> y=35
      return { x, y };
    });
    points.sort((a, b) => a.x - b.x);

    if (points.length === 1) {
      sparklineLinePath = `M 0 ${points[0].y} L 100 ${points[0].y}`;
      sparklinePath = `M 0 ${points[0].y} L 100 ${points[0].y} L 100 40 L 0 40 Z`;
    } else {
      const lineCoords = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      sparklineLinePath = lineCoords;
      sparklinePath = `${lineCoords} L 100 40 L 0 40 Z`;
    }
  }

  // Agent Leaderboard Rankings
  const agentRankingMap: Record<string, { totalScore: number; count: number }> = {};
  filteredCalls.forEach(call => {
    if (!agentRankingMap[call.agent]) {
      agentRankingMap[call.agent] = { totalScore: 0, count: 0 };
    }
    agentRankingMap[call.agent].totalScore += call.score;
    agentRankingMap[call.agent].count += 1;
  });
  const agentRankings = Object.entries(agentRankingMap).map(([name, data]) => ({
    name,
    count: data.count,
    avgScore: Math.round(data.totalScore / data.count)
  })).sort((a, b) => b.avgScore - a.avgScore);

  // Call Duration Distribution
  const shortCalls = filteredCalls.filter(c => c.durationSec < 180).length;
  const mediumCalls = filteredCalls.filter(c => c.durationSec >= 180 && c.durationSec <= 420).length;
  const longCalls = filteredCalls.filter(c => c.durationSec > 420).length;
  const maxBucketCount = Math.max(shortCalls, mediumCalls, longCalls) || 1;
  const durationBuckets = [
    { label: "Short (< 3 min)", count: shortCalls, pct: allCalls.length > 0 ? Math.round((shortCalls / maxBucketCount) * 100) : 0 },
    { label: "Medium (3 - 7 min)", count: mediumCalls, pct: allCalls.length > 0 ? Math.round((mediumCalls / maxBucketCount) * 100) : 0 },
    { label: "Long (> 7 min)", count: longCalls, pct: allCalls.length > 0 ? Math.round((longCalls / maxBucketCount) * 100) : 0 },
  ];

  // Keyword Heatmap / Tag Cloud based on actual occurrence in transcripts
  const keywordWeights = [
    { word: "API Integration", category: "Tech Support" },
    { word: "Refund Request", category: "Billing" },
    { word: "Pricing Plan", category: "Sales" },
    { word: "Reset Password", category: "Support" },
    { word: "Upgrade Subscription", category: "Billing" },
    { word: "Timeout Error", category: "Tech Support" },
    { word: "Enterprise Demo", category: "Sales" },
    { word: "Billing Dispute", category: "Billing" },
    { word: "Frustrated Customer", category: "Tech Support" },
    { word: "Successful Resolution", category: "Support" },
  ];
  const heatmapWords = keywordWeights.map(kw => {
    const frequency = filteredCalls.reduce((acc, call) => {
      const text = (call.transcript || []).map((t: any) => t.text).join(" ").toLowerCase();
      const occurrences = text.includes(kw.word.toLowerCase()) ? 1 : 0;
      return acc + occurrences;
    }, 0);

    const count = frequency;
    const size = Math.min(22, Math.max(11, 10 + count * 3));
    return { word: kw.word, count, size };
  }).filter(tag => tag.count > 0).sort((a, b) => b.count - a.count);

  useEffect(() => {
    if (typeof window !== "undefined") {
      (window as any).__CRM_ANALYTICS_STATE__ = {
        activeFilters: {
          dateFilter,
          customStartDate,
          customEndDate,
          selectedAgent: selectedAgent || "All Agents",
          selectedStatuses,
          minScore,
          searchQuery: searchQuery || "None",
        },
        matchedCallsCount: totalCount,
        totalCallsInDatabase: allCalls.length,
        averageQaScore: avgScore,
        averageDuration: avgDuration,
        highQualityRatio: `${highRatio}%`,
        sentimentBreakdown: {
          positive: `${sentimentPct.positive}%`,
          neutral: `${sentimentPct.neutral}%`,
          negative: `${sentimentPct.negative}%`,
        },
        prevalentCategories: categoryStats.map(c => `${c.name}: ${c.count} calls (${c.pct}%)`),
        agentRankings: agentRankings.map(a => `${a.name}: ${a.count} calls, avg score ${a.avgScore}`),
        durationBuckets: durationBuckets.map(b => `${b.label}: ${b.count} calls`),
        systemKPIs: {
          totalCallsUploaded: totalCallsUploadedYet,
          registeredUsers: totalRegisteredUsers,
          usersLoggedIn: activeThisWeek,
          uploadsThisWeek: uploadsThisWeek,
        }
      };
    }
  }, [
    dateFilter,
    customStartDate,
    customEndDate,
    selectedAgent,
    selectedStatuses,
    minScore,
    searchQuery,
    totalCount,
    allCalls.length,
    avgScore,
    avgDuration,
    highRatio,
    sentimentPct,
    categoryStats,
    agentRankings,
    durationBuckets,
    totalCallsUploadedYet,
    totalRegisteredUsers,
    activeThisWeek,
    uploadsThisWeek
  ]);

  return (
    <div className={styles.appContainer}>
      <Sidebar activeKey="report" />

      {/* Main Workspace */}
      <main className={styles.mainContent}>
        
        {/* Back navigation and Date filter bar */}
        <header className={styles.header}>
          <div className={styles.headerTop}>
            <Link href="/report" className={styles.backLink}>
              <ArrowLeft size={13} />
              <span>Back to Reports</span>
            </Link>

            {/* Premium Date Range Filter Buttons */}
            <div className={styles.dateFiltersRow}>
              {[
                { key: "all", label: "All Time" },
                { key: "today", label: "Today" },
                { key: "yesterday", label: "Yesterday" },
                { key: "7days", label: "Last 7 Days" },
                { key: "30days", label: "Last 30 Days" }
              ].map(item => (
                <button
                  key={item.key}
                  className={`${styles.dateFilterBtn} ${dateFilter === item.key && !customStartDate && !customEndDate ? styles.activeDateFilter : ""}`}
                  onClick={() => {
                    setDateFilter(item.key);
                    setCustomStartDate("");
                    setCustomEndDate("");
                  }}
                >
                  {item.label}
                </button>
              ))}

              <div className={styles.customDateWrapper}>
                <span className={styles.customDateLabel}>Range:</span>
                <input 
                  type="date" 
                  value={customStartDate} 
                  onChange={(e) => {
                    setCustomStartDate(e.target.value);
                    if (e.target.value || customEndDate) {
                      setDateFilter("custom");
                    } else {
                      setDateFilter("all");
                    }
                  }} 
                  className={`${styles.customDateInput} ${dateFilter === "custom" && customStartDate ? styles.activeCustomDate : ""}`}
                />
                <span className={styles.rangeDivider}>to</span>
                <input 
                  type="date" 
                  value={customEndDate} 
                  onChange={(e) => {
                    setCustomEndDate(e.target.value);
                    if (customStartDate || e.target.value) {
                      setDateFilter("custom");
                    } else {
                      setDateFilter("all");
                    }
                  }} 
                  className={`${styles.customDateInput} ${dateFilter === "custom" && customEndDate ? styles.activeCustomDate : ""}`}
                />
              </div>
            </div>
          </div>
          <h1>Advanced Analytics</h1>
          <p className={styles.subtitle}>
            Deep dive into call quality trends, sentiment metrics, agent rankings, and conversation tag volumes.
          </p>
        </header>

        {/* Filters Panel Card */}
        <section className={styles.filtersSection}>
          <div className={styles.sectionHeader}>
            <SlidersHorizontal size={14} className={styles.accentIcon} />
            <h2>Interactive Filter Control Panel</h2>
          </div>
          
          <div className={styles.filtersGrid}>
            
            {/* Custom Searchable Agent Selector Dropdown */}
            <div className={styles.filterBox}>
              <span className={styles.filterLabel}>Agent Filter</span>
              <div className={styles.dropdownContainer}>
                <button 
                  className={styles.dropdownTrigger} 
                  onClick={() => setIsAgentDropdownOpen(!isAgentDropdownOpen)}
                >
                  <span>{selectedAgent ? selectedAgent : "All Agents"}</span>
                  <ChevronDown size={14} className={styles.dropdownTriggerArrow} />
                </button>

                {isAgentDropdownOpen && (
                  <>
                    {/* Backdrop blocker to click-away close */}
                    <div 
                      className={styles.dropdownBackdrop} 
                      onClick={() => {
                        setIsAgentDropdownOpen(false);
                        setAgentSearchQuery("");
                      }} 
                    />
                    <div className={styles.dropdownPopover}>
                      <div className={styles.dropdownSearchWrapper}>
                        <Search size={12} className={styles.dropdownSearchIcon} />
                        <input 
                          type="text" 
                          placeholder="Search agent..." 
                          value={agentSearchQuery}
                          onChange={(e) => setAgentSearchQuery(e.target.value)}
                          className={styles.dropdownSearchInput}
                          autoFocus
                        />
                      </div>
                      <div className={styles.dropdownOptionsList}>
                        <button 
                          className={`${styles.dropdownOption} ${selectedAgent === null ? styles.activeOption : ""}`}
                          onClick={() => {
                            setSelectedAgent(null);
                            setIsAgentDropdownOpen(false);
                            setAgentSearchQuery("");
                          }}
                        >
                          All Agents
                        </button>
                        {filteredDropdownAgents.map(agent => (
                          <button 
                            key={agent}
                            className={`${styles.dropdownOption} ${selectedAgent === agent ? styles.activeOption : ""}`}
                            onClick={() => {
                              setSelectedAgent(agent);
                              setIsAgentDropdownOpen(false);
                              setAgentSearchQuery("");
                            }}
                          >
                            {agent}
                          </button>
                        ))}
                        {filteredDropdownAgents.length === 0 && (
                          <div className={styles.dropdownNoResults}>No agents found</div>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Status Select */}
            <div className={styles.filterBox}>
              <span className={styles.filterLabel}>Status Toggle</span>
              <div className={styles.statusGroup}>
                {["Reviewed", "Pending", "Flagged"].map(status => (
                  <label key={status} className={styles.checkboxLabel}>
                    <input 
                      type="checkbox" 
                      checked={selectedStatuses.includes(status)}
                      onChange={() => handleStatusToggle(status)}
                      className={styles.realCheckbox}
                    />
                    <span className={styles.customCheckbox} />
                    <span className={styles.checkboxText}>{status}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Score Range Select */}
            <div className={styles.filterBox}>
              <div className={styles.sliderLabelRow}>
                <span className={styles.filterLabel}>Min QA Score</span>
                <span className={styles.sliderVal}>{minScore}</span>
              </div>
              <input 
                type="range" 
                min="0" 
                max="100" 
                value={minScore} 
                onChange={(e) => setMinScore(Number(e.target.value))}
                className={styles.scoreSlider}
              />
            </div>

            {/* Keyword Search */}
            <div className={styles.filterBox}>
              <span className={styles.filterLabel}>Keyword Search</span>
              <div className={styles.searchBar}>
                <Search size={14} className={styles.searchIcon} />
                <input 
                  type="text" 
                  placeholder="Filter call ID or Category" 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.searchInput}
                />
              </div>
            </div>
          </div>
        </section>

        {/* Dynamic KPI Stats Brief */}
        <section className={styles.statsGrid}>
          <div className={styles.statsCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>Matched Calls</span>
              <Users size={16} className={styles.cardIcon} />
            </div>
            <span className={styles.cardValue}>
              {totalCount} <span className={styles.cardTotal}>/ {allCalls.length}</span>
            </span>
            <span className={styles.cardSubtext}>Active in selection</span>
          </div>

          <div className={styles.statsCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>Avg. QA Score</span>
              <Award size={16} className={styles.cardIcon} />
            </div>
            <span className={`${styles.cardValue} ${
              avgScore >= 80 ? styles.scoreGreen : avgScore >= 60 ? styles.scoreOrange : styles.scoreRed
            }`}>
              {avgScore}
            </span>
            <span className={styles.cardSubtext}>Performance average</span>
          </div>

          <div className={styles.statsCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>Avg. Duration</span>
              <Clock size={16} className={styles.cardIcon} />
            </div>
            <span className={styles.cardValue}>{avgDuration}</span>
            <span className={styles.cardSubtext}>Average call length</span>
          </div>

          <div className={styles.statsCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>High Quality Ratio</span>
              <Percent size={16} className={styles.cardIcon} />
            </div>
            <span className={styles.cardValue}>{highRatio}%</span>
            <span className={styles.cardSubtext}>Scores 80 or above</span>
          </div>
        </section>

        {/* Dashboard Grid containing 6 Charts */}
        <section className={styles.dashboardGrid}>
          
          {/* Chart 1: Sentiment */}
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Call Sentiment Distribution</h3>
            <div className={styles.sentimentWrapper}>
              <div className={styles.stackedBar}>
                <div 
                  className={styles.segmentPositive} 
                  style={{ width: `${sentimentPct.positive}%` }}
                  title={`Positive: ${sentimentPct.positive}%`}
                />
                <div 
                  className={styles.segmentNeutral} 
                  style={{ width: `${sentimentPct.neutral}%` }}
                  title={`Neutral: ${sentimentPct.neutral}%`}
                />
                <div 
                  className={styles.segmentNegative} 
                  style={{ width: `${sentimentPct.negative}%` }}
                  title={`Negative: ${sentimentPct.negative}%`}
                />
              </div>
              <div className={styles.sentimentLegend}>
                <div className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.dotPositive}`} />
                  <span>Positive ({sentimentPct.positive}%)</span>
                </div>
                <div className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.dotNeutral}`} />
                  <span>Neutral ({sentimentPct.neutral}%)</span>
                </div>
                <div className={styles.legendItem}>
                  <span className={`${styles.legendDot} ${styles.dotNegative}`} />
                  <span>Negative ({sentimentPct.negative}%)</span>
                </div>
              </div>
            </div>
          </div>

          {/* Chart 2: SVG Quality Curve */}
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Quality Score Trend Curve</h3>
            <div className={styles.sparklineWrapper}>
              <div className={styles.svgContainer}>
                <svg className={styles.sparklineSvg} viewBox="0 0 100 40" preserveAspectRatio="none">
                  <defs>
                    <linearGradient id="areaGradientFull" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.25"/>
                      <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0.0"/>
                    </linearGradient>
                  </defs>
                  <path 
                    d={sparklinePath} 
                    fill="url(#areaGradientFull)"
                  />
                  <path 
                    d={sparklineLinePath} 
                    fill="none" 
                    stroke="var(--color-accent)" 
                    strokeWidth="1.5" 
                    strokeLinecap="round"
                  />
                </svg>
              </div>
              <div className={styles.sparklineLabels}>
                <span>Chronological Start</span>
                <span>Chronological Latest</span>
              </div>
            </div>
          </div>

          {/* Chart 3: Category distribution */}
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Category Prevalence</h3>
            <div className={styles.catDistribution}>
              {categoryStats.map(cat => (
                <div key={cat.name} className={styles.catRow}>
                  <div className={styles.catLabelRow}>
                    <span className={styles.catName}>{cat.name}</span>
                    <span className={styles.catValText}>{cat.count} calls ({cat.pct}%)</span>
                  </div>
                  <div className={styles.catBarTrack}>
                    <div 
                      className={styles.catBarFill} 
                      style={{ width: `${cat.pct}%` }}
                    />
                  </div>
                </div>
              ))}
              {totalCount === 0 && (
                <div className={styles.noDataPlaceholder}>No categories match active filters.</div>
              )}
            </div>
          </div>

          {/* Chart 4: Agent Performance Rankings */}
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Agent Performance Leaderboard</h3>
            <div className={styles.leaderboardContainer}>
              {agentRankings.map((agent, index) => (
                <div key={agent.name} className={styles.leaderboardRow}>
                  <div className={styles.agentRankCol}>
                    <span className={styles.rankNum}>#{index + 1}</span>
                    <span className={styles.rankAgentName}>{agent.name}</span>
                  </div>
                  <div className={styles.agentRankBarCol}>
                    <div className={styles.rankBarTrack}>
                      <div 
                        className={`${styles.rankBarFill} ${
                          agent.avgScore >= 80 ? styles.bgGreen : agent.avgScore >= 60 ? styles.bgOrange : styles.bgRed
                        }`}
                        style={{ width: `${agent.avgScore}%` }}
                      />
                    </div>
                  </div>
                  <div className={styles.agentScoreCol}>
                    <span className={styles.rankCallCount}>{agent.count} calls</span>
                    <span className={`${styles.rankScore} ${
                      agent.avgScore >= 80 ? styles.scoreGreen : agent.avgScore >= 60 ? styles.scoreOrange : styles.scoreRed
                    }`}>
                      {agent.avgScore}
                    </span>
                  </div>
                </div>
              ))}
              {agentRankings.length === 0 && (
                <div className={styles.noDataPlaceholder}>No agent records match filters.</div>
              )}
            </div>
          </div>

          {/* Chart 5: Call Duration Buckets */}
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Call Duration Bucketing</h3>
            <div className={styles.durationGraph}>
              {durationBuckets.map(bucket => (
                <div key={bucket.label} className={styles.durationCol}>
                  <div className={styles.durationBarContainer}>
                    <div 
                      className={styles.durationBar} 
                      style={{ height: `${bucket.pct}%` }}
                      title={`${bucket.count} calls`}
                    >
                      {bucket.count > 0 && <span className={styles.durationBarCount}>{bucket.count}</span>}
                    </div>
                  </div>
                  <span className={styles.durationBarLabel}>{bucket.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Chart 6: Keyword Heatmap / Tag Cloud */}
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Call Keyword Heatmap</h3>
            <div className={styles.heatmapWrapper}>
              {heatmapWords.length > 0 ? (
                <div className={styles.heatmapTags}>
                  {heatmapWords.map(tag => (
                    <span 
                      key={tag.word} 
                      className={styles.heatmapTag}
                      style={{ 
                        fontSize: `${tag.size}px`,
                        opacity: Math.min(1, Math.max(0.45, tag.count / 5)),
                        color: tag.count >= 2 ? "var(--color-accent)" : "var(--color-text-main)"
                      }}
                      title={`Frequency score: ${tag.count}`}
                    >
                      {tag.word}
                    </span>
                  ))}
                </div>
              ) : (
                <div className={styles.noDataPlaceholder}>No keywords found in active transcripts.</div>
              )}
            </div>
          </div>

        </section>

        {/* Section Divider */}
        <hr className={styles.sectionDivider} />

        {/* System Activity & User Audits Header */}
        <div className={styles.sectionHeaderTitle}>
          <h2>System Activity & Team Audits</h2>
          <p>Global statistics for call uploads, registered users, and active login timelines this week.</p>
        </div>

        {/* System KPIs Row */}
        <section className={styles.statsGrid}>
          <div className={styles.statsCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>Total Calls Uploaded</span>
              <Award size={16} className={styles.cardIcon} />
            </div>
            <span className={styles.cardValue}>{totalCallsUploadedYet.toLocaleString()}</span>
            <span className={styles.cardSubtext}>Calls uploaded yet</span>
          </div>

          <div className={styles.statsCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>Registered Users</span>
              <Users size={16} className={styles.cardIcon} />
            </div>
            <span className={styles.cardValue}>{totalRegisteredUsers}</span>
            <span className={styles.cardSubtext}>Total team size</span>
          </div>

          <div className={styles.statsCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>Users Logged In</span>
              <Clock size={16} className={styles.cardIcon} />
            </div>
            <span className={styles.cardValue}>{activeThisWeek}</span>
            <span className={styles.cardSubtext}>Active in selected period</span>
          </div>

          <div className={styles.statsCard}>
            <div className={styles.cardHeader}>
              <span className={styles.cardLabel}>Uploads This Week</span>
              <Percent size={16} className={styles.cardIcon} />
            </div>
            <span className={styles.cardValue}>{uploadsThisWeek}</span>
            <span className={styles.cardSubtext}>+12% vs last week</span>
          </div>
        </section>

        {/* Audit Sub-Grid */}
        <section className={styles.auditGrid}>
          {/* Upload Trend Chart */}
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Weekly Call Upload Volume</h3>
            <div className={styles.uploadTrendContainer}>
              {weeklyUploadData.map(data => (
                <div key={data.day} className={styles.uploadBarCol}>
                  <div className={styles.uploadBarTrack}>
                    <div 
                      className={`${styles.uploadBarFill} ${
                        dateFilter === "custom" && 
                        ((customStartDate && data.dateStr >= customStartDate) || !customStartDate) &&
                        ((customEndDate && data.dateStr <= customEndDate) || !customEndDate) &&
                        (customStartDate || customEndDate)
                          ? styles.highlightedUploadBar : ""
                      }`} 
                      style={{ height: `${data.maxPct}%` }}
                      title={`${data.count} calls`}
                    >
                      <span className={styles.uploadBarCount}>{data.count}</span>
                    </div>
                  </div>
                  <span className={styles.uploadBarLabel}>{data.day}</span>
                </div>
              ))}
            </div>
          </div>

          {/* User Logins Timeline table */}
          <div className={styles.chartCard}>
            <h3 className={styles.chartTitle}>Recent User Logins (This Week)</h3>
            <div className={styles.auditTableContainer}>
              <table className={styles.auditTable}>
                <thead>
                  <tr>
                    <th>User</th>
                    <th>Role</th>
                    <th>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUserLogins.length > 0 ? (
                    filteredUserLogins.map((login, idx) => (
                      <tr key={idx}>
                        <td className={styles.auditUserCol}>
                          <span className={styles.userDot} />
                          {login.name}
                        </td>
                        <td>
                          <span className={`${styles.roleBadge} ${styles[`role${login.role}`]}`}>
                            {login.role}
                          </span>
                        </td>
                        <td className={styles.auditTimeCol}>{login.time}</td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={3} className={styles.noLoginsPlaceholder}>
                        No active logins recorded for this date.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

