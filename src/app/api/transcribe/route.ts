import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import * as mm from "music-metadata";
import { safeParseJson } from "@/lib/jsonRepair";
import { normalizeAgentName, replacePseudoNamesInText } from "@/lib/pseudoNames";


async function transcribeAndEvaluateWithGemini(
  file: File,
  geminiApiKey: string,
  systemPrompt: string,
  durationSec?: number
) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    const fileMimeType = file.type || "audio/mp3";
    const fileName = file.name || "audio.mp3";

    let durationContext = "";
    if (durationSec && durationSec > 0) {
      const minutes = Math.floor(durationSec / 60);
      const seconds = Math.round(durationSec % 60);
      durationContext = `The total duration of this audio file is exactly ${minutes} minute(s) and ${seconds} second(s). You must calibrate your output timestamps to fit across this full duration correctly, and ensure the final turns align with the end of the audio file.`;
    }

    const modelEndpoints = [
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`
    ];
    let completionData: any = null;

    // Fast Path: For files <= 20MB, use inline Base64 data to skip File API upload & polling latency
    if (fileBuffer.length <= 20 * 1024 * 1024) {
      console.log(`Using high-speed inline Base64 transcription for ${fileName} (${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB)...`);
      const base64Data = fileBuffer.toString("base64");
      let genAttempts = 0;
      const maxGenAttempts = modelEndpoints.length * 2;

      while (genAttempts < maxGenAttempts) {
        const currentEndpoint = modelEndpoints[genAttempts % modelEndpoints.length];
        try {
          const genResponse = await fetch(currentEndpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    {
                      inlineData: {
                        mimeType: fileMimeType,
                        data: base64Data
                      }
                    },
                    {
                      text: `Transcribe this audio file completely.\n${durationContext}\nProvide a word-for-word, verbatim transcript of the entire audio.\nDo NOT skip any dialogue turns. Do NOT summarize or condense the conversation.\nCapture every single turn between the Agent and the Customer exactly as spoken, with accurate timestamps in hh:mm:ss format.`
                    }
                  ]
                }
              ],
              systemInstruction: {
                parts: [{ text: systemPrompt }]
              },
              generationConfig: {
                responseMimeType: "application/json",
                temperature: 0.1,
                maxOutputTokens: 65536
              }
            }),
            signal: AbortSignal.timeout(900000) // 15 minutes max
          });

          if (!genResponse.ok) {
            const errText = await genResponse.text();
            const isTransient = genResponse.status === 429 || genResponse.status === 503 || genResponse.status === 500 || errText.toLowerCase().includes("high demand") || errText.toLowerCase().includes("rate limit") || errText.toLowerCase().includes("temporary");

            if (isTransient && genAttempts + 1 < maxGenAttempts) {
              genAttempts++;
              await new Promise((r) => setTimeout(r, 2000 * genAttempts));
              continue;
            }
            throw new Error(`Gemini inline generateContent failed: ${genResponse.status} ${genResponse.statusText} - ${errText}`);
          }

          completionData = await genResponse.json();
          break;
        } catch (err: any) {
          if (genAttempts + 1 < maxGenAttempts) {
            genAttempts++;
            await new Promise((r) => setTimeout(r, 2000 * genAttempts));
            continue;
          }
          throw err;
        }
      }
    } else {
      // Fallback Path for large files (> 20MB): Gemini File API
      console.log(`File is > 20MB (${(fileBuffer.length / (1024 * 1024)).toFixed(2)} MB). Using Gemini File API upload...`);
      const initUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiApiKey}`;
      const initRes = await fetch(initUrl, {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": fileBuffer.length.toString(),
          "X-Goog-Upload-Header-Content-Type": fileMimeType,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { displayName: fileName } }),
        signal: AbortSignal.timeout(900000)
      });

      if (!initRes.ok) throw new Error(`Initiate upload failed: ${initRes.status}`);
      const uploadUrl = initRes.headers.get("x-goog-upload-url");
      if (!uploadUrl) throw new Error("Missing upload URL");

      const fileBlob = new Blob([fileBuffer], { type: fileMimeType });
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        headers: {
          "X-Goog-Upload-Command": "upload, finalize",
          "X-Goog-Upload-Offset": "0",
          "Content-Length": fileBuffer.length.toString(),
        },
        body: fileBlob,
        signal: AbortSignal.timeout(900000)
      });

      if (!uploadRes.ok) throw new Error(`Upload bytes failed: ${uploadRes.status}`);
      const uploadData = await uploadRes.json();
      const fileUri = uploadData.file.uri;
      const fileApiName = uploadData.file.name;

      let fileState = "PROCESSING";
      const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${fileApiName}?key=${geminiApiKey}`;
      let attempts = 0;
      while (fileState === "PROCESSING" && attempts < 30) {
        await new Promise((r) => setTimeout(r, 1500));
        attempts++;
        const statusRes = await fetch(statusUrl, { signal: AbortSignal.timeout(300000) });
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          fileState = statusData.state || "ACTIVE";
        }
      }

      const geminiUrl = modelEndpoints[0];
      const genResponse = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { fileData: { fileUri, mimeType: fileMimeType } },
              { text: `Transcribe this audio file completely.\n${durationContext}\nProvide a word-for-word, verbatim transcript of the entire audio.\nCapture every single turn between the Agent and the Customer exactly as spoken, with accurate timestamps in hh:mm:ss format.` }
            ]
          }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 65536 }
        }),
        signal: AbortSignal.timeout(900000)
      });

      completionData = await genResponse.json();

      try {
        fetch(`https://generativelanguage.googleapis.com/v1beta/${fileApiName}?key=${geminiApiKey}`, { method: "DELETE" }).catch(() => { });
      } catch (e) { }
    }

    const candidate = completionData.candidates?.[0];
    const finishReason = candidate?.finishReason;
    if (finishReason === "MAX_TOKENS") {
      console.warn("Gemini transcript response reached maxOutputTokens limit; auto-repairing truncated JSON...");
    }

    let structuredResponseText = candidate?.content?.parts?.[0]?.text;
    if (!structuredResponseText) {
      throw new Error("Gemini returned empty response");
    }

    return {
      parsedData: safeParseJson(structuredResponseText),
      usageMetadata: completionData?.usageMetadata
    };
  } catch (error: any) {
    console.error("Error in transcribeAndEvaluateWithGemini:", error);
    throw error;
  }
}


