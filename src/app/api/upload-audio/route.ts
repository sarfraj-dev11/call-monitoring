import { NextResponse } from "next/server";
import { storage } from "@/lib/firebase";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    console.log(`Server-side uploading ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB) to Firebase Storage...`);
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const cleanFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `calls/${Date.now()}_${cleanFileName}`;
    const storageRef = ref(storage, storagePath);

    // Server-side upload to Firebase Storage (Zero CORS restrictions on Node.js server!)
    await uploadBytes(storageRef, buffer, {
      contentType: file.type || "audio/mp3"
    });

    const downloadUrl = await getDownloadURL(storageRef);
    console.log(`Successfully uploaded to Firebase Storage via server proxy!`);

    return NextResponse.json({ audioUrl: downloadUrl });
  } catch (error: any) {
    console.error("Server-side Firebase Storage upload error:", error);
    return NextResponse.json({ error: error.message || "Failed to upload to Firebase Storage" }, { status: 500 });
  }
}
