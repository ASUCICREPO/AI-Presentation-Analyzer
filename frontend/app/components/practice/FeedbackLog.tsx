import React from 'react';

interface FeedbackEvent {
  time: string;
  message: string;
  type: 'warning' | 'info' | 'success';
}

interface FeedbackLogProps {
  events: FeedbackEvent[];
}

export default function FeedbackLog({ events }: FeedbackLogProps) {
  return (
    <div className="mt-6 2xl:mt-10 animate-slide-up">
      <h4 className="mb-4 font-serif text-base font-semibold text-gray-900 2xl:text-xl">Timestamped Feedback</h4>
      <div className="max-h-[200px] space-y-3 overflow-y-auto rounded-xl border border-gray-200 bg-white p-4 shadow-sm 2xl:p-6">
        {events.map((event, index) => (
          <div 
            key={index}
            className={`flex items-center justify-between rounded-lg border-l-4 p-3 2xl:p-4
              ${event.type === 'warning' ? 'border-yellow-400 bg-yellow-50' : 
                event.type === 'info' ? 'border-blue-400 bg-blue-50' : 
                'border-green-400 bg-green-50'}
            `}
          >
            <div className="flex items-center gap-4">
              <span className="font-mono text-xs font-medium text-gray-500 2xl:text-sm">{event.time}</span>
              <span className="text-sm font-medium text-gray-900 2xl:text-base">{event.message}</span>
            </div>
            <span className="text-lg">
              {event.type === 'warning' ? '⚠️' : event.type === 'info' ? '📢' : '👁️'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
