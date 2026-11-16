import { Activity, ArrowUpRight, Check, ChevronRight, Globe2, ShieldCheck, Zap } from 'lucide-react'
import { API_BASE_URL } from '../lib/config'

const signals = [
  { label: 'API latency', value: '84 ms', change: '−12 ms', width: '76%' },
  { label: 'Availability', value: '99.98%', change: 'Last 30 days', width: '94%' },
]

export default function App() {
  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(16,185,129,0.12),transparent_48%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col px-6 sm:px-10">
        <header className="flex h-20 items-center justify-between border-b border-white/[0.08]">
          <a className="flex items-center gap-3" href="#home" aria-label="PulseWatch home">
            <span className="grid size-9 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><Activity size={19} /></span>
            <span className="text-[15px] font-semibold tracking-tight">pulsewatch<span className="text-emerald-400">.</span></span>
          </a>
          <span className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.035] px-3 py-1.5 text-xs text-zinc-400 sm:flex">
            <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#34d399]" /> Monitoring foundation
          </span>
        </header>

        <section id="home" className="grid flex-1 items-center gap-16 py-20 lg:grid-cols-[1.05fr_0.95fr] lg:py-24">
          <div className="max-w-2xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/[0.07] px-3 py-1.5 text-xs font-medium text-emerald-300">
              <Zap size={13} /> Clarity when every second counts
            </div>
            <h1 className="text-5xl font-semibold leading-[1.08] tracking-[-0.055em] sm:text-6xl lg:text-[4.5rem]">
              Know before<br />
              <span className="bg-gradient-to-r from-emerald-300 via-teal-200 to-cyan-300 bg-clip-text text-transparent">they do.</span>
            </h1>
            <p className="mt-7 max-w-lg text-base leading-7 text-zinc-400 sm:text-lg sm:leading-8">
              A calm, clear view of your websites. PulseWatch keeps an eye on availability and response times, so you can focus on what comes next.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-4">
              <a href={`${API_BASE_URL}/health`} className="group inline-flex items-center gap-2 rounded-lg bg-emerald-400 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300">
                Check API status <ArrowUpRight size={16} className="transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
              <span className="text-sm text-zinc-500">Foundation is online</span>
            </div>
            <div className="mt-12 flex flex-wrap gap-x-7 gap-y-3 border-t border-white/[0.08] pt-6 text-xs text-zinc-500">
              <span className="inline-flex items-center gap-2"><ShieldCheck size={14} className="text-emerald-400" /> Secure by design</span>
              <span className="inline-flex items-center gap-2"><Globe2 size={14} className="text-emerald-400" /> HTTP & HTTPS ready</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[500px] lg:ml-auto">
            <div className="absolute -inset-8 rounded-[2rem] bg-emerald-400/[0.06] blur-3xl" />
            <div className="relative rounded-2xl border border-white/[0.1] bg-zinc-900/80 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-6">
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-xs text-zinc-500">YOUR SERVICE OVERVIEW</div>
                  <div className="mt-2 text-xl font-medium tracking-tight">Everything looks good</div>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/[0.08] px-2.5 py-1 text-[11px] text-emerald-300"><Check size={12} /> Operational</span>
              </div>

              <div className="mt-7 rounded-xl border border-white/[0.07] bg-black/20 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm text-zinc-300">Response time</span>
                  <span className="text-xs text-zinc-500">Last 24 hours <ChevronRight size={13} className="ml-1 inline" /></span>
                </div>
                <div className="flex h-28 items-end gap-1.5" aria-label="Response time chart preview">
                  {[34, 43, 39, 51, 46, 36, 55, 48, 62, 45, 41, 58, 52, 67, 48, 56, 43, 61, 53, 71, 58, 46, 63, 54, 76, 61, 48, 66, 57, 70, 52, 62, 46, 73, 57, 67, 49, 62].map((height, index) => (
                    <span key={index} className="flex-1 rounded-t-sm bg-gradient-to-t from-emerald-500/25 to-emerald-300/80" style={{ height: `${height}%`, opacity: 0.58 + (index % 4) * 0.1 }} />
                  ))}
                </div>
                <div className="mt-3 flex justify-between text-[10px] text-zinc-600"><span>12:00 AM</span><span>6:00 AM</span><span>12:00 PM</span><span>6:00 PM</span><span>Now</span></div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                {signals.map((signal) => (
                  <div key={signal.label} className="rounded-xl border border-white/[0.07] bg-black/20 p-4">
                    <div className="text-xs text-zinc-500">{signal.label}</div>
                    <div className="mt-2 flex items-end justify-between gap-2">
                      <span className="text-xl font-medium tracking-tight">{signal.value}</span>
                      <span className="text-[10px] text-emerald-400">{signal.change}</span>
                    </div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]"><div className="h-full rounded-full bg-emerald-400/80" style={{ width: signal.width }} /></div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.07] bg-black/20 p-3.5">
                <span className="grid size-9 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300"><Globe2 size={16} /></span>
                <div className="min-w-0 flex-1"><div className="truncate text-xs font-medium text-zinc-200">your-website.com</div><div className="mt-1 text-[10px] text-zinc-500">Checked just now · 200 OK</div></div>
                <span className="size-2 rounded-full bg-emerald-400" />
              </div>
            </div>
            <div className="absolute -bottom-5 -left-5 hidden items-center gap-2 rounded-xl border border-white/10 bg-zinc-900 px-3.5 py-3 shadow-xl sm:flex">
              <span className="grid size-7 place-items-center rounded-lg bg-emerald-400/10 text-emerald-300"><Check size={14} /></span>
              <span className="text-xs text-zinc-300">All systems operational</span>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-white/[0.08] py-5 text-[11px] text-zinc-600 sm:flex-row sm:items-center sm:justify-between">
          <span>PulseWatch · Website monitoring, with clarity.</span>
          <span>Foundation release</span>
        </footer>
      </div>
    </main>
  )
}
