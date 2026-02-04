'use client';

import React from 'react';
import Image from 'next/image';

interface Step {
  number: number;
  label: string;
}

interface HeaderProps {
  currentStep: number;
  onStepClick?: (step: number) => void;
}

const steps: Step[] = [
  { number: 1, label: 'Select Persona' },
  { number: 2, label: 'Upload Content' },
  { number: 3, label: 'Practice & Record' },
  { number: 4, label: 'Review Analytics' },
];

export default function Header({ currentStep, onStepClick }: HeaderProps) {
  return (
    <header className="w-full border-b border-gray-100 bg-white">
      <div className="mx-auto flex w-full items-center justify-between px-4 py-3 sm:px-6 lg:px-8 xl:px-12">
        {/* Logo Section */}
        <div className="flex items-center gap-3 sm:gap-4">
          <Image
            src="/logo.png"
            alt="The University of Chicago"
            width={200}
            height={50}
            className="h-7 w-auto sm:h-8 lg:h-9 xl:h-10"
            priority
          />
          {/* Divider */}
          <div className="hidden h-6 w-px bg-gray-200 sm:block lg:h-7 xl:h-8" />
          {/* App Name */}
          <div className="hidden sm:block">
            <span className="text-sm font-semibold text-gray-800 lg:text-base xl:text-lg font-sans">
              AI Presentation Coach
            </span>
          </div>
        </div>

        {/* Stepper */}
        <nav className="flex items-center">
          {steps.map((step, index) => {
            const isActive = step.number === currentStep;
            const isCompleted = step.number < currentStep;
            const isClickable = step.number < currentStep || step.number === currentStep;
            
            return (
              <React.Fragment key={step.number}>
                <div className="relative group">
                  <button
                    onClick={() => isClickable && onStepClick?.(step.number)}
                    disabled={!isClickable}
                    className={`
                      flex items-center gap-1 sm:gap-1.5 lg:gap-2 transition-all duration-200
                      ${isClickable ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
                    `}
                  >
                    {isActive ? (
                      <div className="flex items-center gap-1 rounded-full bg-maroon px-2 py-1 sm:gap-1.5 sm:px-3 sm:py-1.5 lg:px-4 lg:py-2">
                        <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/20 text-[10px] font-medium text-white lg:h-5 lg:w-5 lg:text-xs font-sans">
                          {step.number}
                        </span>
                        <span className="text-[11px] font-medium text-white sm:text-xs lg:text-sm font-sans">
                          {step.label}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 px-1 py-1 sm:gap-1.5 sm:px-2 sm:py-1.5 lg:gap-2 lg:px-3">
                        <span
                          className={`
                            flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium lg:h-5 lg:w-5 lg:text-xs font-sans
                            ${isCompleted ? 'bg-green-600 text-white' : 'bg-gray-200 text-gray-500'}
                          `}
                        >
                          {isCompleted ? (
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none">
                              <path
                                d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"
                                fill="currentColor"
                              />
                            </svg>
                          ) : (
                            step.number
                          )}
                        </span>
                        <span className={`hidden text-[11px] sm:block sm:text-xs lg:text-sm font-sans ${isCompleted ? 'text-green-700 font-medium' : 'text-gray-500'}`}>
                          {step.label}
                        </span>
                      </div>
                    )}
                  </button>

                  {/* Tooltip */}
                  {isClickable && !isActive && (
                    <div className="absolute top-full left-1/2 mt-2 hidden w-max -translate-x-1/2 flex-col items-center group-hover:flex z-50">
                      <div className="h-2 w-2 -mb-1 rotate-45 bg-gray-800" />
                      <div className="rounded bg-gray-800 px-2 py-1 text-xs text-white shadow-lg font-sans">
                        Go back to {step.label}
                      </div>
                    </div>
                  )}
                </div>
                
                {index < steps.length - 1 && (
                  <div
                    className={`
                      mx-0.5 h-px w-4 sm:mx-1 sm:w-6 lg:mx-2 lg:w-10 xl:w-12
                      ${step.number < currentStep ? 'bg-green-600' : 'bg-gray-200'}
                    `}
                  />
                )}
              </React.Fragment>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
