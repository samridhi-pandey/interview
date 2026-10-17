"""FastAPI app: serves the frontend and the three modules' APIs.

Run: uvicorn main:app --reload (from /backend).

Modules:
  1. CV Analyzer       – POST /api/cv/analyze
  2. Mock Interview    – POST /api/interview/start, /answer, /report
  3. Delivery Coach    – POST /api/coach/analyze (facial & vocal analysis)
"""
import os
import tempfile
import time
import traceback
import uuid
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

import ai_service
import interview_service as iv
import resume_analyzer
from models import AnswerRequest, ReportRequest, StartRequest

FRONTEND = Path(__file__).resolve().parent.parent / "frontend"
BACKEND_DIR = Path(__file__).resolve().parent

app = FastAPI(title="AI Interview Preparation Coach")

# In-memory only: extracted CV text kept briefly so the interview module can use it as context.
CV_STORE: dict[str, tuple[float, str]] = {}
CV_TTL = 2 * 60 * 60


def _purge_cvs():
    now = time.time()
    for k in [k for k, (t, _) in CV_STORE.items() if now - t > CV_TTL]:
        CV_STORE.pop(k, None)
    while len(CV_STORE) > 200:
        CV_STORE.pop(next(iter(CV_STORE)))


@app.exception_handler(iv.InterviewError)
async def _interview_error(_, exc: iv.InterviewError):
    return JSONResponse({"detail": str(exc)}, status_code=exc.status)


# ========== Module status ==========
@app.get("/api/status")
def status():
    return {"mode": "ai" if ai_service.AI_ENABLED else "demo", "model": ai_service.MODEL if ai_service.AI_ENABLED else None}


# ========== Module 1: CV Analyzer ==========
@app.post("/api/cv/analyze")
async def analyze_cv(file: UploadFile = File(...)):
    data = await file.read(resume_analyzer.MAX_FILE_BYTES + 1)
    try:
        text = resume_analyzer.extract_text(file.filename or "", data)
    except resume_analyzer.CVError as e:
        raise HTTPException(400, str(e))
    del data  # the uploaded file is never written to disk
    analysis = resume_analyzer.analyze(text)
    _purge_cvs()
    cv_id = uuid.uuid4().hex
    CV_STORE[cv_id] = (time.time(), text)
    return {
        "cv_id": cv_id,
        "filename": file.filename,
        "analysis": analysis,
        "extracted_preview": text[:1500],
        "extracted_chars": len(text),
    }


# ========== Module 2: Mock Interview ==========
@app.post("/api/interview/start")
def start_interview(req: StartRequest):
    cv_text = None
    if req.cv_id:
        entry = CV_STORE.get(req.cv_id)
        cv_text = entry[1] if entry else None  # CV is optional - silently continue without it if expired
    return iv.start(req.domain, req.difficulty, cv_text)


@app.post("/api/interview/answer")
def answer(req: AnswerRequest):
    return iv.answer(req.session_id, req.answer)


@app.post("/api/interview/report")
def report(req: ReportRequest):
    return iv.report(req.session_id)


# ========== Module 3: Delivery Coach (Facial & Vocal Analysis) ==========
# Lazy singleton for the heavy InterviewAnalyzer
_COACH_ANALYZER = None


def _get_coach_analyzer():
    global _COACH_ANALYZER
    if _COACH_ANALYZER is None:
        from interview_analyzer import InterviewAnalyzer
        _COACH_ANALYZER = InterviewAnalyzer()
    return _COACH_ANALYZER


@app.get("/api/coach/health")
def coach_health():
    return {
        "status": "healthy",
        "service": "Delivery Coach - Facial & Vocal Analysis",
        "version": "1.0.0",
    }


@app.get("/api/coach/sample-video")
def coach_sample_video():
    sample_path = BACKEND_DIR / "sample_interview.mp4"
    if not sample_path.exists():
        raise HTTPException(404, "Sample video not found.")
    return FileResponse(sample_path, media_type="video/mp4")


@app.post("/api/coach/analyze")
async def coach_analyze(file: UploadFile = File(None)):
    """Analyzes an uploaded video/audio file for facial & vocal delivery metrics.

    Accepts multipart file upload (video or audio).
    Returns overall_delivery_score, confidence, clarity, engagement, metrics, and coaching feedback.
    """
    import base64

    try:
        analyzer = _get_coach_analyzer()
    except ImportError:
        raise HTTPException(
            503, "Delivery Coach dependencies are not installed. Run: pip install -r backend/requirements-coach.txt"
        )
    temp_files = []

    try:
        video_path = None
        audio_bytes = None

        # Multipart file upload
        if file and file.filename:
            suffix = os.path.splitext(file.filename.lower())[1] or ".mp4"
            with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tf:
                content = await file.read()
                tf.write(content)
                video_path = tf.name
                temp_files.append(video_path)

        if not video_path and not audio_bytes:
            raise HTTPException(400, "No media provided. Upload a video or audio file.")

        result = analyzer.analyze(video_path=video_path, audio_bytes=audio_bytes)
        return result.to_dict()

    except HTTPException:
        raise
    except Exception as e:
        traceback.print_exc()
        raise HTTPException(500, f"Analysis failed: {str(e)}")

    finally:
        for tmp in temp_files:
            if os.path.exists(tmp):
                try:
                    os.remove(tmp)
                except Exception:
                    pass


# ========== Frontend serving ==========
@app.get("/")
def index():
    return FileResponse(FRONTEND / "index.html")


app.mount("/", StaticFiles(directory=FRONTEND), name="static")
