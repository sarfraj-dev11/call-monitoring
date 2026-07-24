import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    const { messages, crmContext } = await request.json();
    const geminiApiKey = process.env.GEMINI_API_KEY;

    if (!geminiApiKey) {
      return NextResponse.json(
        { error: "Gemini API key not found. Please set GEMINI_API_KEY in .env.local" },
        { status: 500 }
      );
    }

    let dynamicStatsSection = "";
    if (crmContext && crmContext.callSummaries) {
      const summaries = crmContext.callSummaries;
      const totalCalls = summaries.length;

      if (totalCalls === 0) {
        dynamicStatsSection = `CURRENT ACTIVE CRM STATUS AND FILTERED STATS (FROM USER'S SCREEN):
- The database is completely empty. There are no calls uploaded yet. Prompt the user to upload a call on the homepage dropzone.`;
      } else {
        const avgScore = Math.round(summaries.reduce((acc: number, c: any) => acc + c.score, 0) / totalCalls);
        const uniqueAgents = Array.from(new Set(summaries.map((c: any) => c.agent))).filter(Boolean);
        const categoriesCounts: Record<string, number> = {};
        const sentimentsCounts: Record<string, number> = {};

        summaries.forEach((c: any) => {
          categoriesCounts[c.category] = (categoriesCounts[c.category] || 0) + 1;
          sentimentsCounts[c.sentiment] = (sentimentsCounts[c.sentiment] || 0) + 1;
        });

        const categoryList = Object.entries(categoriesCounts).map(([cat, cnt]) => `${cat}: ${cnt} calls`).join(", ");
        const sentimentList = Object.entries(sentimentsCounts).map(([sent, cnt]) => `${sent}: ${cnt} calls`).join(", ");

        let activeCallDetail = "No call currently selected.";
        if (crmContext.activeCall) {
          const ac = crmContext.activeCall;
          activeCallDetail = `Selected Call: ${ac.id}
- Agent: ${ac.agent}
- Date: ${ac.date}
- Duration: ${ac.duration}
- QA Score: ${ac.score}/100
- Sentiment: ${ac.sentiment}
- Category: ${ac.category}
- Full Transcript Dialogue turns:
${(ac.transcript || []).map((t: any) => `  * [${t.time}] ${t.speaker}: "${t.text}"`).join("\n")}
- AI Evaluation Breakdown:
  * QA Score Breakdown scores: ${(ac.evaluation?.scores || []).map((s: any) => `${s.label}: ${s.value}`).join(", ")}
  * AI Feedback Success items: ${(ac.evaluation?.feedback || []).filter((f: any) => f.type === "success").map((f: any) => f.text).join("; ")}
  * AI Feedback Warnings/Improvements: ${(ac.evaluation?.feedback || []).filter((f: any) => f.type === "warning").map((f: any) => f.text).join("; ")}
  * Guidance Recommendations: ${(ac.evaluation?.guidance || []).map((g: any) => `[${g.title}] ${g.text}`).join("; ")}`;
        }

        dynamicStatsSection = `CURRENT ACTIVE CRM STATUS AND FILTERED STATS:
- Total Calls Analyzed: ${totalCalls}
- Average QA Score: ${avgScore}%
- Active Agents: ${uniqueAgents.join(", ")}
- Category Breakdown: ${categoryList}
- Sentiment Breakdown: ${sentimentList}
- Active Call Selection Details:
${activeCallDetail}`;
      }
    } else {
      dynamicStatsSection = `CURRENT ACTIVE CRM STATUS AND FILTERED STATS:
- The database is completely empty. There are no calls uploaded yet. Prompt the user to upload a call on the homepage dropzone.`;
    }

    const systemPrompt = `You are the official Antigravity CRM AI Assistant.
Here is the current state and knowledge base of the CRM system:

${dynamicStatsSection}

INSTRUCTIONS:
- You are answering user queries in a chat widget floating in the CRM.
- If the user greets you casually (e.g., 'hello', 'hi', 'wassup', 'hey', 'how is it going'), respond with a friendly greeting and ask how you can help them with the CRM analytics. Do NOT dump the global stats or raw CRM data immediately unless explicitly asked.
- Answer user questions by referencing the CURRENT ACTIVE CRM STATUS AND FILTERED STATS above. If the user asks about stats (e.g. 'what is the average score' or 'how many calls match'), use the active numbers provided in that section.
- Keep your answers highly concise, clear, and professional. Use markdown bold and bullet points appropriately.
- If asked about specific agents, scores, logins, uploads, categories, or sentiments, consult the knowledge base above.
- Be helpful and friendly. Keep responses under 3-4 sentences where possible.`;

    const geminiContents = messages.filter((m: any) => m.text !== "Typing...").map((m: any) => ({
      role: m.sender === "user" ? "user" : "model",
      parts: [{ text: m.text }]
    }));

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contents: geminiContents,
        systemInstruction: {
          parts: [{ text: systemPrompt }]
        },
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 512,
        }
      }),
    });

    const data = await response.json();

    if (data.error) {
      console.error("Gemini API Error:", data.error);
      return NextResponse.json({ error: data.error.message }, { status: 500 });
    }

    const botReply = data.candidates?.[0]?.content?.parts?.[0]?.text || "I am unable to generate a response.";
    return NextResponse.json({ text: botReply });
  } catch (error: any) {
    console.error("Chat API Route Error:", error);
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
