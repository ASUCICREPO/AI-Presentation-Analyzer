'use client';

import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config/config';
import { useAuth } from '../context/AuthContext';

interface SessionReportProps {
  sessionID: string;
  onBack: () => void;
}

interface Report {
  sessionID: string;
  userID: string;
  personaID: string;
  date: string;
  engagementScore: number;
  normalizedScores: {
    wpmScore: number;
    eyeContactScore: number;
    fillerWordsScore: number;
    volumeScore: number;
  };
  rawMetrics: {
    avgWpm: number;
    avgVolume: number;
    volumeVariance: number;
    fillerWordsCount: number;
    eyeContactLookAwaySeconds: number;
    pausesCount: number;
    duration: number;
  };
  feedback: {
    strengths: string[];
    improvements: string[];
    personaRecommendations: string[];
    keyTakeaway: string;
    overallAssessment: string;
  };
  transcript: string;
}

export default function SessionReport({ sessionID, onBack }: SessionReportProps) {
  const { getIdToken } = useAuth();
  const [status, setStatus] = useState<'processing' | 'completed' | 'error'>('processing');
  const [report, setReport] = useState<Report | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Poll for completion via SSE
  useEffect(() => {
    let pollInterval: NodeJS.Timeout;

    const pollStatus = async () => {
      try {
        const token = await getIdToken();
        const response = await fetch(`${API_BASE_URL}/sse/${sessionID}`, {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        if (!response.ok) {
          throw new Error('Failed to poll status');
        }

        const text = await response.text();

        // Parse SSE format: "data: {...}\n\n"
        if (text.startsWith('data:')) {
          const jsonStr = text.substring(5).trim();
          const data = JSON.parse(jsonStr);

          if (data.status === 'completed') {
            setStatus('completed');
            await fetchReport();
          } else if (data.status === 'failed') {
            setStatus('error');
            setError('Analysis failed. Please try again.');
          }
        }
      } catch (err) {
        console.error('[ERROR] Failed to poll status:', err);
      }
    };

    // Poll every 2 seconds
    pollInterval = setInterval(pollStatus, 2000);
    pollStatus(); // Initial poll

    return () => clearInterval(pollInterval);
  }, [sessionID, getIdToken]);

  const fetchReport = async () => {
    try {
      const token = await getIdToken();

      // Get presigned URLs for report.json and report.pdf
      const urlsResponse = await fetch(`${API_BASE_URL}/report_urls/${sessionID}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!urlsResponse.ok) {
        throw new Error('Failed to get report URLs');
      }

      const { reportJsonUrl, reportPdfUrl } = await urlsResponse.json();

      // Fetch report.json
      const reportResponse = await fetch(reportJsonUrl);
      if (!reportResponse.ok) {
        throw new Error('Failed to fetch report');
      }

      const reportData = await reportResponse.json();
      setReport(reportData);
      setPdfUrl(reportPdfUrl);
    } catch (err) {
      console.error('[ERROR] Failed to fetch report:', err);
      setStatus('error');
      setError('Failed to load report data.');
    }
  };

  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreBgColor = (score: number): string => {
    if (score >= 80) return 'bg-green-100';
    if (score >= 60) return 'bg-yellow-100';
    return 'bg-red-100';
  };

  if (status === 'processing') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-16 w-16 border-t-2 border-b-2 border-blue-600 mb-4"></div>
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">Analyzing Your Presentation...</h2>
          <p className="text-gray-600">AI is processing your performance metrics</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-md">
          <div className="text-red-600 text-6xl mb-4">⚠️</div>
          <h2 className="text-2xl font-semibold text-gray-800 mb-2">Analysis Failed</h2>
          <p className="text-gray-600 mb-6">{error || 'Something went wrong. Please try again.'}</p>
          <button
            onClick={onBack}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  if (!report) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-5xl mx-auto px-4">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h1 className="text-3xl font-bold text-gray-800">Presentation Report</h1>
          <button
            onClick={onBack}
            className="px-4 py-2 text-gray-600 hover:text-gray-800"
          >
            ← Back
          </button>
        </div>

        {/* Engagement Score */}
        <div className={`rounded-xl p-8 mb-6 ${getScoreBgColor(report.engagementScore)}`}>
          <div className="text-center">
            <p className="text-gray-700 text-sm uppercase tracking-wide mb-2">Overall Engagement Score</p>
            <p className={`text-6xl font-bold ${getScoreColor(report.engagementScore)}`}>
              {report.engagementScore.toFixed(1)}
            </p>
            <p className="text-gray-600 mt-2">{report.feedback.overallAssessment}</p>
          </div>
        </div>

        {/* Performance Metrics */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">Performance Metrics</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <MetricCard
              title="Speaking Pace"
              score={report.normalizedScores.wpmScore}
              rawValue={`${report.rawMetrics.avgWpm.toFixed(0)} WPM`}
            />
            <MetricCard
              title="Eye Contact"
              score={report.normalizedScores.eyeContactScore}
              rawValue={`${report.rawMetrics.eyeContactLookAwaySeconds.toFixed(1)}s away`}
            />
            <MetricCard
              title="Filler Words"
              score={report.normalizedScores.fillerWordsScore}
              rawValue={`${report.rawMetrics.fillerWordsCount} total`}
            />
            <MetricCard
              title="Volume & Clarity"
              score={report.normalizedScores.volumeScore}
              rawValue={`Avg ${report.rawMetrics.avgVolume.toFixed(0)}%`}
            />
          </div>
        </div>

        {/* AI Feedback */}
        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">AI-Powered Feedback</h2>

          {/* Strengths */}
          {report.feedback.strengths.length > 0 && (
            <div className="mb-4">
              <h3 className="font-semibold text-green-700 mb-2">💪 Strengths</h3>
              <ul className="list-disc list-inside space-y-1">
                {report.feedback.strengths.map((strength, idx) => (
                  <li key={idx} className="text-gray-700">{strength}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Improvements */}
          {report.feedback.improvements.length > 0 && (
            <div className="mb-4">
              <h3 className="font-semibold text-orange-700 mb-2">📈 Areas for Improvement</h3>
              <ul className="list-disc list-inside space-y-1">
                {report.feedback.improvements.map((improvement, idx) => (
                  <li key={idx} className="text-gray-700">{improvement}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Persona Recommendations */}
          {report.feedback.personaRecommendations.length > 0 && (
            <div className="mb-4">
              <h3 className="font-semibold text-blue-700 mb-2">🎯 Persona-Specific Recommendations</h3>
              <ul className="list-disc list-inside space-y-1">
                {report.feedback.personaRecommendations.map((rec, idx) => (
                  <li key={idx} className="text-gray-700">{rec}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Key Takeaway */}
          {report.feedback.keyTakeaway && (
            <div className="mt-6 p-4 bg-blue-50 rounded-lg border-l-4 border-blue-600">
              <h3 className="font-semibold text-blue-900 mb-2">🔑 Key Takeaway</h3>
              <p className="text-gray-800">{report.feedback.keyTakeaway}</p>
            </div>
          )}
        </div>

        {/* Transcript */}
        {report.transcript && (
          <div className="bg-white rounded-xl shadow-md p-6 mb-6">
            <h2 className="text-xl font-semibold text-gray-800 mb-4">Transcript</h2>
            <div className="bg-gray-50 p-4 rounded-lg max-h-96 overflow-y-auto">
              <p className="text-gray-700 whitespace-pre-wrap">{report.transcript}</p>
            </div>
          </div>
        )}

        {/* Download PDF */}
        {pdfUrl && (
          <div className="text-center">
            <a
              href={pdfUrl}
              download={`presentation-report-${sessionID}.pdf`}
              className="inline-block px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 shadow-md"
            >
              📥 Download PDF Report
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function MetricCard({ title, score, rawValue }: { title: string; score: number; rawValue: string }) {
  const getColor = (s: number) => {
    if (s >= 80) return 'bg-green-500';
    if (s >= 60) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4">
      <div className="flex justify-between items-center mb-2">
        <p className="font-medium text-gray-800">{title}</p>
        <p className="text-sm text-gray-600">{score.toFixed(1)}/100</p>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
        <div
          className={`h-2 rounded-full ${getColor(score)}`}
          style={{ width: `${score}%` }}
        ></div>
      </div>
      <p className="text-sm text-gray-600">{rawValue}</p>
    </div>
  );
}
