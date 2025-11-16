import { Context, h, Schema } from 'koishi';

export const name = 'iirose-self-cut';
export const usage = `
---

本插件有两个指令：

- iirose.cut ： 机器人会回复 cut
- iirose.allcut ： 机器人会回复 cut all

---
`;

export interface Config { }

export const Config: Schema<Config> = Schema.object({});

export function apply(ctx: Context)
{
  // write your plugin here
  //  ctx.command('iirose', '花园工具');

  ctx
    .command('iirose.cut', '切除bot的一首歌')
    .action(async ({ session }) =>
    {
      if (session.platform === 'iirose')
      {
        await session.send(h.text('cut'));
      } else
      {
        await session.send(h.text('暂不支持你所在的平台哦~'));
      }
      return;
    });

  ctx
    .command('iirose.allcut', '切除bot的所有歌')
    .action(async ({ session }) =>
    {
      if (session.platform === 'iirose')
      {
        await session.send(h.text('cut all'));
      } else
      {
        await session.send(h.text('暂不支持你所在的平台哦~'));
      }

      return;
    });

}
