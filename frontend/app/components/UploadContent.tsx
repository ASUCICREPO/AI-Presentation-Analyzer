'use client';

import React, { useRef } from 'react';
import { ACADEMIC_PERSONA } from '../config/personas';

interface UploadContentProps {
  onBack: () => void;
  onContinue: () => void; // This will be "Skip & Continue" or "Continue"
}

export default function UploadContent({ onBack, onContinue }: UploadContentProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6 sm:py-8 xl:max-w-[900px] 2xl:max-w-[1280px] 2xl:py-16">
      {/* Page Title */}
      <div className="mb-6 2xl:mb-10">
        <h1 className="text-xl font-bold text-gray-900 font-serif italic sm:text-2xl 2xl:text-4xl">
          Upload Presentation Content
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500 sm:mt-2 2xl:text-xl 2xl:leading-8 font-sans">
          Upload your presentation slides or notes. The AI will analyze your content to provide context-aware feedback and optionally generate relevant questions.
        </p>
      </div>

      {/* Selected Persona Banner */}
      <div className="mb-6 rounded-lg bg-maroon-50 border border-maroon-100 p-4 flex items-center gap-3 2xl:mb-8 2xl:p-6 2xl:rounded-xl">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-maroon-600 2xl:h-7 2xl:w-7">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-white 2xl:h-4 2xl:w-4">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor" />
          </svg>
        </div>
        <span className="text-sm font-medium text-maroon-800 font-sans 2xl:text-lg">
          Selected Persona: {ACADEMIC_PERSONA.title}
        </span>
      </div>

      {/* File Upload Dropzone */}
      <div className="mb-8 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-10 text-center transition-colors hover:border-maroon-300 hover:bg-maroon-50/10 2xl:p-16 2xl:mb-12">
        <div className="flex flex-col items-center justify-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 2xl:h-16 2xl:w-16 2xl:mb-6">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-gray-400 2xl:h-8 2xl:w-8">
              <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" fill="currentColor" />
            </svg>
          </div>
          
          <h3 className="mb-2 text-base font-medium text-gray-900 font-sans 2xl:text-xl">
            Drop your presentation files here
          </h3>
          <p className="mb-6 text-sm text-gray-500 font-sans 2xl:text-lg 2xl:mb-8">
            or click to browse
          </p>
          
          <input 
            type="file" 
            ref={fileInputRef}
            className="hidden" 
            accept=".pdf,.ppt,.pptx,.doc,.docx"
            // TODO: Implement file selection handler and API upload with presigned URL
          />
          
          <button 
            onClick={handleBrowseClick}
            className="rounded-lg bg-maroon-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-maroon-700 hover:shadow-md active:scale-[0.98] font-sans 2xl:px-8 2xl:py-3.5 2xl:text-lg"
          >
            Select Files
          </button>
          
          <p className="mt-4 text-xs text-gray-400 font-sans 2xl:text-base 2xl:mt-6">
            Supported formats: PDF, PPT, PPTX, DOC, DOCX
          </p>
        </div>
      </div>

      {/* Navigation Footer */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-6 2xl:pt-10">
        <button
          onClick={onBack}
          className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 font-sans 2xl:px-8 2xl:py-3.5 2xl:text-lg"
        >
          Back
        </button>

        <div className="flex flex-col items-end gap-2">
          <button
            onClick={onContinue}
            className="rounded-lg bg-maroon-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-maroon-700 hover:shadow-md active:scale-[0.98] font-sans 2xl:px-8 2xl:py-3.5 2xl:text-lg flex items-center gap-2"
          >
            Skip & Continue
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              className="transition-transform duration-200 group-hover:translate-x-0.5 2xl:h-5 2xl:w-5"
            >
              <path
                d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>
      
      <p className="mt-4 text-center text-xs text-gray-400 font-sans 2xl:text-sm 2xl:mt-6">
        Content upload is optional. You can skip this step and proceed directly to practice mode.
      </p>
    </div>
  );
}
