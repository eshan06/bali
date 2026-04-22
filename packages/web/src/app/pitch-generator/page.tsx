'use client';

import { useState } from 'react';

const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming',
];

export default function PitchGeneratorPage() {
  const [districtName, setDistrictName] = useState('');
  const [state, setState] = useState('');
  const [pitch, setPitch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    setPitch('');
    setCopied(false);

    try {
      const res = await fetch('/api/generate-pitch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ districtName, state }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || 'Something went wrong.');
      } else {
        setPitch(data.pitch);
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(pitch);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="border-b border-gray-100 px-8 py-4 flex items-center justify-between">
        <a href="/" className="text-xl font-bold text-[#2E5BD0]">bali</a>
        <a href="/pitch-generator" className="text-sm text-gray-500 hover:text-gray-700 transition-colors">Find Your School</a>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-16">
        <div className="mb-10">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">District Pitch Generator</h1>
          <p className="text-gray-500">Enter a school district and we'll generate a personalized sales pitch using live research.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 mb-10">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              District Name
            </label>
            <input
              type="text"
              value={districtName}
              onChange={(e) => setDistrictName(e.target.value)}
              placeholder="e.g. Los Angeles Unified School District"
              required
              className="w-full px-4 py-3 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2E5BD0] focus:border-transparent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              State
            </label>
            <select
              value={state}
              onChange={(e) => setState(e.target.value)}
              required
              className="w-full px-4 py-3 border border-gray-200 rounded-lg text-gray-900 focus:outline-none focus:ring-2 focus:ring-[#2E5BD0] focus:border-transparent bg-white"
            >
              <option value="" disabled>Select a state</option>
              {US_STATES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 px-6 bg-[#2E5BD0] text-white font-semibold rounded-lg hover:bg-[#2550b8] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {loading ? 'Generating pitch...' : 'Generate Pitch'}
          </button>
        </form>

        {loading && (
          <div className="flex items-center gap-3 text-gray-500 text-sm">
            <div className="w-4 h-4 border-2 border-[#2E5BD0] border-t-transparent rounded-full animate-spin" />
            Researching district and crafting pitch — this may take 15–30 seconds.
          </div>
        )}

        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {pitch && (
          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-gray-50">
              <span className="text-sm font-medium text-gray-600">Generated Pitch</span>
              <button
                onClick={handleCopy}
                className="text-sm px-4 py-1.5 rounded-md border border-gray-200 bg-white hover:bg-gray-50 text-gray-700 transition-colors font-medium"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="px-6 py-5">
              {pitch.split('\n').filter(Boolean).map((para, i) => {
                const looksLikeHeader = /^(📊|⚠️|💸|✅|🚀)/.test(para);
                if (looksLikeHeader) {
                  return (
                    <p key={i} className="font-bold text-gray-900 text-base mt-6 mb-2 first:mt-0">
                      {para}
                    </p>
                  );
                }
                return (
                  <p key={i} className="text-gray-700 leading-relaxed mb-1.5">
                    {para}
                  </p>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
