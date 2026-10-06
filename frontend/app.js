// Signal · AI Interview Preparation Coach — vanilla JS frontend
// All AI calls go through the backend. No secrets here.

const $ = (id) => document.getElementById(id);
const show = (el, on = true) => el.classList.toggle("hidden", !on);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fill = (id, items, tag = "li") => ($(id).innerHTML = (items || []).map((t) => `<${tag}>${esc(t)}</${tag}>`).join(""));

const state = { file: null, cvId: null, cvName: null, domain: "Technical", difficulty: "Medium", sessionId: null, finished: false, coachFile: null };

// ─── API helpers ────────────────────────────────────────────────
async function api(path, options) {
  let res;
  try { res = await fetch(path, options); } catch { throw new Error("Cannot reach the server. Is the backend running?"); }
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    let msg = data?.detail || data?.error;
    if (Array.isArray(msg)) msg = "Please check your input and try again.";
    throw new Error(msg || `Request failed (${res.status}).`);
  }
  return data;
}
const post = (path, body) => api(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const setError = (id, msg) => { $(id).textContent = msg || ""; show($(id), !!msg); };

// ─── Score color ────────────────────────────────────────────────
const scoreColor = (pct) => (pct >= 75 ? "#42a47c" : pct >= 50 ? "#eca458" : "#dc2626");

// ─── SVG ring helper ────────────────────────────────────────────
const CIRCUMFERENCE = 2 * Math.PI * 28; // radius 28
function setRing(circleId, pct) {
  const el = $(circleId);
  if (!el) return;
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;
  el.setAttribute("stroke-dashoffset", offset);
  el.setAttribute("stroke", scoreColor(pct));
}

// ─── Date label ─────────────────────────────────────────────────
const days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const now = new Date();
$("dateLabel").textContent = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;

// ─── Status badge ───────────────────────────────────────────────
api("/api/status").then((s) => {
  const b = $("modeBadge");
  b.textContent = s.mode === "ai" ? `AI mode · ${s.model}` : "DEMO mode";
  b.style.background = s.mode === "ai" ? "rgba(66,164,124,.12)" : "rgba(236,164,88,.15)";
  b.style.color = s.mode === "ai" ? "#42a47c" : "#b45309";
}).catch(() => { $("modeBadge").textContent = "server offline"; });

// ─── Navigation ─────────────────────────────────────────────────
function switchView(name) {
  document.querySelectorAll(".nav-link").forEach((l) => l.classList.toggle("active", l.dataset.view === name));
  ["overview", "cv", "interview", "coach"].forEach((v) => show($(`view-${v}`), v === name));
  if (name === "interview") renderCvContext();
  $("sidebar").classList.remove("open");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
document.querySelectorAll(".nav-link").forEach((l) => l.addEventListener("click", () => switchView(l.dataset.view)));

// Overview card clicks
$("goResumeCard").addEventListener("click", () => switchView("cv"));
$("goInterviewCard").addEventListener("click", () => switchView("interview"));
$("goCoachCard").addEventListener("click", () => switchView("coach"));

// Mobile menu
$("mobileMenuBtn").addEventListener("click", () => $("sidebar").classList.add("open"));
$("sidebarClose").addEventListener("click", () => $("sidebar").classList.remove("open"));

// ═══════════════════════════════════════════════════════════════
// MODULE 1: CV ANALYZER
// ═══════════════════════════════════════════════════════════════
const dz = $("dropzone");
["dragenter", "dragover"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.add("drag"); }));
["dragleave", "drop"].forEach((e) => dz.addEventListener(e, (ev) => { ev.preventDefault(); dz.classList.remove("drag"); }));
dz.addEventListener("drop", (ev) => pickFile(ev.dataTransfer.files[0]));
$("cvFile").addEventListener("change", (ev) => pickFile(ev.target.files[0]));

