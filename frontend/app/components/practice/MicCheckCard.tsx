import React from 'react';
import { Mic, CheckCircle2, Volume2, MessageCircle, ChevronLeft } from 'lucide-react';
import { MicCalibrationState } from '../../hooks/useMicCalibration';

interface MicCheckCardProps {
    micCalibration: MicCalibrationState;
    onBack?: () => void;
}

export default function MicCheckCard({ micCalibration, onBack }: MicCheckCardProps) {
    const barCount = 10;
    const filledBars = Math.round((micCalibration.volume / 100) * barCount);

    const getStatusColor = () => {
        if (micCalibration.error) return 'border-red-200 bg-red-50/50';
        if (micCalibration.isTooLoud) return 'border-orange-200 bg-orange-50/50';
        if (micCalibration.hasSpeechDetected) return 'border-green-100 bg-green-50/50';
        return 'border-gray-200 bg-gray-50/50';
    };

    const getStatusText = () => {
        if (micCalibration.error) return { text: micCalibration.error, color: 'text-red-500' };
        if (!micCalibration.isListening) return { text: 'Waiting for microphone...', color: 'text-gray-400' };
        if (micCalibration.isTooLoud) return { text: 'Too loud — move mic further away', color: 'text-orange-600' };
        if (micCalibration.hasSpeechDetected) return { text: 'Microphone is working', color: 'text-green-600' };
        return { text: 'Speak to test your microphone', color: 'text-gray-500' };
    };

    const status = getStatusText();

    return (
        <div className="animate-fade-in flex flex-col">
            <div className="flex items-center gap-2 mb-3 border-b pb-3">
                {onBack && (
                    <button
                        onClick={onBack}
                        className="h-7 w-7 rounded-full border border-gray-200 text-gray-400 flex items-center justify-center shrink-0 hover:border-maroon-200 hover:text-maroon hover:bg-maroon-50 transition-colors"
                        title="Back to Camera Check"
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                )}
                <div className="h-7 w-7 rounded-full bg-maroon-100 text-maroon flex items-center justify-center font-bold shrink-0 font-sans text-sm">2</div>
                <h3 className="font-serif text-base font-bold text-gray-900 2xl:text-xl">Microphone Check</h3>
                {micCalibration.hasSpeechDetected && (
                    <CheckCircle2 className="w-5 h-5 text-green-500 ml-auto shrink-0" />
                )}
            </div>

            <div className="space-y-4">
                {/* Volume Meter */}
                <div className={`rounded-xl p-4 border-2 transition-all duration-300 ${getStatusColor()}`}>
                    <div
                        className="flex items-center justify-center gap-1 mb-3"
                        role="meter"
                        aria-label="Microphone volume level"
                        aria-valuenow={micCalibration.volume}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    >
                        <Mic className={`w-5 h-5 mr-1 ${micCalibration.hasSpeechDetected ? 'text-green-600' : 'text-gray-400'}`} />
                        {Array.from({ length: barCount }).map((_, i) => (
                            <div
                                key={i}
                                className={`w-3 rounded-sm transition-all duration-75 ${i < filledBars
                                    ? i >= barCount - 2
                                        ? 'bg-red-500'
                                        : i >= barCount - 4
                                            ? 'bg-orange-400'
                                            : 'bg-green-500'
                                    : 'bg-gray-200'
                                    }`}
                                style={{ height: `${14 + i * 2}px` }}
                            />
                        ))}
                    </div>
                    <div className={`text-sm font-medium font-sans text-center ${status.color}`}>
                        {status.text}
                    </div>
                </div>

                {/* Mic Tips Checklist */}
                <div>
                    <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2 font-sans text-sm">
                        <span>Audio Tips</span>
                        <span className="text-xs font-normal text-gray-500">(Self-Check)</span>
                    </h4>
                    <div className="space-y-2">
                        {[
                            { id: 'distance', icon: <Mic className="w-4 h-4 text-maroon" />, text: 'Mic is 6–12 inches from your mouth' },
                            { id: 'noise', icon: <Volume2 className="w-4 h-4 text-amber-500" />, text: 'Background noise is minimal' },
                            { id: 'test', icon: <MessageCircle className="w-4 h-4 text-green-600" />, text: 'Speak a sentence to confirm detection' },
                        ].map((item) => (
                            <div key={item.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-200 bg-white hover:border-maroon-200 transition-colors group cursor-default">
                                <div className="h-7 w-7 rounded-full bg-maroon-50 flex items-center justify-center group-hover:bg-maroon-100 transition-colors shrink-0">
                                    {item.icon}
                                </div>
                                <span className="text-sm text-gray-700 font-medium font-sans">{item.text}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
