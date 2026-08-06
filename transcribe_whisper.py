import sys
import json
import os
import math

def format_timestamp(seconds):
    hours = math.floor(seconds / 3600)
    minutes = math.floor((seconds % 3600) / 60)
    secs = math.floor(seconds % 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"

def transcribe_audio(file_path):
    if not os.path.exists(file_path):
        print(json.dumps({"error": f"File not found: {file_path}"}))
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
        model_size = "base"
        model = WhisperModel(model_size, device="cpu", compute_type="int8")

        segments, info = model.transcribe(file_path, beam_size=5)

        transcript_items = []
        speaker_turn = "Agent"
        
        for segment in segments:
            text = segment.text.strip()
            if not text:
                continue
            start_time_str = format_timestamp(segment.start)
            if transcript_items and transcript_items[-1]["speaker"] == speaker_turn:
                transcript_items[-1]["text"] += f" {text}"
            else:
                transcript_items.append({
                    "time": start_time_str,
                    "speaker": speaker_turn,
                    "text": text
                })
                speaker_turn = "Customer" if speaker_turn == "Agent" else "Agent"

        result = {
            "agentName": "Rahul M.",
            "language": info.language or "en",
            "transcript": transcript_items
        }
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Audio file path argument missing"}))
        sys.exit(1)
    
    audio_path = sys.argv[1]
    transcribe_audio(audio_path)