function pickFile(f) {
  setError("cvError", "");
  if (!f) return;
  if (!/\.(pdf|docx)$/i.test(f.name)) return setError("cvError", "Unsupported file type. Please upload a PDF or DOCX file.");
  if (f.size > 5 * 1024 * 1024) return setError("cvError", "File is too large (max 5 MB).");
  state.file = f;
  const kb = f.size / 1024;
  $("fileInfo").textContent = `📎 ${f.name} · ${kb > 1024 ? (kb / 1024).toFixed(1) + " MB" : Math.round(kb) + " KB"}`;
  show($("fileInfo"));
  $("analyzeBtn").disabled = false;
}

$("analyzeBtn").addEventListener("click", async () => {
  if (!state.file) return;
  setError("cvError", "");
  $("analyzeBtn").disabled = true;
  show($("cvLoading"));
  try {
    const fd = new FormData();
    fd.append("file", state.file);
    const data = await api("/api/cv/analyze", { method: "POST", body: fd });
    state.cvId = data.cv_id;
    state.cvName = data.filename;
    renderCv(data);
  } catch (e) {
    setError("cvError", e.message);
  } finally {
    show($("cvLoading"), false);
    $("analyzeBtn").disabled = false;
  }
});

const CAT_LABELS = { structure: "Structure", formatting: "Formatting", content: "Content", keywords: "Keywords", completeness: "Completeness" };

function renderCv(data) {
  const a = data.analysis;
  show($("cvResult"));
  $("atsScore").textContent = a.ats_score;
  setRing("atsCircle", a.ats_score);
  $("catBars").innerHTML = Object.keys(CAT_LABELS).map((k) => {
    const pct = a.category_percent[k];
    return `<div class="bar"><span>${CAT_LABELS[k]}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${scoreColor(pct)}"></div></div><span class="bar-val">${pct}%</span></div>`;
  }).join("");
  const chips = (list, cls, empty) => (list.length ? list.map((s) => `<span class="chip ${cls}">${esc(s)}</span>`).join("") : `<span class="text-muted">${empty}</span>`);
  $("sections").innerHTML = chips(a.detected_sections, "chip-violet", "No standard section headings detected.");
  $("skills").innerHTML = chips(a.detected_skills, "chip-green", "No recognised skills detected.");
  fill("strengths", a.strengths);
  fill("areas", a.areas_to_improve);
  fill("recs", a.recommendations);
  $("cvPreview").textContent = data.extracted_preview + (data.extracted_chars > 1500 ? "\n…" : "");
  $("cvNote").textContent = a.note || "";
  show($("cvNote"), !!a.note);
  if (a.mode === "demo") {
    $("cvNote").textContent = (a.note ? a.note + " " : "") + "DEMO mode: the ATS score is rule-based; the written feedback is generated from rules, not AI.";
    show($("cvNote"));
  }

  // Update overview stats
  $("resumeBadge").textContent = "Ready";
  $("ovAts").textContent = a.ats_score + "%";
  $("ovStr").textContent = String(a.strengths.length).padStart(2, "0");
  $("ovGap").textContent = String(a.areas_to_improve.length).padStart(2, "0");
  show($("overviewResumeStats"));
  $("navAtsBadge").textContent = a.ats_score;

  $("cvResult").scrollIntoView({ behavior: "smooth" });
}

$("goInterview").addEventListener("click", () => switchView("interview"));

// ═══════════════════════════════════════════════════════════════
// MODULE 2: INTERVIEW
// ═══════════════════════════════════════════════════════════════
function bindSeg(id, key) {
  $(id).querySelectorAll(".seg-btn").forEach((b) => b.addEventListener("click", () => {
    $(id).querySelectorAll(".seg-btn").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    state[key] = b.dataset.value;
  }));
}
bindSeg("domainSeg", "domain");
bindSeg("diffSeg", "difficulty");

function renderCvContext() {
  const el = $("cvContext");
  if (state.cvId) {
    el.innerHTML = `✅ Using CV: <strong>${esc(state.cvName)}</strong> to personalise questions <button class="btn btn-ghost" id="dropCv">Remove</button>`;
    $("dropCv").addEventListener("click", () => { state.cvId = null; state.cvName = null; renderCvContext(); });
  } else {
    el.innerHTML = `No CV attached — you'll get general questions. <button class="btn btn-ghost" id="toCv">Analyze a CV first</button>`;
    $("toCv").addEventListener("click", () => switchView("cv"));
  }
}
renderCvContext();

