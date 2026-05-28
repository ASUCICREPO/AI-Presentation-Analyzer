'use client';

import React from 'react';
import * as Slider from '@radix-ui/react-slider';
import { RotateCcw } from 'lucide-react';
import { PersonaBestPractices } from '../config/config';

interface SessionBaselineSlidersProps {
  /** The persona's defaults — used as initial values and as the "reset to" target. */
  defaults: PersonaBestPractices;
  /** Current per-field overrides. `null` (or empty object) means "use defaults". */
  value: Partial<PersonaBestPractices> | null;
  onChange: (next: Partial<PersonaBestPractices> | null) => void;
}

// ─── Slider primitives ────────────────────────────────────────────────

function trackClasses() {
  return 'relative h-1.5 w-full grow overflow-hidden rounded-full bg-gray-200';
}

function rangeClasses() {
  return 'absolute h-full bg-maroon';
}

function thumbClasses() {
  return [
    'block h-4 w-4 rounded-full bg-white border-2 border-maroon shadow',
    'focus:outline-none focus:ring-2 focus:ring-maroon/40',
    'transition-transform hover:scale-110 active:scale-95',
  ].join(' ');
}

interface SingleSliderProps {
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  onChange: (n: number) => void;
  /** Optional formatter for the displayed number. */
  format?: (n: number) => string;
  helper?: string;
}

function SingleSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  defaultValue,
  onChange,
  format,
  helper,
}: SingleSliderProps) {
  const display = format ? format(value) : `${value}${unit ?? ''}`;
  const defaultDisplay = format ? format(defaultValue) : `${defaultValue}${unit ?? ''}`;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 2xl:text-base">
          {label}
        </label>
        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 tabular-nums 2xl:text-sm">
          {display}
        </span>
      </div>
      <Slider.Root
        className="relative flex w-full select-none items-center py-2"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={(arr) => onChange(arr[0])}
        aria-label={label}
      >
        <Slider.Track className={trackClasses()}>
          <Slider.Range className={rangeClasses()} />
        </Slider.Track>
        <Slider.Thumb className={thumbClasses()} aria-valuetext={display} />
      </Slider.Root>
      <div className="flex items-center justify-between text-[11px] text-gray-400 2xl:text-xs">
        <span>{format ? format(min) : `${min}${unit ?? ''}`}</span>
        <span>default: {defaultDisplay}</span>
        <span>{format ? format(max) : `${max}${unit ?? ''}`}</span>
      </div>
      {helper && (
        <p className="mt-1 text-[11px] leading-snug text-gray-500 2xl:text-xs">{helper}</p>
      )}
    </div>
  );
}

interface RangeSliderProps {
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  value: [number, number];
  defaultValue: [number, number];
  onChange: (range: [number, number]) => void;
  helper?: string;
}

