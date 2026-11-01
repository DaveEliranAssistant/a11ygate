'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { loadDemo } from '@/lib/demo';
import { diffScans } from '@/lib/diff';
import { gateVerdict, verdictReason } from '@/lib/gate';
import { groupFindings } from '@/lib/group';
import { engineVersions, findingsFromResults, pagesFromResults } from '@/lib/parse';
import { STORAGE_KEY, reviveScan } from '@/lib/storage';
import type { AxeResults, GroupBy, Impact, ScanState } from '@/lib/types';

type Snapshot = {
  ready: boolean;
  scan: ScanState | null;
  error: string | null;
  notice: string | null;
};

type ScanContextValue = Snapshot & {
  setThreshold: (threshold: Impact) => void;
  setGroupBy: (groupBy: GroupBy) => void;
  setCurrent: (results: AxeResults[], projectName: string, synthetic: boolean) => void;
  setBaseline: (results: AxeResults[] | null, synthetic: boolean) => void;
  loadDemoData: () => void;
  clearScan: () => void;
  reportError: (message: string) => void;
};

const listeners = new Set<() => void>();
let scan: ScanState | null = null;
let errorMessage: string | null = null;
let notice: string | null = null;
let ready = false;
let hydrated = false;
let edited = false;
let snapshot: Snapshot = { ready, scan, error: errorMessage, notice };
const serverSnapshot: Snapshot = { ready: false, scan: null, error: null, notice: null };

function publish(): void {
  snapshot = { ready, scan, error: errorMessage, notice };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Snapshot {
  return snapshot;
}

function getServerSnapshot(): Snapshot {
  return serverSnapshot;
}

function writeStoredScan(value: ScanState | null): void {
  try {
    if (value) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode can reject storage. The in-memory scan still works.
  }
}

function readStoredScan(): ScanState | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return reviveScan(raw);
  } catch {
    return null;
  }
}

function persist(): void {
  if (!hydrated) return;
  writeStoredScan(scan);
}

function loadFromSession(): void {
  if (hydrated) return;
  hydrated = true;
  if (!edited) scan = readStoredScan();
  ready = true;
  publish();
  writeStoredScan(scan);
}

function pageNotice(count: number, kind: 'current' | 'baseline'): string {
  const noun = count === 1 ? 'page' : 'pages';
  return `Imported ${count} ${kind} ${noun}.`;
}

const actions = {
  reportError(message: string) {
    notice = null;
    errorMessage = message;
    publish();
  },
  setThreshold(threshold: Impact) {
    if (!scan) return;
    edited = true;
    scan = { ...scan, threshold };
    publish();
    persist();
  },
  setGroupBy(groupBy: GroupBy) {
    if (!scan) return;
    edited = true;
    scan = { ...scan, groupBy };
    publish();
    persist();
  },
  setCurrent(results: AxeResults[], projectName: string, synthetic: boolean) {
    edited = true;
    errorMessage = null;
    notice = pageNotice(results.length, 'current');
    scan = {
      projectName,
      currentSynthetic: synthetic,
      baselineSynthetic: scan?.baselineSynthetic ?? false,
      currentResults: results,
      baselineResults: scan?.baselineResults ?? null,
      threshold: scan?.threshold ?? 'serious',
      groupBy: scan?.groupBy ?? 'rule',
      generatedAt: new Date().toISOString(),
    };
    publish();
    persist();
  },
  setBaseline(results: AxeResults[] | null, synthetic: boolean) {
    if (!scan) {
      notice = null;
      errorMessage = 'Import a current run before the baseline.';
      publish();
      return;
    }
    edited = true;
    errorMessage = null;
    scan = {
      ...scan,
      baselineResults: results,
      baselineSynthetic: results ? synthetic : false,
    };
    notice = results
      ? pageNotice(results.length, 'baseline')
      : 'Baseline removed. Every current finding is treated as new.';
    publish();
    persist();
  },
  loadDemoData() {
    const demo = loadDemo();
    edited = true;
    errorMessage = null;
    notice =
      'Loaded synthetic Demo Shop data. 3 pages in the current run and 3 in the baseline. Not a real audit.';
    scan = {
      projectName: demo.projectName,
      currentSynthetic: true,
      baselineSynthetic: true,
      currentResults: demo.current,
      baselineResults: demo.baseline,
      threshold: 'serious',
      groupBy: 'rule',
      generatedAt: new Date().toISOString(),
    };
    publish();
    persist();
  },
  clearScan() {
    edited = true;
    scan = null;
    errorMessage = null;
    notice = 'Scan cleared from this tab.';
    publish();
    persist();
  },
};

const ScanContext = createContext<ScanContextValue | null>(null);

export function ScanProvider({ children }: { children: ReactNode }) {
  const current = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    loadFromSession();
  }, []);

  const value = useMemo<ScanContextValue>(() => ({ ...current, ...actions }), [current]);

  return <ScanContext.Provider value={value}>{children}</ScanContext.Provider>;
}

export function useScan(): ScanContextValue {
  const value = useContext(ScanContext);
  if (!value) throw new Error('useScan must be used within ScanProvider');
  return value;
}

export function useScanModel() {
  const context = useScan();
  const currentScan = context.scan;
  const model = useMemo(() => {
    if (!currentScan) return null;
    const currentFindings = findingsFromResults(currentScan.currentResults);
    const baselineFindings = currentScan.baselineResults
      ? findingsFromResults(currentScan.baselineResults)
      : null;
    const diff = diffScans(currentFindings, baselineFindings);
    const verdict = gateVerdict(diff.newFindings, currentScan.threshold);
    return {
      diff,
      verdict,
      reason: verdictReason(diff.newFindings, currentScan.threshold),
      groups: groupFindings(diff.all, currentScan.groupBy),
      pages: pagesFromResults(currentScan.currentResults),
      baselinePages: currentScan.baselineResults
        ? pagesFromResults(currentScan.baselineResults)
        : [],
      engines: engineVersions(currentScan.currentResults),
    };
  }, [currentScan]);

  return { ...context, model };
}
