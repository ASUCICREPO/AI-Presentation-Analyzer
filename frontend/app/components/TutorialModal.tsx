'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
    X, ChevronLeft, ChevronRight, CheckCircle2, Users, Upload, Video,
    BarChart3, MessageCircle, Lightbulb, Eye, Clock,
} from 'lucide-react';

interface TutorialModalProps {
    isOpen: boolean;
    onClose: () => void;
    userName?: string;
}

const TOTAL_STEPS = 6;

export default function TutorialModal({ isOpen, onClose, userName }: TutorialModalProps) {
    const [step, setStep] = useState(1);

    useEffect(() => {
        if (isOpen) setStep(1);
    }, [isOpen]);

    const handleClose = useCallback(() => {
        localStorage.setItem('tutorial_completed', 'true');
        onClose();
    }, [onClose]);

    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') handleClose();
            if (e.key === 'ArrowRight' && step < TOTAL_STEPS) setStep(s => s + 1);
            if (e.key === 'ArrowLeft' && step > 1) setStep(s => s - 1);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [isOpen, step, handleClose]);

    if (!isOpen) return null;

    const displayName = userName ? userName.split('@')[0] : '';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="relative mx-4 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
                {/* Progress bar */}
                <div className="flex gap-1 bg-maroon-800 px-4 pt-3">
                    {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                        <div key={i} className="h-1 flex-1 rounded-full overflow-hidden bg-maroon-900/50">
                            <div
                                className={`h-full rounded-full transition-all duration-300 ${i + 1 <= step ? 'bg-white' : 'bg-transparent'
                                    }`}
                            />
                        </div>
                    ))}
                </div>

                {/* Header */}
                <div className="relative bg-gradient-to-br from-maroon-800 to-maroon-900 px-6 pb-5 pt-2">
                    <button
                        onClick={handleClose}
                        className="absolute right-4 top-3 rounded-full p-1 text-white/60 transition hover:bg-white/10 hover:text-white"
                        aria-label="Close tutorial"
                    >
                        <X size={20} />
                    </button>
                    <p className="mb-1 text-xs text-maroon-200">Step {step} of {TOTAL_STEPS}</p>
                    <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10">
                            {step === 1 && <CheckCircle2 size={22} className="text-maroon-200" />}
                            {step === 2 && <Users size={22} className="text-purple-300" />}
                            {step === 3 && <Upload size={22} className="text-blue-300" />}
                            {step === 4 && <Video size={22} className="text-red-300" />}
                            {step === 5 && <BarChart3 size={22} className="text-blue-300" />}
                            {step === 6 && <CheckCircle2 size={22} className="text-green-300" />}
                        </span>
                        <div>
                            <h2 className="text-xl font-bold text-white font-serif">
                                {step === 1 && `Welcome to Presentation Analyzer${displayName ? `, ${displayName}` : ''}!`}
                                {step === 2 && 'Step 1: Select Your Audience Persona'}
                                {step === 3 && 'Step 2: Upload Your Content'}
                                {step === 4 && 'Step 3: Record Your Presentation'}
                                {step === 5 && 'Step 4: Review Analytics & Practice Q&A'}
                                {step === 6 && "You're All Set!"}
                            </h2>
                            <p className="text-sm text-maroon-200">
                                {step === 1 && "Let's take a quick tour of how to use the platform"}
                                {step === 2 && 'Choose who you\'re presenting to'}
                                {step === 3 && 'Help the AI understand your presentation'}
                                {step === 4 && 'Practice with real-time AI feedback'}
                                {step === 5 && 'Get detailed insights and persona-specific coaching'}
                                {step === 6 && 'Ready to start practicing?'}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto px-6 py-6">
                    {step === 1 && (
                        <div className="space-y-5">
                            <p className="text-sm leading-relaxed text-gray-600">
                                This AI-powered tool helps you practice and improve your presentation skills with real-time feedback and persona-specific coaching.
                            </p>
                            <div className="rounded-xl border border-red-100 bg-red-50/50 p-5">
                                <h3 className="mb-3 text-sm font-semibold text-gray-900">What you&apos;ll learn in this tutorial:</h3>
                                <ul className="space-y-2.5">
                                    {[
                                        'How to select and customize your audience persona',
                                        'Uploading presentation materials for context',
                                        'Recording your presentation with real-time AI feedback',
                                        'Reviewing analytics and practicing Q&A sessions',
                                    ].map((item, i) => (
                                        <li key={i} className="flex items-start gap-2 text-sm text-gray-600">
                                            <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-400" />
                                            {item}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <p className="text-xs text-gray-400">
                                This tutorial will take about 2-3 minutes. You can exit anytime and restart from the Tutorial button in the header.
                            </p>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="space-y-5">
                            {/* Example persona card */}
                            <div className="rounded-xl border border-gray-200 p-4">
                                <div className="flex items-center gap-3">
                                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-purple-100">
                                        <Users size={20} className="text-purple-600" />
                                    </span>
                                    <div>
                                        <p className="text-sm font-semibold text-gray-900">Academic Expert</p>
                                        <p className="text-xs text-gray-500">Expertise: Expert</p>
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <p className="text-xs text-gray-500">Example persona with priorities like:</p>
                                    <ul className="mt-1.5 space-y-1">
                                        <li className="flex items-start gap-2 text-xs text-gray-600">
                                            <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-gray-400" /> Relationship to existing research
                                        </li>
                                        <li className="flex items-start gap-2 text-xs text-gray-600">
                                            <span className="mt-1 h-1 w-1 flex-shrink-0 rounded-full bg-gray-400" /> Depth of knowledge &amp; clear argument
                                        </li>
                                    </ul>
                                </div>
                            </div>
                            {/* Numbered steps */}
                            <div className="space-y-4">
                                <NumberedItem n={1} title="Browse Available Personas" desc="We offer 7 different personas including Academic Expert, Industry Partners, Investors & VCs, Undergraduate Students, Graduate Students, Public Stakeholders, and Conference Attendees." />
                                <NumberedItem n={2} title="Expand to See Details" desc="Click on a persona to view their key priorities, optimal presentation time, and communication style." />
                                <NumberedItem n={3} title="Customize (Optional)" desc="Adjust presentation time, talk format, or add custom notes to tailor feedback to your specific context." />
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="space-y-5">
                            {/* Upload zone mock */}
                            <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/50 py-10">
                                <Upload size={36} className="mb-2 text-blue-400" />
                                <p className="text-sm font-medium text-gray-700">Drag &amp; Drop Upload Zone</p>
                                <p className="text-xs text-gray-400">Upload slides, notes, abstracts, or other materials</p>
                            </div>
                            <div className="flex items-start gap-3">
                                <Lightbulb size={18} className="mt-0.5 flex-shrink-0 text-amber-500" />
                                <div>
                                    <p className="text-sm font-semibold text-gray-900">Why Upload Content?</p>
                                    <p className="text-xs leading-relaxed text-gray-500">The AI analyzes your materials to provide context-aware feedback. It helps identify areas where you might need clearer explanations or stronger evidence.</p>
                                </div>
                            </div>
                            <div className="rounded-xl border border-gray-200 p-4">
                                <p className="mb-2 text-sm font-semibold text-gray-900">Supported File Types:</p>
                                <div className="flex gap-2">
                                    {['.pdf', '.pptx', '.docx', '.txt'].map(t => (
                                        <span key={t} className="rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-600">{t}</span>
                                    ))}
                                </div>
                            </div>
                            <p className="text-xs text-gray-400">Note: You can skip this step, but uploading content leads to more personalized feedback.</p>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="space-y-5">
                            {/* Camera mock */}
                            <div className="relative flex flex-col items-center justify-center rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 py-16">
                                <span className="absolute right-3 top-3 flex items-center gap-1.5 rounded-full bg-green-500 px-3 py-1 text-[10px] font-medium text-white">
                                    <span className="h-1.5 w-1.5 rounded-full bg-white" /> Recording
                                </span>
                                <Video size={36} className="mb-2 text-gray-400" />
                                <p className="text-sm font-medium text-gray-300">Camera View</p>
                                <p className="text-xs text-gray-500">Real-time recording with live feedback</p>
                            </div>
                            {/* Metric cards */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="rounded-lg border border-gray-200 bg-white p-3">
                                    <div className="flex items-center gap-2 text-xs font-medium text-gray-700">
                                        <Eye size={14} className="text-green-500" /> Eye Contact
                                    </div>
                                    <div className="mt-2 h-2 rounded-full bg-gray-100">
                                        <div className="h-2 w-3/4 rounded-full bg-green-500" />
                                    </div>
                                    <p className="mt-1 text-right text-[10px] text-gray-400">75%</p>
                                </div>
                                <div className="rounded-lg border border-gray-200 bg-white p-3">
                                    <div className="flex items-center gap-2 text-xs font-medium text-gray-700">
                                        <Clock size={14} className="text-blue-500" /> Pace
                                    </div>
                                    <div className="mt-2 h-2 rounded-full bg-gray-100">
                                        <div className="h-2 w-2/3 rounded-full bg-blue-500" />
                                    </div>
                                    <p className="mt-1 text-right text-[10px] text-gray-400">Good</p>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <FeatureItem icon={<CheckCircle2 size={16} className="text-green-500" />} title="Real-Time Metrics" desc="Track eye contact, pace, vocal variety, filler words, and pauses as you present." />
                                <FeatureItem icon={<CheckCircle2 size={16} className="text-green-500" />} title="Live Feedback Alerts" desc="Get instant notifications when you're speaking too fast, using filler words, or need to improve eye contact." />
                                <FeatureItem icon={<CheckCircle2 size={16} className="text-green-500" />} title="Restart Anytime" desc="Not happy with your take? Restart the recording and try again." />
                            </div>
                        </div>
                    )}

                    {step === 5 && (
                        <div className="space-y-5">
                            {/* Stats mock */}
                            <div className="grid grid-cols-3 gap-3 rounded-xl border border-gray-200 p-4">
                                <div className="text-center">
                                    <p className="text-lg font-bold text-green-600">78%</p>
                                    <p className="text-[10px] text-gray-500">Eye Contact</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-lg font-bold text-blue-600">Good</p>
                                    <p className="text-[10px] text-gray-500">Pace</p>
                                </div>
                                <div className="text-center">
                                    <p className="text-lg font-bold text-gray-900">5</p>
                                    <p className="text-[10px] text-gray-500">Filler Words</p>
                                </div>
                            </div>
                            <div className="space-y-3">
                                <FeatureItem icon={<BarChart3 size={16} className="text-blue-500" />} title="Comprehensive Analytics Dashboard" desc="View detailed metrics, timestamped feedback events, and performance trends across all areas." />
                                <FeatureItem icon={<MessageCircle size={16} className="text-teal-500" />} title="Persona-Specific Q&A Practice" desc="Practice answering challenging questions tailored to your selected audience persona. Questions will match the priorities and expertise level of your audience." />
                                <FeatureItem icon={<CheckCircle2 size={16} className="text-green-500" />} title="Downloadable PDF Reports" desc="Export your analytics and recommendations as a PDF for future reference or sharing with advisors." />
                            </div>
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                                <div className="flex items-start gap-2">
                                    <Lightbulb size={16} className="mt-0.5 flex-shrink-0 text-amber-500" />
                                    <div>
                                        <p className="text-sm font-semibold text-amber-800">Research-Based Recommendations</p>
                                        <p className="text-xs leading-relaxed text-amber-700">All feedback is based on academic research about effective presentations and tailored to your specific persona&apos;s expectations.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 6 && (
                        <div className="space-y-5">
                            {/* Success banner */}
                            <div className="flex flex-col items-center rounded-xl bg-red-50 py-8">
                                <CheckCircle2 size={48} className="mb-3 text-maroon-600" />
                                <p className="text-lg font-bold text-gray-900">Ready to Begin!</p>
                                <p className="text-sm text-gray-500">You now know how to use the Presentation Analyzer platform.</p>
                            </div>
                            <p className="text-sm font-semibold text-gray-900">Quick Recap:</p>
                            <div className="space-y-2">
                                {[
                                    { n: 1, text: 'Select and customize your audience persona', color: 'bg-blue-500' },
                                    { n: 2, text: 'Upload your presentation materials', color: 'bg-green-500' },
                                    { n: 3, text: 'Record with real-time AI feedback', color: 'bg-red-500' },
                                    { n: 4, text: 'Review analytics and practice Q&A', color: 'bg-amber-500' },
                                ].map(item => (
                                    <div key={item.n} className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 px-4 py-3">
                                        <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white ${item.color}`}>{item.n}</span>
                                        <span className="text-sm text-gray-700">{item.text}</span>
                                    </div>
                                ))}
                            </div>
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                                <div className="flex items-start gap-2">
                                    <Lightbulb size={16} className="mt-0.5 flex-shrink-0 text-amber-500" />
                                    <div>
                                        <p className="text-sm font-semibold text-amber-800">Pro Tip</p>
                                        <p className="text-xs leading-relaxed text-amber-700">You can access this tutorial anytime by clicking the &quot;Tutorial&quot; button in the header. Practice with different personas to prepare for various audience types.</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-6 py-4">
                    <button
                        onClick={() => setStep(s => s - 1)}
                        disabled={step === 1}
                        className={`flex items-center gap-1 text-sm font-medium transition ${step === 1 ? 'text-gray-300 cursor-default' : 'text-gray-600 hover:text-gray-900'
                            }`}
                    >
                        <ChevronLeft size={16} /> Previous
                    </button>

                    {/* Dots */}
                    <div className="flex items-center gap-1.5">
                        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                            <button
                                key={i}
                                onClick={() => setStep(i + 1)}
                                className={`transition-all duration-200 rounded-full ${i + 1 === step
                                        ? 'h-2.5 w-6 bg-maroon-600'
                                        : 'h-2.5 w-2.5 bg-gray-300 hover:bg-gray-400'
                                    }`}
                                aria-label={`Go to step ${i + 1}`}
                            />
                        ))}
                    </div>

                    {step < TOTAL_STEPS ? (
                        <button
                            onClick={() => setStep(s => s + 1)}
                            className="flex items-center gap-1 rounded-lg bg-maroon-800 px-5 py-2 text-sm font-medium text-white transition hover:bg-maroon-900"
                        >
                            Next <ChevronRight size={16} />
                        </button>
                    ) : (
                        <button
                            onClick={handleClose}
                            className="flex items-center gap-1 rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white transition hover:bg-green-700"
                        >
                            Get Started <CheckCircle2 size={16} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

/* ── Helper sub-components ─────────────────────────────────────────── */

function NumberedItem({ n, title, desc }: { n: number; title: string; desc: string }) {
    return (
        <div className="flex items-start gap-3">
            <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-maroon-600 text-[11px] font-bold text-white">{n}</span>
            <div>
                <p className="text-sm font-semibold text-gray-900">{title}</p>
                <p className="text-xs leading-relaxed text-gray-500">{desc}</p>
            </div>
        </div>
    );
}

function FeatureItem({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
    return (
        <div className="flex items-start gap-3">
            <span className="mt-0.5 flex-shrink-0">{icon}</span>
            <div>
                <p className="text-sm font-semibold text-gray-900">{title}</p>
                <p className="text-xs leading-relaxed text-gray-500">{desc}</p>
            </div>
        </div>
    );
}
