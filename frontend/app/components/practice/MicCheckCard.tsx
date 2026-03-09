import React from 'react';
import { Mic, CheckCircle2 } from 'lucide-react';
import { MicCalibrationState } from '../../hooks/useMicCalibration';

interface MicCheckCardProps {
    micCalibration: MicCalibrationState;
}

export default function MicCheckCard({ micCalibration }: MicCheckCardProps) {
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
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm 2xl:p-6 animate-fade-in">
            <div className="flex items-center gap-2 mb-3 border-b pb-3">
                <div className="h-7 w-7 rounded-full bg-maroon-100 text-maroon flex items-center justify-center shrink-0">
                    <Mic className="w-4 h-4" />
                </div>
                <h3 className="font-serif text-base font-bold text-gray-900 2xl:text-xl">Microphone Check</h3>
                {micCalibration.hasSpeechDetected && (
                    <CheckCircle2 className="w-5 h-5 text-green-500 ml-auto shrink-0" />
                )}
            </div>

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

        </div>
    );
}
