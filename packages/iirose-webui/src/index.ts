import { Context, Schema, Logger } from 'koishi';

import { } from '@koishijs/plugin-console';
import { resolve } from 'node:path';


export const name = 'iirose-webui';
export const inject = ['console'];
export const reusable = false;
export const filter = false;

export const usage = `
---
`;

export interface Config
{
}

export const Config: Schema<Config> = Schema.intersect([

]);

export function apply(ctx: Context, config: Config)
{

  ctx.on('ready', () =>
  {
    // 注册控制台入口
    ctx.console.addEntry({
      dev: resolve(__dirname, '../client/index.ts'),
      prod: resolve(__dirname, '../dist'),
    });
  });
}