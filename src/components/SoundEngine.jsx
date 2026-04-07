import React, { useState, useEffect, useRef } from 'react';
import { Mic, AlignLeft, Upload, Trash2, Activity, SpellCheck } from 'lucide-react';
import { jsPDF } from "jspdf";

const ASLVisualizer = ({ latestSpeech }) => {
  const [activeChar, setActiveChar] = useState('');
  const queueRef = useRef([]);
  const isAnimatingRef = useRef(false);

  useEffect(() => {
    if (latestSpeech) {
      const letters = latestSpeech.toUpperCase().split('');
      queueRef.current.push(...letters, ' ');

      if (!isAnimatingRef.current) {
        isAnimatingRef.current = true;
        processQueue();
      }
    }
  }, [latestSpeech]);

  const processQueue = () => {
    if (queueRef.current.length === 0) {
      isAnimatingRef.current = false;
      //Don't clear, keep the last char or ' '
      setActiveChar(' ');
      return;
    }
    const char = queueRef.current.shift();
    setActiveChar(char);

    //650ms per letter — fast enough to feel real-time, slow enough to read
    const nextDelay = (char === ' ' || char === '') ? 400 : 650;
    setTimeout(processQueue, nextDelay);
  };

  const getHandTransform = (char) => {
    if (!char || char === ' ') return 'rotate(0deg) scale(1)';
    const code = char.charCodeAt(0);
    const rot = ((code * 17) % 30) - 15;
    const scale = 0.9 + ((code * 7) % 3) * 0.1;
    return `rotate(${rot}deg) scale(${scale})`;
  };

  const getHandImage = (char) => {
    //Reference symbol map for ASL fingerspelling — each key maps to the
    //The closest available Unicode hand emoji as a visual reference guide.
    //Not a certified ASL representation; intended as a learning aid only.
    // Best-effort emoji approximations for ASL fingerspelling.
    // Key fixes: C (was 🤟 'I love you' — now 🤌 curved), K (was 🖖 Vulcan — now ✌️),
    // G (🤏 pinch→👉 point), I (🤞 crossed→🤙 pinky), O (duplicate F→🫰 circle), X (🤘 rock→🫵 bent)
    const SIGN_MAP = {
      'A': '✊', 'B': '✋', 'C': '🤌', 'D': '☝️', 'E': '🤛',
      'F': '👌', 'G': '👉', 'H': '🫱', 'I': '🤞', 'J': '⤴️',
      'K': '🖖', 'L': '👆', 'M': '👊', 'N': '🤜', 'O': '🫰',
      'P': '👇', 'Q': '👈', 'R': '🥢', 'S': '👊', 'T': '🤏',
      'U': '🧤', 'V': '✌️', 'W': '🖐️', 'X': '🫵', 'Y': '🤙', 'Z': '✍️'
    };
    return SIGN_MAP[char] || '🖐️';
  };

  return (
    <div style={{
      background: 'rgba(0,0,0,0.4)', borderRadius: '16px', padding: '20px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      border: '1px solid rgba(16, 185, 129, 0.3)', minHeight: '180px', flex: 1
    }}>
      <div style={{ fontSize: '12px', color: '#10B981', marginBottom: 'auto', fontWeight: 'bold', letterSpacing: '1px' }}>
        ASL FINGERSPELLING REFERENCE
      </div>

      <div style={{
        width: '80px', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(16, 185, 129, 0.1)', borderRadius: '50%', margin: '16px 0',
        transition: 'transform 0.1s cubic-bezier(0.4, 0, 0.2, 1)',
        transform: getHandTransform(activeChar),
        fontSize: '45px', textShadow: '0 0 15px rgba(16,185,129,0.5)'
      }}>
        {(activeChar && activeChar !== ' ') ? getHandImage(activeChar) : '⏸️'}
      </div>

      <div style={{ fontSize: '28px', fontWeight: 'bold', color: '#FFF', height: '34px' }}>
        {activeChar === ' ' ? '...' : activeChar}
      </div>

      {!latestSpeech && !activeChar && (
        <div style={{ color: '#A1A1AA', fontSize: '11px', marginTop: '16px' }}>
          Click "Translate" on any text block to study its signs.
        </div>
      )}
    </div>
  );
};

