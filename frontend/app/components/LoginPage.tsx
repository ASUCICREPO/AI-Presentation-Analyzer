'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import { useAuth } from '../context/AuthContext';
import { Eye, EyeOff, LogIn, Loader2 } from 'lucide-react';

interface LoginPageProps {
  onSwitchToSignUp: () => void;
}

export default function LoginPage({ onSwitchToSignUp }: LoginPageProps) {
  const { signIn } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await signIn(email, password);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'An unexpected error occurred.';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4">
      {/* Card */}
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
            AI Presentation Coach
          </h1>
          <p className="text-sm text-gray-500 font-sans">
            Sign in to your account to continue
          </p>
        </div>

        <div className="rounded-2xl border border-gray-100 bg-white p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="login-email" className="mb-1.5 block text-sm font-medium text-gray-700 font-sans">
                Email address <span className="text-red-500">*</span>
              </label>
              <input
                id="login-email"
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
              <label htmlFor="login-password" className="mb-1.5 block text-sm font-medium text-gray-700 font-sans">
                Password <span className="text-red-500">*</span>
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
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
                <LogIn size={18} />
              )}
              {isLoading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-sm text-gray-500 font-sans">
          Don&apos;t have an account?{' '}
          <button
            onClick={onSwitchToSignUp}
            className="font-semibold text-maroon hover:text-maroon-dark transition"
          >
            Create one
          </button>
        </p>
      </div>
    </div>
  );
}
