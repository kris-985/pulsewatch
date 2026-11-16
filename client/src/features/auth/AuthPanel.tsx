import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Activity, ArrowLeft, Eye, EyeOff, LoaderCircle, ShieldCheck } from 'lucide-react'
import { login, register, type AuthResult } from './api'

type Mode = 'login' | 'register'

export function AuthPanel({ mode, onBack, onSwitchMode, onAuthenticated }: {
  mode: Mode
  onBack: () => void
  onSwitchMode: (mode: Mode) => void
  onAuthenticated: (result: AuthResult) => void
}) {
  const [showPassword, setShowPassword] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const mutation = useMutation({
    mutationFn: () => mode === 'register'
      ? register({ name, email, password })
      : login({ email, password }),
    onSuccess: onAuthenticated,
  })

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-background px-5 py-12 text-foreground">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_0%,rgba(16,185,129,0.12),transparent_48%)]" />
      <section className="relative w-full max-w-md">
        <button onClick={onBack} className="mb-8 inline-flex items-center gap-2 text-sm text-zinc-400 transition hover:text-white">
          <ArrowLeft size={15} /> Back to PulseWatch
        </button>
        <div className="rounded-2xl border border-white/10 bg-zinc-900/80 p-7 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-9">
          <div className="mb-8 flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><Activity size={20} /></span>
            <span className="text-base font-semibold tracking-tight">pulsewatch<span className="text-emerald-400">.</span></span>
          </div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-emerald-300">{mode === 'register' ? 'Create your account' : 'Welcome back'}</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">{mode === 'register' ? 'Start monitoring.' : 'Sign in to PulseWatch.'}</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-400">{mode === 'register' ? 'Your personal workspace is created automatically.' : 'Your services are right where you left them.'}</p>

          <form className="mt-8 space-y-5" onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}>
            {mode === 'register' && (
              <label className="block space-y-2 text-sm text-zinc-300">
                Name
                <input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/20 px-3.5 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10" placeholder="Alex Morgan" />
              </label>
            )}
            <label className="block space-y-2 text-sm text-zinc-300">
              Email
              <input autoComplete="email" type="email" required maxLength={254} value={email} onChange={(event) => setEmail(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/20 px-3.5 py-3 text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10" placeholder="you@example.com" />
            </label>
            <label className="block space-y-2 text-sm text-zinc-300">
              Password
              <span className="relative block">
                <input autoComplete={mode === 'register' ? 'new-password' : 'current-password'} type={showPassword ? 'text' : 'password'} required minLength={mode === 'register' ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} className="w-full rounded-lg border border-white/10 bg-black/20 px-3.5 py-3 pr-11 text-white outline-none transition placeholder:text-zinc-600 focus:border-emerald-400/60 focus:ring-2 focus:ring-emerald-400/10" placeholder={mode === 'register' ? '12–72 UTF-8 bytes' : 'Your password'} />
                <button type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)} className="absolute inset-y-0 right-3 grid place-items-center text-zinc-500 hover:text-zinc-200">{showPassword ? <EyeOff size={16} /> : <Eye size={16} />}</button>
              </span>
            </label>

            {mutation.isError && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/[0.07] px-3.5 py-3 text-sm text-rose-300">{mutation.error.message}</p>}

            <button disabled={mutation.isPending} className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-400 px-5 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-emerald-300 disabled:cursor-wait disabled:opacity-70">
              {mutation.isPending ? <LoaderCircle className="animate-spin" size={16} /> : null}
              {mode === 'register' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-center gap-2 border-t border-white/[0.08] pt-5 text-xs text-zinc-500"><ShieldCheck size={14} className="text-emerald-400" /> Your session is protected with secure tokens.</div>
          <p className="mt-5 text-center text-sm text-zinc-500">
            {mode === 'register' ? 'Already have an account?' : 'New to PulseWatch?'}{' '}
            <button type="button" onClick={() => onSwitchMode(mode === 'register' ? 'login' : 'register')} className="font-medium text-emerald-300 hover:text-emerald-200">{mode === 'register' ? 'Sign in' : 'Create an account'}</button>
          </p>
        </div>
      </section>
    </main>
  )
}
