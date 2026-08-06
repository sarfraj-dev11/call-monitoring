import { NextResponse } from "next/server";
import { getAllCalls, getCallById, saveCall, deleteCall, clearAllCalls } from "@/lib/localDb";

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (id) {
      const call = getCallById(id);
      if (!call) {
        return NextResponse.json({ error: "Call not found" }, { status: 404 });
      }
      return NextResponse.json(call);
    }

    const calls = getAllCalls();
    return NextResponse.json(calls);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.id) {
      return NextResponse.json({ error: "Call ID is required" }, { status: 400 });
    }

    const saved = saveCall(body);
    return NextResponse.json(saved);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const clearAll = searchParams.get("clearAll");

    if (clearAll === "true") {
      clearAllCalls();
      return NextResponse.json({ success: true, message: "All calls cleared" });
    }

    if (!id) {
      return NextResponse.json({ error: "Call ID is required" }, { status: 400 });
    }

    // Attempt to delete the associated audio file
    const call = getCallById(id);
    if (call && call.audioUrl && call.audioUrl.includes("file=")) {
      const fileName = call.audioUrl.split("file=")[1];
      if (fileName) {
        const fs = require("fs");
        const path = require("path");
        const filePath = path.join(process.cwd(), "public", "uploads", fileName.split("&")[0]);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.error(`Failed to delete audio file ${filePath}:`, e);
          }
        }
      }
    }

    const success = deleteCall(id);
    return NextResponse.json({ success });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
