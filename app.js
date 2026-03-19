/* ===================================
   BounceCheck ⛳ – App Logic
   Audio Engine, Peak Detection, UI
   =================================== */

(function () {
    'use strict';

    // ============================
    // Configuration
    // ============================
    const CONFIG = {
        // Audio
        sampleRate: 44100,
        fftSize: 2048,
        scriptBufferSize: 4096,          // ScriptProcessorNode buffer size
        // Peak detection
        peakThresholdMultiplier: 2.0,    // multiplier over RMS noise floor for peak
        minPeakGap: 150,                 // minimum ms between peaks (cooldown for echo)
        maxListenTime: 8000,             // max ms to listen for bounces
        requiredPeaks: 3,
        // Noise floor
        noiseCalibrationMs: 500,         // ms to calibrate noise floor
        // COR
        corMin: 0.20,
        corMax: 0.95,
        // Countdown
        countdownSeconds: 3,
        // History
        maxHistory: 20,
        storageKey: 'bouncecheck_history',
        // Waveform
        waveformColor: '#00c853',
        waveformBgColor: 'rgba(0, 200, 83, 0.06)',
    };

    // COR Rating definitions
    const RATINGS = [
        { min: 0.80, label: 'Ausgezeichnet', sublabel: 'Wie neu! Volle Spielqualität.', icon: '⭐', cssClass: 'excellent', color: '#00c853' },
        { min: 0.70, label: 'Gut', sublabel: 'Voll spieltauglich, minimale Abnutzung.', icon: '✅', cssClass: 'good', color: '#8bc34a' },
        { min: 0.60, label: 'Befriedigend', sublabel: 'Für Übungsrunden noch brauchbar.', icon: '⚠️', cssClass: 'fair', color: '#ffeb3b' },
        { min: 0.50, label: 'Mangelhaft', sublabel: 'Deutliche Einbußen bei Distanz und Kontrolle.', icon: '🟠', cssClass: 'poor', color: '#ff9800' },
        { min: 0.00, label: 'Unbrauchbar', sublabel: 'Aussortieren – kaum noch Elastizität.', icon: '❌', cssClass: 'bad', color: '#ff4444' },
    ];

    // ============================
    // State
    // ============================
    let state = {
        phase: 'idle', // idle, countdown, calibrating, listening, analyzing, result
        audioContext: null,
        analyser: null,
        mediaStream: null,
        sourceNode: null,
        processorNode: null,
        peaks: [],
        noiseFloor: 0,
        listenStartTime: 0,
        waveformData: [],
        waveformAnimFrame: null,
        lastResult: null,
    };

    // ============================
    // DOM References
    // ============================
    const $ = (sel) => document.querySelector(sel);
    const $$ = (sel) => document.querySelectorAll(sel);

    const dom = {
        // Hero
        startBtn: $('#startBtn'),
        // Recorder
        recorder: $('#recorder'),
        statusRing: $('#statusRing'),
        statusIcon: $('#statusIcon'),
        statusText: $('#statusText'),
        statusSub: $('#statusSub'),
        countdown: $('#countdown'),
        countdownNumber: $('#countdownNumber'),
        countdownRing: $('#countdownRing'),
        countdownText: $('#countdownText'),
        waveformContainer: $('#waveformContainer'),
        waveformCanvas: $('#waveformCanvas'),
        waveformPeaks: $('#waveformPeaks'),
        bounceCounter: $('#bounceCounter'),
        bounceInfo: $('#bounceInfo'),
        dot1: $('#dot1'),
        dot2: $('#dot2'),
        dot3: $('#dot3'),
        line1: $('#line1'),
        line2: $('#line2'),
        recordBtn: $('#recordBtn'),
        cancelBtn: $('#cancelBtn'),
        retryBtn: $('#retryBtn'),
        recorderActions: $('#recorderActions'),
        // Result
        result: $('#result'),
        gaugeFill: $('#gaugeFill'),
        gaugeValue: $('#gaugeValue'),
        ratingIcon: $('#ratingIcon'),
        ratingText: $('#ratingText'),
        resultDescription: $('#resultDescription'),
        resultRating: $('#resultRating'),
        time1: $('#time1'),
        time2: $('#time2'),
        corDetail: $('#corDetail'),
        ballName: $('#ballName'),
        saveResultBtn: $('#saveResultBtn'),
        newTestBtn: $('#newTestBtn'),
        // History
        history: $('#history'),
        historyGrid: $('#historyGrid'),
        historyEmpty: $('#historyEmpty'),
        clearHistoryBtn: $('#clearHistoryBtn'),
        // Background & Confetti
        bgCanvas: $('#bgCanvas'),
        confettiCanvas: $('#confettiCanvas'),
    };

    // ============================
    // Background Particles
    // ============================
    function initBackgroundParticles() {
        const canvas = dom.bgCanvas;
        const ctx = canvas.getContext('2d');
        let particles = [];
        const PARTICLE_COUNT = 50;

        function resize() {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        }

        function createParticle() {
            return {
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: (Math.random() - 0.5) * 0.3,
                size: Math.random() * 2 + 0.5,
                alpha: Math.random() * 0.3 + 0.05,
            };
        }

        function init() {
            resize();
            particles = Array.from({ length: PARTICLE_COUNT }, createParticle);
        }

        function draw() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            particles.forEach((p) => {
                p.x += p.vx;
                p.y += p.vy;

                if (p.x < 0) p.x = canvas.width;
                if (p.x > canvas.width) p.x = 0;
                if (p.y < 0) p.y = canvas.height;
                if (p.y > canvas.height) p.y = 0;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 200, 83, ${p.alpha})`;
                ctx.fill();
            });

            // Draw connections
            for (let i = 0; i < particles.length; i++) {
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = particles[i].x - particles[j].x;
                    const dy = particles[i].y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < 150) {
                        ctx.beginPath();
                        ctx.moveTo(particles[i].x, particles[i].y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(0, 200, 83, ${0.04 * (1 - dist / 150)})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(draw);
        }

        window.addEventListener('resize', resize);
        init();
        draw();
    }

    // ============================
    // Confetti Effect
    // ============================
    function fireConfetti() {
        const canvas = dom.confettiCanvas;
        const ctx = canvas.getContext('2d');
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;

        const confetti = [];
        const COLORS = ['#00c853', '#ffd700', '#4caf50', '#8bc34a', '#ffeb3b', '#ffffff'];

        for (let i = 0; i < 120; i++) {
            confetti.push({
                x: canvas.width / 2 + (Math.random() - 0.5) * 200,
                y: canvas.height / 2,
                vx: (Math.random() - 0.5) * 15,
                vy: Math.random() * -18 - 5,
                rotation: Math.random() * 360,
                rotationSpeed: (Math.random() - 0.5) * 12,
                size: Math.random() * 8 + 4,
                color: COLORS[Math.floor(Math.random() * COLORS.length)],
                alpha: 1,
                gravity: 0.35,
            });
        }

        let frame = 0;
        const MAX_FRAMES = 180;

        function animate() {
            if (frame > MAX_FRAMES) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                return;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            confetti.forEach((c) => {
                c.x += c.vx;
                c.vy += c.gravity;
                c.y += c.vy;
                c.rotation += c.rotationSpeed;
                c.vx *= 0.99;
                c.alpha = Math.max(0, 1 - frame / MAX_FRAMES);

                ctx.save();
                ctx.translate(c.x, c.y);
                ctx.rotate((c.rotation * Math.PI) / 180);
                ctx.globalAlpha = c.alpha;
                ctx.fillStyle = c.color;
                ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.6);
                ctx.restore();
            });

            frame++;
            requestAnimationFrame(animate);
        }

        animate();
    }

    // ============================
    // Scroll Reveal
    // ============================
    function initScrollReveal() {
        const revealElements = [dom.recorder, dom.history, $('#howto'), $('#science')];

        const observer = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting) {
                        entry.target.classList.add('reveal--visible');
                    }
                });
            },
            { threshold: 0.1 }
        );

        revealElements.forEach((el) => {
            if (el) {
                el.classList.add('reveal');
                observer.observe(el);
            }
        });
    }

    // ============================
    // Audio Engine
    // ============================
    async function initAudio() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
            });

            state.mediaStream = stream;
            state.audioContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: CONFIG.sampleRate,
            });

            state.sourceNode = state.audioContext.createMediaStreamSource(stream);

            // Analyser for waveform visualization only
            state.analyser = state.audioContext.createAnalyser();
            state.analyser.fftSize = CONFIG.fftSize;
            state.analyser.smoothingTimeConstant = 0; // No smoothing – raw data

            // ScriptProcessorNode for lossless peak detection
            // (processes every audio buffer, unlike requestAnimationFrame)
            state.processorNode = state.audioContext.createScriptProcessor(
                CONFIG.scriptBufferSize, 1, 1
            );

            state.sourceNode.connect(state.analyser);
            state.sourceNode.connect(state.processorNode);
            state.processorNode.connect(state.audioContext.destination);

            // CRITICAL: On mobile, AudioContext starts suspended.
            // Must resume() after user gesture.
            if (state.audioContext.state === 'suspended') {
                await state.audioContext.resume();
            }

            console.log('[BounceCheck] ✅ Audio initialized. State:', state.audioContext.state);

            return true;
        } catch (err) {
            console.error('Microphone access denied:', err);
            showError('Mikrofon-Zugriff verweigert. Bitte erlaube den Zugriff in deinen Browser-Einstellungen.');
            return false;
        }
    }

    function stopAudio() {
        if (state.waveformAnimFrame) {
            cancelAnimationFrame(state.waveformAnimFrame);
            state.waveformAnimFrame = null;
        }
        if (state.processorNode) {
            state.processorNode.onaudioprocess = null;
            try { state.processorNode.disconnect(); } catch(e) {}
            state.processorNode = null;
        }
        if (state.sourceNode) {
            try { state.sourceNode.disconnect(); } catch(e) {}
            state.sourceNode = null;
        }
        if (state.mediaStream) {
            state.mediaStream.getTracks().forEach((t) => t.stop());
            state.mediaStream = null;
        }
        if (state.audioContext && state.audioContext.state !== 'closed') {
            state.audioContext.close();
            state.audioContext = null;
        }
    }

    // ============================
    // Waveform Visualization
    // ============================
    function startWaveformVisualization() {
        const canvas = dom.waveformCanvas;
        const ctx = canvas.getContext('2d');
        const analyser = state.analyser;
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        // Track waveform history for scrolling display
        const waveformHistory = [];
        const MAX_HISTORY = 600;

        function resizeCanvas() {
            const rect = canvas.parentElement.getBoundingClientRect();
            canvas.width = rect.width * window.devicePixelRatio;
            canvas.height = rect.height * window.devicePixelRatio;
            ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
        }

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        function draw() {
            state.waveformAnimFrame = requestAnimationFrame(draw);

            const width = canvas.width / window.devicePixelRatio;
            const height = canvas.height / window.devicePixelRatio;

            analyser.getByteTimeDomainData(dataArray);

            // Compute RMS for current frame
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = (dataArray[i] - 128) / 128;
                sum += v * v;
            }
            const rms = Math.sqrt(sum / bufferLength);
            waveformHistory.push(rms);
            if (waveformHistory.length > MAX_HISTORY) {
                waveformHistory.shift();
            }

            // Draw
            ctx.clearRect(0, 0, width, height);

            // Draw center line
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, height / 2);
            ctx.lineTo(width, height / 2);
            ctx.stroke();

            // Draw waveform bars
            const barWidth = width / MAX_HISTORY;
            const centerY = height / 2;

            for (let i = 0; i < waveformHistory.length; i++) {
                const amplitude = waveformHistory[i];
                const barHeight = Math.max(1, amplitude * height * 2.5);
                const x = i * barWidth;

                // Gradient from green to gold for high amplitudes
                const intensity = Math.min(1, amplitude * 5);
                const r = Math.floor(0 + intensity * 255);
                const g = Math.floor(200 - intensity * 40);
                const b = Math.floor(83 - intensity * 83);
                const alpha = 0.3 + intensity * 0.5;

                ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
                ctx.fillRect(x, centerY - barHeight / 2, Math.max(1, barWidth - 1), barHeight);
            }

            // Draw recent waveform line (real-time oscilloscope)
            ctx.beginPath();
            ctx.strokeStyle = CONFIG.waveformColor;
            ctx.lineWidth = 1.5;
            ctx.globalAlpha = 0.6;

            const sliceWidth = width / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = (v * height) / 2;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }
            ctx.stroke();
            ctx.globalAlpha = 1;
        }

        draw();
        return waveformHistory;
    }

    // ============================
    // Bounce Detection (ScriptProcessorNode – lossless)
    // ============================
    function startBounceDetection() {
        state.peaks = [];
        state.listenStartTime = performance.now();

        let noiseFloorSamples = [];
        let calibrated = false;
        let calibrationStart = performance.now();
        let lastPeakTime = 0;
        let noiseFloor = 0;
        let firstPeakAmplitude = 0;
        let inCooldown = false;
        let detectionComplete = false; // Hard-stop flag – prevents queued events from processing

        console.log('[BounceCheck] 🎯 Starting bounce detection...');
        console.log('[BounceCheck] Buffer size:', CONFIG.scriptBufferSize);
        console.log('[BounceCheck] Sample rate:', state.audioContext.sampleRate);

        // Use ScriptProcessorNode – fires for EVERY audio buffer, no data loss
        state.processorNode.onaudioprocess = function(event) {
            // HARD STOP – must be the very first check.
            // On mobile, queued events can fire after we've already found 3 peaks.
            if (detectionComplete) return;
            if (state.phase !== 'listening' && state.phase !== 'calibrating') return;

            const inputData = event.inputBuffer.getChannelData(0);
            const bufferLength = inputData.length;
            const now = performance.now();

            // Compute peak amplitude (max absolute sample value in this buffer)
            let maxAmp = 0;
            let rms = 0;
            for (let i = 0; i < bufferLength; i++) {
                const absVal = Math.abs(inputData[i]);
                if (absVal > maxAmp) maxAmp = absVal;
                rms += inputData[i] * inputData[i];
            }
            rms = Math.sqrt(rms / bufferLength);

            // ---- Calibration phase ----
            if (!calibrated) {
                // Collect BOTH RMS and maxAmp during calibration
                noiseFloorSamples.push({ rms: rms, maxAmp: maxAmp });
                if (now - calibrationStart >= CONFIG.noiseCalibrationMs) {
                    // Use RMS for noise floor (stable, not inflated by random spikes)
                    const rmsSamples = noiseFloorSamples.map(s => s.rms);
                    const maxSamples = noiseFloorSamples.map(s => s.maxAmp);

                    const rmsMean = rmsSamples.reduce((a, b) => a + b, 0) / rmsSamples.length;
                    const rmsVariance = rmsSamples.reduce((a, b) => a + (b - rmsMean) ** 2, 0) / rmsSamples.length;
                    const rmsStddev = Math.sqrt(rmsVariance);
                    const rmsNoiseFloor = rmsMean + 2 * rmsStddev;

                    const maxMean = maxSamples.reduce((a, b) => a + b, 0) / maxSamples.length;

                    // Noise floor = RMS-based (stable), threshold uses maxAmp comparison
                    noiseFloor = rmsNoiseFloor;
                    state.noiseFloor = noiseFloor;
                    calibrated = true;
                    state.phase = 'listening';
                    state.listenStartTime = now;

                    console.log('[BounceCheck] ✅ Calibration done.');
                    console.log('[BounceCheck]    RMS noise floor:', rmsNoiseFloor.toFixed(5));
                    console.log('[BounceCheck]    Avg maxAmp during silence:', maxMean.toFixed(5));
                    console.log('[BounceCheck]    Initial threshold (maxAmp must exceed):', Math.max(noiseFloor * CONFIG.peakThresholdMultiplier, 0.005).toFixed(5));

                    updateStatus('listening', '🎤', 'Aufnahme läuft...', 'Lass den Ball jetzt fallen!');
                    dom.bounceCounter.hidden = false;
                }
                return;
            }

            // ---- Peak Detection ----
            // Compare maxAmp (peak) against RMS-derived threshold
            let threshold;
            if (state.peaks.length === 0) {
                // First peak: needs to clearly exceed the noise
                threshold = Math.max(noiseFloor * CONFIG.peakThresholdMultiplier, 0.005);
            } else {
                // After first peak: expect subsequent peaks to be quieter
                threshold = Math.max(
                    firstPeakAmplitude * 0.12,
                    noiseFloor * 1.5,
                    0.005
                );
            }

            const timeSinceLastPeak = now - lastPeakTime;

            // Check if we're in cooldown (echo/reverb suppression)
            if (inCooldown && timeSinceLastPeak < CONFIG.minPeakGap) {
                return; // Skip this buffer – still in cooldown
            }
            inCooldown = false;

            if (maxAmp > threshold && timeSinceLastPeak > CONFIG.minPeakGap) {
                // ---- Peak Validation ----
                // A real bounce has a sharp attack: maxAmp should be
                // significantly higher than the RMS (crest factor)
                const crestFactor = maxAmp / (rms + 0.0001);
                if (crestFactor < 1.3) {
                    // Too flat – likely sustained noise, not an impact
                    console.log('[BounceCheck] ⚠️ Rejected: crest factor too low:', crestFactor.toFixed(2), 'maxAmp:', maxAmp.toFixed(4));
                    return;
                }

                // Double-check we haven't already collected enough peaks
                if (state.peaks.length >= CONFIG.requiredPeaks) {
                    detectionComplete = true;
                    return;
                }

                // Found a valid peak!
                const peakTime = now;
                state.peaks.push({
                    time: peakTime,
                    amplitude: maxAmp,
                    rms: rms,
                });
                lastPeakTime = peakTime;
                inCooldown = true;

                // Store first peak amplitude for adaptive threshold
                if (state.peaks.length === 1) {
                    firstPeakAmplitude = maxAmp;
                }

                console.log(`[BounceCheck] 🏓 Peak #${state.peaks.length} detected!`);
                console.log(`   Amplitude: ${maxAmp.toFixed(4)}, RMS: ${rms.toFixed(4)}, Crest: ${crestFactor.toFixed(2)}`);
                console.log(`   Threshold was: ${threshold.toFixed(4)}`);
                if (state.peaks.length > 1) {
                    const dt = state.peaks[state.peaks.length - 1].time - state.peaks[state.peaks.length - 2].time;
                    console.log(`   Time since last peak: ${dt.toFixed(1)} ms`);
                }

                // Update UI
                onPeakDetected(state.peaks.length);
                addPeakMarker(state.peaks.length);

                if (state.peaks.length >= CONFIG.requiredPeaks) {
                    // SET FLAG BEFORE analyzeResult to block any queued events
                    detectionComplete = true;
                    state.phase = 'analyzing';
                    console.log('[BounceCheck] ✅ All peaks detected! Analyzing...');
                    analyzeResult();
                    return;
                }
            }

            // ---- Timeout check ----
            if (now - state.listenStartTime > CONFIG.maxListenTime) {
                detectionComplete = true; // Hard stop
                if (state.peaks.length >= 2) {
                    state.phase = 'analyzing';
                    console.log('[BounceCheck] ⏰ Timeout with', state.peaks.length, 'peaks. Analyzing...');
                    analyzeResult();
                } else {
                    state.phase = 'idle';
                    console.log('[BounceCheck] ❌ Timeout – only', state.peaks.length, 'peak(s) detected.');
                    updateStatus('idle', '⚠️', 'Keine Aufpraller erkannt',
                        'Versuche es erneut – achte auf eine harte Oberfläche und wenig Hintergrundgeräusche.');
                    showRetryButton();
                    stopAudio();
                }
                return;
            }
        };

        state.phase = 'calibrating';
        updateStatus('active', '🔊', 'Kalibriere Mikrofon...', 'Bitte kurz still sein...');
    }

    function addPeakMarker(peakNumber) {
        const container = dom.waveformPeaks;
        const canvas = dom.waveformCanvas;
        const width = canvas.clientWidth;

        // Position based on time
        const marker = document.createElement('div');
        marker.className = 'waveform__peak-marker';
        marker.setAttribute('data-label', `#${peakNumber}`);

        // Place at current position (right side of waveform since we're drawing left-to-right)
        const xPos = width - 10;
        marker.style.left = `${xPos}px`;

        container.appendChild(marker);
    }

    function onPeakDetected(count) {
        // Animate bounce dots
        const dots = [dom.dot1, dom.dot2, dom.dot3];
        const lines = [dom.line1, dom.line2];

        for (let i = 0; i < count; i++) {
            dots[i].classList.add('bounce-dot--active');
            if (i > 0 && lines[i - 1]) {
                lines[i - 1].classList.add('bounce-dot__line--active');
            }
        }

        const remaining = CONFIG.requiredPeaks - count;
        if (remaining > 0) {
            dom.bounceInfo.textContent = `${count}/${CONFIG.requiredPeaks} Aufpraller erkannt – noch ${remaining}...`;
        } else {
            dom.bounceInfo.textContent = 'Alle Aufpraller erkannt! Berechne Ergebnis...';
        }
    }

    // ============================
    // Analysis & Results
    // ============================
    function analyzeResult() {
        const peaks = state.peaks;

        if (peaks.length < 2) {
            showError('Zu wenige Aufpraller erkannt. Bitte erneut versuchen.');
            resetToIdle();
            return;
        }

        // Calculate time intervals
        const t1 = peaks[1].time - peaks[0].time; // Time between bounce 1 and 2

        let cor;
        let t2 = null;

        if (peaks.length >= 3) {
            t2 = peaks[2].time - peaks[1].time; // Time between bounce 2 and 3
            cor = t2 / t1;
        } else {
            // Only 2 peaks: estimate COR from amplitude ratio
            // Not as accurate, but still useful
            cor = Math.sqrt(peaks[1].amplitude / peaks[0].amplitude);
        }

        // Clamp COR
        cor = Math.max(CONFIG.corMin, Math.min(CONFIG.corMax, cor));

        // Get rating
        const rating = getRating(cor);

        console.log('[BounceCheck] 📊 === RESULT ===');
        console.log(`   t1 (Bounce 1→2): ${t1.toFixed(1)} ms`);
        if (t2) console.log(`   t2 (Bounce 2→3): ${t2.toFixed(1)} ms`);
        console.log(`   COR = ${t2 ? 't2/t1' : 'sqrt(amp2/amp1)'} = ${cor.toFixed(4)}`);
        console.log(`   Rating: ${rating.icon} ${rating.label}`);
        console.log('[BounceCheck] ================');

        state.lastResult = {
            cor: cor,
            t1: t1,
            t2: t2,
            rating: rating,
            peaks: peaks.length,
            timestamp: Date.now(),
        };

        // Show result
        stopAudio();
        showResult(state.lastResult);
    }

    function getRating(cor) {
        for (const r of RATINGS) {
            if (cor >= r.min) return r;
        }
        return RATINGS[RATINGS.length - 1];
    }

    function showResult(result) {
        state.phase = 'result';

        // Update status
        updateStatus('done', '✅', 'Analyse abgeschlossen!', '');

        // Show result section
        dom.result.hidden = false;
        dom.result.scrollIntoView({ behavior: 'smooth', block: 'center' });

        // Animate gauge
        const maxArc = 266.9; // 2/3 of circumference for 240° arc
        const fillAmount = 400.35 - (result.cor / CONFIG.corMax) * maxArc;
        
        setTimeout(() => {
            dom.gaugeFill.style.strokeDashoffset = fillAmount;
        }, 100);

        // Animate COR counter
        animateCounter(dom.gaugeValue, 0, result.cor, 1500);

        // Rating
        dom.resultRating.className = `result__rating result__rating--${result.rating.cssClass}`;
        dom.ratingIcon.textContent = result.rating.icon;
        dom.ratingText.textContent = result.rating.label;
        dom.resultDescription.textContent = result.rating.sublabel;

        // Details
        dom.time1.textContent = `${result.t1.toFixed(0)} ms`;
        dom.time2.textContent = result.t2 ? `${result.t2.toFixed(0)} ms` : '–';
        dom.corDetail.textContent = result.cor.toFixed(4);

        // Show retry button
        showRetryButton();

        // Fire confetti for excellent rating
        if (result.rating.cssClass === 'excellent') {
            setTimeout(fireConfetti, 800);
        }
    }

    function animateCounter(el, start, end, duration) {
        const startTime = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);

            // Ease out cubic
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = start + (end - start) * eased;

            el.textContent = current.toFixed(2);

            if (progress < 1) {
                requestAnimationFrame(update);
            }
        }

        requestAnimationFrame(update);
    }

    // ============================
    // History / LocalStorage
    // ============================
    function loadHistory() {
        try {
            const data = localStorage.getItem(CONFIG.storageKey);
            return data ? JSON.parse(data) : [];
        } catch {
            return [];
        }
    }

    function saveHistory(entries) {
        try {
            localStorage.setItem(CONFIG.storageKey, JSON.stringify(entries));
        } catch (e) {
            console.warn('Could not save to localStorage', e);
        }
    }

    function addToHistory(result) {
        const entries = loadHistory();
        const entry = {
            id: Date.now(),
            cor: result.cor,
            t1: result.t1,
            t2: result.t2,
            rating: result.rating.label,
            ratingClass: result.rating.cssClass,
            ratingIcon: result.rating.icon,
            color: result.rating.color,
            name: dom.ballName.value.trim() || 'Golfball',
            timestamp: result.timestamp,
        };
        entries.unshift(entry);
        if (entries.length > CONFIG.maxHistory) {
            entries.pop();
        }
        saveHistory(entries);
        renderHistory();
    }

    function deleteFromHistory(id) {
        let entries = loadHistory();
        entries = entries.filter((e) => e.id !== id);
        saveHistory(entries);
        renderHistory();
    }

    function clearHistory() {
        if (confirm('Möchtest du den gesamten Testverlauf wirklich löschen?')) {
            saveHistory([]);
            renderHistory();
        }
    }

    function renderHistory() {
        const entries = loadHistory();
        dom.historyGrid.innerHTML = '';

        if (entries.length === 0) {
            dom.historyEmpty.style.display = 'block';
            return;
        }

        dom.historyEmpty.style.display = 'none';

        entries.forEach((entry, index) => {
            const card = document.createElement('div');
            card.className = 'history-card';
            card.style.animationDelay = `${index * 0.05}s`;

            const date = new Date(entry.timestamp);
            const dateStr = date.toLocaleDateString('de-DE', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
            });

            card.innerHTML = `
                <button class="history-card__delete" data-id="${entry.id}" title="Löschen">✕</button>
                <div class="history-card__header">
                    <span class="history-card__name">${escapeHTML(entry.name)}</span>
                    <span class="history-card__badge result__rating--${entry.ratingClass}" style="background:${entry.color}22;color:${entry.color};border:1px solid ${entry.color}44;">
                        ${entry.ratingIcon} ${entry.rating}
                    </span>
                </div>
                <div class="history-card__cor" style="color:${entry.color}">${entry.cor.toFixed(2)}</div>
                <div class="history-card__date">${dateStr}</div>
            `;

            card.querySelector('.history-card__delete').addEventListener('click', (e) => {
                e.stopPropagation();
                deleteFromHistory(entry.id);
            });

            dom.historyGrid.appendChild(card);
        });
    }

    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    // ============================
    // UI State Management
    // ============================
    function updateStatus(ringClass, icon, text, sub) {
        dom.statusRing.className = `status-ring ${ringClass ? 'status-ring--' + ringClass : ''}`;
        dom.statusIcon.textContent = icon;
        dom.statusText.textContent = text;
        dom.statusSub.textContent = sub;
    }

    function showError(message) {
        const existing = dom.recorder.querySelector('.error-message');
        if (existing) existing.remove();

        const errorEl = document.createElement('div');
        errorEl.className = 'error-message';
        errorEl.innerHTML = `<strong>⚠️ Fehler</strong><p>${message}</p>`;
        dom.recorderActions.before(errorEl);

        setTimeout(() => errorEl.remove(), 8000);
    }

    function showRetryButton() {
        dom.recordBtn.hidden = true;
        dom.cancelBtn.hidden = true;
        dom.retryBtn.hidden = false;
    }

    function resetBounceCounter() {
        [dom.dot1, dom.dot2, dom.dot3].forEach((d) => d.classList.remove('bounce-dot--active'));
        [dom.line1, dom.line2].forEach((l) => l.classList.remove('bounce-dot__line--active'));
        dom.bounceInfo.textContent = 'Warte auf Aufprall...';
        dom.bounceCounter.hidden = true;
    }

    function resetWaveform() {
        dom.waveformPeaks.innerHTML = '';
        const ctx = dom.waveformCanvas.getContext('2d');
        ctx.clearRect(0, 0, dom.waveformCanvas.width, dom.waveformCanvas.height);
    }

    function resetToIdle() {
        state.phase = 'idle';
        state.peaks = [];

        stopAudio();
        resetBounceCounter();
        resetWaveform();

        dom.countdown.classList.remove('countdown--visible');
        dom.result.hidden = true;
        dom.recordBtn.hidden = true;
        dom.cancelBtn.hidden = true;
        dom.retryBtn.hidden = true;

        // Reset gauge
        dom.gaugeFill.style.strokeDashoffset = '400.35';
        dom.gaugeValue.textContent = '0.00';

        // Clear ball name
        dom.ballName.value = '';

        // Remove errors
        const errors = dom.recorder.querySelectorAll('.error-message');
        errors.forEach((e) => e.remove());

        updateStatus('idle', '🎤', 'Bereit zum Testen', 'Drücke den Button und lass den Ball auf eine harte Oberfläche fallen');
    }

    // ============================
    // Countdown & Flow
    // ============================
    async function startTest() {
        resetToIdle();

        // Scroll to recorder
        dom.recorder.scrollIntoView({ behavior: 'smooth', block: 'start' });

        // Init audio
        const audioReady = await initAudio();
        if (!audioReady) return;

        // Start waveform visualization
        startWaveformVisualization();

        // Countdown with SVG ring animation
        state.phase = 'countdown';
        dom.countdown.classList.add('countdown--visible');
        const RING_CIRCUMFERENCE = 339.29; // 2 * PI * 54

        for (let i = CONFIG.countdownSeconds; i > 0; i--) {
            // Set number with fade-in animation
            dom.countdownNumber.textContent = i;
            dom.countdownNumber.style.animation = 'none';
            void dom.countdownNumber.offsetHeight; // force reflow
            dom.countdownNumber.style.animation = 'countFadeIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';

            // Reset ring to full, then animate to empty over 1 second
            dom.countdownRing.classList.remove('countdown__ring--animating');
            dom.countdownRing.style.strokeDashoffset = '0';
            void dom.countdownRing.offsetHeight; // force reflow
            dom.countdownRing.classList.add('countdown__ring--animating');
            dom.countdownRing.style.strokeDashoffset = RING_CIRCUMFERENCE;

            await sleep(1000);
            if (state.phase !== 'countdown') return; // cancelled
        }

        // Show "Los!" briefly
        dom.countdownNumber.textContent = 'Los!';
        dom.countdownNumber.style.animation = 'none';
        dom.countdownNumber.style.fontSize = '2.5rem';
        void dom.countdownNumber.offsetHeight;
        dom.countdownNumber.style.animation = 'countFadeIn 0.35s cubic-bezier(0.34, 1.56, 0.64, 1)';
        dom.countdownText.textContent = 'Ball jetzt fallen lassen!';
        await sleep(600);
        if (state.phase !== 'countdown') return;

        // Reset for next time
        dom.countdownNumber.style.fontSize = '';
        dom.countdownText.textContent = 'Ball bereithalten...';
        dom.countdown.classList.remove('countdown--visible');

        // Show cancel button
        dom.cancelBtn.hidden = false;

        // Start listening
        startBounceDetection();
    }

    function cancelTest() {
        state.phase = 'idle';
        resetToIdle();
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    // ============================
    // Event Listeners
    // ============================
    function bindEvents() {
        // Hero CTA
        dom.startBtn.addEventListener('click', startTest);

        // Record button (currently not used, startBtn is main entry)
        dom.recordBtn.addEventListener('click', startTest);

        // Cancel
        dom.cancelBtn.addEventListener('click', cancelTest);

        // Retry
        dom.retryBtn.addEventListener('click', () => {
            resetToIdle();
            setTimeout(startTest, 300);
        });

        // Save result
        dom.saveResultBtn.addEventListener('click', () => {
            if (state.lastResult) {
                addToHistory(state.lastResult);
                dom.saveResultBtn.textContent = '✅ Gespeichert!';
                dom.saveResultBtn.disabled = true;
                setTimeout(() => {
                    dom.saveResultBtn.innerHTML = '<span class="btn__icon">💾</span><span class="btn__text">Ergebnis speichern</span>';
                    dom.saveResultBtn.disabled = false;
                }, 2000);
            }
        });

        // New test from result screen
        dom.newTestBtn.addEventListener('click', () => {
            resetToIdle();
            setTimeout(startTest, 300);
        });

        // Clear history
        dom.clearHistoryBtn.addEventListener('click', clearHistory);

        // Smooth scroll for hero
        dom.startBtn.addEventListener('click', () => {
            setTimeout(() => {
                dom.recorder.scrollIntoView({ behavior: 'smooth' });
            }, 100);
        });
    }

    // ============================
    // Init
    // ============================
    function init() {
        initBackgroundParticles();
        initScrollReveal();
        bindEvents();
        renderHistory();
    }

    // Wait for DOM
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
