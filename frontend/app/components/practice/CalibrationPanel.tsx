import React from 'react';
import { Sun, Ruler, ScanFace, Check, CheckCircle2, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, AlertCircle } from 'lucide-react';

interface CalibrationPanelProps {
  showMesh: boolean;
  onToggleMesh: () => void;
  gazeStatus: {
    isLookingAtScreen: boolean;
    direction: string;
    message: string;
    color: string;
  };
  onComplete: () => void;
}

export default function CalibrationPanel({
  showMesh,
  onToggleMesh,
  gazeStatus,
  onComplete
}: CalibrationPanelProps) {
  // Helper to get gaze icon based on direction
  const getGazeIcon = () => {
    if (gazeStatus.isLookingAtScreen) return <CheckCircle2 className="w-8 h-8 text-green-600" />;
    
    switch (gazeStatus.direction) {
      case 'Left': return <ArrowLeft className="w-8 h-8 text-red-600" />;
      case 'Right': return <ArrowRight className="w-8 h-8 text-red-600" />;
      case 'Up': return <ArrowUp className="w-8 h-8 text-orange-500" />;
      case 'Down': return <ArrowDown className="w-8 h-8 text-orange-500" />;
      default: return <AlertCircle className="w-8 h-8 text-red-600" />;
    }
  };

  return (
    <div className="animate-fade-in flex flex-col h-full">
       <div className="flex items-center gap-2 mb-4 border-b pb-4">
          <div className="h-8 w-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-bold shrink-0">1</div>
          <h3 className="font-serif text-lg font-bold text-gray-900 2xl:text-2xl">Calibration Check</h3>
       </div>
       
       <div className="flex-1 overflow-y-auto space-y-6">
         {/* Mesh Toggle */}
         <div className="flex items-center justify-between bg-gray-50 p-3 rounded-lg border border-gray-100">
            <span className="text-sm font-medium text-gray-700">Show Face Mesh Overlay</span>
            <button 
              onClick={onToggleMesh}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                showMesh ? 'bg-blue-600' : 'bg-gray-200'
              }`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                showMesh ? 'translate-x-6' : 'translate-x-1'
              }`} />
            </button>
         </div>

         {/* Gaze Check */}
         <div className={`rounded-xl p-5 border-2 text-center transition-all duration-300 ${
            gazeStatus.isLookingAtScreen 
              ? 'border-green-100 bg-green-50/50' 
              : 'border-red-100 bg-red-50/50'
         }`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">Current Gaze Status</p>
            <div className={`text-3xl font-bold mb-2 flex items-center justify-center gap-2 ${
              gazeStatus.isLookingAtScreen ? 'text-green-700' : 'text-red-600'
            }`}>
              {getGazeIcon()}
              {gazeStatus.direction}
            </div>
            <div className={`text-sm font-medium ${
               gazeStatus.isLookingAtScreen ? 'text-green-600' : 'text-red-500'
            }`}>
              {gazeStatus.isLookingAtScreen ? "Perfect! You're looking at the camera." : "Please adjust until 'Center' is shown."}
            </div>
         </div>

         {/* Prominent Checklist */}
         <div>
            <h4 className="font-medium text-gray-900 mb-3 flex items-center gap-2">
              <span>Setup Checklist</span>
              <span className="text-xs font-normal text-gray-500">(Self-Check)</span>
            </h4>
            <div className="space-y-3">
              {[
                { id: 'light', icon: <Sun className="w-5 h-5 text-amber-500" />, text: 'Face is well-lit (no backlight)' },
                { id: 'pos', icon: <Ruler className="w-5 h-5 text-blue-500" />, text: 'Camera is at eye level' },
                { id: 'clear', icon: <ScanFace className="w-5 h-5 text-purple-500" />, text: 'Face visible (no masks/hair)' },
              ].map((item) => (
                <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 bg-white hover:border-blue-300 transition-colors group cursor-default">
                   <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                     {item.icon}
                   </div>
                   <span className="text-sm text-gray-700 font-medium">{item.text}</span>
                </div>
              ))}
            </div>
         </div>
       </div>

       <div className="pt-4 border-t mt-auto">
         <button 
           onClick={onComplete}
           className="w-full rounded-lg bg-blue-600 px-4 py-3 text-sm font-bold text-white shadow-lg hover:bg-blue-700 hover:shadow-xl transform active:scale-[0.98] transition-all flex items-center justify-center gap-2"
         >
           <span>Everything Looks Good</span>
           <Check className="w-5 h-5" />
         </button>
       </div>
    </div>
  );
}
