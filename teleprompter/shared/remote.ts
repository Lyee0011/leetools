export type RemoteAction = 'back' | 'pause' | 'resume';
export type RemoteRoom = { code: string; token: string; expiresAt: number };
export type RemoteCommand = { id: string; action: RemoteAction; createdAt: number };
export type RemoteState = {
  seenAt: number;
  running: boolean;
  progress: number;
  appliedId: string;
  connected: boolean;
};
export type RemotePollResult = { command: RemoteCommand | null; serverNow: number; waitSupported?: boolean };
export type RemoteCommandResult = { id: string; state?: RemoteState };
export const REMOTE_COMMAND_LIFETIME = 4000;
