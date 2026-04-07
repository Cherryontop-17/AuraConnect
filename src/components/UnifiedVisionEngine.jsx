import React, { useState, useRef, useEffect } from 'react';
import { Camera, ShieldAlert, Type, Smile, Activity } from 'lucide-react';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { FilesetResolver, FaceLandmarker, DrawingUtils } from '@mediapipe/tasks-vision';
import '@tensorflow/tfjs';
import Tesseract from 'tesseract.js';

// --- MATH HELPERS ---
const rgbToHsl = (r, g, b) => {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s * 100, l * 100];
};

const getHslColorName = (h, s, l) => {
  if (l < 15) return 'Black'; 
  if (l > 85) return 'White'; 
  if (s < 18) return 'Gray';
  
  // Snap strictly to Primary and Base Secondary colors as requested.
  // We widen the angles to forcefully absorb intermediate colors into the Primary buckets.
  if (h >= 0 && h < 30) return 'Red'; 
  if (h >= 30 && h < 50) return 'Orange';
  if (h >= 50 && h < 80) return 'Yellow'; 
  if (h >= 80 && h < 170) return 'Green'; 
  if (h >= 170 && h < 260) return 'Blue'; 
  if (h >= 260 && h < 320) return 'Purple'; 
  if (h >= 320 && h <= 360) return 'Red'; 
  
  return 'Blue'; // fallback
};

