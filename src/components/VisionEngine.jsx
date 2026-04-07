import React, { useState, useRef, useEffect } from 'react';
import { Camera } from 'lucide-react';

export default function VisionEngine({ autoStart = 0 }) {
   const [isActive, setIsActive] = useState(false);
   const [isProcessing, setIsProcessing] = useState(false);
   const [isRequesting, setIsRequesting] = useState(false); // true while OS camera dialog is open
   const [facingMode, setFacingMode] = useState('environment'); // 'environment'=back, 'user'=front
   const [encouragement, setEncouragement] = useState('');

   //Rotating positive messages — makes the tool feel empowering, not clinical
   const ENCOURAGEMENTS = [
      'Explorer mode 🚀',
      'Navigating like a pro ✨',
      'Your world, highlighted 💚',
      'Space walk activated 🌌',
      'Clear path ahead 🛤️',
      'You\'ve got this 🔥',
      'Every edge is yours 🧭',
      'Radar vision: ON 🟢',
      'Adventure awaits 🌠',
      'See beyond limits 👁️',
      'Nothing can stop you 💪',
      'World unlocked 🔓',
   ];

   const videoRef = useRef(null);
   const displayCanvasRef = useRef(null);
   const hiddenCanvasRef = useRef(null);
   const animationRef = useRef(null);

   useEffect(() => {
      return () => {
         // Hardware Cleanup: Force camera to turn off immediately on tab switch
         if (animationRef.current) cancelAnimationFrame(animationRef.current);
         if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
         }
      }
   }, []);

   //Watch for external hardware triggers (Voice Assistant)
   //autoStart is a counter that increments each time the user says "turn on camera"
   //Using a counter instead of a boolean so repeated commands always fire
   useEffect(() => {
      if (autoStart > 0 && !isActive) {
         toggleCamera();
      }
   }, [autoStart]);

   const toggleCamera = async () => {
      if (!isActive) {
         setIsActive(true);
         setIsRequesting(true);
         //Pick a fresh encouragement every time the radar fires up
         setEncouragement(ENCOURAGEMENTS[Math.floor(Math.random() * ENCOURAGEMENTS.length)]);
         try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode } });
            setIsRequesting(false);
            if (videoRef.current) {
               videoRef.current.srcObject = stream;
               videoRef.current.onloadedmetadata = () => {
                  videoRef.current.play();
                  setIsProcessing(true);
                  processFeed();
               };
            }
         } catch (e) {
            console.error('Camera failed', e);
            setIsActive(false);
            setIsRequesting(false);
         }
      } else {
         setIsActive(false);
         setIsProcessing(false);
         if (videoRef.current && videoRef.current.srcObject) {
            videoRef.current.srcObject.getTracks().forEach(track => track.stop());
            videoRef.current.srcObject = null;
         }
         if (animationRef.current) cancelAnimationFrame(animationRef.current);
         if (displayCanvasRef.current) {
            const ctx = displayCanvasRef.current.getContext('2d');
            ctx.clearRect(0, 0, displayCanvasRef.current.width, displayCanvasRef.current.height);
         }
      }
   };

   // Flip between front and back camera without losing the radar session
   const flipCamera = async (e) => {
      e.stopPropagation();
      const newFacing = facingMode === 'environment' ? 'user' : 'environment';
      setFacingMode(newFacing);
      if (videoRef.current && videoRef.current.srcObject) {
         videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      setIsProcessing(false);
      setIsRequesting(true);
      try {
         const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: newFacing } });
         setIsRequesting(false);
         if (videoRef.current) {
            videoRef.current.srcObject = stream;
            videoRef.current.onloadedmetadata = () => {
               videoRef.current.play();
               setIsProcessing(true);
               processFeed();
            };
         }
      } catch (err) {
         console.error('Camera flip failed', err);
         setIsRequesting(false);
      }
   };

   const processFeed = () => {
      //The main radar loop thingy
      //We grab the media stream n push it to an invisible canvas
      //Only bc u cant extract raw bytes directly from a video tag
      if (!videoRef.current || !hiddenCanvasRef.current || !displayCanvasRef.current) return;

      const v = videoRef.current;
      if (v.readyState !== v.HAVE_ENOUGH_DATA) {
         //Synchronize local processing dimensions with the hardware feed
      if (displayCanvasRef.current) {
         displayCanvasRef.current.width = 640;
         displayCanvasRef.current.height = 480;
      }
      if (hiddenCanvasRef.current) {
         hiddenCanvasRef.current.width = 640;
         hiddenCanvasRef.current.height = 480;
      }

      animationRef.current = requestAnimationFrame(processFeed);
         return;
      }

      const hiddenCtx = hiddenCanvasRef.current.getContext('2d', { willReadFrequently: true });
      const displayCtx = displayCanvasRef.current.getContext('2d');

      const w = hiddenCanvasRef.current.width;  //640
      const h = hiddenCanvasRef.current.height; //480

      // Dimension matching is handled once during stream initialization
      // to avoid continuous browser re-paints every frame.
      hiddenCtx.drawImage(v, 0, 0, w, h);
      const frame = hiddenCtx.getImageData(0, 0, w, h);
      const data = frame.data;

      const output = displayCtx.createImageData(w, h);
      const outData = output.data;

      // Edge sensitivity threshold: Calibrated at 35 to filter out 
      // ISO sensor noise in low-light environments while maintaining 
      // the structural integrity of physical boundaries (door-frames/steps).
      const threshold = 35; 

      //Analyzing the exact rgb pixels to find edges
      //I used a first-order finite difference gradient — derived from the same
      //The principle as the Sobel operator (luminosity rate-of-change between neighbors)
      //However, optimized to check only 2 neighbors (right + below) instead of a full
      //3x3 kernel, cutting lookups by ~75% for mobile CPU performance.
      //Tradeoff; diagonal edges slightly less crisp. Acceptable for hazard detection.
      for (let y = 0; y < h; y++) {
         for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;

            //Calc grayscale values
            const lC = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;

            let lR = lC;
            if (x < w - 1) {
               const iR = (y * w + (x + 1)) * 4;
               lR = data[iR] * 0.299 + data[iR + 1] * 0.587 + data[iR + 2] * 0.114;
            }

            let lB = lC;
            if (y < h - 1) {
               const iB = ((y + 1) * w + x) * 4;
               lB = data[iB] * 0.299 + data[iB + 1] * 0.587 + data[iB + 2] * 0.114;
            }

            //Absolute differential math - if difference is huge = its an edge
            const diff = Math.abs(lC - lR) + Math.abs(lC - lB);

            if (diff > threshold) {
               //Neon Green Edge
               outData[i] = 57;
               outData[i + 1] = 255;
               outData[i + 2] = 20;
               outData[i + 3] = 255;
            } else {
               //Pitch Black Void
               outData[i] = 0;
               outData[i + 1] = 0;
               outData[i + 2] = 0;
               outData[i + 3] = 255;
            }
         }
      }

      displayCtx.putImageData(output, 0, 0);

      animationRef.current = requestAnimationFrame(processFeed);
   };

   return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }} aria-live="polite">
         <section
            className="bento-card"
            onClick={toggleCamera}
            style={{ 
              cursor: 'pointer', 
              minHeight: '600px', 
              display: 'flex', 
              flexDirection: 'column', 
              justifyContent: 'center', 
              position: 'relative', 
              padding: 0,
              backgroundColor: '#000',
              overflow: 'visible' 
            }}
            role="button"
            aria-label={isActive ? "Vision Radar is currently Active. Tap anywhere to turn it off." : "Vision Radar is Offline. Tap anywhere on the screen to engage the hardware camera."}
         >

            <video ref={videoRef} playsInline muted style={{ display: 'none' }}></video>
            <canvas ref={hiddenCanvasRef} width={640} height={480} style={{ display: 'none' }} />

            {/* Massive Background Canvas */}
            <canvas ref={displayCanvasRef} style={{ width: '100%', height: '100%', objectFit: 'contain', position: 'absolute', inset: 0, opacity: isActive ? 1 : 0.1, transition: 'opacity 0.5s' }} />

            {!isActive && (
               <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: '24px', alignItems: 'center', justifyContent: 'center', zIndex: 10 }}>
                  <Camera size={120} opacity={0.7} color="var(--text-primary)" />
                  <h2 style={{ fontSize: '32px', color: 'var(--text-primary)', textAlign: 'center' }}>TAP ANYWHERE TO START</h2>
                  <p style={{ fontSize: '18px', color: 'var(--text-secondary)', maxWidth: '400px', textAlign: 'center' }}>
                     This screen acts as a massive button. Tap anywhere to instantly pull raw optic data and calculate physical hazards.
                  </p>
               </div>
            )}

            {/* Loading overlay during OS camera permission dialog */}
            {isRequesting && !isProcessing && (
               <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', gap: '16px', alignItems: 'center', justifyContent: 'center', zIndex: 10, background: 'rgba(0,0,0,0.7)' }}>
                  <div style={{ width: 48, height: 48, border: '4px solid #39FF14', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                  <p style={{ color: '#39FF14', fontSize: '18px', fontWeight: 'bold' }}>Requesting Camera Access...</p>
                  <p style={{ color: '#aaa', fontSize: '14px' }}>Please approve the browser permission prompt</p>
               </div>
            )}

            {isProcessing && (
               <>
                  <div style={{ position: 'absolute', top: 32, right: 32, background: 'rgba(0,0,0,0.8)', padding: '12px 24px', borderRadius: '99px', border: '2px solid #39FF14', color: '#39FF14', fontSize: '18px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '12px', animation: 'pulse 2s infinite alternate', zIndex: 10 }}>
                     <span style={{ width: 16, height: 16, background: '#39FF14', borderRadius: '50%' }}></span> LIVE — RADAR ACTIVE
                  </div>
                  {/* Encouragement badge — makes the experience feel fun & empowering */}
                  <div style={{
                     position: 'absolute', top: 32, left: 32,
                     background: 'rgba(0,0,0,0.7)',
                     padding: '10px 20px', borderRadius: '99px',
                     border: '1px solid rgba(57, 255, 20, 0.3)',
                     color: '#E2E8F0', fontSize: '15px', fontWeight: '600',
                     zIndex: 10, backdropFilter: 'blur(10px)',
                     animation: 'fadeUp 0.6s ease'
                  }}>
                     {encouragement}
                  </div>
               </>
            )}

            {/* Flip Camera Button — shown only when radar is active */}
            {isActive && (
               <button
                  onClick={flipCamera}
                  style={{
                     position: 'absolute', bottom: 24, right: 24,
                     background: 'rgba(0,0,0,0.75)', border: '2px solid rgba(255,255,255,0.3)',
                     borderRadius: '50%', width: 56, height: 56,
                     display: 'flex', alignItems: 'center', justifyContent: 'center',
                     cursor: 'pointer', zIndex: 20, color: '#fff', fontSize: '24px',
                     backdropFilter: 'blur(10px)'
                  }}
                  aria-label="Flip Camera"
                  title="Flip Camera"
               >
                  🔄
               </button>
            )}
         </section>
      </div>
   );
}
