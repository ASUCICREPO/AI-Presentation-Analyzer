'use client';

import { useState } from 'react';
import Header from './components/Header';
import PersonaSelection from './components/PersonaSelection';
import UploadContent from './components/UploadContent';
import PracticeSession from './components/PracticeSession';
import ConfirmationModal from './components/ConfirmationModal';
import { ACADEMIC_PERSONA } from './config/personas';

export default function Home() {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [customNotes, setCustomNotes] = useState('');
  
  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pendingStep, setPendingStep] = useState<number | null>(null);

  // Handler for persona selection
  const handlePersonaSelect = (id: string | null) => {
    setSelectedPersona(id);
  };

  // Step 1 -> Step 2
  const handleContinueToUpload = () => {
    if (selectedPersona) {
      setCurrentStep(2);
      window.scrollTo(0, 0);
    }
  };

  // Step 2 -> Step 1
  const handleBackToPersona = () => {
    setCurrentStep(1);
    window.scrollTo(0, 0);
  };

  // Step 2 -> Step 3
  const handleContinueFromUpload = () => {
    setCurrentStep(3);
    window.scrollTo(0, 0);
  };

  // Step 3 -> Step 2 (Exit Session)
  const handleBackToUpload = () => {
    // If we're in practice mode (step 3), confirm before leaving
    if (currentStep === 3) {
      setPendingStep(2);
      setIsModalOpen(true);
      return;
    }
    setCurrentStep(2);
    window.scrollTo(0, 0);
  };

  // Step 3 -> Step 4
  const handlePracticeComplete = () => {
    setCurrentStep(4);
    window.scrollTo(0, 0);
    // TODO: Navigate to Review Analytics
  };

  // Handle direct step navigation from Header
  const handleStepClick = (step: number) => {
    // Prevent navigating forward beyond what's logical (though the header usually disables this)
    if (step > currentStep) {
      // Allow moving to next step only if criteria met (e.g. persona selected)
      if (step === 2 && !selectedPersona) return;
      if (step === 3 && currentStep < 2) return; // Can't skip upload entirely without logic
    }

    // Confirmation when leaving Practice Session (Step 3)
    if (currentStep === 3 && step !== 3) {
      setPendingStep(step);
      setIsModalOpen(true);
      return;
    }

    setCurrentStep(step);
    window.scrollTo(0, 0);
  };

  // Handle Modal Actions
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Header currentStep={currentStep} onStepClick={handleStepClick} />
      
      {currentStep === 1 && (
        <PersonaSelection
          selectedPersona={selectedPersona}
          onSelectPersona={handlePersonaSelect}
          customNotes={customNotes}
          onCustomNotesChange={setCustomNotes}
          onContinue={handleContinueToUpload}
        />
      )}

      {currentStep === 2 && (
        <UploadContent 
          onBack={handleBackToPersona}
          onContinue={handleContinueFromUpload}
        />
      )}

      {currentStep === 3 && (
        <PracticeSession
          onBack={handleBackToUpload} // Reuse the back handler which now triggers modal
          onComplete={handlePracticeComplete}
        />
      )}
      
      {currentStep === 4 && (
        <div className="flex min-h-[60vh] items-center justify-center">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 font-serif">Review Analytics</h2>
            <p className="mt-2 text-gray-500 font-sans">Coming Soon...</p>
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
