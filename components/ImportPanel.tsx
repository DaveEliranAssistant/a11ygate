'use client';

import { useEffect, useState } from 'react';
import { axeJsonTooLargeMessage, MAX_AXE_JSON_BYTES } from '@/lib/limits';
import { parseAxeDocuments } from '@/lib/parse';
import { inferProjectName } from '@/lib/project';
import { useScan } from '@/lib/store';

async function readFiles(files: File[]): Promise<{ name: string; text: string }[]> {
  return Promise.all(
    files.map(async (file) => ({
      name: file.name || 'pasted.json',
      text: await file.text(),
    })),
  );
}

function fileProblem(files: File[]): string | null {
  for (const file of files) {
    const name = file.name || 'file.json';
    if (file.size === 0) return `${name}: The file is empty.`;
    if (file.size > MAX_AXE_JSON_BYTES) return `${name}: ${axeJsonTooLargeMessage()}`;
  }
  return null;
}

function DropFields({
  id,
  legend,
  description,
  onParsed,
  onError,
}: {
  id: string;
  legend: string;
  description: string;
  onParsed: (payload: { name: string; text: string }[]) => void;
  onError: (message: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const [paste, setPaste] = useState('');
  const hintId = `${id}-hint`;

  async function ingest(files: File[]) {
    if (files.length === 0) return;
    const problem = fileProblem(files);
    if (problem) {
      onError(problem);
      return;
    }
    try {
      onParsed(await readFiles(files));
    } catch {
      onError('Could not read that file. Try again with an axe-core JSON export.');
    }
  }

  return (
    <fieldset
      className={dragOver ? 'drop drop-over' : undefined}
      onDragEnter={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragOver={(event) => {
        event.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        void ingest([...event.dataTransfer.files]);
      }}
    >
      <legend>{legend}</legend>
      <p id={hintId} className="hint">
        {description}
      </p>
      <label className="file-label">
        {id === 'current' ? 'Choose current JSON files' : 'Choose baseline JSON files'}
        <input
          type="file"
          accept="application/json,.json"
          multiple
          aria-describedby={hintId}
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            event.target.value = '';
            void ingest(files);
          }}
        />
      </label>
      <p className="hint">or drop JSON files on this box</p>
      <label htmlFor={`${id}-paste`}>
        {id === 'current' ? 'Paste current JSON' : 'Paste baseline JSON'}
      </label>
      <textarea
        id={`${id}-paste`}
        value={paste}
        spellCheck={false}
        autoCapitalize="off"
        onChange={(event) => setPaste(event.target.value)}
      />
      <div className="row-actions">
        <button
          type="button"
          onClick={() =>
            onParsed([
              {
                name: id === 'current' ? 'pasted-current.json' : 'pasted-baseline.json',
                text: paste,
              },
            ])
          }
        >
          {id === 'current' ? 'Parse pasted current JSON' : 'Parse pasted baseline JSON'}
        </button>
      </div>
    </fieldset>
  );
}

export function ImportPanel() {
  const { reportError, setCurrent, setBaseline, loadDemoData, clearScan, scan } = useScan();

  useEffect(() => {
    const prevent = (event: DragEvent) => {
      event.preventDefault();
    };
    window.addEventListener('dragover', prevent);
    window.addEventListener('drop', prevent);
    return () => {
      window.removeEventListener('dragover', prevent);
      window.removeEventListener('drop', prevent);
    };
  }, []);

  function accept(kind: 'current' | 'baseline', documents: { name: string; text: string }[]) {
    let parsed: ReturnType<typeof parseAxeDocuments>;
    try {
      parsed = parseAxeDocuments(documents);
    } catch {
      reportError('Could not read that JSON. Check that it is an axe-core result and try again.');
      return;
    }
    if (!parsed.ok) {
      reportError(parsed.error);
      return;
    }
    if (kind === 'current') {
      setCurrent(parsed.results, inferProjectName(parsed.results), parsed.synthetic);
      return;
    }
    setBaseline(parsed.results, parsed.synthetic);
  }

  return (
    <section className="panel" aria-labelledby="import-heading">
      <h2 id="import-heading">Import</h2>
      <p>
        Each file is one axe result, an array of page results, or an object with a results array.
        Files over 8 MB are refused. The optional baseline is the previous run.
      </p>
      <div className="import-grid">
        <DropFields
          id="current"
          legend="Current run"
          description="Required. The run you want to gate."
          onError={reportError}
          onParsed={(documents) => accept('current', documents)}
        />
        <DropFields
          id="baseline"
          legend="Baseline"
          description="Optional. Findings only in this run are marked fixed."
          onError={reportError}
          onParsed={(documents) => accept('baseline', documents)}
        />
      </div>
      <div className="row-actions">
        <button type="button" className="primary" onClick={loadDemoData} aria-describedby="demo-hint">
          Load demo data
        </button>
        {scan ? (
          <button type="button" onClick={clearScan}>
            Clear scan
          </button>
        ) : null}
        {scan?.baselineResults ? (
          <button type="button" onClick={() => setBaseline(null, false)}>
            Remove baseline
          </button>
        ) : null}
      </div>
      <p id="demo-hint" className="hint">
        Loads synthetic Demo Shop scans: 3 pages, a baseline run and a current run. Not a real
        audit.
      </p>
    </section>
  );
}
