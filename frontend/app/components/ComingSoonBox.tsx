'use client';

import React from 'react';

interface ComingSoonBoxProps {
  personas: string[];
}

export default function ComingSoonBox({ personas }: ComingSoonBoxProps) {
  return (
    <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5 2xl:p-8">
      <div className="flex items-start gap-4">
        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 2xl:h-8 2xl:w-8">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            className="text-blue-600 2xl:h-5 2xl:w-5"
          >
            <path
              d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"
              fill="currentColor"
            />
          </svg>
        </div>
        <div>
          <h4 className="text-sm font-semibold text-blue-800 2xl:text-xl">
            Additional Personas Coming Soon
          </h4>
          <p className="mt-1 text-sm text-blue-700 2xl:mt-2 2xl:text-lg">
            Future updates will include additional audience personas such as:
          </p>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 2xl:mt-4 2xl:gap-x-8">
            {personas.map((persona, index) => (
              <span
                key={index}
                className="text-sm text-blue-600 2xl:text-lg"
              >
                · {persona}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