export default function UnifiedVisionEngine() {
  const [isActive, setIsActive] = useState(false);
  const [activeMode, setActiveMode] = useState('NONE'); // NONE, RADAR, MOTOR
  
  // States
  const [predictions, setPredictions] = useState([]);
  const [ocrText, setOcrText] = useState('');
  const [expression, setExpression] = useState('Standby...');
  const [actionHistory, setActionHistory] = useState([]);
  const [systemLogs, setSystemLogs] = useState([]);
  const [speakCommand, setSpeakCommand] = useState(null);

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  
  const objectModelRef = useRef(null);
  const landmarkerRef = useRef(null);
  const drawingUtilsRef = useRef(null);
  const animationRef = useRef(null);
  const activeModeRef = useRef('NONE');
  
  const lastVideoTimeRef = useRef(-1);
  const lastActionTimeRef = useRef(0);
  const mediaPipeTimestampRef = useRef(0);

  useEffect(() => {
      activeModeRef.current = activeMode;
  }, [activeMode]);

  const addLog = (msg) => setSystemLogs(prev => [msg, ...prev].slice(0, 5));

  useEffect(() => {
    const initModels = async () => {
       try {
         objectModelRef.current = await cocoSsd.load();
         addLog("COCO-SSD Geometry Map pre-loaded.");
       } catch(e) {
         addLog("ERROR: COCO-SSD Failed - " + e.message);
       }
       try {
         const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm");
         landmarkerRef.current = await FaceLandmarker.createFromOptions(vision, {
           baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task", delegate: "CPU" },
           outputFaceBlendshapes: true, runningMode: "VIDEO", numFaces: 1
         });
         addLog("MediaPipe Neural Tracker pre-loaded.");
       } catch(e) {
         addLog("ERROR: MediaPipe Failed - " + e.message);
       }
    };
    initModels();
    
    return () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        document.body.classList.remove('sos-strobe');
    }
  }, []);

  useEffect(() => {
    if (speakCommand && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const msg = new SpeechSynthesisUtterance(speakCommand);
      msg.rate = 1.05;
      window.speechSynthesis.speak(msg);
      setSpeakCommand(null);
    }
  }, [speakCommand]);

  const toggleCamera = async () => {
    if (!isActive) {
      setIsActive(true);
      addLog("Initializing Hardware Optics...");
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = () => {
              videoRef.current.play();
              runPipeline();
          };
        }
        streamRef.current = stream;
      } catch (e) {
        addLog("Critical Failure: Webcam Disconnected.");
        setIsActive(false);
      }
    } else {
      setActiveMode('NONE');
      setIsActive(false);
      addLog("Hardware Optics Disconnected.");
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      document.body.classList.remove('sos-strobe');
    }
  };

  const runPipeline = () => {
      const video = videoRef.current;
      if (!video || !isActive) return;

      if (video.currentTime !== lastVideoTimeRef.current) {
          lastVideoTimeRef.current = video.currentTime;
          
          const canvas = canvasRef.current;
          // FIX: Use activeModeRef.current to bypass the React stale closure bug
          if (activeModeRef.current === 'MOTOR' && landmarkerRef.current) {
              try {
                  // C++ WASM strictly requires perfectly ascending integers. performance.now() floats crash the tensor.
                  let nowMs = Math.round(performance.now());
                  if (nowMs <= mediaPipeTimestampRef.current) nowMs = mediaPipeTimestampRef.current + 1;
                  mediaPipeTimestampRef.current = nowMs;

                  const results = landmarkerRef.current.detectForVideo(video, nowMs);
                  processMotorLandmarks(results);
                  drawFaceLandmarks(video, results);
              } catch(e) {
                  if (!systemLogs.includes("ENGINE CRASH: " + e.message)) {
                      addLog("ENGINE CRASH: " + e.message);
                  }
              }
          } else if (canvas) {
              // Clear the tracking overlay if we switch out of motor modes
              const ctx = canvas.getContext('2d');
              ctx.clearRect(0, 0, canvas.width, canvas.height);
          }
      }
      if (isActive) animationRef.current = requestAnimationFrame(runPipeline);
  };

  const drawFaceLandmarks = (video, results) => {
     const canvas = canvasRef.current;
     if (!canvas || !results.faceLandmarks) return;
     
     // Match canvas size to video dimensions to perfectly align the neural mesh overlay
     if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
     if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;
     
     const ctx = canvas.getContext('2d');
     ctx.clearRect(0, 0, canvas.width, canvas.height);
     
     if (!drawingUtilsRef.current) drawingUtilsRef.current = new DrawingUtils(ctx);

     if (results.faceLandmarks.length > 0) {
        for (const landmarks of results.faceLandmarks) {
           drawingUtilsRef.current.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, { color: "rgba(0,255,255,0.3)", lineWidth: 1 });
           drawingUtilsRef.current.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, { color: "rgba(52, 199, 89, 0.8)", lineWidth: 2 });
           drawingUtilsRef.current.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, { color: "rgba(52, 199, 89, 0.8)", lineWidth: 2 });
           drawingUtilsRef.current.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, { color: "rgba(255, 55, 95, 0.8)", lineWidth: 2 });
        }
     }
  };

  const logAction = (action) => {
      const now = Date.now();
      if (now - lastActionTimeRef.current > 3000) {
          lastActionTimeRef.current = now;
          setActionHistory(prev => [{ id: now, text: action }, ...prev].slice(0, 5));
          setSpeakCommand(action.includes('SOS') ? "Emergency SOS triggered!" : action.includes('CONFIRM') ? "Action confirmed." : "Navigating.");
      }
  };

  const processMotorLandmarks = (results) => {
      if (results && results.faceBlendshapes && results.faceBlendshapes.length > 0) {
          const shapes = results.faceBlendshapes[0].categories;
          
          const smileLeft = shapes.find(s => s.categoryName === 'mouthSmileLeft')?.score || 0;
          const smileRight = shapes.find(s => s.categoryName === 'mouthSmileRight')?.score || 0;
          const jawOpen = shapes.find(s => s.categoryName === 'jawOpen')?.score || 0;
          const eyeBlinkLeft = shapes.find(s => s.categoryName === 'eyeBlinkLeft')?.score || 0;
          const eyeBlinkRight = shapes.find(s => s.categoryName === 'eyeBlinkRight')?.score || 0;
          
          const isSmiling = (smileLeft + smileRight) > 0.40; 
          const isJawOpen = jawOpen > 0.15;
          const isBlinking = eyeBlinkLeft > 0.35 && eyeBlinkRight > 0.35;
          
          if (isJawOpen) {
              setExpression("JAW OPEN [HAZARD]");
              document.body.classList.add('sos-strobe');
              if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); // SOS Haptics
              logAction("⚠️ EMERGENCY SOS");
          } else if (isSmiling) {
              setExpression("SMILE [CONFIRM]");
              document.body.classList.remove('sos-strobe');
              logAction("✅ CONFIRMATION");
          } else if (isBlinking) {
              setExpression("BLINK [NAV]");
              document.body.classList.remove('sos-strobe');
              logAction("➡️ NEXT ITEM");
          } else {
              setExpression("NEUTRAL SCANNING...");
              document.body.classList.remove('sos-strobe');
          }
      }
  };

  const extractDominantColor = (ctx, boxX, boxY, boxW, boxH) => {
    const cropX = Math.floor(boxX + (boxW * 0.15)); 
    const cropY = Math.floor(boxY + (boxH * 0.25)); 
    const cropW = Math.max(1, Math.floor(boxW * 0.7)); 
    const cropH = Math.max(1, Math.floor(boxH * 0.5)); 

    let imgData;
    try { imgData = ctx.getImageData(cropX, cropY, cropW, cropH).data; } catch(e) { return null; }

    // MATHEMATICS FIX: Use a Tallying System ("Mode") instead of an Average ("Mean")
    // This prevents the "Cyan" bug caused by averaging 350 and 10 on a color wheel.
    const colorCounts = {};

    // Stride tightly (every 4 pixels) so we don't accidentally jump over the entire shirt
    for (let i = 0; i < imgData.length; i += 16) {
      const r = imgData[i], g = imgData[i + 1], b = imgData[i + 2];
      if (r < 40 && g < 40 && b < 40) continue; 
      if (r > 200 && g > 200 && b > 200) continue;
      
      const [ph, ps, pl] = rgbToHsl(r, g, b);
      if (pl > 20 && pl < 85 && ps > 20) {
          const cName = getHslColorName(ph, ps, pl);
          colorCounts[cName] = (colorCounts[cName] || 0) + 1;
      }
    }
    
    let dominantName = 'Black/White/Gray';
    let maxCount = 0;
    for (const [name, count] of Object.entries(colorCounts)) {
       if (count > maxCount) {
          maxCount = count;
          dominantName = name;
       }
    }
    return dominantName;
  };

  const analyzeScene = async () => {
    if (!videoRef.current || !isActive || !canvasRef.current) return;
    setActiveMode('RADAR');
    addLog("Executing Object Inference Calculus...");
    try {
      const vWidth = videoRef.current.videoWidth;
      const vHeight = videoRef.current.videoHeight;
      const canvas = canvasRef.current;
      canvas.width = vWidth; canvas.height = vHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(videoRef.current, 0, 0, vWidth, vHeight);

      const results = await objectModelRef.current.detect(videoRef.current, 5, 0.4);
      
      const enhancedResults = results.map(r => {
        const areaRatio = (r.bbox[2] * r.bbox[3]) / (vWidth * vHeight);
        const proximity = areaRatio > 0.5 ? 'Very Close' : areaRatio > 0.15 ? 'Near' : 'Distant';
        const position = (r.bbox[0] + r.bbox[2]/2) < vWidth*0.33 ? 'Left' : (r.bbox[0] + r.bbox[2]/2) > vWidth*0.66 ? 'Right' : 'Center';
        let dominantColor = null;
        if (r.class === 'person' && proximity !== 'Distant') {
          dominantColor = extractDominantColor(ctx, r.bbox[0], r.bbox[1], r.bbox[2], r.bbox[3]);
        }
        return { ...r, position, proximity, dominantColor };
      });

      setPredictions(enhancedResults);
      if (enhancedResults.length > 0) {
        const top = enhancedResults[0];
        let p = `${top.class} ${top.position}, ${top.proximity}`;
        if (top.class === 'person' && top.dominantColor) p = `${top.proximity} person ${top.position} wearing ${top.dominantColor}`;
        setSpeakCommand(p);
      } else {
        setSpeakCommand("No objects detected.");
      }
      addLog("Radar Scan Complete.");
      setActiveMode('NONE');
    } catch(e) { setActiveMode('NONE'); }
  };

  const runOCR = async () => {
    if (!videoRef.current || !isActive) return;
    setActiveMode('OCR');
    setOcrText('');
    addLog("Applying Neural Upscaling Filter...");

    const vWidth = videoRef.current.videoWidth;
    const vHeight = videoRef.current.videoHeight;
    
    // Create an isolated canvas buffer specifically for Tesseract to scale onto
    const bufferCanvas = document.createElement('canvas');
    bufferCanvas.width = vWidth * 2; // Exact 2x Upscale
    bufferCanvas.height = vHeight * 2;
    const ctx = bufferCanvas.getContext('2d');
    
    // Draw the native raw video directly to the upscaled buffer
    ctx.drawImage(videoRef.current, 0, 0, bufferCanvas.width, bufferCanvas.height);

    const base64ImageData = bufferCanvas.toDataURL('image/png', 1.0);
    try {
      const result = await Tesseract.recognize(base64ImageData, 'eng');
      const cleanText = result.data.text ? result.data.text.replace(/[^a-zA-Z0-9.,?! ]/g, '').trim() : "";
      if (!cleanText) {
        setOcrText("No text detected.");
        setSpeakCommand("No text detected.");
      } else {
        setOcrText(cleanText);
        setSpeakCommand(`Text identified: ${cleanText}`);
      }
      addLog("OCR Neural Read Successful.");
    } catch (err) {
      setOcrText("OCR Processing Failed.");
      addLog("ERROR: API Blocked by Network.");
    }
    setActiveMode('NONE');
  };

  return (
    <div className="bento-grid">
      <div className="bento-card">
         <h2 className="bento-header"><ShieldAlert size={16}/> Live Diagnostics</h2>
         <div className="diagnostic-log">
           {systemLogs.map((l, i) => <div key={i} className="log-line">{l}</div>)}
           {systemLogs.length === 0 && <span style={{opacity: 0.5}}>Standby...</span>}
         </div>

         {predictions.length > 0 && (
           <div style={{marginTop: '16px', display: 'flex', flexDirection: 'column', gap: '12px'}}>
             <h2 className="bento-header">Spatial Radar</h2>
             {predictions.map((p, i) => (
                <div key={i} className="premium-radar-item">
                  <span className="radar-title">{p.class}</span>
                  <span className="radar-subtitle">{p.proximity} • {p.position}</span>
                  {p.dominantColor && <span className="premium-badge">{p.dominantColor}</span>}
                </div>
             ))}
           </div>
         )}
      </div>

      <div className="bento-card primary" style={{padding: '0', overflow: 'hidden'}}>
         <div className="camera-container">
             {/* Subtle focal brackets instead of HUD crosshairs */}
             {isActive && activeMode === 'NONE' && (
                 <>
                     <div className="focal-bracket focal-tl"></div>
                     <div className="focal-bracket focal-tr"></div>
                     <div className="focal-bracket focal-bl"></div>
                     <div className="focal-bracket focal-br"></div>
                 </>
             )}
             
             <video ref={videoRef} playsInline muted className="camera-lens"></video>
             <canvas ref={canvasRef} className="camera-mesh" />
             
             {!isActive && (
               <div className="offline-blur">
                  <Camera size={48} opacity={0.5} />
                  <h3>Optics Offline</h3>
                  <p>Hardware lens disconnected.</p>
               </div>
             )}

             <div className="glass-controls">
                <button onClick={toggleCamera} className={`premium-btn ${isActive ? 'action-danger' : 'action-success'}`}>
                  <Camera size={16} /> {isActive ? 'Cut Feed' : 'Init Camera'}
                </button>
                <button onClick={analyzeScene} disabled={!isActive || activeMode !== 'NONE'} className="premium-btn action-primary">
                  <ShieldAlert size={16} /> Geometry Radar
                </button>
                <button onClick={runOCR} disabled={!isActive || activeMode !== 'NONE'} className="premium-btn action-warning">
                  <Type size={16} /> Scan Text
                </button>
                <button onClick={() => setActiveMode(activeMode === 'MOTOR' ? 'NONE' : 'MOTOR')} disabled={!isActive} className={`premium-btn ${activeMode === 'MOTOR' ? 'action-success' : 'action-primary'}`}>
                  {activeMode === 'MOTOR' && <span className="status-ring"></span>}
                  <Smile size={16} /> Neural Link
                </button>
             </div>
         </div>
      </div>

      <div className="bento-card">
         <h2 className="bento-header"><Activity size={16}/> Telemetry State</h2>
         
         <div className="neural-status-indicator">
             <span className={`status-pill ${expression.includes('HAZARD') ? 'hazard' : expression.includes('CONFIRM') ? 'success' : ''}`}>
                {expression}
             </span>
         </div>

         <h2 className="bento-header" style={{marginTop: '8px'}}>Neural History</h2>
         <div className="diagnostic-log" style={{minHeight: '120px', flexGrow: 0}}>
             {actionHistory.map(a => (
                <div key={a.id} className="log-line">{a.text}</div>
             ))}
         </div>

         {ocrText && (
           <div style={{marginTop: '16px'}}>
             <h2 className="bento-header" style={{marginBottom: '12px'}}>Extracted Text</h2>
             <div className="premium-ocr-box">"{ocrText}"</div>
           </div>
         )}
      </div>
    </div>
  );
}
