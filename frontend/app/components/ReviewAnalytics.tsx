'use client';

import React, { useState, useEffect, useRef } from 'react';
import { SessionAnalytics } from '../hooks/useSessionAnalytics';
import { AIFeedbackResponse, QAAnalyticsResponse, getVideoPlaybackUrl } from '../services/api';
import {
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  X,
  Gauge,
  Eye,
  Volume2,
  MessageCircle,
  Timer,
  Clock,
  Play,
  RotateCcw,
  Loader2,
  Info,
} from 'lucide-react';
import { pdf } from '@react-pdf/renderer';
import { ReportDocument } from './ReportPDF';

import { CustomVideoPlayer, CustomVideoPlayerHandle } from './CustomVideoPlayer';
import InfoTooltip from './InfoTooltip';

import {
  Persona,
  PersonaBestPractices,
  PersonaScoringWeights,
  DEFAULT_BEST_PRACTICES,
  DEFAULT_SCORING_WEIGHTS,
} from '../config/config';

interface ReviewAnalyticsProps {
  sessionData: SessionAnalytics;
  aiFeedback: AIFeedbackResponse | null;
  qaAnalytics: QAAnalyticsResponse | null;
  persona: Persona | null;
  onBackToStart: () => void;
}

function resolveBestPractices(persona: Persona | null): PersonaBestPractices {
  if (!persona?.bestPractices) return DEFAULT_BEST_PRACTICES;
  return { ...DEFAULT_BEST_PRACTICES, ...persona.bestPractices };
}

function resolveScoringWeights(persona: Persona | null): PersonaScoringWeights {
  if (!persona?.scoringWeights) return DEFAULT_SCORING_WEIGHTS;
  return { ...DEFAULT_SCORING_WEIGHTS, ...persona.scoringWeights };
}

