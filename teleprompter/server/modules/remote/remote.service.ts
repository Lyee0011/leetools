import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, ServiceUnavailableException, ConflictException } from '@nestjs/common';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { REMOTE_COMMAND_LIFETIME, type RemoteAction, type RemoteCommand, type RemoteState, type RemotePollResult, type RemoteCommandResult } from '../../../shared/remote';

const ROOM_LIFE = 4 * 60 * 60 * 1000;
// The platform rejects TTLs below 30 seconds and its SDK fails open. Physical
// retention is separate from the 3s heartbeat / 4s command validity checks.
const TRANSIENT_CACHE_TTL = 60000;
type Room = { hostHash: string; controllerToken: string; expiresAt: number };
type HostState = RemoteState & { generation: string; acceptAfter: number };
const digest = (token: string) => createHash('sha256').update(token).digest('hex');
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

@Injectable()
export class RemoteService {
  constructor(@Inject(CACHE_MANAGER) private readonly cache: Cache) {}
  private key(code: string, part: string) { return `teleprompter-remote-v1:${digest(code)}:${part}`; }
  private code(input: unknown) {
    if (typeof input !== 'string' || !/^(?:\d{2}|[A-HJ-NP-Z2-9]{8})$/.test(input)) throw new BadRequestException('请输入 2 位数字配对码');
    return input;
  }
  private token(input: unknown) {
    if (typeof input !== 'string' || !/^[a-f0-9]{64}$/.test(input)) throw new ForbiddenException('配对已失效，请重新连接');
    return input;
  }
  private async room(code: string) {
    const room = await this.cache.get<Room>(this.key(this.code(code), 'room'));
    if (!room || room.expiresAt <= Date.now()) throw new NotFoundException('配对码已失效，请在提词手机重新开启遥控');
    return room;
  }
  private async authorize(code: string, token: unknown, host: boolean) {
    const room = await this.room(code);
    const value = this.token(token);
    if (!equal(host ? room.hostHash : room.controllerToken, host ? digest(value) : value)) throw new ForbiddenException('配对已失效，请重新连接');
    return room;
  }
  async create() {
    // Platform cache is shared between server instances. Never use a process-local
    // room map: the two phones may hit different instances.
    const start = randomInt(100);
    let code = '';
    for (let offset = 0; offset < 100; offset++) {
      const candidate = String((start + offset) % 100).padStart(2, '0');
      const existing = await this.cache.get<Room>(this.key(candidate, 'room'));
      if (!existing || existing.expiresAt <= Date.now()) { code = candidate; break; }
    }
    if (!code) throw new ServiceUnavailableException('配对码暂时用满了，请稍后再试');
    const token = randomBytes(32).toString('hex');
    const room: Room = { hostHash: digest(token), controllerToken: randomBytes(32).toString('hex'), expiresAt: Date.now() + ROOM_LIFE };
    await this.cache.set(this.key(code, 'room'), room, ROOM_LIFE);
    const check = await this.cache.get<Room>(this.key(code, 'room'));
    if (check?.hostHash !== room.hostHash) throw new ServiceUnavailableException('遥控连接暂不可用，请稍后重试');
    return { code, token, expiresAt: room.expiresAt };
  }
  async join(code: string) {
    const room = await this.room(code);
    return { code, token: room.controllerToken, expiresAt: room.expiresAt };
  }
  async poll(code: string, body: { token?: unknown; running?: unknown; progress?: unknown; appliedId?: unknown; generation?: unknown; wait?: unknown }): Promise<RemotePollResult> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('无效的提词状态');
    const room = await this.authorize(code, body.token, true);
    const session = room.hostHash;
    if (typeof body.running !== 'boolean' || typeof body.progress !== 'number' || !Number.isFinite(body.progress) || typeof body.appliedId !== 'string' || body.appliedId.length > 80 || typeof body.generation !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.generation) || (body.wait !== undefined && typeof body.wait !== 'boolean')) throw new BadRequestException('无效的提词状态');
    const previous = await this.cache.get<HostState>(this.key(session, 'state'));
    const now = Date.now();
    const state: HostState = { seenAt: now, running: body.running, progress: Math.max(0, Math.min(100, body.progress)), appliedId: body.appliedId, connected: true, generation: body.generation, acceptAfter: previous?.generation === body.generation ? previous.acceptAfter : now };
    await this.cache.set(this.key(session, 'state'), state, TRANSIENT_CACHE_TTL);
    const written = await this.cache.get<HostState>(this.key(session, 'state'));
    if (!written || written.seenAt < state.seenAt || written.generation !== state.generation) throw new ServiceUnavailableException('提词状态未能同步，请稍后重试');
    // Keep an authenticated request ready for an arriving press. Use shared
    // cache reads so different server instances work; no local event bus needed.
    const deadline = performance.now() + (body.wait ? 1000 : 0);
    do {
      const command = await this.cache.get<RemoteCommand>(this.key(session, 'command'));
      if (command && command.createdAt >= state.acceptAfter && Date.now() - command.createdAt < REMOTE_COMMAND_LIFETIME && command.id !== body.appliedId) return { serverNow: Date.now(), command, waitSupported: true };
      if (performance.now() >= deadline) break;
      await delay(50);
    } while (performance.now() < deadline);
    return { serverNow: Date.now(), command: null, waitSupported: true };
  }
  private publicState(state?: RemoteState): RemoteState {
    return state ? { seenAt: state.seenAt, running: state.running, progress: state.progress, appliedId: state.appliedId, connected: Date.now() - state.seenAt < 3000 } : { seenAt: 0, running: false, progress: 0, appliedId: '', connected: false };
  }
  async state(code: string, token: unknown): Promise<RemoteState> {
    const room = await this.authorize(code, token, false);
    const state = await this.cache.get<RemoteState>(this.key(room.hostHash, 'state'));
    return this.publicState(state);
  }
  async command(code: string, body: { token?: unknown; id?: unknown; action?: unknown; waitForAck?: unknown }): Promise<RemoteCommandResult> {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('无效的遥控指令');
    const room = await this.authorize(code, body.token, false);
    const session = room.hostHash;
    if (typeof body.id !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(body.id) || typeof body.action !== 'string' || !['back', 'pause', 'resume'].includes(body.action) || (body.waitForAck !== undefined && typeof body.waitForAck !== 'boolean')) throw new BadRequestException('无效的遥控指令');
    const state = this.publicState(await this.cache.get<RemoteState>(this.key(session, 'state')));
    if (!state.connected) throw new ConflictException('提词手机未连接，请保持提词页面在前台');
    if (state.appliedId === body.id) return { id: body.id, state };
    const pending = await this.cache.get<RemoteCommand>(this.key(session, 'command'));
    if (pending && pending.id !== body.id && pending.id !== state.appliedId && Date.now() - pending.createdAt < REMOTE_COMMAND_LIFETIME) throw new ConflictException('上一操作尚未确认，请稍候');
    // Repeated delivery of an HTTP request keeps its original expiry.
    const command: RemoteCommand = pending?.id === body.id ? pending : { id: body.id, action: body.action as RemoteAction, createdAt: Date.now() };
    await this.cache.set(this.key(session, 'command'), command, TRANSIENT_CACHE_TTL);
    const written = await this.cache.get<RemoteCommand>(this.key(session, 'command'));
    if (written?.id !== command.id) throw new ServiceUnavailableException('按键未能发送，请稍后重试');
    if (body.waitForAck) {
      // Return the real host ACK on this request; never optimistically claim a
      // press succeeded. The existing state endpoint remains the timeout fallback.
      const deadline = performance.now() + 1400;
      do {
        const next = await this.cache.get<RemoteState>(this.key(session, 'state'));
        if (next?.appliedId === command.id) return { id: body.id, state: this.publicState(next) };
        await delay(50);
      } while (performance.now() < deadline);
    }
    return { id: body.id };
  }
  async close(code: string, token: unknown) {
    const room = await this.authorize(code, token, true);
    await this.cache.del(this.key(code, 'room'));
    await this.cache.del(this.key(room.hostHash, 'state'));
    await this.cache.del(this.key(room.hostHash, 'command'));
    return { closed: true };
  }
}
