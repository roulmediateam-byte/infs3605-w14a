// Reads a CSV file off the main thread (TRD, Web app: Papa Parse in a Web Worker), so a 2,000-row preview stays
// smooth on a phone. It only splits the file into cells; the import rules run on the main thread and on the server.
import Papa from 'papaparse';

export interface CsvRequest {
  file: File;
}

export type CsvResponse = { ok: true; rows: string[][] } | { ok: false; message: string };

interface WorkerScope {
  onmessage: ((event: MessageEvent<CsvRequest>) => void) | null;
  postMessage: (message: CsvResponse) => void;
}

const scope = self as unknown as WorkerScope;

scope.onmessage = (event) => {
  Papa.parse<string[]>(event.data.file, {
    skipEmptyLines: false,
    complete: (results) => scope.postMessage({ ok: true, rows: results.data }),
    error: (error) => scope.postMessage({ ok: false, message: error.message }),
  });
};
