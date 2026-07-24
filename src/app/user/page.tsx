"use client";

import { useState } from "react";
import Sidebar from "@/components/Sidebar";
import styles from "./page.module.css";
import { OFFICIAL_PSEUDO_NAMES } from "@/lib/pseudoNames";

// SVG Shield Icon
const ShieldIcon = () => (
  <svg className={styles.shieldIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

// SVG Chevron Icon
const ChevronDownIcon = ({ isOpen }: { isOpen: boolean }) => (
  <svg 
    className={`${styles.selectChevron} ${isOpen ? styles.selectChevronOpen : ""}`} 
    viewBox="0 0 24 24" 
    fill="none" 
    stroke="currentColor" 
    strokeWidth="2" 
    strokeLinecap="round" 
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

interface User {
  name: string;
  email: string;
  role: string;
  lastLogin: string;
  kickable: boolean;
}

export default function UserManagementPage() {
  const [activeTab, setActiveTab] = useState<"users" | "scorecard" | "vocabulary">("users");

  const summaryCards = [
    { count: "1 user", role: "Super Admin", desc: "Full system access and configuration" },
    { count: "2 users", role: "QA Analyst", desc: "Call evaluation and audit management" },
    { count: "1 user", role: "Admin", desc: "Team & workflow management" },
  ];

  const [users, setUsers] = useState<User[]>([
    { name: "Anika Sharma", email: "anika@gmail.com", role: "Super Admin", lastLogin: "Today , 9:30", kickable: false },
    { name: "Rohan Mehta", email: "rohan@brocus.com", role: "QA Analyst", lastLogin: "Today, 11:54", kickable: true },
    { name: "Priya Verma", email: "priya@outlook.com", role: "Admin", lastLogin: "Yesterday, 7:34", kickable: true },
    { name: "James Liu", email: "james@gmail.com", role: "QA Analyst", lastLogin: "Today, 6:47", kickable: true },
    { name: "Fatima Al-Rashed", email: "fatima@outlook.com", role: "IT Manager", lastLogin: "Yesterday, 4:34", kickable: true },
  ]);

  // QA Scorecard Parameter State
  const defaultScorecard = [
    { id: 1, param: "Was the agent enthusiastic, energetic throughout the call?", isFatal: false, weight: 2.7, category: "Soft Skills & Rapport", enabled: true },
    { id: 2, param: "Did the agent use a pseudo name?", isFatal: false, weight: 2.8, category: "Process & Compliance", enabled: true },
    { id: 3, param: "Did the agent ask for the customer’s name and personalize the call?", isFatal: false, weight: 2.7, category: "Opening & Greeting", enabled: true },
    { id: 4, param: "Did the agent understand and comprehend the primary issue?", isFatal: false, weight: 2.7, category: "Process & Compliance", enabled: true },
    { id: 5, param: "Did the agent confirm VIVINT to be the new service provider?", isFatal: false, weight: 2.7, category: "Product & USP", enabled: true },
    { id: 6, param: "Did the agent ask the customer to save the company’s number and request contact details?", isFatal: false, weight: 2.7, category: "Process & Compliance", enabled: true },
    { id: 7, param: "Did the agent ask relevant questions?", isFatal: false, weight: 2.7, category: "Process & Compliance", enabled: true },
    { id: 8, param: "Did the agent calm an irritated customer?", isFatal: false, weight: 2.7, category: "Soft Skills & Rapport", enabled: true },
    { id: 9, param: "Did the agent handle objections using rebuttals?", isFatal: false, weight: 2.7, category: "Process & Compliance", enabled: true },
    { id: 10, param: "Did the agent build rapport and use power words & statements?", isFatal: false, weight: 2.7, category: "Soft Skills & Rapport", enabled: true },
    { id: 24, param: "Did the agent fail to open the call within 5 seconds?", isFatal: true, weight: 2.7, category: "Opening & Greeting", enabled: true },
    { id: 26, param: "Did the Agent fail to use BROCUS IT solutions callopening?", isFatal: true, weight: 2.7, category: "Opening & Greeting", enabled: true },
    { id: 31, param: "Did the Agent mention that, He/She is not affiliated with [ADT/Brinks]", isFatal: true, weight: 2.7, category: "Product & USP", enabled: true },
    { id: 37, param: "Did the agent use regional or abusive language or display rude behavior?", isFatal: true, weight: 2.7, category: "Soft Skills & Rapport", enabled: true },
  ];

  const [scorecardParams, setScorecardParams] = useState<any[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("qa_custom_scorecard");
      if (stored) {
        try { return JSON.parse(stored); } catch (e) {}
      }
    }
    return defaultScorecard;
  });

  const [newParamText, setNewParamText] = useState("");
  const [newParamFatal, setNewParamFatal] = useState(false);
  const [newParamCategory, setNewParamCategory] = useState("Process & Compliance");

  // Custom Vocabulary State
  const defaultVocabulary = ["Brocus", "Brocus IT Solutions", "Vivint", "ADT", "Brinks"];
  const [vocabulary, setVocabulary] = useState<string[]>(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("qa_custom_vocabulary");
      if (stored) {
        try { return JSON.parse(stored); } catch (e) {}
      }
    }
    return defaultVocabulary;
  });
  const [newVocabTerm, setNewVocabTerm] = useState("");

  const handleAddParam = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newParamText.trim()) return;
    const newParam = {
      id: Date.now(),
      param: newParamText.trim(),
      isFatal: newParamFatal,
      weight: 2.7,
      category: newParamCategory,
      enabled: true
    };
    const updated = [...scorecardParams, newParam];
    setScorecardParams(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("qa_custom_scorecard", JSON.stringify(updated));
    }
    setNewParamText("");
    setNewParamFatal(false);
  };

  const handleToggleParam = (id: number) => {
    const updated = scorecardParams.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p);
    setScorecardParams(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("qa_custom_scorecard", JSON.stringify(updated));
    }
  };

  const handleAddVocab = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVocabTerm.trim() || vocabulary.includes(newVocabTerm.trim())) return;
    const updated = [...vocabulary, newVocabTerm.trim()];
    setVocabulary(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("qa_custom_vocabulary", JSON.stringify(updated));
    }
    setNewVocabTerm("");
  };

  const handleRemoveVocab = (term: string) => {
    const updated = vocabulary.filter(v => v !== term);
    setVocabulary(updated);
    if (typeof window !== "undefined") {
      localStorage.setItem("qa_custom_vocabulary", JSON.stringify(updated));
    }
  };

  // Modal, Dropdown, and Form States
  const [userToKick, setUserToKick] = useState<User | null>(null);
  const [isAddUserOpen, setIsAddUserOpen] = useState(false);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [newUserName, setNewUserName] = useState("");
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserRole, setNewUserRole] = useState("QA Analyst");

  // Kick Logic
  const handleKickClick = (user: User) => {
    setUserToKick(user);
  };

  const handleConfirmKick = () => {
    if (userToKick) {
      setUsers(users.filter((u) => u.email !== userToKick.email));
      setUserToKick(null);
    }
  };

  const handleCancelKick = () => {
    setUserToKick(null);
  };

  // Add User Logic
  const handleAddUserClick = () => {
    setIsAddUserOpen(true);
  };

  const handleAddUserConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUserName.trim() || !newUserEmail.trim()) return;

    const newUser: User = {
      name: newUserName,
      email: newUserEmail,
      role: newUserRole,
      lastLogin: "Just now",
      kickable: true,
    };

    setUsers([...users, newUser]);
    
    // Reset fields and close modal
    setNewUserName("");
    setNewUserEmail("");
    setNewUserRole("QA Analyst");
    setIsAddUserOpen(false);
  };

  const handleAddUserCancel = () => {
    setNewUserName("");
    setNewUserEmail("");
    setNewUserRole("QA Analyst");
    setIsAddUserOpen(false);
    setIsDropdownOpen(false);
  };

  return (
    <div className={styles.appContainer}>
      <Sidebar activeKey="user" />

      {/* Main Content Area */}
      <main className={styles.mainContent}>
        <header className={styles.header}>
          <h1>User & System Configuration</h1>
        </header>

        {/* Tab Navigation */}
        <div className={styles.tabsContainer}>
          <button 
            className={`${styles.tabBtn} ${activeTab === "users" ? styles.tabBtnActive : ""}`} 
            onClick={() => setActiveTab("users")}
          >
            User Management
          </button>
          <button 
            className={`${styles.tabBtn} ${activeTab === "scorecard" ? styles.tabBtnActive : ""}`} 
            onClick={() => setActiveTab("scorecard")}
          >
            QA Scorecard Parameters
          </button>
          <button 
            className={`${styles.tabBtn} ${activeTab === "vocabulary" ? styles.tabBtnActive : ""}`} 
            onClick={() => setActiveTab("vocabulary")}
          >
            Custom Vocabulary ("Brocus")
          </button>
        </div>

        {activeTab === "users" && (
          <>
            {/* Top Summary Cards */}
            <section className={styles.summaryGrid}>
              {summaryCards.map((card, idx) => (
                <div key={idx} className={styles.summaryCard}>
                  <div className={styles.cardHeader}>
                    <ShieldIcon />
                    <span className={styles.userCountText}>{card.count}</span>
                  </div>
                  <div className={styles.cardBody}>
                    <h3 className={styles.cardTitle}>{card.role}</h3>
                    <p className={styles.cardDescription}>{card.desc}</p>
                  </div>
                </div>
              ))}
            </section>

            {/* Users Table Card */}
            <section className={styles.tablePanelCard}>
              <div className={styles.panelHeader}>
                <h2 className={styles.panelTitle}>Users</h2>
                <button className={styles.inviteButton} onClick={handleAddUserClick}>
                  Add User
                </button>
              </div>

              <div className={styles.tableContainer}>
                <table className={styles.usersTable}>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Last Login</th>
                      <th aria-hidden="true"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user, idx) => (
                      <tr key={idx}>
                        <td className={styles.nameColumn}>{user.name}</td>
                        <td className={styles.emailColumn}>{user.email}</td>
                        <td className={styles.roleColumn}>{user.role}</td>
                        <td className={styles.loginColumn}>{user.lastLogin}</td>
                        <td className={styles.actionsColumn}>
                          {user.kickable && (
                            <button
                              className={styles.kickBtn}
                              onClick={() => handleKickClick(user)}
                            >
                              Kick
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}

        {activeTab === "scorecard" && (
          <section className={styles.tablePanelCard}>
            <div className={styles.panelHeader}>
              <div>
                <h2 className={styles.panelTitle}>Custom QA Scorecard Parameters</h2>
                <p style={{ fontSize: "12.5px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                  Configure evaluation metrics, weights, and fatal flags dynamically used by Gemini AI during call audits.
                </p>
              </div>
            </div>

            {/* Add Parameter Form */}
            <form onSubmit={handleAddParam} style={{ display: "flex", gap: "12px", marginBottom: "20px", background: "#fafafa", padding: "16px", borderRadius: "8px" }}>
              <input 
                type="text" 
                className={styles.formInput} 
                placeholder="Enter new QA parameter metric..."
                value={newParamText}
                onChange={(e) => setNewParamText(e.target.value)}
                style={{ flex: 1 }}
                required
              />
              <select 
                className={styles.formInput} 
                value={newParamCategory}
                onChange={(e) => setNewParamCategory(e.target.value)}
                style={{ width: "180px" }}
              >
                <option value="Opening & Greeting">Opening & Greeting</option>
                <option value="Soft Skills & Rapport">Soft Skills & Rapport</option>
                <option value="Product & USP">Product & USP</option>
                <option value="Process & Compliance">Process & Compliance</option>
                <option value="Closing & Follow-up">Closing & Follow-up</option>
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", cursor: "pointer" }}>
                <input 
                  type="checkbox" 
                  checked={newParamFatal} 
                  onChange={(e) => setNewParamFatal(e.target.checked)}
                />
                Fatal Parameter
              </label>
              <button type="submit" className={styles.inviteButton}>
                + Add Metric
              </button>
            </form>

            <div style={{ display: "flex", flexDirection: "column" }}>
              {scorecardParams.map((item) => (
                <div key={item.id} className={styles.paramItem}>
                  <div>
                    <span className={styles.paramText}>{item.param}</span>
                  </div>
                  <div className={styles.paramMeta}>
                    <span className={styles.badgeCategory}>{item.category}</span>
                    {item.isFatal ? (
                      <span className={styles.badgeFatal}>Fatal</span>
                    ) : (
                      <span className={styles.badgeNonFatal}>Weight: {item.weight || 2.7}</span>
                    )}
                    <button 
                      className={styles.kickBtn}
                      onClick={() => handleToggleParam(item.id)}
                      style={{ color: item.enabled ? "#16a34a" : "#dc2626" }}
                    >
                      {item.enabled ? "Active" : "Disabled"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {activeTab === "vocabulary" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Pseudo Names Exchange Section */}
            <section className={styles.tablePanelCard}>
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>Official Agent Pseudo Names & STT Phonetic Exchange</h2>
                  <p style={{ fontSize: "12.5px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                    Speech-to-Text often mishears agent names (e.g. <em>"Atom Miller"</em> for <strong>Adam Miller</strong>, <em>"Casey Jones"</em> for <strong>Cassey Jones</strong>, <em>"Suzanne Davis"</em> for <strong>Suzzane Daves</strong>, <em>"Jared McCann"</em> for <strong>Jared McAnn</strong>). The automatic phonetic engine normalizes and exchanges all speech variants into these official pseudo names.
                  </p>
                </div>
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "20px" }}>
                {OFFICIAL_PSEUDO_NAMES.map((name) => (
                  <div key={name} style={{ background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1e40af", padding: "6px 14px", borderRadius: "20px", fontSize: "13px", fontWeight: 600 }}>
                    👤 {name}
                  </div>
                ))}
              </div>

              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "16px", borderRadius: "8px" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "600", color: "#166534", marginBottom: "4px" }}>
                  ✓ Speech-to-Text Pseudo Name Exchange Engine Active
                </h3>
                <p style={{ fontSize: "12.5px", color: "#15803d", lineHeight: "1.4" }}>
                  Active phonetic matching & exchange rules ensure dialogue turns and extracted agent names are automatically mapped to the official pseudo name list across all transcription and evaluation pipelines.
                </p>
              </div>
            </section>

            {/* Brand Vocabulary Section */}
            <section className={styles.tablePanelCard}>
              <div className={styles.panelHeader}>
                <div>
                  <h2 className={styles.panelTitle}>Custom Domain Dictionary & Speech-to-Text Accuracy</h2>
                  <p style={{ fontSize: "12.5px", color: "var(--color-text-muted)", marginTop: "4px" }}>
                    Define custom brand terminology (e.g. <strong>"Brocus"</strong>, <strong>"Brocus IT Solutions"</strong>) to automatically guide Gemini audio transcription and prevent misspellings (*"Broca"*, *"Brocas"*, *"Broker"*).
                  </p>
                </div>
              </div>

              <form onSubmit={handleAddVocab} style={{ display: "flex", gap: "12px", marginBottom: "20px" }}>
                <input 
                  type="text"
                  className={styles.formInput}
                  placeholder="Add custom brand name or product term (e.g. Brocus)..."
                  value={newVocabTerm}
                  onChange={(e) => setNewVocabTerm(e.target.value)}
                  style={{ flex: 1 }}
                  required
                />
                <button type="submit" className={styles.inviteButton}>
                  Add Term
                </button>
              </form>

              <div style={{ display: "flex", flexWrap: "wrap", gap: "10px", marginBottom: "24px" }}>
                {vocabulary.map((term) => (
                  <div key={term} className={styles.vocabTag}>
                    <span>{term}</span>
                    <button 
                      type="button"
                      className={styles.removeVocabBtn} 
                      onClick={() => handleRemoveVocab(term)}
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>

              <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", padding: "16px", borderRadius: "8px" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "600", color: "#166534", marginBottom: "4px" }}>
                  ✓ Speech-to-Text Phonetic Replacement Rules Active
                </h3>
                <p style={{ fontSize: "12.5px", color: "#15803d", lineHeight: "1.4" }}>
                  Automatic dictionary correction is actively listening for homophones like <em>"Broca"</em>, <em>"Brocas"</em>, <em>"Broker"</em>, and <em>"Procus"</em> during audio processing, ensuring all company name occurrences are output correctly as <strong>"Brocus"</strong>.
                </p>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Confirmation Modal */}
      {userToKick && (
        <div className={styles.modalBackdrop}>
          <div className={styles.modalCard}>
            <h2 className={styles.modalTitle}>Remove User?</h2>
            <p className={styles.modalDescription}>
              Are you sure you want to kick <strong>{userToKick.name}</strong>? This action will immediately revoke their system access.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.cancelBtn} onClick={handleCancelKick}>
                Cancel
              </button>
              <button className={styles.confirmBtn} onClick={handleConfirmKick}>
                Kick
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add User Modal */}
      {isAddUserOpen && (
        <div className={styles.modalBackdrop}>
          {isDropdownOpen && (
            <div className={styles.dropdownBackdrop} onClick={() => setIsDropdownOpen(false)} />
          )}

          <div className={styles.modalCard}>
            <h2 className={styles.modalTitle}>Add New User</h2>
            
            <form onSubmit={handleAddUserConfirm} className={styles.modalForm}>
              <div className={styles.formGroup}>
                <label htmlFor="userName" className={styles.formLabel}>Name</label>
                <input
                  type="text"
                  id="userName"
                  className={styles.formInput}
                  placeholder="e.g. Anika Sharma"
                  value={newUserName}
                  onChange={(e) => setNewUserName(e.target.value)}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="userEmail" className={styles.formLabel}>Email</label>
                <input
                  type="email"
                  id="userEmail"
                  className={styles.formInput}
                  placeholder="e.g. anika@gmail.com"
                  value={newUserEmail}
                  onChange={(e) => setNewUserEmail(e.target.value)}
                  required
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Role</label>
                
                {/* Custom Select Box */}
                <div className={styles.customSelectContainer}>
                  <button
                    type="button"
                    className={styles.customSelectTrigger}
                    onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                  >
                    <span>{newUserRole}</span>
                    <ChevronDownIcon isOpen={isDropdownOpen} />
                  </button>

                  {isDropdownOpen && (
                    <div className={styles.customSelectOptions}>
                      {["Super Admin", "Admin", "QA Analyst", "It Manager"].map((role) => (
                        <button
                          key={role}
                          type="button"
                          className={`${styles.customSelectOption} ${newUserRole === role ? styles.customSelectOptionActive : ""}`}
                          onClick={() => {
                            setNewUserRole(role);
                            setIsDropdownOpen(false);
                          }}
                        >
                          {role}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className={styles.modalActions}>
                <button type="button" className={styles.cancelBtn} onClick={handleAddUserCancel}>
                  Cancel
                </button>
                <button type="submit" className={styles.addSubmitBtn}>
                  Add
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
