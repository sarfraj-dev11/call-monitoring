import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }

    const cleanFileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
    const filePath = path.join(uploadsDir, cleanFileName);
    
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);

    const localUrl = `/uploads/${cleanFileName}`;
    return NextResponse.json({ audioUrl: localUrl });
  } catch (error: any) {
    console.error("Local audio upload error:", error);
    return NextResponse.json({ error: error.message || "Failed to save local audio file" }, { status: 500 });
  }
}
