'use client';

import { useState } from 'react';
import Header from './components/Header';
import PersonaSelection from './components/PersonaSelection';
import UploadContent from './components/UploadContent';
import { ACADEMIC_PERSONA } from './config/personas';

export default function Home() {
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedPersona, setSelectedPersona] = useState<string | null>(null);
  const [customNotes, setCustomNotes] = useState('');

  // Handler for persona selection
  const handlePersonaSelect = (id: string | null) => {
    setSelectedPersona(id);
  };

  // Handler to proceed to Step 2
  const handleContinueToUpload = () => {
    if (selectedPersona) {
      setCurrentStep(2);
      window.scrollTo(0, 0);
    }
  };

  // Handler to go back to Step 1
  const handleBackToPersona = () => {
    setCurrentStep(1);
    window.scrollTo(0, 0);
  };

  // Handler to proceed from upload (Step 2) to Step 3
  const handleContinueFromUpload = () => {
    setCurrentStep(3);
    // TODO: Navigate to Practice & Record page or show next component
    console.log("Proceeding to Practice & Record");
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <Header currentStep={currentStep} />
      
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
    </div>
  );
}
