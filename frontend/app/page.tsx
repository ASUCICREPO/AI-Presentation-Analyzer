'use client';

import { useState } from 'react';
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
import { generateSessionId } from './config/config';
import { Loader2 } from 'lucide-react';

type AuthView = 'login' | 'signup' | 'confirm';

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
  const [customNotes, setCustomNotes] = useState('');
  const [pdfUploaded, setPdfUploaded] = useState(false);
  const [sessionId, setSessionId] = useState<string>(generateSessionId);
  const [sessionData, setSessionData] = useState<SessionAnalytics | null>(null);

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingStep, setPendingStep] = useState<number | null>(null);

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
      window.scrollTo(0, 0);
    }
  };

  const handleBackToPersona = () => {
    setCurrentStep(1);
    window.scrollTo(0, 0);
  };

  const handleContinueFromUpload = () => {
    setCurrentStep(3);
    window.scrollTo(0, 0);
  };

  const handleBackToUpload = () => {
    if (currentStep === 3) {
      setPendingStep(2);
      setIsModalOpen(true);
      return;
    }
    setCurrentStep(2);
    window.scrollTo(0, 0);
  };

  const handlePracticeComplete = (data: SessionAnalytics) => {
    setSessionData(data);
    setCurrentStep(4); // Go to QA Session (Step 4)
    window.scrollTo(0, 0);
  };

  const handleQAComplete = () => {
    setCurrentStep(5); // Go to Review Analytics (Step 5)
    window.scrollTo(0, 0);
  };

  const handleQASkip = () => {
    setCurrentStep(5); // Skip QA, go directly to Analytics
    window.scrollTo(0, 0);
  };

  const handleBackToPractice = () => {
    // From QA, go back to practice (with confirmation)
    setPendingStep(3);
    setIsModalOpen(true);
  };

  const handleDownloadSessionData = () => {
    if (sessionData) {
      const blob = new Blob([JSON.stringify(sessionData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `session_analytics_${sessionData.sessionId}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const handleBackToStart = () => {
    setCurrentStep(1);
    setSessionData(null);
    setSessionId(generateSessionId());
    setPdfUploaded(false);
    window.scrollTo(0, 0);
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
    window.scrollTo(0, 0);
  };

  const handleConfirmNavigation = () => {
    if (pendingStep !== null) {
      setCurrentStep(pendingStep);
      window.scrollTo(0, 0);
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

      {currentStep === 1 && (
        <PersonaSelection
          selectedPersona={selectedPersona}
          onSelectPersona={handlePersonaSelect}
          onPersonaNameChange={setSelectedPersonaName}
          onTimeLimitChange={setSelectedPersonaTimeLimit}
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
          onBack={handleBackToPersona}
          onContinue={handleContinueFromUpload}
          onPdfUploaded={() => setPdfUploaded(true)}
        />
      )}

      {currentStep === 3 && (
        <PracticeSession
          personaTitle={selectedPersonaName}
          sessionId={sessionId}
          timeLimitSec={selectedPersonaTimeLimit}
          hasPresentationPdf={pdfUploaded}
          hasPersonaCustomization={customNotes.trim().length > 0}
          onBack={handleBackToUpload}
          onComplete={handlePracticeComplete}
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

      {currentStep === 5 && sessionData && (
        <ReviewAnalytics
          sessionData={sessionData}
          onDownload={handleDownloadSessionData}
          onBackToStart={handleBackToStart}
        />
      )}

      {currentStep === 5 && !sessionData && (
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 font-serif">Review Analytics</h2>
            <p className="mt-2 text-gray-500 font-sans">No session data available</p>
          </div>
        </div>
      )}

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