function buildBestPracticeChecks(bp: PersonaBestPractices) {
  return {
    wpm: {
      label: bp.wpm.label ?? 'Speaking Pace',
      range: `${bp.wpm.min}-${bp.wpm.max} wpm`,
      check: (v: number) => v >= bp.wpm.min && v <= bp.wpm.max,
    },
    eyeContact: {
      label: bp.eyeContact.label ?? 'Eye Contact',
      range: `${bp.eyeContact.min}%+`,
      check: (v: number) => v >= bp.eyeContact.min,
    },
    fillers: {
      label: bp.fillerWords.label ?? 'Filler Words',
      range: `${bp.fillerWords.max} or fewer`,
      check: (v: number) => v <= bp.fillerWords.max,
    },
    pauses: {
      label: bp.pauses.label ?? 'Strategic Pauses',
      range: `${bp.pauses.min}+ pauses`,
      check: (v: number) => v >= bp.pauses.min,
    },
  };
}

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;
  const color = score >= 80 ? '#16a34a' : score >= 60 ? '#ca8a04' : '#dc2626';

  return (
    <div className="relative h-40 w-40 flex-shrink-0">
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
        <circle cx="64" cy="64" r={radius} fill="none" stroke="#e5e7eb" strokeWidth="8" />
        <circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference - progress}`}
          className="transition-all duration-1000 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold text-gray-900">{score}</span>
        <span className="text-xs text-gray-500">Overall Score</span>
      </div>
    </div>
  );
}

function MetricBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div className="h-2.5 w-full rounded-full bg-gray-200">
      <div className={`h-full rounded-full ${color} transition-all duration-700 ease-out`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function ReviewAnalytics({ sessionData, aiFeedback, qaAnalytics, persona, onBackToStart }: ReviewAnalyticsProps) {
  const { windows } = sessionData;
  const [showWindows, setShowWindows] = useState(false);
  const [dismissedBanner, setDismissedBanner] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isPdfLoading, setIsPdfLoading] = useState(false);
  const [isVideoDownloading, setIsVideoDownloading] = useState(false);
  const videoRef = useRef<CustomVideoPlayerHandle>(null);

  // Fetch video playback URL on mount
  useEffect(() => {
    getVideoPlaybackUrl(sessionData.sessionId).then(setVideoUrl);
  }, [sessionData.sessionId]);

  const bp = resolveBestPractices(persona);
  const weights = resolveScoringWeights(persona);
  const BEST_PRACTICES = buildBestPracticeChecks(bp);

  const stats = (() => {
    if (windows.length === 0) return null;
    const avgWpm = Math.round(windows.reduce((s, w) => s + w.speakingPace.average, 0) / windows.length);
    const avgVolume = Math.round(windows.reduce((s, w) => s + w.volumeLevel.average, 0) / windows.length);
    const avgEyeContact = Math.round(windows.reduce((s, w) => s + w.eyeContactScore, 0) / windows.length);
    const totalFillers = windows.reduce((s, w) => s + w.fillerWords, 0);
    const totalPauses = windows.reduce((s, w) => s + w.pauses, 0);
    return { avgWpm, avgVolume, avgEyeContact, totalFillers, totalPauses };
  })();

  const overallScore = (() => {
    if (!stats) return 0;
    const wpmOuter = bp.wpm.max - bp.wpm.min;
    const paceScore = BEST_PRACTICES.wpm.check(stats.avgWpm) ? 100
      : stats.avgWpm >= bp.wpm.min - wpmOuter && stats.avgWpm <= bp.wpm.max + wpmOuter ? 70 : 40;
    const eyeScore = Math.min(stats.avgEyeContact, 100);
    const fillerScore = stats.totalFillers <= bp.fillerWords.max ? 100
      : stats.totalFillers <= bp.fillerWords.max * 2 ? 70 : 40;
    const pauseScore = stats.totalPauses >= bp.pauses.min ? 100
      : stats.totalPauses >= Math.floor(bp.pauses.min / 2) ? 70 : 40;
    return Math.round(
      paceScore * weights.pace +
      eyeScore * weights.eyeContact +
      fillerScore * weights.fillerWords +
      pauseScore * weights.pauses
    );
  })();

  const getBarColor = (score: number, type: 'wpm' | 'volume' | 'eyeContact') => {
    if (type === 'wpm') {
      const wpmOuter = bp.wpm.max - bp.wpm.min;
      return BEST_PRACTICES.wpm.check(score) ? 'bg-green-500'
        : score >= bp.wpm.min - wpmOuter && score <= bp.wpm.max + wpmOuter ? 'bg-yellow-500' : 'bg-red-500';
    }
    if (type === 'volume') return score >= 40 && score <= 80 ? 'bg-green-500' : score >= 20 ? 'bg-yellow-500' : 'bg-red-500';
    return score >= bp.eyeContact.min ? 'bg-green-500' : score >= bp.eyeContact.min - 20 ? 'bg-yellow-500' : 'bg-red-500';
  };

  const getTrendIcon = (current: number, previous: number) => {
    if (current > previous) return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (current < previous) return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <Minus className="h-4 w-4 text-gray-400" />;
  };

  const getScoreColor = (score: number, type: 'wpm' | 'volume' | 'eyeContact') => {
    if (type === 'wpm') {
      const wpmOuter = bp.wpm.max - bp.wpm.min;
      return BEST_PRACTICES.wpm.check(score) ? 'text-green-600'
        : score >= bp.wpm.min - wpmOuter && score <= bp.wpm.max + wpmOuter ? 'text-yellow-600' : 'text-red-600';
    }
    if (type === 'volume') return score >= 40 && score <= 80 ? 'text-green-600' : score >= 20 ? 'text-yellow-600' : 'text-red-600';
    return score >= bp.eyeContact.min ? 'text-green-600' : score >= bp.eyeContact.min - 20 ? 'text-yellow-600' : 'text-red-600';
  };

  const feedbackPersona = aiFeedback?.persona;

  const handleDownloadPdf = async () => {
    if (isPdfLoading) return;
    setIsPdfLoading(true);
    try {
      const blob = await pdf(
        <ReportDocument
          sessionData={sessionData}
          aiFeedback={aiFeedback}
          qaAnalytics={qaAnalytics}
          stats={stats}
          overallScore={overallScore}
          feedbackPersonaLabel={feedbackPersona?.title || "Persona"}
          bp={bp}
          BEST_PRACTICES={BEST_PRACTICES}
        />
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `presentation_report_${sessionData.sessionId}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setIsPdfLoading(false);
    }
  };

  const handleDownloadVideo = async () => {
    if (isVideoDownloading || !videoUrl) return;
    setIsVideoDownloading(true);
    try {
      const res = await fetch(videoUrl);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `presentation_recording_${sessionData.sessionId}.webm`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Video download failed:', err);
    } finally {
      setIsVideoDownloading(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6">
      {/* No-AI Banner */}
      {!aiFeedback && !dismissedBanner && (
        <div className="mb-4 flex items-center justify-between rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            <p className="text-sm text-yellow-800">
              AI feedback could not be generated. Showing raw metrics only.
            </p>
          </div>
          <button onClick={() => setDismissedBanner(true)} className="text-yellow-600 hover:text-yellow-800">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Presentation Analysis</h1>
          {feedbackPersona && (
            <p className="mt-1 text-sm text-gray-600">
              Feedback tailored for: <span className="font-semibold text-maroon">{feedbackPersona.title}</span>
            </p>
          )}
          {!feedbackPersona && (
            <p className="mt-1 text-sm text-gray-600">
              {sessionData.personaTitle} &middot; {windows.length} windows recorded
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={handleDownloadPdf}
            disabled={isPdfLoading}
            className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
          >
            {isPdfLoading
              ? <Loader2 className="h-4 w-4 animate-spin" />
              : <Download className="h-4 w-4" />}
            {isPdfLoading ? 'Generating PDF...' : 'Download PDF'}
          </button>
          {videoUrl && (
            <button
              onClick={handleDownloadVideo}
              disabled={isVideoDownloading}
              className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
            >
              {isVideoDownloading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Download className="h-4 w-4" />}
              {isVideoDownloading ? 'Downloading...' : 'Download Video'}
            </button>
          )}
          <button
            onClick={onBackToStart}
            className="flex items-center gap-2 rounded-lg bg-maroon px-4 py-2 text-white hover:bg-maroon/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            New Practice Session
          </button>
        </div>
      </div>

      {/* Disclaimer */}
      <div className="mb-6 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-500" />
        <p className="text-xs leading-relaxed text-blue-800">
          This analysis evaluates presentation delivery (pace, eye contact, volume, filler words, pauses) and content quality (structure, clarity, arguments).
          It does not judge the factual accuracy of your content.
        </p>
      </div>

      {/* Performance Summary Card */}
      {stats && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-gradient-to-r from-green-50/60 to-white p-6 shadow-sm">
          <div className="flex flex-col items-center gap-6 md:flex-row md:items-start">
            <ScoreRing score={overallScore} />
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-gray-900">Performance Summary <InfoTooltip text="Your overall presentation score based on pace, eye contact, volume, filler words, and pauses — weighted by your selected persona." /></h2>
              {aiFeedback ? (
                <p className="mt-2 text-sm leading-relaxed text-gray-700">
                  {aiFeedback.performanceSummary.overallAssessment}
                </p>
              ) : (
                <p className="mt-2 text-sm leading-relaxed text-gray-700">
                  Session completed with {windows.length} analysis window{windows.length !== 1 ? 's' : ''}.
                  Review your detailed metrics below.
                </p>
              )}
              <div className="mt-4 flex flex-wrap gap-3">
                {BEST_PRACTICES.wpm.check(stats.avgWpm) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Good pacing
                  </span>
                )}
                {!BEST_PRACTICES.eyeContact.check(stats.avgEyeContact) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-yellow-100 px-3 py-1 text-xs font-medium text-yellow-800">
                    <AlertTriangle className="h-3.5 w-3.5" /> Improve eye contact
                  </span>
                )}
                {BEST_PRACTICES.fillers.check(stats.totalFillers) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Minimal fillers
                  </span>
                )}
                {BEST_PRACTICES.pauses.check(stats.totalPauses) && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-3 py-1 text-xs font-medium text-green-800">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Good use of pauses
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Video Playback + Timestamped Feedback */}
      {(videoUrl || (aiFeedback?.timestampedFeedback && aiFeedback.timestampedFeedback.length > 0)) && (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Left: Recording Playback */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">Recording Playback</h2>
            {videoUrl ? (
              <>
                <CustomVideoPlayer
                  ref={videoRef}
                  sessionId={sessionData.sessionId}
                  videoUrl={videoUrl}
                  className="relative overflow-hidden rounded-lg bg-gray-900"
                />
                <div className="mt-3 flex gap-3">
                  <button
                    onClick={() => { videoRef.current?.play(); }}
                    className="flex items-center gap-2 rounded-lg bg-maroon px-4 py-2 text-sm text-white hover:bg-maroon/90 transition-colors"
                  >
                    <Play className="h-4 w-4" /> Play Recording
                  </button>
                  <button
                    onClick={() => { videoRef.current?.seekTo(0); }}
                    className="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <RotateCcw className="h-4 w-4" /> Restart
                  </button>
                </div>
              </>
            ) : (
              <div className="flex h-48 items-center justify-center rounded-lg bg-gray-900">
                <p className="text-sm text-gray-400">Video recording unavailable</p>
              </div>
            )}
          </div>

          {/* Right: Timestamped Feedback */}
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-1 text-lg font-semibold text-gray-900">Timestamped Feedback <InfoTooltip text="Specific moments during your presentation where delivery metrics fell below best practice thresholds. Click any entry to jump to that point in the recording." /></h2>
            <p className="mb-4 text-sm text-gray-500">Moments where your delivery fell below best practices</p>
            {aiFeedback?.timestampedFeedback && aiFeedback.timestampedFeedback.length > 0 ? (
              <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {aiFeedback.timestampedFeedback.map((event, i) => {
                  const msg = event.message.toLowerCase();
                  const isEye = msg.includes('eye contact');
                  const isFiller = msg.includes('filler');
                  const isPace = msg.includes('pace');
                  const isPause = msg.includes('pause');
                  const isVolume = msg.includes('volume');

                  let borderColor = 'border-red-200';
                  let bgColor = 'bg-red-50';
                  let iconColor = 'text-red-500';
                  let Icon = AlertTriangle;

                  if (isFiller) {
                    borderColor = 'border-yellow-200'; bgColor = 'bg-yellow-50'; iconColor = 'text-yellow-500'; Icon = MessageCircle;
                  } else if (isPace) {
                    borderColor = 'border-yellow-200'; bgColor = 'bg-yellow-50'; iconColor = 'text-yellow-500'; Icon = Gauge;
                  } else if (isEye) {
                    borderColor = 'border-red-200'; bgColor = 'bg-red-50'; iconColor = 'text-red-500'; Icon = Eye;
                  } else if (isPause) {
                    borderColor = 'border-yellow-200'; bgColor = 'bg-yellow-50'; iconColor = 'text-yellow-500'; Icon = Clock;
                  } else if (isVolume) {
                    borderColor = 'border-yellow-200'; bgColor = 'bg-yellow-50'; iconColor = 'text-yellow-500'; Icon = Volume2;
                  }

                  return (
                    <button
                      key={i}
                      className={`flex w-full items-center gap-3 rounded-lg border ${borderColor} ${bgColor} px-4 py-3 text-left transition-colors hover:opacity-80`}
                      onClick={() => {
                        if (videoRef.current) {
                          // timestamp may be "MM:SS - MM:SS" range; seek to start time
                          const startPart = event.timestamp.split(' - ')[0];
                          const [min, sec] = startPart.split(':').map(Number);
                          videoRef.current.seekTo(min * 60 + sec);
                          videoRef.current.play();
                        }
                      }}
                    >
                      <span className="flex-shrink-0 rounded border border-gray-200 bg-white px-2 py-0.5 font-mono text-sm text-gray-700">
                        {event.timestamp}
                      </span>
                      <span className="flex-1 text-sm text-gray-800">{event.message}</span>
                      <Icon className={`h-5 w-5 flex-shrink-0 ${iconColor}`} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="flex h-32 items-center justify-center">
                <p className="text-sm text-gray-400">All metrics within best practices</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Two-Column: Metrics + Recommendations */}
      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Detailed Metrics */}
        {stats && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">Detailed Metrics <InfoTooltip text="Breakdown of your delivery metrics averaged across all 30-second analysis windows." /></h2>
            <div className="space-y-5">
              {/* Speaking Pace */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-gray-700"><Gauge className="h-4 w-4 text-blue-500" />Speaking Pace</span>
                  <span className="font-bold text-gray-900">{stats.avgWpm} wpm</span>
                </div>
                <MetricBar value={stats.avgWpm} max={200} color={getBarColor(stats.avgWpm, 'wpm')} />
                {aiFeedback && (
                  <p className="mt-1 text-xs text-gray-500">{aiFeedback.performanceSummary.deliveryFeedback.speakingPace}</p>
                )}
              </div>

              {/* Eye Contact */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-gray-700"><Eye className="h-4 w-4 text-purple-500" />Eye Contact</span>
                  <span className="font-bold text-gray-900">{stats.avgEyeContact}%</span>
                </div>
                <MetricBar value={stats.avgEyeContact} max={100} color={getBarColor(stats.avgEyeContact, 'eyeContact')} />
                {aiFeedback && (
                  <p className="mt-1 text-xs text-gray-500">{aiFeedback.performanceSummary.deliveryFeedback.eyeContact}</p>
                )}
              </div>

              {/* Volume */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-gray-700"><Volume2 className="h-4 w-4 text-teal-500" />Volume</span>
                  <span className="font-bold text-gray-900">{stats.avgVolume}%</span>
                </div>
                <MetricBar value={stats.avgVolume} max={100} color={getBarColor(stats.avgVolume, 'volume')} />
                {aiFeedback && (
                  <p className="mt-1 text-xs text-gray-500">{aiFeedback.performanceSummary.deliveryFeedback.volume}</p>
                )}
              </div>

              {/* Filler Words */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-gray-700"><MessageCircle className="h-4 w-4 text-orange-500" />Filler Words</span>
                  <span className={`font-bold ${stats.totalFillers <= bp.fillerWords.max ? 'text-green-600' : stats.totalFillers <= bp.fillerWords.max * 2 ? 'text-yellow-600' : 'text-red-600'}`}>
                    {stats.totalFillers} detected
                  </span>
                </div>
                {aiFeedback && (
                  <p className="mt-1 text-xs text-gray-500">{aiFeedback.performanceSummary.deliveryFeedback.fillerWords}</p>
                )}
              </div>

              {/* Strategic Pauses */}
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-gray-700"><Timer className="h-4 w-4 text-indigo-500" />Strategic Pauses</span>
                  <span className="font-bold text-gray-900">{stats.totalPauses}</span>
                </div>
                {aiFeedback && (
                  <p className="mt-1 text-xs text-gray-500">{aiFeedback.performanceSummary.deliveryFeedback.pauses}</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Key Recommendations */}
        {aiFeedback && aiFeedback.keyRecommendations.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 text-lg font-semibold text-gray-900">
              Key Recommendations{feedbackPersona ? ` for ${feedbackPersona.title}` : ''} <InfoTooltip text="AI-generated suggestions tailored to your selected audience persona to help improve your next presentation." />
            </h2>
            <div className="space-y-4">
              {aiFeedback.keyRecommendations.map((rec, i) => (
                <div key={i} className="flex gap-3">
                  <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-maroon text-xs font-bold text-white">
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900">{rec.title}</h3>
                    <p className="mt-0.5 text-xs leading-relaxed text-gray-600">{rec.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* If no AI feedback, show an empty placeholder in the right column */}
        {!aiFeedback && stats && (
          <div className="flex items-center justify-center rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6">
            <p className="text-sm text-gray-400">AI recommendations unavailable for this session.</p>
          </div>
        )}
      </div>

      {/* Content Strengths */}
      {aiFeedback && aiFeedback.performanceSummary.contentStrengths.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">Content Strengths <InfoTooltip text="Aspects of your presentation content that the AI identified as effective — structure, clarity, and argument quality." /></h2>
          <ul className="space-y-3">
            {aiFeedback.performanceSummary.contentStrengths.map((strength, i) => (
              <li key={i} className="flex gap-3 text-sm text-gray-700">
                <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-500" />
                <span className="leading-relaxed">{strength}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Q&A Session Feedback */}
      {qaAnalytics?.qaFeedback && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">Q&A Session Feedback <InfoTooltip text="Analysis of your responses during the Q&A session, including quality rating and per-question breakdown." /></h2>
            <span className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${qaAnalytics.qaFeedback.responseQuality === 'Excellent' ? 'bg-green-100 text-green-800' :
              qaAnalytics.qaFeedback.responseQuality === 'Good' ? 'bg-blue-100 text-blue-800' :
                'bg-yellow-100 text-yellow-800'
              }`}>
              {qaAnalytics.qaFeedback.responseQuality}
            </span>
          </div>

          <p className="mb-4 text-sm leading-relaxed text-gray-700">
            {qaAnalytics.qaFeedback.overallSummary}
          </p>

          <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <h3 className="mb-3 text-sm font-semibold text-green-800">Strengths</h3>
              <ul className="space-y-2">
                {qaAnalytics.qaFeedback.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-500" />
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
              <h3 className="mb-3 text-sm font-semibold text-amber-800">Areas to Improve</h3>
              <ul className="space-y-2">
                {qaAnalytics.qaFeedback.improvements.map((imp, i) => (
                  <li key={i} className="flex gap-2 text-sm text-gray-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                    <span>{imp}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {qaAnalytics.qaFeedback.questionBreakdown.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-medium text-gray-700">Per-Question Breakdown</h3>
              <div className="space-y-2">
                {qaAnalytics.qaFeedback.questionBreakdown.map((q, i) => (
                  <div key={i} className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                    <span className={`mt-0.5 inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${q.rating === 'Strong' ? 'bg-green-500' :
                      q.rating === 'Adequate' ? 'bg-blue-500' : 'bg-amber-500'
                      }`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-900 truncate">{q.question}</span>
                        <span className={`flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${q.rating === 'Strong' ? 'bg-green-100 text-green-700' :
                          q.rating === 'Adequate' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                          {q.rating}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-gray-500">{q.note}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="mt-3 text-xs text-gray-400">
            Based on {qaAnalytics.totalQuestions} question{qaAnalytics.totalQuestions !== 1 ? 's' : ''} and {qaAnalytics.totalResponses} response{qaAnalytics.totalResponses !== 1 ? 's' : ''}
          </p>
        </div>
      )}

      {/* Timestamped Feedback — removed, now in video+feedback section above */}

      {/* Comparison with Best Practices */}
      {stats && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
          <div className="border-b border-gray-200 px-6 py-4">
            <h2 className="text-lg font-semibold text-gray-900">Comparison with Best Practices <InfoTooltip text="How your metrics compare against established presentation best practices for your selected persona." /></h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Metric</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Your Performance</th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Best Practice</th>
                  <th className="px-6 py-3 text-center text-xs font-medium uppercase tracking-wider text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {[
                  { key: 'wpm' as const, value: stats.avgWpm, display: `${stats.avgWpm} wpm` },
                  { key: 'eyeContact' as const, value: stats.avgEyeContact, display: `${stats.avgEyeContact}%` },
                  { key: 'fillers' as const, value: stats.totalFillers, display: `${stats.totalFillers}` },
                  { key: 'pauses' as const, value: stats.totalPauses, display: `${stats.totalPauses}` },
                ].map((row) => {
                  const bp = BEST_PRACTICES[row.key];
                  const passing = bp.check(row.value);
                  return (
                    <tr key={row.key} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">{bp.label}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-bold text-gray-900">{row.display}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">{bp.range}</td>
                      <td className="whitespace-nowrap px-6 py-4 text-center">
                        {passing
                          ? <CheckCircle2 className="mx-auto h-5 w-5 text-green-500" />
                          : <AlertTriangle className="mx-auto h-5 w-5 text-yellow-500" />}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Collapsible 30-Second Window Analysis */}
      {windows.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
          <button
            onClick={() => setShowWindows(!showWindows)}
            className="flex w-full items-center justify-between border-b border-gray-200 px-6 py-4 text-left hover:bg-gray-50 transition-colors"
          >
            <h2 className="text-lg font-semibold text-gray-900">30-Second Window Analysis <InfoTooltip text="Your presentation is divided into 30-second windows. This table shows how your metrics changed over time." /></h2>
            {showWindows ? <ChevronUp className="h-5 w-5 text-gray-500" /> : <ChevronDown className="h-5 w-5 text-gray-500" />}
          </button>
          {showWindows && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Window</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Speaking Pace</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Volume</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Eye Contact</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Fillers</th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">Pauses</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {windows.map((w, index) => {
                    const prev = index > 0 ? windows[index - 1] : null;
                    return (
                      <tr key={w.windowNumber} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">#{w.windowNumber}</td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={getScoreColor(w.speakingPace.average, 'wpm')}>{w.speakingPace.average} WPM</span>
                            {prev && getTrendIcon(w.speakingPace.average, prev.speakingPace.average)}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={getScoreColor(w.volumeLevel.average, 'volume')}>{w.volumeLevel.average}%</span>
                            {prev && getTrendIcon(w.volumeLevel.average, prev.volumeLevel.average)}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <div className="flex items-center gap-2">
                            <span className={getScoreColor(w.eyeContactScore, 'eyeContact')}>{w.eyeContactScore}%</span>
                            {prev && getTrendIcon(w.eyeContactScore, prev.eyeContactScore)}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{w.fillerWords}</td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">{w.pauses}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {windows.length === 0 && !aiFeedback && (
        <div className="flex min-h-[40vh] items-center justify-center">
          <p className="text-gray-500">No analytics data available</p>
        </div>
      )}
    </div>
  );
}
