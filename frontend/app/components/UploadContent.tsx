'use client';

import React, { useRef, useState, useEffect } from 'react';
import { getPresignedUrl, uploadFileWithPresignedUrl } from '../services/api';

interface UploadContentProps {
  personaName: string;
  sessionId: string;
  initialFileName?: string | null;
  initialUploaded?: boolean;
  onBack: () => void;
  onContinue: () => void;
  onPdfUploaded?: (fileName: string) => void;
}

export default function UploadContent({ personaName, sessionId, initialFileName, initialUploaded, onBack, onContinue, onPdfUploaded }: UploadContentProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(initialUploaded ?? false);
  const [progress, setProgress] = useState(initialUploaded ? 100 : 0);
  const [error, setError] = useState<string | null>(null);
  const [displayFileName, setDisplayFileName] = useState<string | null>(initialFileName ?? null);
  const [showPrivacyModal, setShowPrivacyModal] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const pendingFileRef = useRef<File | null>(null);

  // Trigger enter animation after mount
  useEffect(() => {
    if (showPrivacyModal) {
      requestAnimationFrame(() => setModalVisible(true));
    }
  }, [showPrivacyModal]);

  const handleDismissPrivacy = () => {
    setModalVisible(false);
    setTimeout(() => {
      setShowPrivacyModal(false);
      setPrivacyAccepted(true);
      // Proceed with the pending upload
      if (pendingFileRef.current) {
        const file = pendingFileRef.current;
        pendingFileRef.current = null;
        setSelectedFile(file);
        startUpload(file);
      }
    }, 300);
  };

  const handleCancelPrivacy = () => {
    setModalVisible(false);
    setTimeout(() => {
      setShowPrivacyModal(false);
      pendingFileRef.current = null;
      if (fileInputRef.current) fileInputRef.current.value = '';
    }, 300);
  };

  const handleBrowseClick = () => {
    fileInputRef.current?.click();
  };

  const startUpload = async (file: File) => {
    setUploading(true);
    setProgress(0);
    setError(null);
    try {
      const presigned = await getPresignedUrl('ppt', sessionId);
      await uploadFileWithPresignedUrl(file, presigned, (pct) => setProgress(pct));
      setProgress(100);
      setUploaded(true);
      setDisplayFileName(file.name);
      onPdfUploaded?.(file.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploaded(false);
    setError(null);

    if (privacyAccepted) {
      setSelectedFile(file);
      startUpload(file);
    } else {
      pendingFileRef.current = file;
      setShowPrivacyModal(true);
    }
  };

  const handleRemoveFile = () => {
    setSelectedFile(null);
    setUploaded(false);
    setProgress(0);
    setError(null);
    setDisplayFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <div className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6 sm:py-8 xl:max-w-[900px] 2xl:max-w-[1280px] 2xl:py-16">
      {/* Page Title */}
      <div className="mb-6 2xl:mb-10">
        <h1 className="text-xl font-bold text-gray-900 font-serif italic sm:text-2xl 2xl:text-4xl">
          Upload Presentation Content
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-gray-500 sm:mt-2 2xl:text-xl 2xl:leading-8 font-sans">
          Upload your presentation slides or notes. The AI will analyze your content to provide context-aware feedback and optionally generate relevant questions.
        </p>
      </div>

      {/* Selected Persona Banner */}
      <div className="mb-6 rounded-lg bg-maroon-50 border border-maroon-100 p-4 flex items-center gap-3 2xl:mb-8 2xl:p-6 2xl:rounded-xl">
        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-maroon-600 2xl:h-7 2xl:w-7">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="text-white 2xl:h-4 2xl:w-4">
            <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor" />
          </svg>
        </div>
        <span className="text-sm font-medium text-maroon-800 font-sans 2xl:text-lg">
          Selected Persona: {personaName}
        </span>
      </div>

      {/* File Upload Dropzone / Selected File */}
      {!selectedFile && !displayFileName ? (
        <div className="mb-8 rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-10 text-center transition-colors hover:border-maroon-300 hover:bg-maroon-50/10 2xl:p-16 2xl:mb-12">
          <div className="flex flex-col items-center justify-center">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 2xl:h-16 2xl:w-16 2xl:mb-6">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" className="text-gray-400 2xl:h-8 2xl:w-8">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM14 13v4h-4v-4H7l5-5 5 5h-3z" fill="currentColor" />
              </svg>
            </div>

            <h3 className="mb-2 text-base font-medium text-gray-900 font-sans 2xl:text-xl">
              Drop your presentation file here
            </h3>
            <p className="mb-6 text-sm text-gray-500 font-sans 2xl:text-lg 2xl:mb-8">
              or click to browse
            </p>

            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              accept=".pdf"
              onChange={handleFileChange}
            />

            <button
              onClick={handleBrowseClick}
              className="rounded-lg bg-maroon-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-maroon-700 hover:shadow-md active:scale-[0.98] font-sans 2xl:px-8 2xl:py-3.5 2xl:text-lg"
            >
              Select File
            </button>

            <p className="mt-4 text-xs text-gray-400 font-sans 2xl:text-base 2xl:mt-6">
              Supported format: PDF
            </p>
          </div>
        </div>
      ) : (
        <div className="mb-8 rounded-xl border-2 border-gray-200 bg-white p-6 2xl:p-10 2xl:mb-12">
          {/* File info row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 2xl:h-14 2xl:w-14">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-red-500 2xl:h-7 2xl:w-7">
                  <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" fill="currentColor" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 font-sans 2xl:text-lg">{selectedFile?.name ?? displayFileName}</p>
                {selectedFile && (
                  <p className="text-xs text-gray-500 font-sans 2xl:text-sm">
                    {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              {uploaded && (
                <span className="flex items-center gap-1 text-sm text-green-600 font-sans">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z" fill="currentColor" />
                  </svg>
                  Uploaded
                </span>
              )}
              {uploading && (
                <span className="text-xs text-gray-400 font-sans 2xl:text-sm">{progress}%</span>
              )}
              <button
                onClick={handleRemoveFile}
                disabled={uploading}
                className="rounded-lg border border-gray-200 p-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z" fill="currentColor" />
                </svg>
              </button>
            </div>
          </div>

          {/* Progress bar */}
          {(uploading || uploaded) && (
            <div className="mt-4">
              <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100 2xl:h-3">
                <div
                  className={`h-full rounded-full transition-all duration-300 ease-out ${uploaded ? 'bg-green-500' : 'bg-maroon-600'
                    }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-gray-400 font-sans 2xl:text-sm">
                {uploaded ? 'Upload complete' : `Uploading… ${progress}%`}
              </p>
            </div>
          )}

          {error && (
            <p className="mt-3 text-sm text-red-500 font-sans">{error}</p>
          )}
        </div>
      )}

      {/* Navigation Footer */}
      <div className="flex items-center justify-between border-t border-gray-100 pt-6 2xl:pt-10">
        <button
          onClick={onBack}
          className="rounded-lg border border-gray-200 px-5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 font-sans 2xl:px-8 2xl:py-3.5 2xl:text-lg"
        >
          Back
        </button>

        <div className="flex flex-col items-end gap-2">
          <button
            onClick={onContinue}
            disabled={uploading}
            className="rounded-lg bg-maroon-600 px-6 py-2.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-maroon-700 hover:shadow-md active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed font-sans 2xl:px-8 2xl:py-3.5 2xl:text-lg flex items-center gap-2"
          >
            {uploaded ? 'Continue' : 'Skip & Continue'}
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              className="transition-transform duration-200 group-hover:translate-x-0.5 2xl:h-5 2xl:w-5"
            >
              <path
                d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6-1.41-1.41z"
                fill="currentColor"
              />
            </svg>
          </button>
        </div>
      </div>

      <p className="mt-4 text-center text-xs text-gray-400 font-sans 2xl:text-sm 2xl:mt-6">
        Content upload is optional. You can skip this step and proceed directly to practice mode.
      </p>

      {/* Privacy Notice Modal */}
      {showPrivacyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className={`absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${modalVisible ? 'opacity-100' : 'opacity-0'
              }`}
            onClick={handleCancelPrivacy}
          />
          <div
            className={`relative w-full max-w-lg transform overflow-hidden rounded-2xl bg-white p-6 shadow-xl transition-all duration-300 ${modalVisible ? 'translate-y-0 opacity-100 scale-100' : 'translate-y-4 opacity-0 scale-95'
              }`}
          >
            <div className="flex items-start gap-3 mb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 shrink-0">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="text-blue-500">
                  <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4z" fill="currentColor" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 font-serif">Data Usage &amp; Privacy Notice</h3>
                <p className="text-xs text-gray-500 font-sans">Important information about your presentation data</p>
              </div>
            </div>

            <p className="text-sm text-gray-700 mb-4 font-sans leading-relaxed">
              Your uploaded presentation content and recorded videos are processed to provide real-time feedback and analysis.
            </p>

            <p className="text-sm font-semibold text-gray-900 mb-2 font-sans">Here&apos;s what you should know:</p>
            <ul className="space-y-2 mb-4">
              <li className="flex items-start gap-2 text-sm text-gray-700 font-sans">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />
                Your data is stored in the backend to enable presentation analysis and feedback
              </li>
              <li className="flex items-start gap-2 text-sm text-gray-700 font-sans">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />
                Your data will not be shared beyond the services required for this application
              </li>
              <li className="flex items-start gap-2 text-sm text-gray-700 font-sans">
                <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-gray-400 shrink-0" />
                Your data will not be used for model training or shared with external parties
              </li>
            </ul>

            <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 mb-6">
              <p className="text-xs text-gray-700 font-sans leading-relaxed">
                <span className="font-semibold">⚠️ Note:</span> While we prioritize your privacy, please avoid uploading sensitive, confidential, or personally identifiable information (PII) as this is a practice tool utilizing cloud-based AI services.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleCancelPrivacy}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 font-sans"
              >
                Cancel
              </button>
              <button
                onClick={handleDismissPrivacy}
                className="flex-1 rounded-lg bg-maroon-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition-all hover:bg-maroon-700 hover:shadow-md active:scale-[0.98] font-sans"
              >
                I Understand &amp; Agree
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
