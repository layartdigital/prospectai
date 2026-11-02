// Icones aproximados para a bancada (lucide-react real nao esta instalavel aqui).
import type { SVGProps } from 'react';
type P = SVGProps<SVGSVGElement>;
const base = (d: string) => (p: P) => (
  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
    <path d={d} />
  </svg>
);
export const AlertTriangle = base('M12 3 2 21h20L12 3Zm0 6v5m0 3v.01');
export const HelpCircle = (p: P) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7m0 3v.01" /></svg>);
export const Loader2 = base('M21 12a9 9 0 1 1-6.2-8.55');
export const Network = (p: P) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><rect x="9" y="2" width="6" height="6" rx="1" /><rect x="2" y="16" width="6" height="6" rx="1" /><rect x="16" y="16" width="6" height="6" rx="1" /><path d="M5 16v-3h14v3M12 12V8" /></svg>);
export const RotateCcw = base('M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5');
export const ExternalLink = base('M15 3h6v6m0-6-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5');
export const ShieldCheck = base('M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm-3 9 2 2 4-4');
export const ShieldQuestion = base('M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Zm0 11v.01M10 10a2 2 0 1 1 3 1.7c-.6.3-1 .7-1 1.3');
export const Search = (p: P) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>);
export const Maximize2 = base('M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7');
export const Minus = base('M5 12h14');
export const Plus = base('M5 12h14M12 5v14');
export const AlertCircle = (p: P) => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="12" cy="12" r="9" /><path d="M12 8v5m0 3v.01" /></svg>);
export const LogOut = base('M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9');
