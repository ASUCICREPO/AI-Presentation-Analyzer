import React from 'react';
import { Volume2, VolumeX, Eye, Mic } from 'lucide-react';

interface RealTimeFeedbackPanelProps {
  isRecording: boolean;
  soundEnabled: boolean;
  onToggleSound: () => void;
  gazeStatus: {
    isLookingAtScreen: boolean;
    message: string;
    color: string;
  };
  metrics: {
    speakingPace: number;
    volumeLevel: number;
    fillerWords: number;
    pauses: number;
  };
}

export default function RealTimeFeedbackPanel({
  isRecording,
  soundEnabled,
  onToggleSound,
  gazeStatus,
  metrics
}: RealTimeFeedbackPanelProps) {
  // Compute pace bar width (target ~130-160wpm)
  const pacePercent = isRecording ? Math.min(100, Math.round((metrics.speakingPace / 180) * 100)) : 0;
  const paceColor = metrics.speakingPace > 0 && metrics.speakingPace < 110
    ? 'bg-yellow-500'
    : metrics.speakingPace > 170
      ? 'bg-red-500'
      : 'bg-green-500';

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-serif text-base font-bold text-gray-900 2xl:text-xl">Real-time Feedback</h3>
      </div>

      <div className={`space-y-4 2xl:space-y-5 ${!isRecording ? 'opacity-60 grayscale-[0.5]' : ''}`}>
        {/* Metric: Speaking Pace */}
        <div>
          <div className="flex justify-between text-sm 2xl:text-base">
            <span className="flex items-center gap-2 text-gray-600">
              <Volume2 className="w-4 h-4" />
              Speaking Pace
            </span>
            <span className="font-semibold text-gray-900">{isRecording ? metrics.speakingPace : '--'} wpm</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full bg-green-500 transition-all duration-500" style={{ width: isRecording ? '65%' : '0%' }} />
          </div>
          <div className="mt-0.5 text-[10px] text-gray-400">Target: 130-160 wpm</div>
        </div>

        {/* Metric: Volume Level */}
        <div>
          <div className="flex justify-between text-sm 2xl:text-base">
            <span className="flex items-center gap-2 text-gray-600">
              <Mic className="w-4 h-4" />
              Volume Level
            </span>
            <span className="font-semibold text-gray-900">{isRecording ? `${metrics.volumeLevel}%` : '--%'}</span>
          </div>
          <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: isRecording ? `${metrics.volumeLevel}%` : '0%' }} />
          </div>
          <div className="mt-0.5 text-[10px] text-gray-400">Maintain consistent volume</div>
        </div>

        {/* Metric: Eye Contact */}
        <div>
          <div className="flex justify-between text-sm 2xl:text-base">
            <div className="flex items-center gap-2 text-gray-600">
              <Eye className="w-4 h-4" />
              <span>Eye Contact Status</span>
              
              {/* Audio Toggle & Tooltip */}
              <div className="group relative flex items-center">
                <button 
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleSound();
                  }}
                  className={`ml-1 p-1.5 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-blue-500 ${
                    soundEnabled 
                      ? 'bg-blue-100 text-blue-600 hover:bg-blue-200' 
                      : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                  }`}
                >
                  {soundEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
                </button>
                
                {/* Tooltip */}
                <div className="absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 translate-y-2 opacity-0 invisible transform rounded-lg bg-gray-900 px-3 py-2 text-center text-xs text-white shadow-xl transition-all duration-200 group-hover:visible group-hover:translate-y-0 group-hover:opacity-100 z-50">
                  <p className="font-semibold mb-1">{soundEnabled ? "Audio Cues On" : "Audio Cues Off"}</p>
                  <p className="text-gray-300 font-normal leading-relaxed">
                    Plays a gentle alert if you look away for more than 3 seconds.
                  </p>
                  {/* Arrow */}
                  <div className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 bg-gray-900"></div>
                </div>
              </div>
            </div>
            <span className={`font-semibold ${!isRecording ? 'text-gray-900' : gazeStatus.isLookingAtScreen ? 'text-green-600' : 'text-red-500'}`}>
              {isRecording ? (gazeStatus.isLookingAtScreen ? 'Focused' : 'Distracted') : '--'}
            </span>
          </div>
          
          {/* Visual Status Indicator */}
          <div className="mt-2 flex items-center gap-2">
            <div className={`h-3 w-3 rounded-full transition-colors duration-300 ${isRecording ? (gazeStatus.isLookingAtScreen ? 'bg-green-500' : 'bg-red-500 animate-pulse') : 'bg-gray-300'}`} />
            <span className="text-xs text-gray-500">
              {isRecording ? (gazeStatus.isLookingAtScreen ? "Great! Maintaining eye contact." : "Check camera!") : "Waiting to start..."}
            </span>
          </div>
        </div>

        {/* Counter Metrics */}
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-gray-100 p-2.5">
            <div className="text-[11px] text-gray-500 2xl:text-xs">Filler Words</div>
            <div className="mt-0.5 text-lg font-bold text-green-600 2xl:text-xl">{isRecording ? metrics.fillerWords : '--'}</div>
            <div className="text-[10px] text-gray-400">um, uh, like, you know</div>
          </div>
          <div className="rounded-lg border border-gray-100 p-2.5">
            <div className="text-[11px] text-gray-500 2xl:text-xs">Pauses</div>
            <div className="mt-0.5 text-lg font-bold text-gray-900 2xl:text-xl">{isRecording ? metrics.pauses : '--'}</div>
            <div className="text-[10px] text-gray-400">Strategic pauses detected</div>
          </div>
        </div>
      </div>
    </div>
  );
}