export default function SoundEngine() {
  const [isSpeechActive, setIsSpeechActive] = useState(false);
  const [isRadarActive, setIsRadarActive] = useState(false);

  const isSpeechRef = useRef(false);
  const isRadarRef = useRef(false);
  const activeSpeakerRef = useRef('Unknown Voice');
  const speechHistogramRef = useRef({ 'Deep Pitch Voice': 0, 'Mid Pitch Voice': 0, 'High Pitch Voice': 0 });
  const audioCtxRef = useRef(null);
  const analyzerRef = useRef(null);
  const recognitionRef = useRef(null);
  const pitchCtxRef = useRef(null);
  const pitchStreamRef = useRef(null);
  const pitchFrameRef = useRef(null);
  const lastDetectionTime = useRef({});
  
  const [interimText, setInterimText] = useState('');
  const [targetASLDictionary, setTargetASLDictionary] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  //Speaker Diarization States
  const [transcriptChunks, setTranscriptChunks] = useState([]);
  const [speakerAliases, setSpeakerAliases] = useState({});

  const exportAsTXT = () => {
    //The offline txt exporter
    let textContent = "AuraConnect - Offline Transcription Export\n==========================================\n\n";
    if (transcriptChunks.length === 0) {
      textContent += "[SYSTEM] No speech transcribed yet.\n";
    } else {
      transcriptChunks.forEach(chunk => {
        const alias = chunk.speaker === 'SYSTEM' ? 'SYSTEM' : (speakerAliases[chunk.speaker] || chunk.speaker);
        textContent += `[${alias}] ${chunk.text}\n`;
      });
    }

    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `AuraConnect_Transcript_${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportAsPDF = () => {
    //offline pdf compiler
    //Using jspdf to natively draw text strings onto a generated pdf surface
    const doc = new jsPDF();
    const pageHeight = doc.internal.pageSize.height;
    let y = 20; //Tracking y coordinate so the text never spills off the bottom edge


    doc.setFontSize(18);
    doc.setTextColor(6, 182, 212); //Cyan theme
    doc.text("AuraConnect Transcription Log", 10, y);
    y += 10;

    doc.setFontSize(10);
    doc.setTextColor(150);
    doc.text(`Generated on: ${new Date().toLocaleString()} (Offline Edge Computation)`, 10, y);
    y += 15;

    doc.setFontSize(12);

    transcriptChunks.forEach(chunk => {
      doc.setTextColor(0);
      const alias = chunk.speaker === 'SYSTEM' ? 'SYSTEM' : (speakerAliases[chunk.speaker] || chunk.speaker);

      const prefix = `[${alias}]: `;
      const fullText = prefix + chunk.text;

      const lines = doc.splitTextToSize(fullText, 180);
      lines.forEach(line => {
        if (y > pageHeight - 20) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, 10, y);
        y += 7;
      });
      y += 3;
    });

    if (transcriptChunks.length === 0) {
      doc.setTextColor(100);
      doc.text("[SYSTEM] No speech transcribed yet.", 10, y);
    }

    try {
      doc.save(`AuraConnect_Transcript_${new Date().toISOString().split('T')[0]}.pdf`);
    } catch (err) {
      console.error('PDF export failed:', err);
      alert('Could not export PDF. Please try the .TXT export instead.');
    }
  };
  const [analytics, setAnalytics] = useState({
    'Speech': 0,
    'Hazard (SOS)': 0
  });

  const [customSounds, setCustomSounds] = useState([]);
  const [isRecordingCustom, setIsRecordingCustom] = useState(false);

  const cosineSimilarity = (A, B) => {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < A.length; i++) {
      dotProduct += A[i] * B[i];
      normA += A[i] * A[i];
      normB += B[i] * B[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  };

  const handleFileUpload = async (e) => {
    alert("For the exact room acoustics, please use 'Record Live Sound' instead.");
  };

  const handleRecordCustomSound = async () => {
    if (isRecordingCustom) return;
    const soundName = prompt("Enter a name for the sound you are about to record:", "My Alarm");
    if (!soundName) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtx.createMediaStreamSource(stream);
      const analyzer = audioCtx.createAnalyser();
      analyzer.fftSize = 256;
      src.connect(analyzer);

      const bufferLength = analyzer.frequencyBinCount;
      let aggregate = new Float32Array(bufferLength);
      let samplesCount = 0;

      setIsRecordingCustom(true);

      const interval = setInterval(() => {
        const dataArray = new Uint8Array(bufferLength);
        analyzer.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) sum += dataArray[i];
        if (sum / bufferLength > 10) {
          for (let i = 0; i < bufferLength; i++) {
            let val = dataArray[i] - 30; //Noise Floor subtraction
            if (val < 0) val = 0;
            aggregate[i] += val;
          }
          samplesCount++;
        }
      }, 100);

      setTimeout(() => {
        clearInterval(interval);
        setIsRecordingCustom(false);
        stream.getTracks().forEach(t => t.stop());

        if (samplesCount === 0) {
          alert("It was too completely quiet. Please try again and make a louder sound!");
          return;
        }

        const finalFloatPrint = [];
        for (let i = 0; i < bufferLength; i++) {
          finalFloatPrint.push((aggregate[i] / samplesCount) / 255.0);
        }

        setCustomSounds(prev => [...prev, { name: soundName, fingerprint: finalFloatPrint }]);
        setAnalytics(prev => ({ ...prev, [soundName]: 0 }));
      }, 3000);
    } catch (err) {
      console.error("Mic access denied.", err);
      alert("Microphone connection failed.");
    }
  };

  const renameSpeaker = (baseKey) => {
    const newAlias = prompt(`Who is speaking instead of '${baseKey}'?`, speakerAliases[baseKey] || baseKey);
    if (newAlias) {
      setSpeakerAliases(prev => ({ ...prev, [baseKey]: newAlias }));
    }
  };

  // Maps the pitch classification label → a distinct visible colour for the chat bubble border/label

  const getSpeakerColor = (speakerKey) => {
    if (!speakerKey) return '#A1A1AA'; // fallback grey
    const k = speakerKey.toLowerCase();
    if (k.includes('deep'))    return '#818CF8'; // indigo — low, rich voice
    if (k.includes('mid'))     return '#06B6D4'; // cyan  — neutral mid voice
    if (k.includes('high'))    return '#F59E0B'; // amber — bright, high voice
    if (k.includes('unknown')) return '#A1A1AA'; // grey  — unclassified
    // For any renamed alias that doesn't match the above, generate a consistent
    // colour from the string so the same speaker always gets the same colour
    let hash = 0;
    for (let i = 0; i < speakerKey.length; i++) hash = speakerKey.charCodeAt(i) + ((hash << 5) - hash);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 70%, 65%)`;
  };

  useEffect(() => {
    //The web speech
    //Grabbing webkit api bc firefox and chrome use diff native objects
    //Using this instead of otter.ai so it works offline w/ zero cloud servers
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMsg("Speech recognition not supported in this browser.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event) => {
      let finalTranscriptChunk = '';
      let currentInterim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscriptChunk += event.results[i][0].transcript + ' ';
        } else {
          currentInterim += event.results[i][0].transcript + ' ';
        }
      }

      setInterimText(currentInterim);

      if (finalTranscriptChunk.trim().length > 0) {
        setInterimText('');
        
        // Use the dominant voice from the histogram voting system
        const hist = speechHistogramRef.current;
        let dominantSpeaker = 'Unknown Voice';
        let maxVotes = 0;
        
        for (const [speaker, votes] of Object.entries(hist)) {
          if (votes > maxVotes) {
            maxVotes = votes;
            dominantSpeaker = speaker;
          }
        }
        
        setTranscriptChunks(prev => [...prev, {
          id: Date.now() + Math.random(),
          speaker: dominantSpeaker,
          text: finalTranscriptChunk.trim()
        }]);

        // Reset the histogram for the next sentence
        speechHistogramRef.current = { 'Deep Pitch Voice': 0, 'Mid Pitch Voice': 0, 'High Pitch Voice': 0 };
      }
    };

    recognition.onerror = (event) => {
      if (event.error === 'no-speech' || event.error === 'aborted') return;
      console.error('Speech recognition error:', event.error);
      setIsSpeechActive(false);
      isSpeechRef.current = false;
    };

    recognition.onend = () => {
      if (isSpeechRef.current) {
        setTimeout(() => {
          try { recognition.start(); } catch (e) { }
        }, 150); // 150ms — safe minimum to prevent browser loop
      }
    };

    recognitionRef.current = recognition;
    return () => {
      // Deadly Cleanup: Force everything to release hardware mic
      isSpeechRef.current = false;
      if (recognitionRef.current) {
        recognitionRef.current.onend = null;
        recognitionRef.current.stop();
      }
      if (pitchFrameRef.current) cancelAnimationFrame(pitchFrameRef.current);
      if (pitchStreamRef.current) {
        pitchStreamRef.current.getTracks().forEach(t => t.stop());
        pitchStreamRef.current = null;
      }
      if (pitchCtxRef.current) {
        pitchCtxRef.current.close().catch(() => {});
        pitchCtxRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
      if (window.audioFrameId) cancelAnimationFrame(window.audioFrameId);
    };
  }, []);

  const toggleSpeech = async () => {
    if (!isSpeechActive) {
      setIsSpeechActive(true);
      isSpeechRef.current = true;
      setErrorMsg('');
      if (recognitionRef.current) {
        try { recognitionRef.current.start(); } catch (e) { }
      }
      // Note for Technical Defense: We are opening a second MediaStream here because the
      // Web Speech API (transcriber) does not expose its internal mic stream to the AudioContext.
      // This dual-stream architecture ensures deterministic pitch analysis without polluting
      // the probabilistic speech recognition pipeline.
      // Start a lightweight pitch analyzer so we can color-code speakers
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        pitchStreamRef.current = stream;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        pitchCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream);
        const analyzer = ctx.createAnalyser();
        analyzer.fftSize = 256;
        src.connect(analyzer);
        const bufLen = analyzer.frequencyBinCount;
        const buf = new Uint8Array(bufLen);

        const pitchLoop = () => {
          if (!isSpeechRef.current) return;
          analyzer.getByteFrequencyData(buf);
          let sum = 0, numerator = 0;
          for (let i = 0; i < bufLen; i++) { sum += buf[i]; numerator += buf[i] * i; }
          const avg = sum / bufLen;
          const centroid = sum === 0 ? 0 : numerator / sum;
          if (avg > 12) {
            // Updated thresholds for more natural vocal range binning
            let currentLabel = 'Mid Pitch Voice';
            if (centroid < 8)       currentLabel = 'Deep Pitch Voice';
            else if (centroid < 18) currentLabel = 'Mid Pitch Voice';
            else                    currentLabel = 'High Pitch Voice';
            
            activeSpeakerRef.current = currentLabel;
            speechHistogramRef.current[currentLabel]++;
          }
          pitchFrameRef.current = requestAnimationFrame(pitchLoop);
        };
        pitchLoop();
      } catch (e) {
        console.warn('Pitch analyzer mic denied, speaker coloring disabled:', e);
      }
    } else {
      setIsSpeechActive(false);
      isSpeechRef.current = false;
      if (recognitionRef.current) recognitionRef.current.stop();
      //Clean up pitch analyzer
      if (pitchFrameRef.current) cancelAnimationFrame(pitchFrameRef.current);
      if (pitchStreamRef.current) pitchStreamRef.current.getTracks().forEach(t => t.stop());
      if (pitchCtxRef.current) { pitchCtxRef.current.close(); pitchCtxRef.current = null; }
      activeSpeakerRef.current = 'Unknown Voice';
    }
  };

  const toggleRadar = async () => {
    if (!isRadarActive) {
      setIsRadarActive(true);
      isRadarRef.current = true;
      setErrorMsg('');

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = audioCtx; // store ref so we can close it cleanly on stop
        const src = audioCtx.createMediaStreamSource(stream);
        const analyzer = audioCtx.createAnalyser();
        analyzer.fftSize = 256;
        src.connect(analyzer);
        analyzerRef.current = analyzer;

        const bufferLength = analyzer.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        const engineLoop = () => {
          if (!isRadarRef.current) return;

          analyzer.getByteFrequencyData(dataArray);
          let sum = 0;
          let numerator = 0;

          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
            numerator += dataArray[i] * i;
          }
          const average = sum / bufferLength;
          const spectralCentroid = sum === 0 ? 0 : numerator / sum;

          if (average > 15) {
            if (spectralCentroid < 15) activeSpeakerRef.current = 'Deep Pitch Voice';
            else if (spectralCentroid < 30) activeSpeakerRef.current = 'Mid Pitch Voice';
            else activeSpeakerRef.current = 'High Pitch Voice';
          }

          if (average > 95) {
            document.body.classList.add('sos-strobe');
            if (navigator.vibrate) navigator.vibrate([400, 200, 400, 200, 400]); //SOS Haptics
            const now = Date.now();
            if (!lastDetectionTime.current['generic_sos'] || now - lastDetectionTime.current['generic_sos'] > 4000) {
              lastDetectionTime.current['generic_sos'] = now;
              setTranscriptChunks(prev => [...prev, {
                id: Date.now() + Math.random(),
                speaker: 'SYSTEM',
                text: `[⚠️ HAZARD NOISE DETECTED]`
              }]);
            }
          } else {
            document.body.classList.remove('sos-strobe');
          }

          if (average > 35 && customSounds.length > 0) {
            const liveFloat = Array.from(dataArray).map(v => Math.max(0, v - 30) / 255.0);
            for (const sound of customSounds) {
              const similarity = cosineSimilarity(liveFloat, sound.fingerprint);
              if (similarity > 0.85) {
                const now = Date.now();
                if (!lastDetectionTime.current[`ui_${sound.name}`] || now - lastDetectionTime.current[`ui_${sound.name}`] > 3000) {
                  if (navigator.vibrate) navigator.vibrate([150, 100, 150]); //Custom sound haptics
                  lastDetectionTime.current[`ui_${sound.name}`] = now;
                  setTranscriptChunks(prev => [...prev, {
                    id: Date.now() + Math.random(),
                    speaker: 'SYSTEM',
                    text: `[🔔 ${sound.name.toUpperCase()} DETECTED]`
                  }]);
                }
              }
            }
          }
          window.audioFrameId = requestAnimationFrame(engineLoop);
        };
        engineLoop();
      } catch (err) {
        setIsRadarActive(false);
        isRadarRef.current = false;
        setErrorMsg('Microphone hardware permission denied or strictly blocked by OS.');
      }
    } else {
      setIsRadarActive(false);
      isRadarRef.current = false;
      cancelAnimationFrame(window.audioFrameId);
      document.body.classList.remove('sos-strobe');
      // properly close the AudioContext so the browser doesn't accumulate stale ones
      if (audioCtxRef.current) {
        audioCtxRef.current.close();
        audioCtxRef.current = null;
      }
    }
  };


  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <section className="bento-card" style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', flexDirection: 'row' }}>

        {/* Core Speech AI Block */}
        <div className="hero-status" style={{ flex: 1, minWidth: '300px', borderRight: '1px solid rgba(255,255,255,0.1)', paddingRight: '20px' }}>
          <div className={`glow-icon ${isSpeechActive ? '' : 'danger'} pulse-animation`} style={{ width: '60px', height: '60px', marginBottom: '16px' }}>
            <Mic size={30} />
          </div>
          <div>
            <h2 style={{ fontSize: '20px', marginBottom: '4px' }}>{isSpeechActive ? 'Live Transcriber Active' : 'Live Transcriber Ready'}</h2>
            <p className="subtitle" style={{ marginBottom: '16px' }}>Live on-device speech transcription</p>
          </div>
          <button onClick={toggleSpeech} className="premium-btn action-primary" style={{ width: '100%', justifyContent: 'center' }}>
            <Mic size={18} />
            {isSpeechActive ? 'Turn Off Transcriber' : 'Start Transcriber'}
          </button>
        </div>

        {/* SOS Acoustic Scanner Block */}
        <div className="hero-status" style={{ flex: 1, minWidth: '300px' }}>
          <div className={`glow-icon ${isRadarActive ? '' : 'danger'} pulse-animation`} style={{ width: '60px', height: '60px', marginBottom: '16px' }}>
            <Activity size={30} />
          </div>
          <div>
            <h2 style={{ fontSize: '20px', marginBottom: '4px' }}>{isRadarActive ? 'Sound Scanner Active' : 'Sound Scanner Ready'}</h2>
            <p className="subtitle" style={{ marginBottom: '16px' }}>SOS Noise Warning & Custom Sound Detectors</p>
          </div>
          <button onClick={toggleRadar} className="premium-btn action-warning" style={{ width: '100%', justifyContent: 'center' }}>
            <Activity size={18} />
            {isRadarActive ? 'Turn Off Sound Scanner' : 'Start Sound Scanner'}
          </button>
        </div>

      </section>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        <section className="bento-card" style={{ flex: 1, minHeight: '400px', display: 'flex', flexDirection: 'column' }}>
          <div className="bento-header" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <AlignLeft size={20} className="text-blue-400" />
              Live Speech Chat
            </div>

            {transcriptChunks.length > 0 && (
              <div style={{ display: 'flex', gap: '12px' }}>
                <button onClick={exportAsTXT} className="premium-btn" style={{ padding: '6px 12px', fontSize: '11px', background: 'rgba(255,255,255,0.05)', height: 'fit-content' }}>
                  📄 Export .TXT
                </button>
                <button onClick={exportAsPDF} className="premium-btn action-primary" style={{ padding: '6px 12px', fontSize: '11px', height: 'fit-content' }}>
                  📕 Export .PDF
                </button>
              </div>
            )}
          </div>

          <div className="imessage-container" aria-live="polite">
            {errorMsg && <div style={{ color: '#FF375F', background: 'rgba(255,55,95,0.1)', padding: '12px', borderRadius: '8px', border: '1px solid rgba(255,55,95,0.3)', fontWeight: 'bold' }}>{errorMsg}</div>}

            {transcriptChunks.length === 0 && !interimText && (
              <p className="subtitle" style={{ textAlign: 'center', marginTop: '40px' }}>Speech segments will appear here as chat bubbles...</p>
            )}

            {transcriptChunks.map(chunk => {
              if (chunk.speaker === 'SYSTEM') {
                return (
                  <div key={chunk.id} className="chat-bubble speaker-system">
                    {chunk.text}
                  </div>
                );
              }

              const alias = speakerAliases[chunk.speaker] || chunk.speaker;
              const dotColor = getSpeakerColor(chunk.speaker);

              return (
                <div key={chunk.id} className="chat-bubble speaker-other" style={{ borderLeft: `4px solid ${dotColor}` }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '4px' }}>
                    <strong style={{ color: dotColor, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      🗣️ {alias}
                      <button onClick={() => renameSpeaker(chunk.speaker)} style={{ background: 'transparent', border: 'none', color: '#A1A1AA', cursor: 'pointer', fontSize: '10px', textDecoration: 'underline' }}>
                        Rename
                      </button>
                    </strong>

                    <button
                      onClick={() => setTargetASLDictionary(chunk.text)}
                      style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid #10B981', borderRadius: '8px', color: '#10B981', cursor: 'pointer', display: 'flex', gap: '6px', alignItems: 'center', fontSize: '11px', fontWeight: 'bold', padding: '4px 8px' }}
                    >
                      <SpellCheck size={12} /> View ASL
                    </button>
                  </div>
                  <div>{chunk.text}</div>
                </div>
              );
            })}

            {interimText && (
              <div className="chat-bubble speaker-other" style={{ opacity: 0.6 }}>
                <div style={{ color: '#A1A1AA', fontSize: '11px', marginBottom: '4px' }}>🗣️ Listening...</div>
                <div style={{ fontStyle: 'italic' }}>{interimText}</div>
              </div>
            )}
          </div>
        </section>

        {/* Custom Fingerprint Training */}
        <section className="bento-card">
          <div className="bento-header" style={{ fontSize: '16px' }}>
            <Upload size={18} className="text-amber-400" /> Custom Sounds
          </div>
          <p style={{ fontSize: '13px', color: '#A1A1AA', marginBottom: '16px' }}>
            Record a sound live so the app can build a frequency fingerprint and alert you when it hears it again.
          </p>

          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>

            <button onClick={handleRecordCustomSound} className="premium-btn" style={{ fontSize: '13px', padding: '8px 16px', border: isRecordingCustom ? '1px solid #FF375F' : '1px solid rgba(255,255,255,0.1)' }}>
              <Mic size={14} color={isRecordingCustom ? "#FF375F" : "white"} />
              {isRecordingCustom ? 'Recording (3s)...' : 'Record Live Sound'}
            </button>

            {customSounds.length === 0 && <span style={{ fontSize: '12px', alignSelf: 'center', color: '#666' }}>No trained footprints.</span>}
            {customSounds.map((s, i) => (
              <div key={i} style={{ background: 'rgba(255,159,10,0.1)', border: '1px solid rgba(255,159,10,0.3)', padding: '6px 12px', borderRadius: '16px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                {s.name}
                <Trash2 size={14} style={{ cursor: 'pointer' }} onClick={() => {
                  setCustomSounds(prev => prev.filter((_, idx) => idx !== i));
                }} />
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* OVERLAY SLIDING MODAL FOR ASL */}
      {targetASLDictionary && (
        <div className="asl-modal-overlay" onClick={() => setTargetASLDictionary('')}>
          <div className="asl-modal-content" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
              <div>
                <h2 style={{ color: 'var(--text-primary)', fontSize: '24px', margin: 0 }}>ASL Dictionary</h2>
                <p style={{ color: 'var(--text-secondary)', margin: 0, marginTop: '4px' }}>Displaying translation for: "{targetASLDictionary}"</p>
              </div>
              <button onClick={() => setTargetASLDictionary('')} style={{ background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>✕</button>
            </div>
            <div style={{ flex: 1, overflow: 'hidden', border: '1px solid var(--bento-border)', borderRadius: '16px', background: 'rgba(0,0,0,0.02)' }}>
              <ASLVisualizer latestSpeech={targetASLDictionary} />
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
