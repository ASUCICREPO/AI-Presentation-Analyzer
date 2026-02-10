'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useAuth } from '../context/AuthContext';
import { ShieldCheck, Loader2, RotateCcw } from 'lucide-react';

interface ConfirmSignUpPageProps {
  email: string;
  onConfirmed: () => void;
  onBack: () => void;
}

export default function ConfirmSignUpPage({ email, onConfirmed, onBack }: ConfirmSignUpPageProps) {
  const { confirmSignUp, resendConfirmation } = useAuth();

  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [resendMessage, setResendMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await confirmSignUp(email, code);
      onConfirmed();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Verification failed.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    setResendMessage('');
    try {
      await resendConfirmation(email);
      setResendMessage('A new code has been sent to your email.');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not resend code.';
      setError(message);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo + Header */}
        <div className="mb-8 flex flex-col items-center gap-4">
          <Image
            src="/logo.png"
            alt="The University of Chicago"
            width={260}
            height={65}
            className="h-10 w-auto sm:h-12"
            priority
          />
          <div className="h-px w-16 bg-maroon-200" />
          <h1 className="text-2xl font-medium text-gray-900 font-serif sm:text-3xl">
            Verify Your Email
          </h1>
          <p className="text-center text-sm text-gray-500 font-sans">
            We sent a verification code to<br />
            <span className="font-medium text-gray-700">{email}</span>
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Code Input */}
            <div>
              <label htmlFor="confirm-code" className="mb-1.5 block text-sm font-medium text-gray-700 font-sans">
                Verification code
              </label>
              <input
                id="confirm-code"
                type="text"
                inputMode="numeric"
                required
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="Enter 6-digit code"
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-center text-lg tracking-[0.3em] text-gray-900 placeholder-gray-400 transition focus:border-maroon focus:outline-none focus:ring-2 focus:ring-maroon/20 font-sans"
              />
            </div>

            {/* Error / Success messages */}
            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 font-sans">
                {error}
              </div>
            )}
            {resendMessage && (
              <div className="rounded-lg bg-green-50 px-4 py-3 text-sm text-green-700 font-sans">
                {resendMessage}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading || code.length < 6}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-maroon px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-maroon-dark disabled:opacity-60 disabled:cursor-not-allowed font-sans"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <ShieldCheck size={18} />
              )}
              {isLoading ? 'Verifying…' : 'Verify Account'}
            </button>
          </form>

          {/* Resend */}
          <div className="mt-4 flex items-center justify-center">
            <button
              onClick={handleResend}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-maroon transition font-sans"
            >
              <RotateCcw size={14} />
              Resend code
            </button>
          </div>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-500 font-sans">
          <button
            onClick={onBack}
            className="font-semibold text-maroon hover:text-maroon-dark transition"
          >
            Back to Sign In
          </button>
        </p>
      </div>
    </div>
  );
}
