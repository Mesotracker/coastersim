export interface Theme {
  name: string;
  rail: string;
  spine: string;
  tie: string;
  support: string;
  car: string;
  accent: string;
}

export const THEMES: Theme[] = [
  {
    name: 'Classic Red',
    rail: '#e2e8f0',
    spine: '#dc2626',
    tie: '#f87171',
    support: '#f1f5f9',
    car: '#facc15',
    accent: '#dc2626',
  },
  {
    name: 'Neon Night',
    rail: '#67e8f9',
    spine: '#7c3aed',
    tie: '#22d3ee',
    support: '#a78bfa',
    car: '#f472b6',
    accent: '#22d3ee',
  },
  {
    name: 'Woodie',
    rail: '#e7e5e4',
    spine: '#92400e',
    tie: '#b45309',
    support: '#a16207',
    car: '#0f766e',
    accent: '#b45309',
  },
  {
    name: 'Arctic',
    rail: '#f8fafc',
    spine: '#0284c7',
    tie: '#7dd3fc',
    support: '#e0f2fe',
    car: '#f97316',
    accent: '#0284c7',
  },
  {
    name: 'Emerald',
    rail: '#ecfdf5',
    spine: '#047857',
    tie: '#34d399',
    support: '#d1fae5',
    car: '#fb7185',
    accent: '#059669',
  },
];
