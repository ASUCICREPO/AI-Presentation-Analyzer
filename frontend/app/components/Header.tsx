'use client';

import React, { useState, useRef, useEffect } from 'react';
import Image from 'next/image';
import { LogOut, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface Step {
  number: number;
  label: string;
}

interface HeaderProps {
  currentStep: number;
  onStepClick?: (step: number) => void;
  sessionId?: string;
}

const steps: Step[] = [
  { number: 1, label: 'Select Persona' },
  { number: 2, label: 'Upload Content' },
  { number: 3, label: 'Practice & Record' },
  { number: 4, label: 'Q&A Session' },
  { number: 5, label: 'Review Analytics' },
];

export default function Header({ currentStep, onStepClick, sessionId }: HeaderProps) {
  const { signOut, userEmail } = useAuth();
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const initials = userEmail ? userEmail.charAt(0).toUpperCase() : 'U';

  return (
    <header className="w-full border-b border-gray-100 bg-white">
      <div className="mx-auto flex w-full items-center px-4 py-3 sm:px-6 lg:px-8 xl:px-12">
        {/* Logo Section */}
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          <Image
            src="/logo.png"
            alt="The University of Chicago"
            width={200}
            height={50}
            className="h-7 w-auto sm:h-8 lg:h-9 xl:h-10"
            priority
          />
          <div className="hidden h-6 w-px bg-gray-200 sm:block lg:h-7 xl:h-8" />
          <span className="hidden text-sm font-semibold text-gray-800 sm:block lg:text-base xl:text-lg font-sans">
            AI Presentation Coach
          </span>
        </div>

        {/* Spacer pushes stepper + avatar to the right */}
        <div className="min-w-[24px] flex-1 sm:min-w-[40px] lg:min-w-[60px]" />

        {/* Stepper */}
        <nav className="flex items-center">
          {steps.map((step, index) => {
            const isActive = step.number === currentStep;
            const isCompleted = step.number < currentStep;
            const isClickable = currentStep !== 5 && (step.number < currentStep || step.number === currentStep);

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

        {/* Divider between stepper and avatar */}
        <div className="mx-3 h-6 w-px bg-gray-200 sm:mx-4" />

        {/* Avatar dropdown */}
        <div className="relative shrink-0" ref={dropdownRef}>
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-maroon text-sm font-semibold text-white transition hover:bg-maroon-dark focus:outline-none focus:ring-2 focus:ring-maroon/30 focus:ring-offset-2 font-sans"
            title={userEmail ?? 'Account'}
          >
            {initials}
          </button>

          {isDropdownOpen && (
            <div className="absolute right-0 top-full mt-2 w-60 rounded-xl border border-gray-100 bg-white py-1 shadow-lg z-50 animate-fade-in">
              <div className="border-b border-gray-100 px-4 py-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-maroon-50 text-maroon">
                    <User size={16} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900 font-sans">
                      {userEmail}
                    </p>
                    <p className="text-xs text-gray-400 font-sans">Signed in</p>
                  </div>
                </div>
              </div>
              {sessionId && (
                <div className="border-b border-gray-100 px-4 py-2">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-gray-400 font-sans">Session ID</p>
                  <p className="mt-0.5 truncate text-xs text-gray-600 font-mono">{sessionId}</p>
                </div>
              )}
              <div className="py-1">
                <button
                  onClick={() => {
                    setIsDropdownOpen(false);
                    signOut();
                  }}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-sm text-gray-600 transition hover:bg-gray-50 hover:text-maroon font-sans"
                >
                  <LogOut size={15} />
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
