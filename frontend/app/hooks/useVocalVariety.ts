'use client';

import { useRef, useState, useCallback } from 'react';

export interface VocalVarietyMetrics {
    pitchVariation: number;
    volumeVariation: number;
    spectralVariation: number;
    monotoneScore: number;
}

function stdDev(arr: number[]): number {
    if (arr.length < 2) return 0;
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) ** 2, 0) / arr.length;
    return Math.sqrt(variance);
}

function toScore(std: number, threshold: number): number {
    return Math.min(100, Math.max(0, Math.round((std / threshold) * 100)));
}

// Simple zero-crossing rate calculation
function calculateZCR(samples: Float32Array): number {
    let crossings = 0;
    for (let i = 1; i < samples.length; i++) {
        if ((samples[i] >= 0 && samples[i - 1] < 0) || (samples[i] < 0 && samples[i - 1] >= 0)) {
            crossings++;
        }
    }
    return crossings / samples.length;
}

// Simple spectral centroid approximation
function calculateSpectralCentroid(samples: Float32Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += Math.abs(samples[i]);
    }
    return sum / samples.length;
}

export function useVocalVariety() {
    const [metrics, setMetrics] = useState<VocalVarietyMetrics>({
        pitchVariation: 0,
        volumeVariation: 0,
        spectralVariation: 0,
        monotoneScore: 0,
    });

    const audioContextRef = useRef<AudioContext | null>(null);
    const workletNodeRef = useRef<AudioWorkletNode | null>(null);
    const timerRef = useRef<number | null>(null);
    const rmsHistory = useRef<number[]>([]);
    const zcrHistory = useRef<number[]>([]);
    const spectralHistory = useRef<number[]>([]);
    const activeRef = useRef(false);

    const startAnalysis = useCallback(async (stream: MediaStream) => {
        // Prevent multiple initializations
        if (activeRef.current) {
            return;
        }

        // Reset history
        rmsHistory.current = [];
        zcrHistory.current = [];
        spectralHistory.current = [];
        activeRef.current = true;

        try {
            const audioContext = new AudioContext({ sampleRate: 48000 });
            audioContextRef.current = audioContext;

            // Resume context if suspended
            if (audioContext.state === 'suspended') {
                await audioContext.resume();
            }

            const source = audioContext.createMediaStreamSource(stream);

            // Load the audio worklet
            await audioContext.audioWorklet.addModule('/audio-capture-processor.js');

            // Create worklet node
            const workletNode = new AudioWorkletNode(audioContext, 'audio-capture-processor');
            workletNodeRef.current = workletNode;

            // Connect the audio graph
            source.connect(workletNode);
            workletNode.connect(audioContext.destination);

            // Listen for audio data
            workletNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
                if (!activeRef.current) return;

                const samples = e.data;

                // Calculate RMS
                let sumSquares = 0;
                for (let i = 0; i < samples.length; i++) {
                    sumSquares += samples[i] * samples[i];
                }
                const rms = Math.sqrt(sumSquares / samples.length);

                // Only process if there's actual audio (not silence)
                if (rms > 0.01) {
                    const zcr = calculateZCR(samples);
                    const spectral = calculateSpectralCentroid(samples);

                    rmsHistory.current.push(rms);
                    zcrHistory.current.push(zcr);
                    spectralHistory.current.push(spectral);
                }
            };

            // Calculate metrics every 30 seconds
            timerRef.current = window.setInterval(() => {
                if (rmsHistory.current.length < 10) {
                    return;
                }

                const pitchVar = toScore(stdDev(zcrHistory.current), 0.05);
                const volumeVar = toScore(stdDev(rmsHistory.current), 0.02);
                const spectralVar = toScore(stdDev(spectralHistory.current), 0.1);
                const monotone = Math.max(0, 100 - Math.round((pitchVar + volumeVar + spectralVar) / 3));

                setMetrics({
                    pitchVariation: pitchVar,
                    volumeVariation: volumeVar,
                    spectralVariation: spectralVar,
                    monotoneScore: monotone
                });

                // Reset for next window
                rmsHistory.current = [];
                zcrHistory.current = [];
                spectralHistory.current = [];
            }, 10000);
        } catch (error) {
            console.error('[VocalVariety] Error during setup:', error);
            activeRef.current = false;
        }
    }, []);

    const stopAnalysis = useCallback(() => {
        activeRef.current = false;

        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }

        if (workletNodeRef.current) {
            workletNodeRef.current.port.postMessage('stop');
            workletNodeRef.current.disconnect();
            workletNodeRef.current = null;
        }

        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }

        rmsHistory.current = [];
        zcrHistory.current = [];
        spectralHistory.current = [];
    }, []);

    const resetAnalysis = useCallback(() => {
        rmsHistory.current = [];
        zcrHistory.current = [];
        spectralHistory.current = [];
        setMetrics({ pitchVariation: 0, volumeVariation: 0, spectralVariation: 0, monotoneScore: 0 });
    }, []);

    return { metrics, startAnalysis, stopAnalysis, resetAnalysis };
}
