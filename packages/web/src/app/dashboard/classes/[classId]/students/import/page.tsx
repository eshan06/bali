'use client';

import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';
import { CsvImportResult } from '@bali/shared';

export default function ImportStudentsPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [csvContent, setCsvContent] = useState('');
  const [fileName, setFileName] = useState('');
  const [result, setResult] = useState<CsvImportResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      setCsvContent(ev.target?.result as string || '');
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvContent) { setError('Please select a CSV file'); return; }
    setError('');
    setLoading(true);
    try {
      const res = await api.post<CsvImportResult>(`/classes/${classId}/students/import`, { csv: csvContent });
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-lg">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Import Students</h1>

      <div className="glass-card rounded-2xl p-6 space-y-4">
        <div className="rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
          <p className="font-medium mb-1">CSV Format</p>
          <p>Your CSV should have headers: <code className="bg-blue-100 px-1 rounded">first_name</code>, <code className="bg-blue-100 px-1 rounded">last_name</code>, <code className="bg-blue-100 px-1 rounded">email</code></p>
          <p className="mt-1">Or a single <code className="bg-blue-100 px-1 rounded">name</code> column (will split on first space).</p>
        </div>

        {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-600">{error}</div>}

        {result ? (
          <div className="space-y-3">
            <div className="rounded-lg bg-green-50 p-4">
              <p className="font-medium text-green-800">Imported {result.imported} student(s)</p>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-lg bg-yellow-50 p-4">
                <p className="font-medium text-yellow-800 mb-2">{result.errors.length} error(s):</p>
                {result.errors.map((e, i) => (
                  <p key={i} className="text-sm text-yellow-700">Row {e.row}: {e.message}</p>
                ))}
              </div>
            )}
            <button
              onClick={() => router.push(`/dashboard/classes/${classId}/`)}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
            >
              Back to Class
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div
              onClick={() => fileRef.current?.click()}
              className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-primary-400 transition-colors"
            >
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFileChange} className="hidden" />
              {fileName ? (
                <p className="text-sm text-gray-700">{fileName}</p>
              ) : (
                <p className="text-sm text-gray-500">Click to select a CSV file or drag and drop</p>
              )}
            </div>

            {csvContent && (
              <div className="rounded-lg bg-gray-50 p-3 max-h-40 overflow-auto">
                <pre className="text-xs text-gray-600 whitespace-pre-wrap">{csvContent.slice(0, 500)}</pre>
              </div>
            )}

            <div className="flex gap-3">
              <button type="submit" disabled={loading || !csvContent}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50 transition-colors">
                {loading ? 'Importing...' : 'Import Students'}
              </button>
              <button type="button" onClick={() => router.back()}
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
