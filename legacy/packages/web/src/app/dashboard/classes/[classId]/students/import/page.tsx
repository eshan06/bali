'use client';

import { useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api-client';
import { CsvImportResult } from '@bali/shared';

const BRAND = '#2E5BD0';

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
      setCsvContent((ev.target?.result as string) || '');
    };
    reader.readAsText(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvContent) {
      setError('Please select a CSV file');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.post<CsvImportResult>(
        `/classes/${classId}/students/import`,
        { csv: csvContent }
      );
      setResult(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <header className="space-y-2">
        <p
          className="text-[11px] font-black uppercase tracking-[0.22em]"
          style={{ color: BRAND }}
        >
          Roster
        </p>
        <h1 className="text-3xl md:text-5xl font-black tracking-tight text-gray-900 leading-[1.05]">
          Import students
        </h1>
        <p className="text-sm md:text-base text-gray-500 max-w-xl">
          Upload a CSV to add students in bulk.
        </p>
      </header>

      {/* Format hint */}
      <div
        className="rounded-2xl border p-5 space-y-2"
        style={{
          backgroundColor: 'rgba(46, 91, 208, 0.05)',
          borderColor: 'rgba(46, 91, 208, 0.20)',
        }}
      >
        <p className="text-sm font-bold" style={{ color: BRAND }}>
          CSV format
        </p>
        <p className="text-sm text-gray-700">
          Headers should be{' '}
          <code className="rounded bg-white border border-gray-100 px-1.5 py-0.5 text-xs font-mono">
            first_name
          </code>
          ,{' '}
          <code className="rounded bg-white border border-gray-100 px-1.5 py-0.5 text-xs font-mono">
            last_name
          </code>
          , and{' '}
          <code className="rounded bg-white border border-gray-100 px-1.5 py-0.5 text-xs font-mono">
            email
          </code>
          .
        </p>
        <p className="text-sm text-gray-700">
          A single{' '}
          <code className="rounded bg-white border border-gray-100 px-1.5 py-0.5 text-xs font-mono">
            name
          </code>{' '}
          column also works — it splits on the first space.
        </p>
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="surface-card rounded-2xl p-7 space-y-5">
        {result ? (
          <>
            <div className="rounded-xl bg-green-50 border border-green-100 p-5">
              <p className="font-bold text-green-800">
                Imported {result.imported}{' '}
                {result.imported === 1 ? 'student' : 'students'}
              </p>
            </div>
            {result.errors.length > 0 && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-5 space-y-2">
                <p className="font-bold text-amber-800">
                  {result.errors.length}{' '}
                  {result.errors.length === 1 ? 'row' : 'rows'} skipped
                </p>
                <ul className="text-sm text-amber-700 space-y-1">
                  {result.errors.map((e, i) => (
                    <li key={i}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={() =>
                  router.push(`/dashboard/classes/${classId}/`)
                }
                className="inline-flex items-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 shadow-sm"
                style={{ backgroundColor: BRAND }}
              >
                Back to class
              </button>
            </div>
          </>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-5">
            <div
              onClick={() => fileRef.current?.click()}
              className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/60 px-8 py-10 text-center cursor-pointer hover:border-brand/40 hover:bg-brand/[0.02] transition-colors"
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                className="hidden"
              />
              <svg
                className="mx-auto h-8 w-8 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.6}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M7 16a4 4 0 01-.88-7.9 5 5 0 019.9-1.86A4.5 4.5 0 0117 16h-1m-4-4v8m0-8l-3 3m3-3l3 3"
                />
              </svg>
              <p className="mt-3 text-sm font-bold text-gray-900">
                {fileName || 'Click to choose a CSV file'}
              </p>
              {!fileName && (
                <p className="mt-1 text-xs text-gray-500">
                  Or drag and drop a .csv export from your gradebook.
                </p>
              )}
            </div>

            {csvContent && (
              <div className="rounded-xl bg-gray-50 border border-gray-100 p-4 max-h-40 overflow-auto">
                <pre className="text-xs text-gray-600 whitespace-pre-wrap font-mono">
                  {csvContent.slice(0, 500)}
                </pre>
              </div>
            )}

            <div className="flex gap-2 pt-2 border-t border-gray-100">
              <button
                type="submit"
                disabled={loading || !csvContent}
                className="inline-flex items-center rounded-full px-6 py-2.5 text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 shadow-sm"
                style={{ backgroundColor: BRAND }}
              >
                {loading ? 'Importing…' : 'Import students'}
              </button>
              <Link
                href={`/dashboard/classes/${classId}/`}
                className="inline-flex items-center rounded-full border border-gray-200 bg-white px-6 py-2.5 text-sm font-bold text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
