import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Ear, ShieldAlert, Mic, EyeOff, Eye, Settings } from 'lucide-react';
import SoundEngine from './components/SoundEngine';
import VisionEngine from './components/VisionEngine';

export default function App() {
  //The main state 
  //Holding all the state vars here so they can be passed down to the other tabs
  const [activeTab, setActiveTab] = useState('home'); //Default to Split Home
  const [theme, setTheme] = useState('dark');
  const [isLowVisionMode, setIsLowVisionMode] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  //First-time voice nav onboarding — only shows once, tracked via localStorage
  const [isVoiceOnboardingOpen, setIsVoiceOnboardingOpen] = useState(false);
  //It will track if user has ever activated Voice Nav — persists across page refreshes
  const [hasSeenVoiceNav, setHasSeenVoiceNav] = useState(
    () => !!localStorage.getItem('auraconnect_voicenav_onboarded')
  );

  useEffect(() => {
    if (theme === 'light') {
      document.documentElement.classList.add('theme-light');
    } else {
      document.documentElement.classList.remove('theme-light');
    }
  }, [theme]);
  const [isVoiceAssistantActive, setIsVoiceAssistantActive] = useState(false);
  const [autoEngageCamera, setAutoEngageCamera] = useState(0);
  const recognitionRef = useRef(null);

  //Locking this in a ref bc the voice assistant relies on outdated closures 
  //Only without the ref it crashes when u say switch tabs
  const activeTabRef = useRef('auditory');
  useEffect(() => {
    activeTabRef.current = activeTab;
  }, [activeTab]);

  const hasMountedRef = useRef(false);
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return; //Skip the first render — don't announce on page load
    }
    if (isLowVisionMode) {
      document.body.classList.add('low-vision-mode');
      speakFeedback("Low Vision UI activated. High contrast enabled.");
    } else {
      document.body.classList.remove('low-vision-mode');
      speakFeedback("Premium UI activated.");
    }
  }, [isLowVisionMode]);

  const speakFeedback = (text) => {
    //Using the window speech api w/ no dependencies so it works offline
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.1;
      window.speechSynthesis.speak(utterance);
    }
  };

  const toggleVoiceAssistant = () => {
    if (isVoiceAssistantActive) {
      if (recognitionRef.current) recognitionRef.current.stop();
      setIsVoiceAssistantActive(false);
      speakFeedback("Voice Assistant Deactivated.");
    } else {
      //The voice nav thingy sequence
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognition) {
        alert("Your browser does not support Voice Navigation.");
        return;
      }
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = false;

      recognition.onresult = (e) => {
        const command = e.results[e.results.length - 1][0].transcript.toLowerCase();
        console.log("🗣️ Voice Command Recognized:", command);
        //No reset needed — counter only increments forward

        if (command.includes("what is auraconnect") || command.includes("what is aura connect") || command.includes("what is this app") || command.includes("describe the app") || command.includes("about this app")) {
          speakFeedback("AuraConnect is a highly optimized accessibility platform built to assist with visual and auditory impairments using deterministic logic.");
        }
        else if (command.includes("who built this") || command.includes("who created")) {
          speakFeedback("This platform was engineered by Charishya Yarram for the software development accessibility project.");
        }
        else if (command.includes("how does the radar work") || command.includes("how does the camera work")) {
          speakFeedback("The Vision Radar uses a 1-dimensional mathematical spatial loop to calculate pixel luminosity, actively highlighting physical edges so you don't trip.");
        }
        else if (command.includes("read the screen") || command.includes("read text")) {
          const screenText = document.body.innerText.substring(0, 300);
          speakFeedback("Reading current interface aloud. " + screenText);
        }
        //Prioritize exact command for engaging radar so camera doesn't catch it prematurely
        else if (command.includes("turn on camera") || command.includes("turn on the radar") || command.includes("start the camera") || command.includes("engage")) {
          setActiveTab('vision');
          setAutoEngageCamera(prev => prev + 1);
          //Removed voice feedback to be less interruptive; device vibrating is enough confirmation
        }
        //Turning the camera off securely by forcing a route change which drops the hardware stream
        else if (command.includes("turn off camera") || command.includes("stop camera") || command.includes("turn off radar") || command.includes("stop radar")) {
          setActiveTab('home');
        }
        else if (command.includes("home") || command.includes("main menu")) {
          setActiveTab('home');
        }
        else if (command.includes("settings") || command.includes("preferences") || command.includes("options")) {
          setIsSettingsOpen(true);
        }
        else if (command.includes("auditory") || command.includes("sound") || command.includes("speech") || command.includes("audio")) {
          setActiveTab('auditory');
        }
        else if (command.includes("vision") || command.includes("camera")) {
          setActiveTab('vision');
          setAutoEngageCamera(prev => prev + 1);
        }
        else if ((command === "yes" || command.includes("yes read") || command.includes("please read") || command.includes("yeah")) && activeTabRef.current === 'vision') {
          const textToRead = "This feature uses your camera to instantly highlight edges and objects in the room around you. Instead of using a slow AI to guess what it sees, it uses simple math to brightly outline physical hazards, making sure it never crashes or lags when you need it most.";
          speakFeedback(textToRead);
        }
        else if (command.includes("contrast") || command.includes("blind") || command.includes("low vision")) {
          setIsLowVisionMode(prev => !prev);
        }
        else if (command.includes("light mode") || command.includes("light theme") || command.includes("switch to light")) {
          setTheme('light');
          speakFeedback("Switched to Light Mode.");
        }
        else if (command.includes("dark mode") || command.includes("dark theme") || command.includes("switch to dark")) {
          setTheme('dark');
          speakFeedback("Switched to Dark Mode.");
        }
      };

      recognition.onerror = (e) => {
        console.error("Voice Nav Error (Intercepted):", e.error);
        //The error triggers onend automatically, which restarts it
      };

      recognition.onend = () => {
        if (isVoiceAssistantActiveRef.current) {
          setTimeout(() => {
            try { recognition.start(); } catch (err) { }
          }, 100); // 100ms — standard safe delay to avoid Chrome rate-limit loop
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
      setIsVoiceAssistantActive(true);

      //The first time check
      //Show that the command guide popup only on the very first activation ever.
      //The localStorage flag persists across sessions so it never pops again.
      const hasSeenOnboarding = localStorage.getItem('auraconnect_voicenav_onboarded');
      if (!hasSeenOnboarding) {
        localStorage.setItem('auraconnect_voicenav_onboarded', 'true');
        setHasSeenVoiceNav(true);
        setIsVoiceOnboardingOpen(true);
        //It will read short command summary aloud immediately
        speakFeedback(
          "Voice Navigator is now active. Here are your commands. " +
          "Say: home, auditory, vision, or settings to navigate. " +
          "Say: engage, or turn on the radar to start the camera. " +
          "Say: read the screen to hear the current page. " +
          "Say: low vision to toggle high contrast mode. " +
          "You can close this guide by tapping Got It."
        );
      } else {
        speakFeedback("Voice Assistant Active. You can command me to navigate, answer questions, or read the screen aloud.");
      }
    }
  };

  const isVoiceAssistantActiveRef = useRef(isVoiceAssistantActive);
  useEffect(() => {
    isVoiceAssistantActiveRef.current = isVoiceAssistantActive;
  }, [isVoiceAssistantActive]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && e.ctrlKey) {
        toggleVoiceAssistant();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      {/* ==== Voice Nav First-Time Onboarding Modal ==== */}
      {isVoiceOnboardingOpen && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.85)',
            zIndex: 99999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px'
          }}
          onClick={() => setIsVoiceOnboardingOpen(false)}
        >
          <div
            style={{
              width: '100%', maxWidth: '520px',
              background: 'linear-gradient(135deg, #0f0f1a 0%, #1a1a2e 100%)',
              border: '1px solid rgba(139,92,246,0.4)',
              borderRadius: '20px', padding: '28px',
              boxShadow: '0 0 60px rgba(139,92,246,0.2)'
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
              <div style={{
                width: '44px', height: '44px', borderRadius: '12px',
                background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px'
              }}>🎙️</div>
              <div>
                <h2 style={{ color: '#fff', margin: 0, fontSize: '18px', fontWeight: '700' }}>Voice Navigator — Command Guide</h2>
                <p style={{ color: '#8B5CF6', margin: 0, fontSize: '12px', marginTop: '2px' }}>Reading this aloud now · Only shown once</p>
              </div>
              <button
                onClick={() => setIsVoiceOnboardingOpen(false)}
                style={{
                  marginLeft: 'auto', background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)', borderRadius: '50%',
                  width: '36px', height: '36px', color: '#aaa',
                  cursor: 'pointer', fontSize: '16px', display: 'flex',
                  alignItems: 'center', justifyContent: 'center'
                }}
                aria-label="Close onboarding guide"
              >✕</button>
            </div>

            {/* Command rows */}
            <>
              {[
                { category: '🏠 Navigate', commands: ['"home"', '"auditory"', '"vision"', '"settings"'] },
                { category: '📷 Camera', commands: ['"engage"', '"turn on the radar"', '"turn off camera"', '"stop radar"'] },
                { category: '🔊 Screen Read', commands: ['"read the screen"', '"read text"'] },
                { category: '🌗 Accessibility', commands: ['"low vision"', '"contrast"', '"blind"'] },
                { category: '🎨 Theme', commands: ['"light mode"', '"dark mode"', '"switch to light"', '"switch to dark"'] },
                { category: '❓ Info', commands: ['"what is this app"', '"how does the radar work"', '"who built this"'] },
              ].map(({ category, commands }) => (
                <div key={category} style={{ marginBottom: '16px' }}>
                  <h3 style={{ color: 'rgba(255,255,255,0.5)', margin: '0 0 8px 0', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '1px' }}>{category}</h3>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {commands.map(cmd => (
                      <span key={cmd} style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.2)', padding: '4px 10px', borderRadius: '6px', fontSize: '13px', color: '#fff' }}>{cmd}</span>
                    ))}
                  </div>
                </div>
              ))}

              {/* Quick Shortcut Hint */}
              <div style={{ marginTop: '24px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '12px', border: '1px dashed rgba(255,255,255,0.1)', textAlign: 'center' }}>
                <p style={{ color: 'rgba(255,255,255,0.4)', margin: 0, fontSize: '11px' }}>
                  💡 Global Shortcut: <kbd style={{ background: '#333', padding: '2px 6px', borderRadius: '4px', border: '1px solid #555', color: '#fff' }}>Ctrl + Space</kbd> triggers this navigator instantly.
                </p>
              </div>
            </>


            <button
              onClick={() => setIsVoiceOnboardingOpen(false)}
              style={{
                width: '100%', marginTop: '16px', padding: '12px',
                background: 'linear-gradient(135deg, #8B5CF6, #6D28D9)',
                border: 'none', borderRadius: '12px',
                color: '#fff', fontWeight: '700', fontSize: '15px',
                cursor: 'pointer', letterSpacing: '0.5px'
              }}
            >
              Got It — Start Talking
            </button>
          </div>
        </div>
      )}
      <div className="ambient-mesh" style={{ display: isLowVisionMode ? 'none' : 'block' }}></div>

      <div className="layout-wrapper" aria-live="polite">
        <header className="app-header">
          <div className="logo-group">
            <img
              src="/auraconnect-logo.png"
              alt="AuraConnect Logo"
              style={{ width: isLowVisionMode ? 44 : 32, height: isLowVisionMode ? 44 : 32, borderRadius: '8px' }}
            />
            <h1>AuraConnect</h1>
          </div>

          {/* Nav Pills removed in favor of Split Home & Bottom Tab */}

          <div className="status-controls" style={{ display: 'flex', gap: '12px' }}>
            <button
              className={`premium-btn ${isVoiceAssistantActive ? 'action-warning' : 'action-primary'}`}
              onClick={toggleVoiceAssistant}
              aria-label="Toggle Voice Control Assistant"
            >
              <Mic size={isLowVisionMode ? 24 : 16} />
              <span className="hidden-mobile">
                {isVoiceAssistantActive ? 'Listening...' : 'Voice Nav'}
              </span>
            </button>
            {/* Always-visible command guide button */}
            <button
              className="premium-btn"
              onClick={() => setIsVoiceOnboardingOpen(true)}
              aria-label="Show Voice Nav Command Guide"
              style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.4)', color: 'var(--text-primary)' }}
            >
              <span style={{ fontSize: '13px' }}>📋</span>
              <span className="hidden-mobile">Commands</span>
            </button>
            <button
              className={`premium-btn ${isLowVisionMode ? 'action-danger' : 'action-success'}`}
              onClick={() => setIsLowVisionMode(!isLowVisionMode)}
              aria-label="Toggle Low Vision High Contrast Mode"
            >
              <EyeOff size={isLowVisionMode ? 24 : 16} />
              <span className="hidden-mobile">Low Vision UI</span>
            </button>
            {/* Global Settings Button Injection */}
            {!isLowVisionMode && (
              <button
                className="settings-btn"
                onClick={() => setIsSettingsOpen(true)}
                aria-label="Open Settings"
              >
                <Settings size={20} />
              </button>
            )}
          </div>
        </header>

        {isLowVisionMode && (
          <div className="low-vision-nav" style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
            <button
              onClick={() => { setActiveTab('auditory'); speakFeedback("Auditory Environment"); }}
              className="lv-btn"
              style={{ border: activeTab === 'auditory' ? '4px solid #FFFF00' : '2px solid #FFF' }}
            >
              Auditory
            </button>
            <button
              onClick={() => { setActiveTab('vision'); speakFeedback("Vision Radar"); }}
              className="lv-btn"
              style={{ border: activeTab === 'vision' ? '4px solid #FFFF00' : '2px solid #FFF' }}
            >
              Vision
            </button>
          </div>
        )}

        <main className="content-area">
          <AnimatePresence mode="sync">
            {activeTab === 'home' && !isLowVisionMode && (
              <motion.div key="home" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.12 }}>
                <div className="split-home-container">
                  <div className="split-btn" onClick={() => { setActiveTab('auditory'); speakFeedback("Auditory Hub Selected."); }}>
                    <Ear size={64} color="#4F46E5" />
                    <h2>Auditory Hub</h2>
                    <p>Speech Transcriber & ASL</p>
                  </div>
                  <div className="split-btn" onClick={() => { setActiveTab('vision'); setAutoEngageCamera(prev => prev + 1); speakFeedback("Vision Radar Selected."); }}>
                    <Eye size={64} color="#F59E0B" />
                    <h2>Vision Radar</h2>
                    <p>Spatial Hazard Detection</p>
                  </div>
                </div>
              </motion.div>
            )}
            {activeTab === 'auditory' && (
              <motion.div key="auditory" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.12 }} className="tab-content">
                <SoundEngine />
              </motion.div>
            )}
            {activeTab === 'vision' && (
              <motion.div key="vision" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.12 }} className="tab-content">
                <VisionEngine autoStart={autoEngageCamera} />
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {!isLowVisionMode && activeTab !== 'home' && (
          <div className="bottom-tab-bar" aria-label="Bottom Navigation Drawer">
            <button onClick={() => { setActiveTab('home'); }} className="bottom-tab-btn" aria-label="Go to Home Screen">
              <ShieldAlert size={24} /> Home
            </button>
            <button onClick={() => { setActiveTab('auditory'); }} className={`bottom-tab-btn ${activeTab === 'auditory' ? 'active' : ''}`} aria-label="Auditory Hub">
              <Ear size={24} /> Auditory
            </button>
            <button onClick={() => { setActiveTab('vision'); }} className={`bottom-tab-btn ${activeTab === 'vision' ? 'active' : ''}`} aria-label="Vision Radar">
              <Eye size={24} /> Vision
            </button>
          </div>
        )}
        {isSettingsOpen && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }} onClick={() => setIsSettingsOpen(false)}>
            <div style={{ width: '100%', maxWidth: '400px', background: 'var(--bento-bg)', border: '1px solid var(--bento-border)', borderRadius: '16px', padding: '24px' }} onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
                <h2 style={{ color: 'var(--text-primary)', fontSize: '24px', margin: 0 }}>Settings</h2>
                <button onClick={() => setIsSettingsOpen(false)} style={{ background: 'rgba(0,0,0,0.05)', border: 'none', borderRadius: '50%', width: '40px', height: '40px', color: 'var(--text-primary)', cursor: 'pointer', fontSize: '20px' }}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--bento-bg)', borderRadius: '12px', border: '1px solid var(--bento-border)' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>Visual Theme</span>
                  <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} className="premium-btn">
                    {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
                  </button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px', background: 'var(--bento-bg)', borderRadius: '12px', border: '1px solid var(--bento-border)' }}>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 'bold' }}>High Contrast UI</span>
                  <button onClick={() => { setIsLowVisionMode(!isLowVisionMode); setIsSettingsOpen(false); }} className={`premium-btn ${isLowVisionMode ? 'action-danger' : 'action-primary'}`}>
                    {isLowVisionMode ? 'Disable' : 'Enable'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
