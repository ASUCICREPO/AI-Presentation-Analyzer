'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, UserPlus, Loader2, Check } from 'lucide-react';

interface SignUpPageProps {
  onSwitchToLogin: () => void;
  onNeedConfirmation: (email: string) => void;
}

export default function SignUpPage({ onSwitchToLogin, onNeedConfirmation }: SignUpPageProps) {
  const { signUp } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Password requirements
  const hasMinLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);
  const passwordsMatch = password === confirmPassword && confirmPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      const { userConfirmed } = await signUp(email, password, name);
      if (!userConfirmed) {
        onNeedConfirmation(email);
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  const RequirementDot = ({ met }: { met: boolean }) => (
    <span
      className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px] transition-colors ${
        met ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-400'
      }`}
    >
      {met ? <Check size={10} /> : ''}
    </span>
  );

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 py-10">
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
            Create Account
          </h1>
          <p className="text-sm text-gray-500 font-sans">
            Get started with AI Presentation Coach
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            <p className="text-xs text-gray-400 font-sans"><span className="text-red-500">*</span> Required fields</p>

            {/* Name */}
            <div>
              <label htmlFor="signup-name" className="mb-1.5 block text-sm font-medium text-gray-700 font-sans">
                Full name <span className="text-red-500">*</span>
              </label>
              <input
                id="signup-name"
                type="text"
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Doe"
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-maroon focus:outline-none focus:ring-2 focus:ring-maroon/20 font-sans"
              />
            </div>

            {/* Email */}
            <div>
              <label htmlFor="signup-email" className="mb-1.5 block text-sm font-medium text-gray-700 font-sans">
                Email address <span className="text-red-500">*</span>
              </label>
              <input
                id="signup-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@uchicago.edu"
                className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:border-maroon focus:outline-none focus:ring-2 focus:ring-maroon/20 font-sans"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="signup-password" className="mb-1.5 block text-sm font-medium text-gray-700 font-sans">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="signup-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Create a strong password"
                  className="block w-full rounded-lg border border-gray-300 px-4 py-2.5 pr-11 text-sm text-gray-900 placeholder-gray-400 transition focus:border-maroon focus:outline-none focus:ring-2 focus:ring-maroon/20 font-sans"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Password requirements */}
              {password.length > 0 && (
                <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs font-sans text-gray-500">
                  <div className="flex items-center gap-1.5"><RequirementDot met={hasMinLength} /> 8+ characters</div>
                  <div className="flex items-center gap-1.5"><RequirementDot met={hasUppercase} /> Uppercase letter</div>
                  <div className="flex items-center gap-1.5"><RequirementDot met={hasLowercase} /> Lowercase letter</div>
                  <div className="flex items-center gap-1.5"><RequirementDot met={hasNumber} /> Number</div>
                  <div className="flex items-center gap-1.5"><RequirementDot met={hasSpecial} /> Special character</div>
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label htmlFor="signup-confirm" className="mb-1.5 block text-sm font-medium text-gray-700 font-sans">
                Confirm password <span className="text-red-500">*</span>
              </label>
              <input
                id="signup-confirm"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter your password"
                className={`block w-full rounded-lg border px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition focus:outline-none focus:ring-2 font-sans ${
                  confirmPassword.length > 0
                    ? passwordsMatch
                      ? 'border-green-300 focus:border-green-400 focus:ring-green-100'
                      : 'border-red-300 focus:border-red-400 focus:ring-red-100'
                    : 'border-gray-300 focus:border-maroon focus:ring-maroon/20'
                }`}
              />
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 font-sans">
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-maroon px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-maroon-dark disabled:opacity-60 disabled:cursor-not-allowed font-sans"
            >
              {isLoading ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <UserPlus size={18} />
              )}
              {isLoading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-500 font-sans">
          Already have an account?{' '}
          <button
            onClick={onSwitchToLogin}
            className="font-semibold text-maroon hover:text-maroon-dark transition"
          >
            Sign in
          </button>
        </p>
      </div>
    </div>
  );
}
