'use client';

import UserSection from '../components/UserSection';
import TopicSection from '../components/TopicSection';

export default function Home() {
  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-900 font-sans selection:bg-indigo-100 selection:text-indigo-900">
      {/* Premium Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-tr from-indigo-600 to-violet-600 rounded-lg flex items-center justify-center shadow-lg shadow-indigo-200">
              <span className="text-white font-bold text-lg">F</span>
            </div>
            <h1 className="text-xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-slate-900 to-slate-600">
              Forja <span className="text-indigo-600">Next.js</span> Example
            </h1>
          </div>
          <div className="flex items-center gap-4 text-sm font-medium text-slate-500">
            <span className="flex items-center gap-1.5 px-3 py-1 bg-slate-100 rounded-full">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
              Live Example
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-12 animate-in fade-in slide-in-from-bottom-4 duration-1000">
        {/* Intro */}
        <section className="text-center space-y-4 mb-16">
          <h2 className="text-4xl md:text-5xl font-black text-slate-900 tracking-tight">
            The Power of <span className="italic text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-violet-600">Relations</span>
          </h2>
          <p className="text-lg text-slate-500 max-w-2xl mx-auto">
            This demo showcases Forja's advanced features: nested relationships, recursive population,
            smart sorting, and real-time fake data generation.
          </p>
        </section>

        {/* User Management Section */}
        <div className="relative group">
          <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-500 rounded-2xl blur opacity-10 group-hover:opacity-20 transition duration-1000 group-hover:duration-200"></div>
          <UserSection />
        </div>

        {/* Content Section */}
        <div className="grid grid-cols-1 gap-12">
          <div className="relative">
            <div className="absolute -left-4 top-0 bottom-0 w-px bg-slate-200 hidden md:block"></div>
            <TopicSection />
          </div>
        </div>

        {/* Footer */}
        <footer className="pt-12 border-t border-slate-200 text-center text-slate-400 text-sm">
          <p>Built with Forja + Next.js + Tailwind CSS</p>
        </footer>
      </main>

      <style jsx global>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-in {
          animation: fadeIn 0.8s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
