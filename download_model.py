import sys
import json
import os

def check_or_download_model():
    cache_dir = os.path.expanduser("~/.cache/huggingface/hub/models--Systran--faster-whisper-base")
    
    if len(sys.argv) > 1 and sys.argv[1] == "status":
        exists = os.path.exists(cache_dir)
        print(json.dumps({"downloaded": exists}))
        return

    print(json.dumps({"progress": 15, "status": "Connecting to HuggingFace Hub..."}))
    sys.stdout.flush()

    try:
        from faster_whisper import WhisperModel
        print(json.dumps({"progress": 50, "status": "Downloading faster-whisper-base model weights..."}))
        sys.stdout.flush()
        
        # Download model weights into local cache
        model = WhisperModel("base", device="cpu", compute_type="int8")
        
        print(json.dumps({"progress": 100, "status": "Model ready!", "downloaded": True}))
        sys.stdout.flush()
    except Exception as e:
        print(json.dumps({"error": str(e), "progress": 0}))
        sys.stdout.flush()

if __name__ == "__main__":
    check_or_download_model()
