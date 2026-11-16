import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, ArrowUpRight, LogOut, ShieldCheck } from 'lucide-react'
import { getMe, logout, type AuthIdentity, type WorkspaceSummary } from './api'

export function WorkspaceHome({ user, workspace, onLogout }: {
  user: AuthIdentity
  workspace: WorkspaceSummary | null
  onLogout: () => void
}) {
  const queryClient = useQueryClient()
  const meQuery = useQuery({ queryKey: ['auth', 'me'], queryFn: getMe })
  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: async () => {
      await queryClient.clear()
      onLogout()
    },
  })
  const currentUser = meQuery.data?.user ?? user
  const currentWorkspace = meQuery.data?.workspace ?? workspace

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex h-20 max-w-6xl items-center justify-between border-b border-white/[0.08] px-6">
        <div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-xl border border-emerald-400/20 bg-emerald-400/10 text-emerald-300"><Activity size={19} /></span><span className="font-semibold">pulsewatch<span className="text-emerald-400">.</span></span></div>
        <button onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-sm text-zinc-400 transition hover:border-white/20 hover:text-white disabled:opacity-60"><LogOut size={15} /> Sign out</button>
      </header>
      <section className="mx-auto max-w-6xl px-6 py-14">
        <div className="text-sm text-emerald-300">Your workspace</div>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight">Welcome, {currentUser.name}.</h1>
        <p className="mt-3 text-zinc-400">Your PulseWatch account is ready. Monitor management will be available in the next product stage.</p>
        {meQuery.isError && <p role="alert" className="mt-5 text-sm text-rose-300">Could not refresh your profile. Your current session is still available.</p>}
        <div className="mt-9 grid gap-4 sm:grid-cols-2">
          <article className="rounded-xl border border-white/10 bg-zinc-900/70 p-5">
            <div className="flex items-center justify-between"><span className="text-sm text-zinc-400">Workspace</span><ArrowUpRight size={16} className="text-zinc-600" /></div>
            <h2 className="mt-4 text-xl font-medium">{currentWorkspace?.name ?? 'Personal workspace'}</h2>
            <p className="mt-1 text-sm text-zinc-500">{currentUser.email}</p>
          </article>
          <article className="rounded-xl border border-white/10 bg-zinc-900/70 p-5">
            <div className="flex items-center justify-between"><span className="text-sm text-zinc-400">Plan</span><ShieldCheck size={16} className="text-emerald-400" /></div>
            <h2 className="mt-4 text-xl font-medium">{currentWorkspace?.planCode ?? 'free'}</h2>
            <p className="mt-1 text-sm text-zinc-500">Personal workspace · ready to configure</p>
          </article>
        </div>
      </section>
    </main>
  )
}
