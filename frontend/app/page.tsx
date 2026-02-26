'use client';

import { useState, useRef, useCallback } from 'react';
import { useAuth } from './context/AuthContext';
import Header from './components/Header';
import PersonaSelection from './components/PersonaSelection';
import UploadContent from './components/UploadContent';
import PracticeSession from './components/PracticeSession';
import QASession from './components/QASession';
import ReviewAnalytics from './components/ReviewAnalytics';
import ConfirmationModal from './components/ConfirmationModal';
import LoginPage from './components/LoginPage';
import SignUpPage from './components/SignUpPage';
import ConfirmSignUpPage from './components/ConfirmSignUpPage';
import { SessionAnalytics } from './hooks/useSessionAnalytics';
import { AIFeedbackResponse } from './services/api';
import { generateSessionId, Persona } from './config/config';
import { Loader2 } from 'lucide-react';

type AuthView = 'login' | 'signup' | 'confirm';

const PROCESSING_PHASES = [
  'Finalizing uploads...',
  'Analyzing your presentation...',
  'Almost there...',
] as const;

type ProcessingPhase = 0 | 1 | 2;

export default function Home() {
  const { isAuthenticated, isLoading, userId } = useAuth();

  // Auth page state
  const [authView, setAuthView] = useState<AuthView>('login');
  const [confirmEmail, setConfirmEmail] = useState('');

  // App state
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [selectedPersonaName, setSelectedPersonaName] = useState<string>('');
  const [selectedPersonaTimeLimit, setSelectedPersonaTimeLimit] = useState<number | undefined>(undefined);
  const [selectedPersonaData, setSelectedPersonaData] = useState<Persona | null>(null);
  const [customNotes, setCustomNotes] = useState('');
  const [pdfUploaded, setPdfUploaded] = useState(false);
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string>(generateSessionId);
  const [sessionData, setSessionData] = useState<SessionAnalytics | null>(null);
  const [aiFeedback, setAiFeedback] = useState<AIFeedbackResponse | null>(null);

  // Background analytics tracking
  const analyticsPromiseRef = useRef<Promise<AIFeedbackResponse | null> | null>(null);
  const [isWaitingForAnalytics, setIsWaitingForAnalytics] = useState(false);
  const [processingPhase, setProcessingPhase] = useState<ProcessingPhase>(0);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingStep, setPendingStep] = useState<number | null>(null);

  // Ref for PracticeSession exit cleanup
  const exitSessionRef = useRef<(() => void) | null>(null);

  // --- Auth navigation ---
  const handleSwitchToSignUp = () => setAuthView('signup');
  const handleSwitchToLogin = () => setAuthView('login');
  const handleNeedConfirmation = (email: string) => {
    setConfirmEmail(email);
    setAuthView('confirm');
  };
  const handleConfirmed = () => setAuthView('login');

  // --- App handlers ---
  const handlePersonaSelect = (id: string | null) => {
    setSelectedPersona(id);
  };

  const handleContinueToUpload = () => {
    if (selectedPersona) {
      setCurrentStep(2);
      window.scrollTo({ top: 0 });
    }
  };

  const handleBackToPersona = () => {
    setCurrentStep(1);
    window.scrollTo({ top: 0 });
  };

  const handleContinueFromUpload = () => {
    setCurrentStep(3);
    window.scrollTo({ top: 0 });
  };

  const handleBackToUpload = () => {
    if (currentStep === 3) {
      setPendingStep(2);
      setIsModalOpen(true);
      return;
    }
    setCurrentStep(2);
    window.scrollTo({ top: 0 });
  };

  const handlePracticeComplete = (data: SessionAnalytics, promise: Promise<AIFeedbackResponse | null>) => {
    setSessionData(data);
    analyticsPromiseRef.current = promise;
    setCurrentStep(4);
    window.scrollTo({ top: 0 });
  };

  const handleBackToPractice = () => {
    setPendingStep(3);
    setIsModalOpen(true);
  };

  const resolveAnalyticsAndShow = useCallback(async () => {
    setIsWaitingForAnalytics(true);
    setProcessingPhase(0);
    setCurrentStep(5);
    window.scrollTo({ top: 0 });

    const phaseTimer1 = setTimeout(() => setProcessingPhase(1), 2_000);
    const phaseTimer2 = setTimeout(() => setProcessingPhase(2), 15_000);

    let feedback: AIFeedbackResponse | null = null;
    if (analyticsPromiseRef.current) {
      feedback = await analyticsPromiseRef.current;
      analyticsPromiseRef.current = null;
    }

    clearTimeout(phaseTimer1);
    clearTimeout(phaseTimer2);

    setAiFeedback(feedback);
    setIsWaitingForAnalytics(false);
  }, []);

  const handleQAComplete = () => {
    resolveAnalyticsAndShow();
  };

  const handleQASkip = () => {
    resolveAnalyticsAndShow();
  };

  const handleBackToStart = () => {
    setCurrentStep(1);
    setSessionData(null);
    setAiFeedback(null);
    analyticsPromiseRef.current = null;
    setSessionId(generateSessionId());
    setPdfUploaded(false);
    setUploadedFileName(null);
    window.scrollTo({ top: 0 });
  };

  const handleStepClick = (step: number) => {
    if (step > currentStep) {
      if (step === 2 && !selectedPersona) return;
      if (step === 3 && currentStep < 2) return;
    }

    if (currentStep === 3 && step !== 3) {
      setPendingStep(step);
      setIsModalOpen(true);
      return;
    }

    setCurrentStep(step);
    window.scrollTo({ top: 0 });
  };

  const handleConfirmNavigation = () => {
    exitSessionRef.current?.();
    exitSessionRef.current = null;
    if (pendingStep !== null) {
      setCurrentStep(pendingStep);
      window.scrollTo({ top: 0 });
    }
    setIsModalOpen(false);
    setPendingStep(null);
  };

  const handleCancelNavigation = () => {
    setIsModalOpen(false);
    setPendingStep(null);
  };

  // --- Loading screen ---
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 size={32} className="animate-spin text-maroon" />
      </div>
    );
  }

  // --- Auth screens ---
  if (!isAuthenticated) {
    if (authView === 'signup') {
      return (
        <SignUpPage
          onSwitchToLogin={handleSwitchToLogin}
          onNeedConfirmation={handleNeedConfirmation}
        />
      );
    }
    if (authView === 'confirm') {
      return (
        <ConfirmSignUpPage
          email={confirmEmail}
          onConfirmed={handleConfirmed}
          onBack={handleSwitchToLogin}
        />
      );
    }
    return <LoginPage onSwitchToSignUp={handleSwitchToSignUp} />;
  }

  // --- Authenticated app ---
  return (
    <div className="min-h-screen bg-gray-50">
      <Header currentStep={currentStep} onStepClick={handleStepClick} sessionId={sessionId} />

      <div key={currentStep} className="animate-step-enter">
        {currentStep === 1 && (
          <PersonaSelection
            selectedPersona={selectedPersona}
            onSelectPersona={handlePersonaSelect}
            onPersonaNameChange={setSelectedPersonaName}
            onTimeLimitChange={setSelectedPersonaTimeLimit}
            onPersonaDataChange={setSelectedPersonaData}
            customNotes={customNotes}
            onCustomNotesChange={setCustomNotes}
            sessionId={sessionId}
            onContinue={handleContinueToUpload}
          />
        )}

        {currentStep === 2 && (
          <UploadContent
            personaName={selectedPersonaName}
            sessionId={sessionId}
            initialFileName={uploadedFileName}
            initialUploaded={pdfUploaded}
            onBack={handleBackToPersona}
            onContinue={handleContinueFromUpload}
            onPdfUploaded={(fileName) => {
              setPdfUploaded(true);
              setUploadedFileName(fileName);
            }}
          />
        )}

        {currentStep === 3 && (
          <PracticeSession
            personaTitle={selectedPersonaName}
            personaId={selectedPersona ?? ''}
            sessionId={sessionId}
            timeLimitSec={selectedPersonaTimeLimit}
            hasPresentationPdf={pdfUploaded}
            hasPersonaCustomization={customNotes.trim().length > 0}
            onBack={handleBackToUpload}
            onComplete={handlePracticeComplete}
            exitSessionRef={exitSessionRef}
          />
        )}

        {currentStep === 4 && (
          <QASession
            personaId={selectedPersona || ''}
            personaName={selectedPersonaName}
            sessionId={sessionId}
            userId={userId || ''}
            onBack={handleBackToPractice}
            onComplete={handleQAComplete}
            onSkip={handleQASkip}
          />
        )}

        {currentStep === 5 && isWaitingForAnalytics && (
          <div className="flex min-h-[70vh] items-center justify-center px-4">
            <div className="mx-auto max-w-md text-center">
              <div className="relative mx-auto mb-8 h-24 w-24">
                <div className="absolute inset-0 animate-ping rounded-full bg-maroon-200 opacity-20" />
                <div className="absolute inset-2 animate-pulse rounded-full bg-maroon-100 opacity-40" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <svg
                    className="h-12 w-12 animate-spin text-maroon-600"
                    viewBox="0 0 48 48"
                    fill="none"
                  >
                    <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="80 40" opacity="0.3" />
                    <circle cx="24" cy="24" r="20" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeDasharray="30 90" />
                  </svg>
                </div>
              </div>

              <h2 className="text-xl font-bold text-gray-900 font-serif italic sm:text-2xl 2xl:text-3xl">
                Processing Your Session
              </h2>
              <div className="relative mt-3 h-8 overflow-hidden">
                <p
                  key={processingPhase}
                  className="animate-fade-in text-sm text-gray-500 font-sans leading-relaxed sm:text-base 2xl:text-lg"
                >
                  {PROCESSING_PHASES[processingPhase]}
                </p>
              </div>

              <p className="mt-8 text-xs text-gray-400 font-sans 2xl:text-sm">
                Please don&apos;t close this tab while processing.
              </p>
            </div>
          </div>
        )}

        {currentStep === 5 && !isWaitingForAnalytics && sessionData && (
          <ReviewAnalytics
            sessionData={sessionData}
            aiFeedback={aiFeedback}
            persona={selectedPersonaData}
            onBackToStart={handleBackToStart}
          />
        )}

        {currentStep === 5 && !isWaitingForAnalytics && !sessionData && (
          <div className="flex min-h-[60vh] items-center justify-center">
            <div className="text-center">
              <h2 className="text-2xl font-bold text-gray-900 font-serif">Review Analytics</h2>
              <p className="mt-2 text-gray-500 font-sans">No session data available</p>
            </div>
          </div>
        )}
      </div>

      {/* Confirmation Modal */}
      <ConfirmationModal
        isOpen={isModalOpen}
        title="Exit Practice Session?"
        message="Are you sure you want to leave? Your current recording and practice progress will be lost."
        confirmText="Exit Session"
        cancelText="Stay"
        type="warning"
        onConfirm={handleConfirmNavigation}
        onCancel={handleCancelNavigation}
      />
    </div>
  );
}