// GET handler to initiate resumable upload or check file status (Bypasses Vercel 4.5MB request limit)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!geminiApiKey) {
    return NextResponse.json({ error: "Gemini API key not set in environment" }, { status: 500 });
  }

  if (action === "init-upload") {
    const fileName = searchParams.get("fileName") || "audio.mp3";
    const fileSize = searchParams.get("fileSize") || "0";
    const fileMimeType = searchParams.get("fileMimeType") || "audio/mp3";

    try {
      const initUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${geminiApiKey}`;
      const initRes = await fetch(initUrl, {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": fileSize,
          "X-Goog-Upload-Header-Content-Type": fileMimeType,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { displayName: fileName } }),
      });

      if (!initRes.ok) {
        const errText = await initRes.text();
        throw new Error(`Initiate upload failed (${initRes.status}): ${errText}`);
      }

      const uploadUrl = initRes.headers.get("x-goog-upload-url");
      if (!uploadUrl) throw new Error("Missing upload URL from Gemini API");

      return NextResponse.json({ uploadUrl });
    } catch (err: any) {
      console.error("Error in init-upload:", err);
      return NextResponse.json({ error: err.message || "Failed to initialize Gemini upload" }, { status: 500 });
    }
  }

  if (action === "check-file") {
    const fileApiName = searchParams.get("fileApiName");
    if (!fileApiName) {
      return NextResponse.json({ error: "fileApiName required" }, { status: 400 });
    }

    try {
      const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${fileApiName}?key=${geminiApiKey}`;
      const statusRes = await fetch(statusUrl);
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        return NextResponse.json({ state: statusData.state || "ACTIVE" });
      }
      return NextResponse.json({ state: "ACTIVE" });
    } catch (err: any) {
      return NextResponse.json({ state: "ACTIVE" });
    }
  }

  return NextResponse.json({ error: "Invalid action" }, { status: 400 });
}


