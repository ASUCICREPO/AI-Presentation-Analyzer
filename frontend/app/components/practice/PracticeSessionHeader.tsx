import React from 'react';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { PRESENTATION_LIMITS } from '../../config/config';

interface PracticeSessionHeaderProps {
  onBack: () => void;
  timer: number;
  maxDurationSec: number;
  personaTitle: string;
  showFeedback: boolean;
  onToggleFeedback: () => void;
}

export default function PracticeSessionHeader({ 
  onBack, 
  timer, 
  maxDurationSec,
  personaTitle,
  showFeedback,
  onToggleFeedback,
}: PracticeSessionHeaderProps) {
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const remaining = maxDurationSec - timer;
  const isNearEnd = remaining <= PRESENTATION_LIMITS.FINAL_WARNING_REMAINING_SEC;
  const isWarning = remaining <= PRESENTATION_LIMITS.WARNING_REMAINING_SEC;

  return (
    <div className="mb-3 flex items-center justify-between 2xl:mb-6">
      <div className="flex items-start gap-4">
        <button 
          onClick={onBack}
          className="group mt-1 flex h-10 w-10 items-center justify-center rounded-full bg-white border border-gray-200 text-gray-500 shadow-sm transition-all duration-300 ease-out hover:border-maroon-200 hover:bg-maroon-50 hover:text-maroon-700 hover:shadow-md"
          title="Exit Session"
        >
          <ArrowLeft className="w-5 h-5 transition-transform duration-300 ease-out group-hover:-translate-x-1" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-gray-900 font-serif italic sm:text-2xl 2xl:text-4xl">
            Practice Your Presentation
          </h1>
          <p className="mt-1 text-sm text-gray-500 font-sans 2xl:text-xl">
            Presenting to: <span className="text-maroon-700 font-medium">{personaTitle}</span>
          </p>
        </div>
      </div>
      
      <div className="text-right flex items-center gap-4">
        {/* Real-time Feedback Toggle */}
        <button
          onClick={onToggleFeedback}
          className={`
            flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium
            transition-all duration-200
            2xl:px-4 2xl:py-2.5 2xl:text-sm
            ${showFeedback
              ? 'border-maroon-200 bg-maroon-50 text-maroon-700 hover:bg-maroon-100'
              : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300 hover:bg-gray-50'
            }
          `}
          title={showFeedback ? 'Hide real-time feedback panel' : 'Show real-time feedback panel'}
        >
          <BarChart3 className="w-3.5 h-3.5 2xl:w-4 2xl:h-4" />
          <span className="hidden sm:inline">Live Feedback</span>
          <div
            className={`
              relative ml-1 inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200
              ${showFeedback ? 'bg-maroon' : 'bg-gray-300'}
            `}
          >
            <span
              className={`
                inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform duration-200 shadow-sm
                ${showFeedback ? 'translate-x-[18px]' : 'translate-x-[3px]'}
              `}
            />
          </div>
        </button>

        <div>
          <div
            className={`
              text-2xl font-bold font-mono 2xl:text-4xl transition-colors duration-300
              ${isNearEnd ? 'text-red-600' : isWarning ? 'text-amber-600' : 'text-gray-900'}
            `}
          >
            {formatTime(timer)}
          </div>
          <div className="text-xs text-gray-500 font-sans 2xl:text-base">
            {isWarning
              ? `${formatTime(remaining)} remaining`
              : 'Recording Time'}
          </div>
        </div>
      </div>
    </div>
  );
}
