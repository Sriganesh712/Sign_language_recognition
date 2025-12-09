// src/pages/DataCollector.jsx
import React, { useEffect, useRef, useState } from "react";
import { Hands } from "@mediapipe/hands";
import { Camera } from "@mediapipe/camera_utils";
import JSZip from "jszip";
import { saveAs } from "file-saver";

const FRAME_COUNT = 32;
const DB_NAME = "gesture-db-v1";
const STORE_NAME = "samples";

export default function DataCollector() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const latestLandmarksRef = useRef(null);

  const [gestureName, setGestureName] = useState("");
  const [status, setStatus] = useState("Idle");
  const [samplesSaved, setSamplesSaved] = useState(0);
  const [batchCount, setBatchCount] = useState(50);
  const [collecting, setCollecting] = useState(false);
  const [progress, setProgress] = useState(0);

  // ---------- IndexedDB ----------
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME))
          db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function saveToDB(sample) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const r = tx.objectStore(STORE_NAME).add(sample);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function getAllFromDB() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const r = tx.objectStore(STORE_NAME).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      tx.oncomplete = () => db.close();
    });
  }

  async function countGestureInDB(name) {
    const all = await getAllFromDB();
    return all.filter((s) => s.gesture === name).length;
  }

  // ---------- MediaPipe Hands ----------
  useEffect(() => {
    const hands = new Hands({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      selfieMode: true,
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });

    hands.onResults((results) => {
      latestLandmarksRef.current =
        results.multiHandLandmarks?.[0] || null;
    });

    const cam = new Camera(videoRef.current, {
      onFrame: async () => hands.send({ image: videoRef.current }),
      width: 640,
      height: 480,
    });

    cam.start();

    const updateSampleCount = async () => {
      const all = await getAllFromDB();
      setSamplesSaved(all.length);
    };
    updateSampleCount();

    const drawLoop = () => {
      drawOverlay();
      requestAnimationFrame(drawLoop);
    };
    drawLoop();

    return () => cam.stop();
  }, []);

  // ---------- Overlay Drawing ----------
  function drawOverlay() {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;

    const ctx = canvas.getContext("2d");
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const lm = latestLandmarksRef.current;
    if (!lm) return;

    ctx.save();
    ctx.scale(-1, 1);
    ctx.translate(-canvas.width, 0);

    const connections = [
      [0,1],[1,2],[2,3],[3,4],
      [0,5],[5,6],[6,7],[7,8],
      [0,9],[9,10],[10,11],[11,12],
      [0,13],[13,14],[14,15],[15,16],
      [0,17],[17,18],[18,19],[19,20]
    ];

    ctx.strokeStyle = "rgba(0,150,255,0.9)";
    ctx.lineWidth = 2;

    connections.forEach(([a, b]) => {
      ctx.beginPath();
      ctx.moveTo(lm[a].x * canvas.width, lm[a].y * canvas.height);
      ctx.lineTo(lm[b].x * canvas.width, lm[b].y * canvas.height);
      ctx.stroke();
    });

    lm.forEach((p, i) => {
      ctx.beginPath();
      ctx.fillStyle = i === 0 ? "red" : "white";
      ctx.arc(p.x * canvas.width, p.y * canvas.height, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.restore();
  }

  // ---------- Data Normalization ----------
  function flatten(lm) {
    return lm.flatMap((p) => [p.x, p.y, p.z]);
  }

  function normalizeFrame(flat) {
    const pts = [];
    for (let i = 0; i < 63; i += 3)
      pts.push([flat[i], flat[i + 1], flat[i + 2]]);

    const wrist = pts[0];
    const centered = pts.map((p) => [p[0]-wrist[0], p[1]-wrist[1], p[2]-wrist[2]]);

    let maxd = 1e-6;
    centered.forEach((p) => {
      const d = Math.hypot(p[0], p[1], p[2]);
      if (d > maxd) maxd = d;
    });

    return centered.flatMap((p) => [p[0]/maxd, p[1]/maxd, p[2]/maxd]);
  }

  async function captureSequence() {
    const seq = [];
    for (let i = 0; i < FRAME_COUNT; i++) {
      const lm = latestLandmarksRef.current;
      seq.push(
        lm ? normalizeFrame(flatten(lm)) : new Array(63).fill(0)
      );
      await new Promise((r) => setTimeout(r, 33));
    }
    return seq;
  }

  // ---------- Batch Capture ----------
  async function startBatch() {
    if (!gestureName.trim()) return alert("Enter gesture name");

    setCollecting(true);
    setStatus("Batch capturing...");
    setProgress(0);

    for (let i = 1; i <= batchCount; i++) {
      setStatus(`Capturing ${i} / ${batchCount}`);
      setProgress(i / batchCount);

      const seq = await captureSequence();

      const count = await countGestureInDB(gestureName);
      const sample = {
        gesture: gestureName.trim(),
        timestamp: Date.now(),
        frames: seq,
        filename: `${gestureName}_${count + 1}.json`,
      };

      await saveToDB(sample);

      await new Promise((r) => setTimeout(r, 150)); // small delay
    }

    const all = await getAllFromDB();
    setSamplesSaved(all.length);
    setStatus("Batch complete");
    setCollecting(false);

    setTimeout(() => {
      setStatus("Idle");
      setProgress(0);
    }, 600);
  }

  // ---------- ZIP Export ----------
  async function exportZip() {
    const all = await getAllFromDB();
    if (all.length === 0) return alert("No samples stored.");

    const zip = new JSZip();
    const folder = zip.folder("dataset");

    all.forEach((s) => {
      folder.file(s.filename, JSON.stringify(s));
    });

    const blob = await zip.generateAsync({ type: "blob" }, (meta) =>
      setProgress(meta.percent / 100)
    );

    saveAs(blob, `gesture_dataset_${Date.now()}.zip`);
    setProgress(0);
  }

  // ---------- Clear DB ----------
  async function clearAll() {
    if (!confirm("Delete ALL samples?")) return;

    const db = await openDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => {
      db.close();
      setSamplesSaved(0);
      setStatus("Database cleared");
      setTimeout(() => setStatus("Idle"), 800);
    };
  }

  return (
    <div className="w-full min-h-screen bg-gray-50 p-6">
      <h1 className="text-3xl font-bold text-center mb-6">
        Gesture Data Collector
      </h1>

      <div className="flex flex-col lg:flex-row gap-6 justify-center">
        {/* VIDEO FEED */}
        <div className="relative">
          <video
            ref={videoRef}
            className="w-[640px] h-[480px] rounded-lg border shadow -scale-x-100 object-cover"
            autoPlay
            muted
            playsInline
          />
          <canvas
            ref={canvasRef}
            className="absolute top-0 left-0 w-[640px] h-[480px] pointer-events-none -scale-x-100"
          />
          <div className="absolute bottom-3 left-3 bg-black/70 text-white px-3 py-1 rounded">
            {status}
          </div>
          <div className="absolute bottom-3 right-3 bg-white/80 px-3 py-1 rounded text-sm">
            Total samples: <b>{samplesSaved}</b>
          </div>
        </div>

        {/* CONTROLS */}
        <div className="bg-white p-5 rounded-lg shadow max-w-md w-full space-y-4">
          <label>
            <span className="font-semibold">Gesture Name</span>
            <input
              value={gestureName}
              onChange={(e) => setGestureName(e.target.value)}
              placeholder="e.g. thumbs_up"
              className="mt-1 w-full px-3 py-2 border rounded"
            />
          </label>

          <label>
            <span className="font-semibold">Batch Samples</span>
            <input
              type="number"
              value={batchCount}
              min={1}
              max={500}
              onChange={(e) => setBatchCount(Number(e.target.value))}
              className="mt-1 w-32 px-3 py-2 border rounded"
            />
          </label>

          <button
            disabled={collecting}
            onClick={startBatch}
            className="w-full py-2 bg-blue-600 text-white font-semibold rounded disabled:opacity-50"
          >
            Start Batch Capture
          </button>

          {/* Progress */}
          <div>
            <div className="h-3 w-full bg-gray-200 rounded">
              <div
                className="h-3 bg-green-500 rounded"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <div className="text-xs mt-1">{Math.round(progress * 100)}%</div>
          </div>

          <div className="flex gap-3">
            <button
              onClick={exportZip}
              className="flex-1 py-2 bg-indigo-600 text-white rounded"
            >
              Export ZIP
            </button>

            <button
              onClick={clearAll}
              className="py-2 px-3 bg-gray-200 rounded"
            >
              Clear All
            </button>
          </div>

          <div className="text-gray-600 text-sm">
            Tip: Slightly move or rotate your hand between samples for better model performance.
          </div>
        </div>
      </div>
    </div>
  );
}
