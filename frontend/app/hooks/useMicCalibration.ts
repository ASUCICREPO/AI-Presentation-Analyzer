import { useState, useRef, useCallback, useEffect } from 'react';

const WORKLET_SAMPLE_RATE = 16000;
const EMA_ALPHA = 0.3;
const VOLUME_MAX_RMS = 0.15;

export interface MicCalibrationState {
    /** 0–100 normalized volume level */
    volume: number;
    /** Whether the mic has detected speech above a minimum threshold */
    hasSpeechDetected: boolean;
    /** Whether the mic level is clipping / too loud */
    isTooLoud: boolean;
    /** Whether calibration is actively listening */
    isListening: boolean;
    /** Error message if mic setup failed */
    error: string | null;
}

export interface MicCalibrationReturn extends MicCalibrationState {
    start: (stream: MediaStream) => Promise<void>;
    stop: () => void;
}

const SPEECH_THRESHOLD = 8;   // volume must exceed this to count as "speech detected"
const LOUD_THRESHOLD = 92;    // above this is clipping territory

export function useMicCalibration(): MicCalibrationReturn {
    const [state, setState] = useState<MicCalibrationState>({
        volume: 0,
        hasSpeechDetected: false,
        isTooLoud: false,
        isListening: false,
        error: null,
    });

    const audioCtxRef = useRef<AudioContext | null>(null);
    const workletRef = useRef<AudioWorkletNode | null>(null);
    const emaRef = useRef(0);
    const activeRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const speechDetectedRef = useRef(false);

    // Use rAF to throttle state updates (~60fps max, but we only update when volume changes meaningfully)
    const lastVolumeRef = useRef(0);

    const updateVolume = useCallback(() => {
        if (!activeRef.current) return;

        const normalized = Math.round(Math.min(100, (emaRef.current / VOLUME_MAX_RMS) * 100));

        // Only update state if volume changed by at least 1 unit
        if (Math.abs(normalized - lastVolumeRef.current) >= 1) {
            lastVolumeRef.current = normalized;
            const tooLoud = normalized >= LOUD_THRESHOLD;
            if (normalized >= SPEECH_THRESHOLD) speechDetectedRef.current = true;

            setState(prev => ({
                ...prev,
                volume: normalized,
                isTooLoud: tooLoud,
                hasSpeechDetected: speechDetectedRef.current,
            }));
        }

        rafRef.current = requestAnimationFrame(updateVolume);
    }, []);

    const start = useCallback(async (stream: MediaStream) => {
        setState(prev => ({ ...prev, error: null, isListening: false }));
        emaRef.current = 0;
        lastVolumeRef.current = 0;
        speechDetectedRef.current = false;

        try {
            const audioCtx = new AudioContext({ sampleRate: WORKLET_SAMPLE_RATE });
            audioCtxRef.current = audioCtx;

            if (audioCtx.state === 'suspended') await audioCtx.resume();

            const source = audioCtx.createMediaStreamSource(stream);
            await audioCtx.audioWorklet.addModule('/audio-capture-processor.js');
            const worklet = new AudioWorkletNode(audioCtx, 'audio-capture-processor');
            workletRef.current = worklet;

            source.connect(worklet);
            worklet.connect(audioCtx.destination);

            worklet.port.onmessage = (e: MessageEvent<Float32Array>) => {
                if (!activeRef.current) return;
                const samples = e.data;
                let sum = 0;
                for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
                const rms = Math.sqrt(sum / samples.length);
                emaRef.current = EMA_ALPHA * rms + (1 - EMA_ALPHA) * emaRef.current;
            };

            activeRef.current = true;
            setState(prev => ({ ...prev, isListening: true }));
            rafRef.current = requestAnimationFrame(updateVolume);
        } catch (err) {
            const msg = err instanceof Error ? err.message : 'Microphone setup failed';
            setState(prev => ({ ...prev, error: msg }));
        }
    }, [updateVolume]);

    const stop = useCallback(() => {
        activeRef.current = false;

        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }

        if (workletRef.current) {
            workletRef.current.port.postMessage('stop');
            workletRef.current.disconnect();
            workletRef.current = null;
        }

        if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
            audioCtxRef.current.close();
            audioCtxRef.current = null;
        }

        setState({
            volume: 0,
            hasSpeechDetected: false,
            isTooLoud: false,
            isListening: false,
            error: null,
        });
    }, []);

    useEffect(() => {
        return () => { if (activeRef.current) stop(); };
    }, [stop]);

    return { ...state, start, stop };
}
