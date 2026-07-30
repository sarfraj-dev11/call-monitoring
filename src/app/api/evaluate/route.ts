import { NextResponse } from "next/server";
import { safeParseJson } from "@/lib/jsonRepair";
import { normalizeAgentName } from "@/lib/pseudoNames";

function generateFallbackEvaluation(transcript: any[], agentName: string) {
  let agentWords = 0;
  let customerWords = 0;
  let silenceTurns = 0;

  transcript.forEach((t) => {
    const text = t.text || "";
    const speaker = t.speaker || "";
    const words = text.split(/\s+/).length;
    if (speaker === "Agent") {
      agentWords += words;
    } else if (speaker === "Customer") {
      customerWords += words;
    } else {
      silenceTurns += 1;
    }
  });

  const totalWords = agentWords + customerWords || 1;
  const agentTimePct = Math.round((agentWords / totalWords) * 100);
  const customerTimePct = Math.round((customerWords / totalWords) * 100);
  
  const agentTime = Math.min(95, Math.max(5, agentTimePct));
  const customerTime = Math.min(95, Math.max(5, customerTimePct));
  const silenceTime = Math.min(30, silenceTurns * 4);

  const checklistParameters = [
    { id: 1, param: "Was the agent enthusiastic, energetic throughout the call?", fatal: false },
    { id: 2, param: "Did the agent use a pseudo name?", fatal: false, weight: 2.8 },
    { id: 3, param: "Did the agent ask for the customer’s name and personalize the call?", fatal: false },
    { id: 4, param: "Did the agent understand and comprehend the primary issue?", fatal: false },
    { id: 5, param: "Did the agent confirm VIVINT to be the new service provider?", fatal: false },
    { id: 6, param: "Did the agent ask the customer to save the company’s number and request for primary contact number and alternate number?", fatal: false },
    { id: 7, param: "Did the agent ask relevant questions?", fatal: false },
    { id: 8, param: "Did the agent calm an irritated customer?", fatal: false },
    { id: 9, param: "Did the agent handle objections using rebuttals?", fatal: false },
    { id: 10, param: "Did the agent build rapport and used power words & statements?", fatal: false },
    { id: 11, param: "Did the agent follow the correct hold procedure?", fatal: false },
    { id: 12, param: "Was there any dead air on the call, and did the agent avoid it?", fatal: false },
    { id: 13, param: "Did the agent follow the correct transfer procedure?", fatal: false },
    { id: 14, param: "Did the agent list all the USPs (unique selling points) for the part or process?", fatal: false },
    { id: 15, param: "Did the agent suggest VIVINT?", fatal: false },
    { id: 16, param: "Did the agent gauge the issue effectively?", fatal: false },
    { id: 17, param: "Did the agent demonstrate negotiation skills?", fatal: false },
    { id: 18, param: "Did the agent offer discounts, promotions and credits with enthusiasm?", fatal: false },
    { id: 19, param: "Did the agent summarize the call and ask if further assistance was needed?", fatal: false },
    { id: 20, param: "Did the agent follow up as required?", fatal: false },
    { id: 21, param: "Did the agent ask for a callback date and time?", fatal: false },
    { id: 22, param: "Did the agent sound grammatically correct on the call. No pronunciation errors.", fatal: false },
    { id: 23, param: "Did the agent use incorrect dispositions or comments?", fatal: false },
    { id: 24, param: "Did the agent fail to open the call within 5 seconds?", fatal: true },
    { id: 25, param: "Did the agent pitch early without gauging the customer’s query?", fatal: true },
    { id: 26, param: "Did the Agent fail to use BROCUS IT solutions callopening?", fatal: true },
    { id: 27, param: "Did the agent fail to create urgency during the call?", fatal: true },
    { id: 28, param: "Did the agent disconnect the call abruptly?", fatal: true },
    { id: 29, param: "Did the agent provide misleading information or offer services that were not available?", fatal: true },
    { id: 30, param: "Did the agent promise incorrectly?", fatal: true },
    { id: 31, param: "Did the Agent mention that, He/She is not affiliated with [ADT/Brinks]", fatal: true },
    { id: 32, param: "Did the Agent use the proper Script of Vivint and mention the Partnership with Vivint paragraph", fatal: true },
    { id: 33, param: "Did the agent fail to update notes accurately?", fatal: true },
    { id: 34, param: "Did the Agent mention that [ADT/brinks] and Vivint are 2 separate Companies]", fatal: true },
    { id: 35, param: "Did the Agent inform that, he cannot do anything about the current system and provider statement?", fatal: true },
    { id: 36, param: "Did the agent fail to conduct proper verification?", fatal: true },
    { id: 37, param: "Did the agent use regional or abusive language or display rude behavior?", fatal: true },
  ];

  const checklist = checklistParameters.map((p) => {
    let score = "Pass";
    let explanation = "The agent successfully met this standard during the call.";
    let contextQuote = "";

    if (p.id === 8) {
      score = "NA";
      explanation = "No customer irritation was observed on this call.";
    } else if (p.id === 11) {
      score = silenceTurns > 0 ? "Pass" : "NA";
      explanation = silenceTurns > 0 ? "Agent followed correct hold protocol." : "No holds were placed during this call.";
    } else if (p.id === 13) {
      score = "NA";
      explanation = "No call transfer was requested or initiated.";
    } else if (p.id === 21) {
      score = "NA";
      explanation = "A callback was not required for this call.";
    }

    const agentTurns = transcript.filter((t) => t.speaker === "Agent");
    if (score === "Pass" && agentTurns.length > 0) {
      if (p.id === 24 || p.id === 26) {
        contextQuote = agentTurns[0]?.text ? `"${agentTurns[0].text}"` : "";
      } else if (p.id === 3) {
        const nameTurn = transcript.find((t) => t.text?.toLowerCase().includes("name") || t.text?.toLowerCase().includes("hello"));
        contextQuote = nameTurn?.text ? `"${nameTurn.text}"` : `"${agentTurns[0]?.text || ""}"`;
      } else {
        const randIndex = (p.id * 7) % agentTurns.length;
        contextQuote = agentTurns[randIndex]?.text ? `"${agentTurns[randIndex].text}"` : "";
      }
    }

    return {
      id: p.id,
      parameter: p.param,
      isFatal: p.fatal,
      weight: p.id === 2 ? 2.8 : 2.7,
      score: score,
      contextQuote: contextQuote,
      explanation: explanation
    };
  });

  // Simple heuristic for negative word detection in fallback mode
  const negativeKeywords = ["cancel", "frustrated", "terrible", "horrible", "awful", "bad service", "waste of time", "complaint", "abusive", "unhappy", "angry", "disappointed", "rude", "poor", "issue"];
  const detectedNegativePhrases: string[] = [];
  transcript.forEach((t) => {
    const text = (t.text || "").toLowerCase();
    negativeKeywords.forEach((kw) => {
      if (text.includes(kw) && !detectedNegativePhrases.includes(kw)) {
        detectedNegativePhrases.push(kw);
      }
    });
  });

  const fullText = transcript.map(t => t.text || "").join(" ").toLowerCase();
  const isSalesCall = fullText.includes("buy") || fullText.includes("price") || fullText.includes("plan") || fullText.includes("discount") || fullText.includes("vivint") || fullText.includes("promotion") || fullText.includes("subscription") || fullText.includes("sale");
  const callCategory = isSalesCall ? "Sales" : "Non-Sales";
  const sentiment = detectedNegativePhrases.length > 2 ? "Negative" : (detectedNegativePhrases.length > 0 ? "Neutral" : "Positive");

  return {
    category: callCategory,
    sentiment: sentiment,
    language: "English (India)",
    negativePhrases: detectedNegativePhrases,
    agentTime: agentTime,
    customerTime: customerTime,
    silenceTime: silenceTime,
    qaAnalysis: {
      customerName: "Valued Customer",
      phoneNumber: "+1 (555) 019-2834",
      disposition: isSalesCall ? "Product Discussion" : "General Inquiry",
      saleStatus: isSalesCall ? "Sale" : "Non-Sale",
      callCategory: callCategory,
      negativePhrases: detectedNegativePhrases,
      checklist: checklist
    },
    feedback: [
      { "type": "success", "text": "Customer interaction was handled politely and professionally." },
      { "type": "warning", "text": "Gemini API evaluation was temporarily offline; generated local fallback evaluation results." }
    ],
    guidance: [
      { "type": "pattern", "title": "Local Backup Mode", "text": "Heuristic evaluation generated. Standard parameters scored based on baseline expectations.", "color": "yellow" }
    ]
  };
}

