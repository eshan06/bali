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

const ROLES = [
  'Superintendent',
  'Principal',
  'Assistant Principal',
  'District Administrator',
  'Other',
];

interface FormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  district: string;
  state: string;
  role: string;
  message: string;
}

const empty: FormData = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  district: '',
  state: '',
  role: '',
  message: '',
};

export default function RequestDemoPage() {
  const [form, setForm] = useState<FormData>(empty);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function set(field: keyof FormData) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('https://formspree.io/f/mjgjpyaq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setSubmitted(true);
      } else {
        setError('Something went wrong, please try again.');
      }
    } catch {
      setError('Something went wrong, please try again.');
    } finally {
      setLoading(false);
    }
  }

  const inputClass =
    'w-full px-4 py-3 border border-gray-200 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#2E5BD0] focus:border-transparent text-sm';

  const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5';

  return (
    <div className="min-h-screen bg-white">
      {/* Navbar */}
      <nav className="border-b border-gray-100 px-8 py-5">
        <a href="/" className="text-2xl font-black text-black tracking-tight">
          bali
        </a>
      </nav>

      <div className="max-w-2xl mx-auto px-6 py-16">
        {submitted ? (
          <div className="text-center py-24">
            <div
              className="mx-auto mb-6 flex items-center justify-center rounded-full"
              style={{ width: 64, height: 64, backgroundColor: '#2E5BD0' }}
            >
              <svg className="w-7 h-7 text-white" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h2 className="text-3xl font-bold text-gray-900 mb-3">Thank you!</h2>
            <p className="text-gray-500 text-lg">We'll be in touch within 24 hours.</p>
            <a
              href="/"
              className="inline-block mt-10 text-sm font-medium text-[#2E5BD0] hover:underline"
            >
              ← Back to homepage
            </a>
          </div>
        ) : (
          <>
            <div className="mb-10">
              <h1 className="text-4xl font-bold text-gray-900 mb-3">Request a Demo</h1>
              <p className="text-gray-500 text-base leading-relaxed">
                We'll reach out within 24 hours to schedule a walkthrough for your district.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Name row */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>First Name</label>
                  <input
                    type="text"
                    value={form.firstName}
                    onChange={set('firstName')}
                    placeholder="Jane"
                    required
                    className={inputClass}
                  />
                </div>
                <div>
                  <label className={labelClass}>Last Name</label>
                  <input
                    type="text"
                    value={form.lastName}
                    onChange={set('lastName')}
                    placeholder="Smith"
                    required
                    className={inputClass}
                  />
                </div>
              </div>

              <div>
                <label className={labelClass}>Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  placeholder="jane@district.edu"
                  required
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>Phone Number</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={set('phone')}
                  placeholder="(555) 000-0000"
                  className={inputClass}
                />
              </div>

              <div>
                <label className={labelClass}>School District Name</label>
                <input
                  type="text"
                  value={form.district}
                  onChange={set('district')}
                  placeholder="e.g. Los Angeles Unified School District"
                  required
                  className={inputClass}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelClass}>State</label>
                  <select
                    value={form.state}
                    onChange={set('state')}
                    required
                    className={inputClass + ' bg-white'}
                  >
                    <option value="" disabled>Select a state</option>
                    {US_STATES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Role</label>
                  <select
                    value={form.role}
                    onChange={set('role')}
                    required
                    className={inputClass + ' bg-white'}
                  >
                    <option value="" disabled>Select your role</option>
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className={labelClass}>
                  Message <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  value={form.message}
                  onChange={set('message')}
                  placeholder="Any specific questions or context?"
                  rows={4}
                  className={inputClass + ' resize-none'}
                />
              </div>

              {error && (
                <p className="text-sm text-red-600">{error}</p>
              )}

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3.5 px-6 bg-[#2E5BD0] text-white font-bold rounded-lg hover:bg-[#2550b8] transition-colors text-sm disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {loading ? 'Submitting…' : 'Request a Demo'}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
