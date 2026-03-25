'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils,
  FaceLandmarkerResult,
} from '@mediapipe/tasks-vision';

/** Must match the installed `@mediapipe/tasks-vision` version (see package.json). Using `@latest` here breaks when npm ships a newer WASM than your bundled JS. */
const MEDIAPIPE_TASKS_VISION_VERSION = '0.10.32';

export interface UseFaceLandmarkerOptions {
  numFaces?: number;
  minFaceDetectionConfidence?: number;
  minFacePresenceConfidence?: number;
  minTrackingConfidence?: number;
  outputFaceBlendshapes?: boolean;
  outputFacialTransformationMatrixes?: boolean;
}

export interface UseFaceLandmarkerReturn {
  status: 'idle' | 'loading' | 'ready' | 'running' | 'error';
  error: string | null;
  lastResult: FaceLandmarkerResult | null;
  detectForVideo: (video: HTMLVideoElement, timestamp: number) => FaceLandmarkerResult | null;
  drawResults: (canvas: HTMLCanvasElement, result: FaceLandmarkerResult) => void;
}

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

export function useFaceLandmarker(options: UseFaceLandmarkerOptions = {}): UseFaceLandmarkerReturn {
  const {
    numFaces = 1,
    minFaceDetectionConfidence = 0.5,
    minFacePresenceConfidence = 0.5,
    minTrackingConfidence = 0.5,
    outputFaceBlendshapes = true,
    outputFacialTransformationMatrixes = false,
  } = options;

  const [status, setStatus] = useState<UseFaceLandmarkerReturn['status']>('idle');
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<FaceLandmarkerResult | null>(null);
  
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);
  const drawingUtilsRef = useRef<DrawingUtils | null>(null);

  // Initialize FaceLandmarker
  useEffect(() => {
    if (typeof window === 'undefined') return;

    let isMounted = true;

    const initFaceLandmarker = async () => {
      setStatus('loading');
      setError(null);

      try {
        // Load WASM from the same package version as the imported JS API.
        const wasmBase = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MEDIAPIPE_TASKS_VISION_VERSION}/wasm`;
        const vision = await FilesetResolver.forVisionTasks(wasmBase);

        const createWithDelegate = (delegate: 'GPU' | 'CPU') =>
          FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: MODEL_URL,
              delegate,
            },
            runningMode: 'VIDEO',
            numFaces,
            minFaceDetectionConfidence,
            minFacePresenceConfidence,
            minTrackingConfidence,
            outputFaceBlendshapes,
            outputFacialTransformationMatrixes,
          });

        let landmarker: FaceLandmarker;
        try {
          landmarker = await createWithDelegate('GPU');
        } catch (gpuErr) {
          console.warn('FaceLandmarker GPU init failed, falling back to CPU:', gpuErr);
          landmarker = await createWithDelegate('CPU');
        }

        if (isMounted) {
          faceLandmarkerRef.current = landmarker;
          setStatus('ready');
        }
      } catch (err) {
        console.error('Failed to initialize FaceLandmarker:', err);
        if (isMounted) {
          setError(err instanceof Error ? err.message : 'Failed to initialize face detection');
          setStatus('error');
        }
      }
    };

    initFaceLandmarker();

    return () => {
      isMounted = false;
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
    };
  }, [
    numFaces,
    minFaceDetectionConfidence,
    minFacePresenceConfidence,
    minTrackingConfidence,
    outputFaceBlendshapes,
    outputFacialTransformationMatrixes,
  ]);

  // Detect faces in video frame
  const detectForVideo = useCallback((video: HTMLVideoElement, timestamp: number): FaceLandmarkerResult | null => {
    if (!faceLandmarkerRef.current || status !== 'ready') {
      return null;
    }

    try {
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        const result = faceLandmarkerRef.current.detectForVideo(video, timestamp);
        setLastResult(result);
        return result;
      }
      return null;
    } catch (err) {
      console.error('Detection error:', err);
      return null;
    }
  }, [status]);

  // Draw results on canvas
  const drawResults = useCallback((canvas: HTMLCanvasElement, result: FaceLandmarkerResult) => {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize drawing utils if needed
    if (!drawingUtilsRef.current) {
      drawingUtilsRef.current = new DrawingUtils(ctx);
    }

    const drawingUtils = drawingUtilsRef.current;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw each face's landmarks
    if (result.faceLandmarks) {
      for (const landmarks of result.faceLandmarks) {
        // Draw face mesh tesselation (the mesh connecting landmarks)
        drawingUtils.drawConnectors(
          landmarks,
          FaceLandmarker.FACE_LANDMARKS_TESSELATION,
          { color: '#C0C0C070', lineWidth: 1 }
        );

        // Draw face contours
        drawingUtils.drawConnectors(
          landmarks,
          FaceLandmarker.FACE_LANDMARKS_FACE_OVAL,
          { color: '#E0E0E0', lineWidth: 2 }
        );

        // Draw lips
        drawingUtils.drawConnectors(
          landmarks,
          FaceLandmarker.FACE_LANDMARKS_LIPS,
          { color: '#800001', lineWidth: 2 }
        );

        // Draw left eye
        drawingUtils.drawConnectors(
          landmarks,
          FaceLandmarker.FACE_LANDMARKS_LEFT_EYE,
          { color: '#30FF30', lineWidth: 2 }
        );

        // Draw left eyebrow
        drawingUtils.drawConnectors(
          landmarks,
          FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW,
          { color: '#30FF30', lineWidth: 2 }
        );

        // Draw right eye
        drawingUtils.drawConnectors(
          landmarks,
          FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE,
          { color: '#3030FF', lineWidth: 2 }
        );

        // Draw right eyebrow
        drawingUtils.drawConnectors(
          landmarks,
          FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW,
          { color: '#3030FF', lineWidth: 2 }
        );

        // Draw left iris
        drawingUtils.drawConnectors(
          landmarks,
          FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS,
          { color: '#00FF00', lineWidth: 1 }
        );

        // Draw right iris
        drawingUtils.drawConnectors(
          landmarks,
          FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS,
          { color: '#0000FF', lineWidth: 1 }
        );
      }
    }
  }, []);

  return {
    status,
    error,
    lastResult,
    detectForVideo,
    drawResults,
  };
}
