"use client";

import { useState, useEffect } from "react";
import Sidebar from "@/components/Sidebar";
import styles from "./page.module.css";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

// SVG Icons
const CalendarIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.filterIcon}>
    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </svg>
);

const ArrowRightIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={styles.arrowIcon}>
    <line x1="5" y1="12" x2="19" y2="12" />
    <polyline points="12 5 19 12 12 19" />
  </svg>
);

const SearchIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={styles.searchIcon}>
    <circle cx="11" cy="11" r="8" />
    <line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const ExportIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={styles.tableExportIcon}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

export default function ReportsPage() {
  const router = useRouter();
  const [allCalls, setAllCalls] = useState<any[]>([]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("all_calls_database");
      if (stored) {
        try {
          setAllCalls(JSON.parse(stored));
        } catch (e) {
          console.error("Failed to load calls database", e);
        }
      }
    }
  }, []);

  const handleCallClick = (id: string) => {
    localStorage.setItem("active_call_id", id);
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      try {
        const channel = new BroadcastChannel("call_updates");
        channel.postMessage({ type: "ACTIVE_CALL_CHANGED", callId: id });
        channel.close();
      } catch (e) {}
    }
    router.push(`/evaluation?id=${encodeURIComponent(id)}`);
  };

  // States
  const [searchQuery, setSearchQuery] = useState("");
  const [startDate, setStartDate] = useState("2026-05-01");
  const [endDate, setEndDate] = useState("2026-06-30");

  // Dynamic filter logic
  const filteredMainCalls = allCalls.filter(call => {
    const callDate = new Date(call.dateStr + "T00:00:00");
    const start = startDate ? new Date(startDate + "T00:00:00") : null;
    const end = endDate ? new Date(endDate + "T00:00:00") : null;
    
    const matchesSearch = searchQuery 
      ? call.agent.toLowerCase().includes(searchQuery.toLowerCase()) || 
        call.id.toLowerCase().includes(searchQuery.toLowerCase())
      : true;
      
    const matchesStart = start ? callDate.getTime() >= start.getTime() : true;
    const matchesEnd = end ? callDate.getTime() <= end.getTime() : true;
    
    return matchesSearch && matchesStart && matchesEnd;
  });

  // Calculate dynamic KPIs
  const totalAnalyzed = filteredMainCalls.length;
  
  const avgQA = totalAnalyzed > 0
    ? Math.round((filteredMainCalls.reduce((acc, c) => acc + c.score, 0) / totalAnalyzed) * 10) / 10
    : 0;
    
  const flaggedCount = filteredMainCalls.filter(c => c.status === "Flagged").length;
  
  const avgDurationSec = totalAnalyzed > 0
    ? Math.round(filteredMainCalls.reduce((acc, c) => acc + c.durationSec, 0) / totalAnalyzed)
    : 0;

  const formatDurationHelper = (totalSeconds: number): string => {
    const roundedSeconds = Math.round(totalSeconds);
    const hrs = Math.floor(roundedSeconds / 3600);
    const mins = Math.floor((roundedSeconds % 3600) / 60);
    const secs = roundedSeconds % 60;

    if (hrs > 0) {
      return mins > 0 ? `${hrs} hour${hrs > 1 ? "s" : ""} ${mins} min` : `${hrs} hour${hrs > 1 ? "s" : ""}`;
    }
    if (mins > 0) {
      return secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`;
    }
    return `${secs} sec`;
  };

  const avgDurationStr = totalAnalyzed > 0
    ? formatDurationHelper(avgDurationSec)
    : "0 sec";

  const kpis = [
    { label: "Calls Analyzed", value: totalAnalyzed.toLocaleString(), subtext: "+12% this week", highlight: false },
    { label: "Avg. QA Score", value: avgQA.toString(), subtext: "+1.4% from last period", highlight: false },
    { label: "Flagged Calls", value: flaggedCount.toString(), subtext: "-4% this week", highlight: false },
    { label: "Avg. Duration", value: avgDurationStr, subtext: "Consistent pacing", highlight: false },
  ];

  // Daily average score calculation
  const dayScoresMap: Record<string, number[]> = {
    "Mon": [], "Tue": [], "Wed": [], "Thu": [], "Fri": [], "Sat": [], "Today": []
  };
  
  filteredMainCalls.forEach(call => {
    const d = new Date(call.dateStr + "T00:00:00");
    const dayIndex = d.getDay(); // 0 = Sunday, 1 = Mon...
    let key = "Today";
    if (dayIndex === 1) key = "Mon";
    else if (dayIndex === 2) key = "Tue";
    else if (dayIndex === 3) key = "Wed";
    else if (dayIndex === 4) key = "Thu";
    else if (dayIndex === 5) key = "Fri";
    else if (dayIndex === 6) key = "Sat";
    
    dayScoresMap[key].push(call.score);
  });

  const baseScores = [
    { day: "Mon", fallback: 72 },
    { day: "Tue", fallback: 82 },
    { day: "Wed", fallback: 78 },
    { day: "Thu", fallback: 87 },
    { day: "Fri", fallback: 83 },
    { day: "Sat", fallback: 95 },
    { day: "Today", fallback: 84 },
  ];
  
  const dailyScores = baseScores.map(item => {
    const scores = dayScoresMap[item.day];
    const value = scores.length > 0 
      ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
      : 0;
    return { day: item.day, value };
  });

  // Dynamic Speech donut percentages
  const avgAgent = totalAnalyzed > 0
    ? Math.round(filteredMainCalls.reduce((acc, c) => acc + c.agentTime, 0) / totalAnalyzed)
    : 0;
  const avgCustomer = totalAnalyzed > 0
    ? Math.round(filteredMainCalls.reduce((acc, c) => acc + c.customerTime, 0) / totalAnalyzed)
    : 0;
  const avgSilence = totalAnalyzed > 0
    ? Math.max(0, 100 - avgAgent - avgCustomer)
    : 0;

  const donutGradientStyle = {
    background: avgAgent === 0 && avgCustomer === 0
      ? "var(--color-bg-muted, #eae7e1)"
      : `conic-gradient(
          var(--color-accent) 0% ${avgAgent}%,
          #2b2825 ${avgAgent}% ${avgAgent + avgCustomer}%,
          #eae7e1 ${avgAgent + avgCustomer}% 100%
        )`
  };

  const getScoreColorClass = (score: number) => {
    if (score >= 80) return styles.scoreGreen;
    if (score >= 60) return styles.scoreOrange;
    return styles.scoreRed;
  };

  return (
    <div className={styles.appContainer}>
      <Sidebar activeKey="report" />

      {/* Main Content Area */}
      <main className={styles.mainContent}>
        <header className={styles.header}>
          <h1>Reports</h1>
        </header>

        {/* Top KPI Cards Row */}
        <section className={styles.kpiGrid}>
          {kpis.map((kpi, idx) => (
            <div key={idx} className={`${styles.kpiCard} ${kpi.highlight ? styles.kpiCardBlueHighlight : ""}`}>
              <span className={styles.kpiLabel}>{kpi.label}</span>
              <span className={styles.kpiValue}>{kpi.value}</span>
              <span className={styles.kpiSubtext}>{kpi.subtext}</span>
            </div>
          ))}
        </section>

        {/* Charts Section */}
        <section className={styles.chartsGrid}>
          {/* Daily QA Scores Card */}
          <div className={styles.chartCard}>
            <h2 className={styles.chartTitle}>Daily QA Scores</h2>
            
            <div className={styles.barChartContainer}>
              {/* Y Axis */}
              <div className={styles.yAxis}>
                <span>100</span>
                <span>80</span>
                <span>65</span>
                <span>50</span>
              </div>
              
              {/* Bar Columns Container */}
              <div className={styles.barsContainer}>
                {dailyScores.map((data, idx) => (
                  <div key={idx} className={styles.barColumn}>
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{ height: `${data.value}%` }}
                      />
                    </div>
                    <span className={styles.barLabel}>{data.day}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Speech Time Donut Card */}
          <div className={styles.chartCard}>
            <h2 className={styles.chartTitle}>Speech Time</h2>
            
            <div className={styles.donutContainer}>
              <div className={styles.donutChart} style={donutGradientStyle} />
              
              <div className={styles.donutLegend}>
                <div className={styles.legendRow}>
                  <div className={styles.legendLabelContainer}>
                    <span className={`${styles.legendDot} ${styles.legendDotAgent}`} />
                    <span className={styles.legendLabelText}>Agent</span>
                  </div>
                  <span className={styles.legendValue}>{avgAgent}%</span>
                </div>
                
                <div className={styles.legendRow}>
                  <div className={styles.legendLabelContainer}>
                    <span className={`${styles.legendDot} ${styles.legendDotCustomer}`} />
                    <span className={styles.legendLabelText}>Customer</span>
                  </div>
                  <span className={styles.legendValue}>{avgCustomer}%</span>
                </div>
                
                <div className={styles.legendRow}>
                  <div className={styles.legendLabelContainer}>
                    <span className={`${styles.legendDot} ${styles.legendDotSilence}`} />
                    <span className={styles.legendLabelText}>Silence</span>
                  </div>
                  <span className={styles.legendValue}>{avgSilence}%</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Recent Calls Section */}
        <section className={styles.recentCallsSection}>
          <div className={styles.tableHeader}>
            <h2>Recent Calls</h2>
            
            <div className={styles.filterControls}>
              <div className={styles.datePickerRange}>
                <div className={styles.dateInputWrapper}>
                  <CalendarIcon />
                  <input 
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className={styles.dateInput}
                  />
                </div>
                <ArrowRightIcon />
                <div className={styles.dateInputWrapper}>
                  <CalendarIcon />
                  <input 
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className={styles.dateInput}
                  />
                </div>
              </div>

              <div className={styles.searchBar}>
                <SearchIcon />
                <input 
                  type="text" 
                  placeholder="Search name" 
                  className={styles.searchInput}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)} 
                />
              </div>

              <Link href="/analytics" className={styles.launchBtn}>
                <ExternalLink size={13} />
                <span>Launch</span>
              </Link>
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
                  <th>Score</th>
                  <th>Status</th>
                  <th className={styles.exportHeaderColumn}>
                    <button className={styles.exportLinkBtn}>
                      <ExportIcon />
                      <span>Export</span>
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                 {filteredMainCalls.length > 0 ? (
                  filteredMainCalls.map((call, idx) => (
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
                      <td className={`${styles.scoreColumn} ${getScoreColorClass(call.score)}`}>
                        {call.score}
                      </td>
                      <td colSpan={2}>
                        <span className={`${styles.statusBadge} ${styles[`status${call.status}`]}`}>
                          <span className={styles.statusDot} />
                          {call.status}
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "40px", color: "var(--color-text-muted)" }}>
                      No calls analyzed yet. Upload an audio recording on the homepage to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}



