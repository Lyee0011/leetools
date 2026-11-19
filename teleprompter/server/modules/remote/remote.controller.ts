import { Body, Controller, Header, Param, Post, HttpException, ServiceUnavailableException } from '@nestjs/common';
import { RemoteService } from './remote.service';

@Controller('api/remote')
export class RemoteController {
  constructor(private readonly remote: RemoteService) {}
  private async run<T>(operation: () => Promise<T>): Promise<T> {
    try { return await operation(); }
    catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException('遥控连接暂不可用，请稍后重试');
    }
  }
  @Post('create') @Header('Cache-Control', 'no-store')
  create() { return this.run(() => this.remote.create()); }
  @Post(':code/join') @Header('Cache-Control', 'no-store')
  join(@Param('code') code: string) { return this.run(() => this.remote.join(code)); }
  @Post(':code/poll') @Header('Cache-Control', 'no-store')
  poll(@Param('code') code: string, @Body() body: { token?: unknown; running?: unknown; progress?: unknown; appliedId?: unknown; generation?: unknown; wait?: unknown }) { return this.run(() => this.remote.poll(code, body)); }
  @Post(':code/state') @Header('Cache-Control', 'no-store')
  state(@Param('code') code: string, @Body('token') token: unknown) { return this.run(() => this.remote.state(code, token)); }
  @Post(':code/command') @Header('Cache-Control', 'no-store')
  command(@Param('code') code: string, @Body() body: { token?: unknown; id?: unknown; action?: unknown; waitForAck?: unknown }) { return this.run(() => this.remote.command(code, body)); }
  @Post(':code/close') @Header('Cache-Control', 'no-store')
  close(@Param('code') code: string, @Body('token') token: unknown) { return this.run(() => this.remote.close(code, token)); }
}