function RangeSlider({
  label,
  unit,
  min,
  max,
  step,
  value,
  defaultValue,
  onChange,
  helper,
}: RangeSliderProps) {
  const [lo, hi] = value;
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-sm font-medium text-gray-700 2xl:text-base">
          {label}
        </label>
        <span className="rounded-md bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-700 tabular-nums 2xl:text-sm">
          {lo}–{hi}{unit ?? ''}
        </span>
      </div>
      <Slider.Root
        className="relative flex w-full select-none items-center py-2"
        min={min}
        max={max}
        step={step}
        minStepsBetweenThumbs={1}
        value={value}
        onValueChange={(arr) => {
          if (arr.length === 2) onChange([arr[0], arr[1]]);
        }}
        aria-label={label}
      >
        <Slider.Track className={trackClasses()}>
          <Slider.Range className={rangeClasses()} />
        </Slider.Track>
        <Slider.Thumb className={thumbClasses()} aria-label={`${label} minimum`} aria-valuetext={`${lo}${unit ?? ''}`} />
        <Slider.Thumb className={thumbClasses()} aria-label={`${label} maximum`} aria-valuetext={`${hi}${unit ?? ''}`} />
      </Slider.Root>
      <div className="flex items-center justify-between text-[11px] text-gray-400 2xl:text-xs">
        <span>{min}{unit ?? ''}</span>
        <span>default: {defaultValue[0]}–{defaultValue[1]}{unit ?? ''}</span>
        <span>{max}{unit ?? ''}</span>
      </div>
      {helper && (
        <p className="mt-1 text-[11px] leading-snug text-gray-500 2xl:text-xs">{helper}</p>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────

/** Resolve effective value for a metric: override (if any) → default. */
function eff<T>(override: T | undefined, fallback: T): T {
  return override === undefined ? fallback : override;
}

export default function SessionBaselineSliders({
  defaults,
  value,
  onChange,
}: SessionBaselineSlidersProps) {
  const wpmMin = eff(value?.wpm?.min, defaults.wpm.min);
  const wpmMax = eff(value?.wpm?.max, defaults.wpm.max);
  const eyeMin = eff(value?.eyeContact?.min, defaults.eyeContact.min);
  const fillerMax = eff(value?.fillerWords?.max, defaults.fillerWords.max);
  const pausesMin = eff(value?.pauses?.min, defaults.pauses.min);

  const isOverridden =
    !!value && (
      value.wpm !== undefined ||
      value.eyeContact !== undefined ||
      value.fillerWords !== undefined ||
      value.pauses !== undefined
    );

  const updateWpm = (range: [number, number]) => {
    onChange({
      ...(value ?? {}),
      wpm: { ...defaults.wpm, ...value?.wpm, min: range[0], max: range[1] },
    });
  };

  const updateEye = (n: number) => {
    onChange({
      ...(value ?? {}),
      eyeContact: { ...defaults.eyeContact, ...value?.eyeContact, min: n },
    });
  };

  const updateFiller = (n: number) => {
    onChange({
      ...(value ?? {}),
      fillerWords: { ...defaults.fillerWords, ...value?.fillerWords, max: n },
    });
  };

  const updatePauses = (n: number) => {
    onChange({
      ...(value ?? {}),
      pauses: { ...defaults.pauses, ...value?.pauses, min: n },
    });
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="flex items-center justify-between px-5 py-4 2xl:px-8 2xl:py-6">
        <div>
          <h4 className="text-sm font-medium text-gray-700 2xl:text-xl">
            Session Baseline (Optional)
          </h4>
          <p className="mt-0.5 text-xs text-gray-500 2xl:text-sm">
            Personalize the thresholds for this session.
          </p>
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={!isOverridden}
          className={`
            inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors 2xl:text-sm
            ${isOverridden
              ? 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
              : 'border-gray-200 bg-gray-50 text-gray-300 cursor-not-allowed'
            }
          `}
        >
          <RotateCcw className="h-3 w-3 2xl:h-3.5 2xl:w-3.5" />
          Reset
        </button>
      </div>

      <div className="space-y-5 border-t border-gray-100 px-5 py-5 2xl:space-y-6 2xl:px-8 2xl:py-6">
        <RangeSlider
          label="Speaking Pace"
          unit=" wpm"
          min={80}
          max={220}
          step={5}
          value={[wpmMin, wpmMax]}
          defaultValue={[defaults.wpm.min, defaults.wpm.max]}
          onChange={updateWpm}
          helper="Target words-per-minute window for your delivery."
        />

        <SingleSlider
          label="Eye Contact"
          unit="%"
          min={0}
          max={100}
          step={1}
          value={eyeMin}
          defaultValue={defaults.eyeContact.min}
          onChange={updateEye}
          helper="Minimum percentage of time looking toward the camera."
        />

        <SingleSlider
          label="Filler Words"
          min={0}
          max={15}
          step={1}
          value={fillerMax}
          defaultValue={defaults.fillerWords.max}
          onChange={updateFiller}
          format={(n) => `≤ ${n} per 30s`}
          helper="Maximum filler words per 30-second window before flagging."
        />

        <SingleSlider
          label="Strategic Pauses"
          min={0}
          max={15}
          step={1}
          value={pausesMin}
          defaultValue={defaults.pauses.min}
          onChange={updatePauses}
          format={(n) => `≥ ${n} per 30s`}
          helper="Minimum deliberate pauses per 30-second window."
        />
      </div>
    </div>
  );
}
