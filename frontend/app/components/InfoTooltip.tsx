'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';

interface InfoTooltipProps {
    text: string;
    size?: number;
}

export default function InfoTooltip({ text, size = 15 }: InfoTooltipProps) {
    const [visible, setVisible] = useState(false);

    return (
        <span className="relative inline-flex items-center align-middle ml-1">
            <button
                type="button"
                className="text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus:text-gray-600"
                onMouseEnter={() => setVisible(true)}
                onMouseLeave={() => setVisible(false)}
                onFocus={() => setVisible(true)}
                onBlur={() => setVisible(false)}
                aria-label="More information"
            >
                <Info style={{ width: size, height: size }} />
            </button>
            {visible && (
                <div className="absolute z-50 w-56 rounded-lg bg-gray-800 px-3 py-2 text-xs leading-relaxed text-white shadow-lg pointer-events-none top-full left-1/2 -translate-x-1/2 mt-2" style={{ fontFamily: 'Arial, sans-serif' }}>
                    {text}
                    <div className="absolute left-1/2 -translate-x-1/2 h-2 w-2 rotate-45 bg-gray-800 -top-1" />
                </div>
            )}
        </span>
    );
}
