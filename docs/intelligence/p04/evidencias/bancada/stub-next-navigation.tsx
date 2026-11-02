import { useSyncExternalStore } from 'react';
const EVT = 'pa-urlchange';
const subscribe = (cb: () => void) => { window.addEventListener(EVT, cb); window.addEventListener('popstate', cb); return () => { window.removeEventListener(EVT, cb); window.removeEventListener('popstate', cb); }; };
const snap = () => window.location.search;
export function useSearchParams(): URLSearchParams {
  const s = useSyncExternalStore(subscribe, snap, () => '');
  return new URLSearchParams(s);
}
export function useRouter() {
  return { refresh: () => { window.dispatchEvent(new Event('pa-refresh')); }, replace: (url: string) => { history.replaceState(null, '', url); window.dispatchEvent(new Event(EVT)); }, push: (url: string) => { history.pushState(null, '', url); window.dispatchEvent(new Event(EVT)); } };
}
export function usePathname() { return window.location.pathname; }
