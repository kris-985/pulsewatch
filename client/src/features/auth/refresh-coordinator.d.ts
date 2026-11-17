export interface RefreshCoordinatorOptions {
  locks?: { request<T>(name: string, options: { mode: 'exclusive' }, callback: () => Promise<T>): Promise<T> } | null
  createChannel?: ((name: string) => BroadcastChannel) | null
  storage?: Storage | null
  now?: () => number
  wait?: (milliseconds: number) => Promise<void>
  idFactory?: () => string
}

export function createRefreshCoordinator(
  options?: RefreshCoordinatorOptions,
): (operation: () => Promise<string | null>) => Promise<string | null>
