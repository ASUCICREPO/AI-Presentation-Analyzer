import React from 'react';
import { Sun, Ruler, ScanFace, CheckCircle2, ArrowLeft, ArrowRight, ArrowUp, ArrowDown, AlertCircle } from 'lucide-react';
import InfoTooltip from '../InfoTooltip';

interface CalibrationPanelProps {
  showMesh: boolean;
  onToggleMesh: () => void;
  gazeStatus: {
    isLookingAtScreen: boolean;
    direction: string;
    message: string;
    color: string;
  };
}

export default function CalibrationPanel({
  showMesh,
  onToggleMesh,
  gazeStatus,
}: CalibrationPanelProps) {
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
    <div className="animate-fade-in flex flex-col">
      <div className="flex items-center gap-2 mb-3 border-b pb-3">
        <div className="h-7 w-7 rounded-full bg-maroon-100 text-maroon flex items-center justify-center font-bold shrink-0 font-sans text-sm">1</div>
        <h3 className="font-serif text-base font-bold text-gray-900 2xl:text-xl">Camera Check <InfoTooltip text="Verify your camera setup — face detection, gaze tracking, and lighting conditions before you start recording." /></h3>
      </div>

      <div className="space-y-4">
        {/* Mesh Toggle */}
        <div className="flex items-center justify-between bg-gray-50 p-2.5 rounded-lg border border-gray-100">
          <span className="text-sm font-medium text-gray-700 font-sans">Show Face Mesh Overlay</span>
          <button
            onClick={onToggleMesh}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-maroon/30 focus:ring-offset-2 ${showMesh ? 'bg-maroon' : 'bg-gray-200'
              }`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showMesh ? 'translate-x-6' : 'translate-x-1'
              }`} />
          </button>
        </div>

        {/* Gaze Check */}
        <div className={`rounded-xl p-3 border-2 text-center transition-all duration-300 ${gazeStatus.isLookingAtScreen
          ? 'border-green-100 bg-green-50/50'
          : 'border-red-100 bg-red-50/50'
          }`}>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 mb-1 font-sans">Current Gaze Status</p>
          <div className={`text-2xl font-bold mb-1 flex items-center justify-center gap-2 ${gazeStatus.isLookingAtScreen ? 'text-green-700' : 'text-red-600'
            }`}>
            {getGazeIcon()}
            {gazeStatus.direction}
          </div>
          <div className={`text-xs font-medium font-sans ${gazeStatus.isLookingAtScreen ? 'text-green-600' : 'text-red-500'
            }`}>
            {gazeStatus.isLookingAtScreen ? "Perfect! You're looking at the camera." : "Please adjust until 'Center' is shown."}
          </div>
        </div>

        {/* Setup Checklist */}
        <div>
          <h4 className="font-medium text-gray-900 mb-2 flex items-center gap-2 font-sans text-sm">
            <span>Setup Checklist</span>
            <span className="text-xs font-normal text-gray-500">(Self-Check)</span>
          </h4>
          <div className="space-y-2">
            {[
              { id: 'light', icon: <Sun className="w-4 h-4 text-amber-500" />, text: 'Face is well-lit (no backlight)' },
              { id: 'pos', icon: <Ruler className="w-4 h-4 text-maroon" />, text: 'Camera is at eye level' },
              { id: 'clear', icon: <ScanFace className="w-4 h-4 text-maroon-400" />, text: 'Face visible (no masks/hair)' },
            ].map((item) => (
              <div key={item.id} className="flex items-center gap-2.5 p-2.5 rounded-lg border border-gray-200 bg-white hover:border-maroon-200 transition-colors group cursor-default">
                <div className="h-7 w-7 rounded-full bg-maroon-50 flex items-center justify-center group-hover:bg-maroon-100 transition-colors shrink-0">
                  {item.icon}
                </div>
                <span className="text-sm text-gray-700 font-medium font-sans">{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}