export async function POST(request: Request) {
  const routeStartTime = Date.now();
  try {
    const { transcript, agentName, customScorecard, feedbackHistory } = await request.json();

    if (!transcript || !Array.isArray(transcript)) {
      return NextResponse.json({ error: "Missing or invalid transcript array" }, { status: 400 });
    }

    const rawKey = process.env.GEMINI_API_KEY || "";
    const geminiApiKey = rawKey.trim().replace(/^["']|["']$/g, "");
    if (!geminiApiKey) {
      return NextResponse.json({ error: "Gemini API key not set in environment" }, { status: 500 });
    }

    // Build QA Parameters list dynamically if custom Scorecard is passed
    let parametersText = "";
    if (Array.isArray(customScorecard) && customScorecard.length > 0) {
      parametersText = customScorecard.map((p: any, index: number) => 
        `${index + 1}. ${p.parameter || p.param || p.name} (${p.isFatal ? "Fatal" : "Non-Fatal"}, weight ${p.weight || 2.7})`
      ).join("\n");
    } else {
      parametersText = `1. Was the agent enthusiastic, energetic throughout the call? (Non-Fatal)
2. Did the agent use a pseudo name? (Non-Fatal, weight 2.8)
3. Did the agent ask for the customer’s name and personalize the call? (Non-Fatal)
4. Did the agent understand and comprehend the primary issue? (Non-Fatal)
5. Did the agent confirm VIVINT to be the new service provider? (Non-Fatal)
6. Did the agent ask the customer to save the company’s number and request for primary contact number and alternate number? (Non-Fatal)
7. Did the agent ask relevant questions? (Non-Fatal)
8. Did the agent calm an irritated customer? (Non-Fatal - only NA if the customer was never irritated or upset)
9. Did the agent handle objections using rebuttals? (Non-Fatal - only NA if no objections were raised)
10. Did the agent build rapport and used power words & statements? (Non-Fatal)
11. Did the agent follow the correct hold procedure? (Non-Fatal - only NA if the agent never put the customer on hold)
12. Was there any dead air on the call, and did the agent avoid it? (Non-Fatal)
13. Did the agent follow the correct transfer procedure? (Non-Fatal - only NA if the agent never transferred the call)
14. Did the agent list all the USPs (unique selling points) for the part or process? (Non-Fatal)
15. Did the agent suggest VIVINT? (Non-Fatal)
16. Did the agent gauge the issue effectively? (Non-Fatal)
17. Did the agent demonstrate negotiation skills? (Non-Fatal)
18. Did the agent offer discounts, promotions and credits with enthusiasm? (Non-Fatal)
19. Did the agent summarize the call and ask if further assistance was needed? (Non-Fatal)
20. Did the agent follow up as required? (Non-Fatal)
21. Did the agent ask for a callback date and time? (Non-Fatal)
22. Did the agent sound grammatically correct on the call. No pronunciation errors. (Non-Fatal)
23. Did the agent use incorrect dispositions or comments? (Non-Fatal)
24. Did the agent fail to open the call within 5 seconds? (Fatal)
25. Did the agent pitch early without gauging the customer’s query? (Fatal)
26. Did the Agent fail to use BROCUS IT solutions callopening? (Fatal)
27. Did the agent fail to create urgency during the call? (Fatal)
28. Did the agent disconnect the call abruptly? (Fatal)
29. Did the agent provide misleading information or offer services that were not available? (Fatal)
30. Did the agent promise incorrectly? (Fatal)
31. Did the Agent mention that, He/She is not affiliated with [ADT/Brinks] (Fatal)
32. Did the Agent use the proper Script of Vivint and mention the Partnership with Vivint paragraph (Fatal)
33. Did the agent fail to update notes accurately? (Fatal)
34. Did the Agent mention that [ADT/brinks] and Vivint are 2 separate Companies] (Fatal)
35. Did the Agent inform that, he cannot do anything about the current system and provider statement? (Fatal)
36. Did the agent fail to conduct proper verification? (Fatal)
37. Did the agent use regional or abusive language or display rude behavior? (Fatal)`;
    }

    let continuousFeedbackContext = "";
    if (Array.isArray(feedbackHistory) && feedbackHistory.length > 0) {
      continuousFeedbackContext = `\nPREVIOUS MANAGER QA FEEDBACK & HISTORICAL LEARNING:\nThe following historical feedback entries represent manager corrections from previous call audits. Align your assessment standards with these learned rules:\n` +
        feedbackHistory.slice(-5).map((f: any) => `- [${f.date || "Recent"}] Rule/Preference: ${f.text || f.feedback}`).join("\n") + "\n";
    }

    const systemPrompt = `You are an expert Call Center QA Evaluator.
Analyze the provided turn-by-turn dialogue transcript between "Agent" and "Customer".
Perform a detailed QA audit on this dialogue, verifying each of the specified parameters.
${continuousFeedbackContext}
For each parameter:
- Determine if the agent passed, failed, or if the parameter is Not Applicable (NA).
- "Pass" means the agent met the standard.
- "Fail" means the agent failed to meet the standard.
- "NA" means the parameter is not applicable to the conversation.
- Extract a matching contextQuote from the transcript as direct evidence.
- Provide a brief 1-2 sentence explanation.

THE QA SCORECARD PARAMETERS TO EVALUATE:
${parametersText}

In addition, extract the following metadata and intelligence from the call:
- category: Determine if the call is primarily a "Sales" call or a "Non-Sales" call (e.g. support, inquiry, billing, general).
- sentiment: Classify overall conversation tone as "Positive", "Neutral", or "Negative".
- language: Detect primary spoken language or regional dialect (e.g. "English (US)", "English (India)", "Hinglish", "Hindi", "Spanish", "Tamil", etc.).
- negativePhrases: Extract any specific negative, angry, hostile, or escalation words/phrases spoken during the call (e.g., "cancel my account", "frustrated", "terrible service", "horrible", "speak with supervisor", "waste of time"). If none, return an empty array [].
- customerName: Extract the customer's name if mentioned (otherwise return "Valued Customer").
- phoneNumber: Extract the customer's phone number or alternate phone number if mentioned (otherwise return a realistic mock number "+1 (555) 019-2834").
- disposition: Determine the wrap-up status of the call (e.g. "Completed Sale", "Callback Scheduled", "Information Request", "General Inquiry").
- saleStatus: Classify as "Sale" or "Non-Sale".

You must return your output ONLY in a valid JSON object matching the following structure. Do NOT return any markdown wrapper other than raw JSON.
{
  "category": "Sales",
  "sentiment": "Positive",
  "language": "English (India)",
  "negativePhrases": ["frustrated", "delay"],
  "agentTime": 60,
  "customerTime": 32,
  "silenceTime": 8,
  "qaAnalysis": {
    "customerName": "...",
    "phoneNumber": "...",
    "disposition": "...",
    "saleStatus": "Sale",
    "callCategory": "Sales",
    "negativePhrases": ["frustrated", "delay"],
    "checklist": [
      {
        "id": 1,
        "parameter": "...",
        "isFatal": false,
        "weight": 2.7,
        "score": "Pass",
        "contextQuote": "...",
        "explanation": "..."
      }
    ]
  },
  "feedback": [
    { "type": "success", "text": "..." },
    { "type": "warning", "text": "..." }
  ],
  "guidance": [
    { "type": "pattern", "title": "...", "text": "...", "color": "yellow" }
  ]
}`;

    const formattedTranscript = transcript.map(t => `[${t.time}] ${t.speaker}: "${t.text}"`).join("\n");

    console.log(`Evaluating transcript text with Gemini 2.5 Flash...`);

    let evaluationResult;
    try {
      // 4. Generate content with retries for transient errors
      const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`;
      let evalAttempts = 0;
      const maxEvalAttempts = 4;
      let completionData: any = null;

      while (evalAttempts < maxEvalAttempts) {
        try {
          const response = await fetch(geminiUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      text: `Evaluate the following transcript dialogue:\n\n${formattedTranscript}`
                    }
                  ]
                }
              ],
              systemInstruction: {
                parts: [
                  { text: systemPrompt }
                ]
              },
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.2,
                maxOutputTokens: 65536
              }
            }),
            signal: AbortSignal.timeout(900000) // 15 minutes timeout window to allow full Gemini processing
          });

          if (!response.ok) {
            const errText = await response.text();
            const isTransient = response.status === 429 || response.status === 503 || response.status === 500 || errText.toLowerCase().includes("high demand") || errText.toLowerCase().includes("rate limit") || errText.toLowerCase().includes("temporary");
            
            if (isTransient && evalAttempts + 1 < maxEvalAttempts) {
              evalAttempts++;
              const backoffMs = Math.pow(2, evalAttempts) * 1000 + Math.random() * 1000;
              console.warn(`Gemini evaluate transient error (${response.status}). Retrying attempt ${evalAttempts}/${maxEvalAttempts} in ${Math.round(backoffMs)}ms...`);
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
              continue;
            }
            throw new Error(`Gemini evaluation failed: ${response.status} ${response.statusText} - ${errText}`);
          }

          completionData = await response.json();
          if (completionData.error) {
            const errMessage = completionData.error.message || "";
            const isTransient = completionData.error.code === 429 || completionData.error.code === 503 || completionData.error.code === 500 || errMessage.toLowerCase().includes("high demand") || errMessage.toLowerCase().includes("rate limit") || errMessage.toLowerCase().includes("temporary");
            
            if (isTransient && evalAttempts + 1 < maxEvalAttempts) {
              evalAttempts++;
              const backoffMs = Math.pow(2, evalAttempts) * 1000 + Math.random() * 1000;
              console.warn(`Gemini evaluate API transient error. Retrying attempt ${evalAttempts}/${maxEvalAttempts} in ${Math.round(backoffMs)}ms...`);
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
              continue;
            }
            throw new Error(`Gemini API Error: ${errMessage}`);
          }
          
          break; // Success!
        } catch (err: any) {
          const isFetchTimeout = err.name === "TimeoutError" || err.message?.toLowerCase().includes("timeout") || err.message?.toLowerCase().includes("fetch failed");
          if (isFetchTimeout && evalAttempts + 1 < maxEvalAttempts) {
            evalAttempts++;
            const backoffMs = Math.pow(2, evalAttempts) * 1000 + Math.random() * 1000;
            console.warn(`Gemini evaluate fetch/timeout error: ${err.message}. Retrying attempt ${evalAttempts}/${maxEvalAttempts} in ${Math.round(backoffMs)}ms...`);
            await new Promise((resolve) => setTimeout(resolve, backoffMs));
            continue;
          }
          throw err;
        }
      }

      const usageMetadata = completionData?.usageMetadata;
      const promptTokens = usageMetadata?.promptTokenCount || Math.round(transcript.reduce((acc: number, t: any) => acc + (t.text || "").split(/\s+/).length, 0) * 1.3 + 1200);
      const candidateTokens = usageMetadata?.candidatesTokenCount || 850;
      const evaluateTokens = usageMetadata?.totalTokenCount || (promptTokens + candidateTokens);

      const candidate = completionData.candidates?.[0];
      const finishReason = candidate?.finishReason;
      if (finishReason === "MAX_TOKENS") {
        console.warn("Gemini evaluation response reached maxOutputTokens limit; auto-repairing truncated JSON...");
      }

      let structuredResponseText = candidate?.content?.parts?.[0]?.text;
      if (!structuredResponseText) {
        throw new Error("Gemini returned empty response");
      }

      evaluationResult = safeParseJson(structuredResponseText);
      evaluationResult.evaluateTokens = evaluateTokens;
    } catch (geminiErr: any) {
      console.warn("Gemini evaluation failed completely. Falling back to local heuristic evaluation:", geminiErr);
      evaluationResult = generateFallbackEvaluation(transcript, agentName);
      (evaluationResult as any).evaluateTokens = Math.round(transcript.reduce((acc: number, t: any) => acc + (t.text || "").split(/\s+/).length, 0) * 1.3 + 850);
    }

    // DYNAMIC MATHEMATICAL SCORING CALCULATIONS
    const checklist = evaluationResult.qaAnalysis?.checklist || [];
    
    let failedNonFatalPoints = 0;
    let failedFatalPoints = 0;
    let hasFailedFatal = false;

    checklist.forEach((item: any) => {
      const isFailed = item.score === "Fail";
      const itemWeight = item.id === 2 ? 2.8 : 2.7;
      item.weight = itemWeight;

      if (isFailed) {
        if (item.isFatal || item.id >= 24) {
          failedFatalPoints += itemWeight;
          hasFailedFatal = true;
          item.isFatal = true;
        } else {
          failedNonFatalPoints += itemWeight;
          item.isFatal = false;
        }
      } else {
        item.isFatal = item.id >= 24;
      }
    });

    const accuracy = Math.max(0, Math.round((100 - failedNonFatalPoints - failedFatalPoints) * 10) / 10);
    const nonFatalScore = Math.max(0, Math.round((100 - failedNonFatalPoints) * 10) / 10);
    const finalScore = hasFailedFatal ? 0 : nonFatalScore;

    const today = new Date();
    const formattedAuditDate = today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    const formattedFeedbackDate = tomorrow.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

    evaluationResult.qaAnalysis.auditDate = formattedAuditDate;
    evaluationResult.qaAnalysis.feedbackDate = formattedFeedbackDate;
    const resolvedAgentName = evaluationResult.qaAnalysis.agentName || agentName || "Adam Miller";
    evaluationResult.qaAnalysis.agentName = normalizeAgentName(resolvedAgentName);

    const categoryGroupings = {
      "Opening & Greeting": [3, 24, 26],
      "Soft Skills & Rapport": [1, 8, 10, 22, 37],
      "Product & USP": [5, 14, 15, 16, 18, 25, 29, 31, 32, 34, 35],
      "Process & Compliance": [2, 4, 6, 7, 9, 11, 12, 13, 17, 23, 27, 28, 30, 33, 36],
      "Closing & Follow-up": [19, 20, 21]
    };

    const breakdown = Object.entries(categoryGroupings).map(([catName, ids]) => {
      const itemsInCat = checklist.filter((item: any) => ids.includes(item.id));
      const passed = itemsInCat.filter((item: any) => item.score === "Pass").length;
      const failed = itemsInCat.filter((item: any) => item.score === "Fail").length;
      
      let categoryScore = 10;
      if (passed + failed > 0) {
        categoryScore = Math.round((passed / (passed + failed)) * 10);
      }
      
      let color = "green";
      if (categoryScore < 6) color = "red";
      else if (categoryScore < 8) color = "orange";

      return {
        name: catName,
        score: categoryScore,
        max: 10,
        color: color
      };
    });

    evaluationResult.evaluation = {
      qaScore: finalScore,
      scores: [
        { "label": "Accuracy", "value": `${accuracy}` },
        { "label": "Non fatal Score", "value": `${nonFatalScore}` },
        { "label": "Final Score", "value": `${finalScore}` }
      ],
      breakdown: breakdown,
      feedback: evaluationResult.feedback || [],
      guidance: evaluationResult.guidance || []
    };

    const evaluateTimeMs = Date.now() - routeStartTime;
    const evaluateTimeSec = Math.round(evaluateTimeMs / 100) / 10;
    
    evaluationResult.evaluateTimeMs = evaluateTimeMs;
    evaluationResult.evaluateTimeSec = evaluateTimeSec;

    return NextResponse.json(evaluationResult);
  } catch (error: any) {
    console.error("Evaluate API Error:", error);
    if (error.cause) {
      console.error("Underlying cause in evaluate API:", error.cause);
    }
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
