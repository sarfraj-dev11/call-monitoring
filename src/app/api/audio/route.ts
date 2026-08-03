import { NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const fileName = searchParams.get("file");
    const remoteUrl = searchParams.get("url");

    if (remoteUrl) {
      return NextResponse.redirect(remoteUrl, 307);
    }

    if (!fileName) {
      return NextResponse.json({ error: "Filename or URL is required" }, { status: 400 });
    }

    // Prevent directory traversal attacks
    const safeFileName = path.basename(fileName);
    const filePath = path.join(process.cwd(), "public", "uploads", safeFileName);

    // Check if the file exists on disk
    try {
      await fs.access(filePath);
    } catch {
      return NextResponse.json({ error: "Audio file not found" }, { status: 404 });
    }

    const stat = await fs.stat(filePath);
    const fileSize = stat.size;
    const range = request.headers.get("range");

    // Determine the correct content type based on the file extension
    const ext = safeFileName.split(".").pop()?.toLowerCase();
    let contentType = "audio/mpeg";
    if (ext === "wav") contentType = "audio/wav";
    else if (ext === "ogg") contentType = "audio/ogg";
    else if (ext === "webm") contentType = "audio/webm";

    // Handle range requests for HTML5 audio player compatibility (seeking, partial streaming)
    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
          },
        });
      }

      const chunksize = end - start + 1;
      
      // Read only the requested byte range
      const fd = await fs.open(filePath, "r");
      const buffer = Buffer.alloc(chunksize);
      await fd.read(buffer, 0, chunksize, start);
      await fd.close();

      return new NextResponse(buffer, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunksize.toString(),
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      });
    } else {
      // Fallback to serving the entire file if no range header is supplied
      const fileBuffer = await fs.readFile(filePath);
      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": fileSize.toString(),
          "Content-Type": contentType,
          "Cache-Control": "no-cache",
        },
      });
    }
  } catch (error: any) {
    console.error("Audio streaming route error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const uploadsDir = path.join(process.cwd(), "public", "uploads");
    try {
      const files = await fs.readdir(uploadsDir);
      for (const file of files) {
        // Only delete file extensions we created
        if (file.endsWith(".wav") || file.endsWith(".mp3")) {
          await fs.unlink(path.join(uploadsDir, file)).catch(e => console.error(`Failed to unlink ${file}:`, e));
        }
      }
    } catch (err) {
      console.warn("Uploads directory not accessible during clear:", err);
    }
    return NextResponse.json({ success: true, message: "Server-side audio files cleared successfully." });
  } catch (error: any) {
    console.error("Audio clear route error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