function showQuestion(q, total) {
  ["setup", "fbCard", "reportCard"].forEach((id) => show($(id), false));
  show($("qCard"));
  $("qCount").textContent = `Question ${q.number} of ${total}`;
  $("qTopic").textContent = q.topic;
  $("qType").textContent = q.type;
  $("qText").textContent = q.text;
  $("progressBar").style.width = `${((q.number - 1) / total) * 100}%`;
  $("answerBox").value = "";
  $("charCount").textContent = "0 / 4000";
  setError("answerError", "");
  $("answerBox").focus();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("startBtn").addEventListener("click", async () => {
  setError("startError", "");
  $("startBtn").disabled = true;
  show($("startLoading"));
  try {
    const d = await post("/api/interview/start", { domain: state.domain, difficulty: state.difficulty, cv_id: state.cvId });
    state.sessionId = d.session_id;
    state.total = d.total;
    state.finished = false;
    state.currentDomain = d.domain;
    showQuestion(d.question, d.total);
  } catch (e) {
    setError("startError", e.message);
  } finally {
    show($("startLoading"), false);
    $("startBtn").disabled = false;
  }
});

$("answerBox").addEventListener("input", (e) => ($("charCount").textContent = `${e.target.value.length} / 4000`));

$("submitBtn").addEventListener("click", async () => {
  const answer = $("answerBox").value.trim();
  if (!answer) return setError("answerError", "Please type an answer before submitting.");
  setError("answerError", "");
  $("submitBtn").disabled = true;
  $("answerBox").disabled = true;
  show($("evalLoading"));
  try {
    const d = await post("/api/interview/answer", { session_id: state.sessionId, answer });
    state.next = d.next_question;
    state.finished = d.finished;
    renderFeedback(d.evaluation, d.finished, d.mode);
  } catch (e) {
    setError("answerError", e.message);
  } finally {
    show($("evalLoading"), false);
    $("submitBtn").disabled = false;
    $("answerBox").disabled = false;
  }
});

function renderFeedback(ev, finished, mode) {
  show($("qCard"), false);
  show($("fbCard"));
  $("fbScore").textContent = ev.score;
  $("fbComm").textContent = ev.communication_score;
  $("fbTech").textContent = ev.technical_depth_score;
  $("fbConf").textContent = ev.confidence_score;
  $("fbTechLabel").textContent = state.currentDomain === "HR" ? "Relevance / Content" : "Technical Depth";
  fill("fbStrengths", ev.strengths);
  fill("fbImprove", ev.improvements);
  $("fbText").textContent = ev.feedback;
  $("fbIdeal").textContent = ev.ideal_answer;
  $("nextBtn").textContent = finished ? "View final report →" : "Next question →";
  setError("fbError", "");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("nextBtn").addEventListener("click", async () => {
  if (!state.finished) return showQuestion(state.next, state.total);
  setError("fbError", "");
  $("nextBtn").disabled = true;
  show($("reportLoading"));
  try {
    renderReport(await post("/api/interview/report", { session_id: state.sessionId }));
  } catch (e) {
    setError("fbError", e.message);
  } finally {
    show($("reportLoading"), false);
    $("nextBtn").disabled = false;
  }
});

function renderReport(r) {
  show($("fbCard"), false);
  show($("reportCard"));
  $("reportMeta").textContent = `${r.domain} interview · ${r.difficulty} difficulty`;
  $("readyPct").textContent = r.readiness_percentage;
  setRing("readyCircle", r.readiness_percentage);
  $("rOverall").textContent = r.overall_score;
  $("rComm").textContent = r.communication_score;
  $("rTech").textContent = r.technical_depth_score;
  $("rTechLabel").textContent = r.technical_depth_label;
  $("rConf").textContent = r.confidence_score;
  $("qScores").innerHTML = r.questions.map((q) => {
    const pct = q.score * 10;
    return `<div class="bar"><span>Q${q.number} · ${esc(q.topic)}</span><div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${scoreColor(pct)}"></div></div><span class="bar-val">${q.score}/10</span></div>`;
  }).join("");
  fill("rStrong", r.strong_areas);
  fill("rImprove", r.areas_to_improve);
  fill("rTips", r.top_3_tips);
  const notes = [r.note, r.mode === "demo" ? "DEMO mode: scores come from simple heuristics and a local question bank, not from AI." : ""].filter(Boolean);
  $("reportNote").textContent = notes.join(" ");
  show($("reportNote"), notes.length > 0);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("restartBtn").addEventListener("click", () => {
  state.sessionId = null;
  show($("reportCard"), false);
  show($("setup"));
  renderCvContext();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// ═══════════════════════════════════════════════════════════════
// MODULE 3: DELIVERY COACH
// ═══════════════════════════════════════════════════════════════
let mediaRecorder = null;
let recordedChunks = [];
let webcamStream = null;

// Dropzone for coach
const cDz = $("coachDropzone");
["dragenter", "dragover"].forEach((e) => cDz.addEventListener(e, (ev) => { ev.preventDefault(); cDz.classList.add("drag"); }));
["dragleave", "drop"].forEach((e) => cDz.addEventListener(e, (ev) => { ev.preventDefault(); cDz.classList.remove("drag"); }));
cDz.addEventListener("drop", (ev) => pickCoachFile(ev.dataTransfer.files[0]));
$("coachFile").addEventListener("change", (ev) => pickCoachFile(ev.target.files[0]));

function pickCoachFile(f) {
  setError("coachError", "");
  if (!f) return;
  if (f.size > 150 * 1024 * 1024) return setError("coachError", "File is too large (max 150 MB).");
  state.coachFile = f;
  const mb = (f.size / (1024 * 1024)).toFixed(1);
  $("coachFileInfo").textContent = `📎 ${f.name} · ${mb} MB`;
  show($("coachFileInfo"));
  show($("coachAnalyzeBtn"));
}

// Webcam recording
$("useWebcamBtn").addEventListener("click", async () => {
  setError("coachError", "");
  try {
    webcamStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    $("webcamVideo").srcObject = webcamStream;
    show($("webcamArea"));
    show($("coachChoices"), false);
  } catch (e) {
    setError("coachError", "Could not access webcam/microphone. Please allow permissions.");
  }
});

$("startRecordBtn").addEventListener("click", () => {
  recordedChunks = [];
  mediaRecorder = new MediaRecorder(webcamStream, { mimeType: "video/webm" });
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    state.coachFile = new File([blob], "webcam-recording.webm", { type: "video/webm" });
    const mb = (blob.size / (1024 * 1024)).toFixed(1);
    $("coachFileInfo").textContent = `🎥 Webcam recording · ${mb} MB`;
    show($("coachFileInfo"));
    show($("coachAnalyzeBtn"));
    stopWebcam();
  };
  mediaRecorder.start();
  show($("startRecordBtn"), false);
  show($("stopRecordBtn"));
});

$("stopRecordBtn").addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  show($("stopRecordBtn"), false);
  show($("startRecordBtn"));
});

$("cancelWebcamBtn").addEventListener("click", () => {
  if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  stopWebcam();
});

function stopWebcam() {
  if (webcamStream) { webcamStream.getTracks().forEach((t) => t.stop()); webcamStream = null; }
  $("webcamVideo").srcObject = null;
  show($("webcamArea"), false);
  show($("coachChoices"));
  show($("stopRecordBtn"), false);
  show($("startRecordBtn"));
}

// Analyze delivery
$("coachAnalyzeBtn").addEventListener("click", () => analyzeCoach(state.coachFile));

$("coachDemoBtn").addEventListener("click", async () => {
  setError("coachError", "");
  show($("coachLoading"));
  $("coachDemoBtn").disabled = true;
  try {
    // Fetch the sample video and submit it
    const resp = await fetch("/api/coach/sample-video");
    if (!resp.ok) throw new Error("Sample video not available.");
    const blob = await resp.blob();
    const file = new File([blob], "sample_interview.mp4", { type: "video/mp4" });
    await analyzeCoach(file);
  } catch (e) {
    setError("coachError", e.message);
  } finally {
    show($("coachLoading"), false);
    $("coachDemoBtn").disabled = false;
  }
});

async function analyzeCoach(file) {
  if (!file) return setError("coachError", "No file selected.");
  setError("coachError", "");
  show($("coachLoading"));
  $("coachAnalyzeBtn").disabled = true;
  $("coachDemoBtn").disabled = true;
  try {
    const fd = new FormData();
    fd.append("file", file);
    const data = await api("/api/coach/analyze", { method: "POST", body: fd });
    renderCoachResults(data);
  } catch (e) {
    setError("coachError", e.message);
  } finally {
    show($("coachLoading"), false);
    $("coachAnalyzeBtn").disabled = false;
    $("coachDemoBtn").disabled = false;
  }
}

function renderCoachResults(data) {
  show($("coachSetup"), false);
  show($("coachResult"));

  $("cOverall").textContent = Math.round(data.overall_delivery_score);
  $("cConfidence").textContent = Math.round(data.confidence_score);
  $("cClarity").textContent = Math.round(data.clarity_score);
  $("cEngagement").textContent = Math.round(data.engagement_score);

  fill("coachStrengths", data.strengths || []);
  fill("coachImprovements", data.actionable_improvements || []);

  // Facial metrics
  const fm = data.metrics?.facial || {};
  const facialRows = [
    ["Eye Contact", `${fm.eye_contact_ratio ?? "—"}%`],
    ["Looking Away", `${fm.looking_away_ratio ?? "—"}%`],
    ["Blink Rate", `${fm.blink_rate_bpm ?? "—"} BPM`],
    ["Smile Ratio", `${(fm.smiling_ratio ?? 0).toFixed(1)}%`],
    ["Head Stability", `${fm.head_stability_score ?? "—"}`],
    ["Warmth", `${fm.warmth_score ?? "—"}`],
    ["Expressiveness", `${fm.facial_expressiveness ?? "—"}`],
  ];
  $("facialMetrics").innerHTML = "<h3>👁️ Facial Analysis</h3>" + facialRows.map(([l, v]) => `<div class="metric-row"><span class="metric-label">${l}</span><span class="metric-value">${v}</span></div>`).join("");

  // Vocal metrics
  const vm = data.metrics?.vocal || {};
  const sm = data.metrics?.speech || {};
  const vocalRows = [
    ["Words Per Minute", `${vm.words_per_minute ?? "—"}`],
    ["Pacing Score", `${vm.pacing_score ?? "—"}`],
    ["Vocal Energy", `${vm.vocal_energy_score ?? "—"}`],
    ["Pitch Mean", `${vm.pitch_mean_hz ?? "—"} Hz`],
    ["Pitch Variation", `${vm.pitch_std_hz ?? "—"} Hz`],
    ["Monotone", vm.is_monotone ? "Yes" : "No"],
    ["Filler Words", `${sm.filler_words_count ?? 0}`],
    ["Word Count", `${sm.word_count ?? 0}`],
  ];
  $("vocalMetrics").innerHTML = "<h3>🎤 Vocal Analysis</h3>" + vocalRows.map(([l, v]) => `<div class="metric-row"><span class="metric-label">${l}</span><span class="metric-value">${v}</span></div>`).join("");

  // Transcript
  if (sm.transcript) {
    $("coachTranscript").textContent = sm.transcript;
    $("transcriptCard").style.display = "block";
  } else {
    $("transcriptCard").style.display = "none";
  }

  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("coachRetryBtn").addEventListener("click", () => {
  show($("coachResult"), false);
  show($("coachSetup"));
  show($("coachAnalyzeBtn"), false);
  show($("coachFileInfo"), false);
  state.coachFile = null;
  window.scrollTo({ top: 0, behavior: "smooth" });
});