export async function POST(request: Request) {
  const routeStartTime = Date.now();
  try {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      return NextResponse.json({ error: "Gemini API key not set in environment" }, { status: 500 });
    }

    const contentType = request.headers.get("content-type") || "";

    // Direct JSON Payload with Pre-uploaded Gemini File URI (Bypasses Vercel 4.5MB Payload limit for 3-hour calls)
    if (contentType.includes("application/json")) {
      const body = await request.json();
      const { fileUri, fileMimeType, fileName, durationSec, fileApiName } = body;

      if (!fileUri) {
        return NextResponse.json({ error: "fileUri missing in payload" }, { status: 400 });
      }

      let durationContext = "";
      if (durationSec && durationSec > 0) {
        const minutes = Math.floor(durationSec / 60);
        const seconds = Math.round(durationSec % 60);
        durationContext = `The total duration of this audio file is exactly ${minutes} minute(s) and ${seconds} second(s). You must calibrate your output timestamps to fit across this full duration correctly, and ensure the final turns align with the end of the audio file.`;
      }

      // Check File API Status until ACTIVE
      if (fileApiName) {
        let fileState = "PROCESSING";
        const statusUrl = `https://generativelanguage.googleapis.com/v1beta/${fileApiName}?key=${geminiApiKey}`;
        let attempts = 0;
        while (fileState === "PROCESSING" && attempts < 30) {
          await new Promise((r) => setTimeout(r, 1500));
          attempts++;
          try {
            const statusRes = await fetch(statusUrl);
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              fileState = statusData.state || "ACTIVE";
            }
          } catch (e) { }
        }
      }

      const systemPromptTranscribe = `You are a high-fidelity verbatim audio transcriber for call center QA evaluations.
Your task is to transcribe the provided audio file with 100% accuracy.
Do NOT summarize, truncate, condense, or omit any part of the audio.
Do NOT skip dialogue turns, filler words, disconnections, or pauses.
Transcribe every single word spoken between "Agent" and "Customer".

Perform strict speaker diarization:
Label speaker turns clearly as "Agent" or "Customer".
Include precise timestamps [hh:mm:ss] for every single speaker change.

Return ONLY a single valid JSON object with this EXACT structure:
{
  "agentName": "string",
  "language": "string",
  "transcript": [
    { "time": "00:00:05", "speaker": "Agent", "text": "Hello, thank you for calling support." },
    { "time": "00:00:10", "speaker": "Customer", "text": "Hi, I need help with my account." }
  ]
}`;

      const modelEndpoints = [
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`,
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`
      ];

      let completionData: any = null;
      let genAttempts = 0;
      const maxGenAttempts = modelEndpoints.length * 2;

      while (genAttempts < maxGenAttempts) {
        const currentEndpoint = modelEndpoints[genAttempts % modelEndpoints.length];
        try {
          const genResponse = await fetch(currentEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                parts: [
                  { fileData: { fileUri, mimeType: fileMimeType || "audio/mp3" } },
                  { text: `Transcribe this audio file completely.\n${durationContext}\nProvide a word-for-word, verbatim transcript of the entire audio.\nCapture every single turn between the Agent and the Customer exactly as spoken, with accurate timestamps in hh:mm:ss format.` }
                ]
              }],
              systemInstruction: { parts: [{ text: systemPromptTranscribe }] },
              generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 65536 }
            }),
            signal: AbortSignal.timeout(900000)
          });

          if (!genResponse.ok) {
            const errText = await genResponse.text();
            const isTransient = genResponse.status === 429 || genResponse.status === 503 || genResponse.status === 500 || errText.toLowerCase().includes("high demand") || errText.toLowerCase().includes("rate limit");
            if (isTransient && genAttempts + 1 < maxGenAttempts) {
              genAttempts++;
              await new Promise((r) => setTimeout(r, 2000 * genAttempts));
              continue;
            }
            throw new Error(`Gemini generateContent failed: ${genResponse.status} ${genResponse.statusText} - ${errText}`);
          }

          completionData = await genResponse.json();
          break;
        } catch (err: any) {
          if (genAttempts + 1 < maxGenAttempts) {
            genAttempts++;
            await new Promise((r) => setTimeout(r, 2000 * genAttempts));
            continue;
          }
          throw err;
        }
      }

      // Cleanup Gemini File API after transcription
      if (fileApiName) {
        fetch(`https://generativelanguage.googleapis.com/v1beta/${fileApiName}?key=${geminiApiKey}`, { method: "DELETE" }).catch(() => { });
      }

      const candidate = completionData.candidates?.[0];
      let structuredResponseText = candidate?.content?.parts?.[0]?.text;
      if (!structuredResponseText) {
        throw new Error("Gemini returned empty response");
      }

      const parsedResult = safeParseJson(structuredResponseText);
      const transcribeTokens = completionData?.usageMetadata?.totalTokenCount || Math.round((durationSec || 105) * 12 + 450);

      const processedTranscript = (parsedResult.transcript || []).map((t: any) => ({
        time: t.time || "00:00:00",
        speaker: t.speaker || "Agent",
        text: replacePseudoNamesInText(t.text || "")
      }));

      const formatDuration = (sec: number) => {
        if (!sec || isNaN(sec) || sec <= 0) return "1:45";
        const mins = Math.floor(sec / 60);
        const secs = Math.round(sec % 60);
        if (mins > 0) {
          return secs > 0 ? `${mins} min ${secs} sec` : `${mins} min`;
        }
        return `${secs} sec`;
      };

      const formattedDuration = formatDuration(durationSec);
      const today = new Date();
      const formattedToday = today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
      const formattedIso = today.toISOString().split("T")[0];

      const transcribeTimeMs = Date.now() - routeStartTime;
      const transcribeTimeSec = Math.round(transcribeTimeMs / 100) / 10;
      const rawAgentName = parsedResult.agentName || "Adam Miller";
      const finalAgentName = normalizeAgentName(rawAgentName);

      return NextResponse.json({
        agentName: finalAgentName,
        date: formattedToday,
        dateStr: formattedIso,
        duration: formattedDuration,
        durationSec,
        language: parsedResult.language || "English (India)",
        transcript: processedTranscript,
        transcribeTimeMs,
        transcribeTimeSec,
        transcribeTokens,
        tokensUsed: transcribeTokens,
        evaluation: null,
        qaAnalysis: null,
        audioUrl: ""
      });
    }

    // Standard FormData Mode (for small files)
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const durationSec = Number(formData.get("durationSec")) || 0;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    // Save audio file to public/uploads directory for static playback
    let audioUrl = "";
    let serverParsedDurationSec = 0;
    try {
      const uploadsDir = path.join(process.cwd(), "public", "uploads");
      await fs.mkdir(uploadsDir, { recursive: true });

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Parse precise audio duration using music-metadata on the server
      try {
        const metadata = await mm.parseBuffer(buffer, file.type || "audio/mp3");
        if (metadata?.format?.duration) {
          serverParsedDurationSec = metadata.format.duration;
        }
      } catch (mmErr) { }

      const fileExtension = file.name.split(".").pop() || "mp3";
      const fileName = `${Date.now()}.${fileExtension}`;
      const filePath = path.join(uploadsDir, fileName);
      await fs.writeFile(filePath, buffer);

      audioUrl = `/api/audio?file=${fileName}`;
    } catch (fsErr: any) { }

    const systemPromptTranscribe = `You are a high-fidelity verbatim audio transcriber for call center QA evaluations.
Your task is to transcribe the provided audio file with 100% accuracy.
Do NOT summarize, truncate, condense, or omit any part of the audio.
Do NOT skip dialogue turns, filler words, disconnections, or pauses.
Transcribe every single word spoken between "Agent" and "Customer".

CRITICAL COMPANY & BRAND VOCABULARY ACCURACY RULES:
1. The official company name is "Brocus" (or "Brocus IT Solutions" / "Brocus IT").
2. NEVER transcribe the company name as "Broca", "Brocas", "Broker", "Brokers", "Procus", "Broka", or "Brocous".
3. Pay special attention to greetings like "Thank you for calling Brocus IT Solutions" or "This is Brocus IT Solutions". Always spell "Brocus" correctly.
4. Other partner and industry brand names include "Vivint", "ADT", and "Brinks". Spell them with exact capitalization.

CRITICAL AGENT PSEUDO NAME ACCURACY RULES:
1. Call center agents use official pseudo names. When transcribing agent names, ALWAYS match and standardize to the exact spelling from this official pseudo name list:
   - Adam Miller
   - David Scotts
   - Mike Ross
   - Cassey Jones
   - Mark Anderson
   - John Woods
   - Suzzane Daves
   - Jared McAnn
   - David White
   - Ron Williams
   - Richard Johnson
   - Eva Wilson
   - Nathan Brown
   - Jenny White
   - George Anthony
   - Lisa Johnson
2. If an agent name is spoken or misheard phonetically in dialogue (e.g., "Atom Miller", "Casey Jones", "Suzanne Davis", "Jared McCann", "David Scott"), exchange and transcribe it using the official pseudo name.
3. Identify the agentName (e.g. from the greeting). Match it to the official pseudo name list. If no name is mentioned, return "Adam Miller".

REGIONAL LANGUAGE & DIALECT DETECTION:
Detect the primary language or regional code-switching spoken during the call.
Examples: "English (US)", "English (India)", "Hindi", "Hinglish", "Spanish", "Tamil", "Telugu", etc.

SILENCE / HOLD RULE:
If there is a hold, silence, or pause in the audio lasting 3 seconds or longer, identify it and insert a transcript entry with speaker "Silence" and describe the event in brackets, for example: "[Silence for 12 seconds]" or "[Hold music plays]".

CRITICAL TIMESTAMP RULES:
1. Timestamps must represent the actual elapsed time in the audio format hh:mm:ss (hours:minutes:seconds).
2. Do NOT shift seconds or centiseconds to the left slots.
3. For example, if a turn occurs at 5 seconds and 48 centiseconds (5.48s), the timestamp MUST be "00:00:05" (NOT "00:05:48").
4. If a turn occurs at 42 seconds and 47 centiseconds (42.47s), the timestamp MUST be "00:00:42" (NOT "00:42:47").
5. If a turn occurs at 1 minute and 10 seconds (70.15s), the timestamp MUST be "00:01:10" (NOT "01:10:15").
6. Always format the hours:minutes:seconds accurately relative to the start of the audio file.

Identify the agentName (e.g. from the greeting). Match it to the official pseudo name list. If no name is mentioned, use "Adam Miller".

You must return your output ONLY in a valid JSON object matching the following structure. Do NOT return any markdown wrapper other than raw JSON.
{
  "agentName": "Adam Miller",
  "language": "English (India)",
  "transcript": [
    { "time": "00:00:05", "speaker": "Agent", "text": "verbatim text spoken here" },
    { "time": "00:00:15", "speaker": "Silence", "text": "[Silence for 15 seconds]" },
    { "time": "00:00:30", "speaker": "Customer", "text": "verbatim text spoken here" }
  ]
}`;

    const finalDurationSec = serverParsedDurationSec || durationSec || 0;

    let geminiResult: any;
    try {
      geminiResult = await transcribeAndEvaluateWithGemini(file, geminiApiKey, systemPromptTranscribe, finalDurationSec);
    } catch (geminiErr: any) {
      console.error("Gemini transcription API failed:", geminiErr);
      return NextResponse.json({ error: `Gemini processing failed: ${geminiErr.message}` }, { status: 500 });
    }

    const finalResult = geminiResult.parsedData || {};
    const usageMetadata = geminiResult.usageMetadata;

    // Post-processing Phonetic Vocabulary & Pseudo Name Correction Engine
    // Correct common speech-to-text misrecognitions for company name "Brocus" and Agent Pseudo Names
    const correctVocabularyText = (text: string): string => {
      if (!text) return text;
      let cleaned = text
        // Fix "Broca IT / Brocas IT / Broker IT" -> "Brocus IT"
        .replace(/\b(broca|brocas|broker|brokers|procus|broka|brocous|braker)\s+it\b/gi, "Brocus IT")
        // Fix standalone misspellings of Brocus
        .replace(/\b(broca|brocas|broker|brokers|procus|broka|brocous|braker)\b/gi, (match) => {
          if (match === match.toUpperCase()) return "BROCUS";
          if (match[0] === match[0].toUpperCase()) return "Brocus";
          return "brocus";
        });

      // Perform pseudo-name phonetic replacement
      cleaned = replacePseudoNamesInText(cleaned);
      return cleaned;
    };

    let processedTranscript = Array.isArray(finalResult.transcript)
      ? finalResult.transcript.map((t: any) => ({
        ...t,
        text: correctVocabularyText(t.text || ""),
      }))
      : [];

    // Parse actual duration in seconds from transcript timestamps, defaulting to client duration if provided
    let calculatedDurationSec = finalDurationSec || 0;
    if (!calculatedDurationSec && processedTranscript.length > 0) {
      const lastTurn = processedTranscript[processedTranscript.length - 1];
      if (lastTurn && typeof lastTurn.time === "string") {
        const parts = lastTurn.time.split(":").map(Number);
        if (parts.length === 3) {
          calculatedDurationSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
        } else if (parts.length === 2) {
          calculatedDurationSec = parts[0] * 60 + parts[1];
        }
      }
    }

    if (!calculatedDurationSec && typeof finalResult.durationSec === "number") {
      calculatedDurationSec = finalResult.durationSec;
    }
    if (!calculatedDurationSec || isNaN(calculatedDurationSec)) {
      calculatedDurationSec = 105;
    }

    // Calculate AI token counts
    const promptTokens = usageMetadata?.promptTokenCount || Math.round((calculatedDurationSec * 4.3) + 550);
    const candidateTokens = usageMetadata?.candidatesTokenCount || Math.round(processedTranscript.reduce((acc: number, t: any) => acc + (t.text || "").split(/\s+/).length, 0) * 1.3);
    const transcribeTokens = usageMetadata?.totalTokenCount || (promptTokens + candidateTokens);

    const formatDuration = (totalSeconds: number): string => {
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

    const formattedDuration = formatDuration(calculatedDurationSec);

    const today = new Date();
    const formattedToday = today.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
    const formattedIso = today.toISOString().split("T")[0];

    const transcribeTimeMs = Date.now() - routeStartTime;
    const transcribeTimeSec = Math.round(transcribeTimeMs / 100) / 10;

    const rawAgentName = finalResult.agentName || "Adam Miller";
    const finalAgentName = normalizeAgentName(rawAgentName);

    const responseData = {
      agentName: finalAgentName,
      date: formattedToday,
      dateStr: formattedIso,
      duration: formattedDuration,
      durationSec: calculatedDurationSec,
      language: finalResult.language || "English (India)",
      transcript: processedTranscript,
      transcribeTimeMs,
      transcribeTimeSec,
      transcribeTokens,
      tokensUsed: transcribeTokens,
      evaluation: null,
      qaAnalysis: null,
      audioUrl
    };

    return NextResponse.json(responseData);
  } catch (error: any) {
    console.error("Transcribe Route Error:", error);
    if (error.cause) {
      console.error("Underlying fetch cause in POST:", error.cause);
    }
    return NextResponse.json({ error: error.message || "Internal Server Error" }, { status: 500 });
  }
}
