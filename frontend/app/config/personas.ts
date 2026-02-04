export interface Persona {
  id: string;
  title: string;
  expertise: string;
  keyPriorities: string[];
  attentionSpan: string;
  communicationStyle: string;
}

export const ACADEMIC_PERSONA: Persona = {
  id: 'academic',
  title: 'Academic Committee',
  expertise: 'Expert',
  keyPriorities: [
    'Research rigor',
    'Methodology',
    'Theoretical contribution',
    'Citations',
  ],
  attentionSpan: '20-30 minutes',
  communicationStyle: 'Formal, data-driven, detailed explanations with academic terminology',
};

export const COMING_SOON_PERSONAS = [
  'Industry Partners',
  'Investors & VCs',
  'Public Stakeholders',
];
