import { Context, h, Schema } from 'koishi';
import { } from 'koishi-plugin-adapter-iirose';

export const name = 'iirose-subscribe';

export const inject = {
  //  optional: [''],
  required: ['database']
};

export const usage = `
---

## 插件效果

频道消息 订阅转发。

订阅一个频道，可以让你不在那个频道的时候，通过与机器人私聊 实现与订阅频道的交互。

## 使用说明
1. 在群内发送 iirose.sub.on ，将会订阅BOT的消息
2. 在群内发送 iirose.sub.off ，将会取消订阅BOT的消息
3. 订阅状态会在数据库 (iirose_subscribe表) 中保存，不会因为重启而消失
4. 本插件只会在 iirose 中生效
5. adminList 为管理员列表，需要填写用户的唯一标识(如: 5b0fe8a3b1ff2 )，只有管理员才能使用订阅功能

## 注意事项
开启订阅状态后，私聊bot发送内容，会被转发到群内
开启订阅状态后，群内发送内容，会被转发到私聊bot
关闭订阅状态后，不会再转发消息

---
`;

export interface Config
{
  adminList: string[];
}

export const Config: Schema<Config> =
  Schema.object({
    adminList: Schema.array(String).description('管理员uid列表'),
  });

declare module 'koishi' {
  interface Tables
  {
    iirose_subscribe: subscribe;
  }
}

export interface subscribe
{
  uid: string;
  status: boolean;
}

export function apply(ctx: Context, config: Config)
{
  ctx.on('ready', () =>
  {
    ctx.model.extend('iirose_subscribe', {
      uid: 'string',
      status: 'boolean'
    }, {
      primary: 'uid'
    });

    //  其他iirose插件已经注册此指令
    //  ctx.command('iirose', '花园工具');

    ctx.command("iirose.sub", '订阅房间')
      .subcommand('.on', '开启订阅')
      .action(async ({ session }) =>
      {
        if (session.platform !== 'iirose')
        {
          return '[IIROSE-Subscribe] 该平台不支持使用此插件';
        }

        if (!config.adminList.includes(session.userId))
        {
          return '[IIROSE-Subscribe] 你没有权限使用此功能';
        }

        const userData = await ctx.database.get('iirose_subscribe', session.userId);

        if (userData.length > 0 && userData[0].status)
        {
          return '[IIROSE-Subscribe] 你已经设置为订阅状态了哦~';
        } else if (userData.length > 0)
        {
          await ctx.database.set('iirose_subscribe', session.userId, {
            status: true
          });

          return `[IIROSE-Subscribe] 将 ${h.at(session.userId)} 设置为BOT订阅状态`;
        } else if (userData.length == 0)
        {
          ctx.database.create('iirose_subscribe', {
            uid: session.userId,
            status: true
          });

          return `[IIROSE-Subscribe] 将 ${h.at(session.userId)} 设置为BOT订阅状态`;
        }
      });

    ctx.command("iirose.sub", '订阅房间')
      .subcommand('.off', '关闭订阅')
      .action(async ({ session }) =>
      {
        if (session.platform !== 'iirose')
        {
          return '[IIROSE-Subscribe] 该平台不支持使用此插件';
        }

        if (!config.adminList.includes(session.userId))
        {
          return '[IIROSE-Subscribe] 你没有权限使用此功能';
        }

        const userData = await ctx.database.get('iirose_subscribe', session.userId);

        if (userData.length > 0 && !userData[0].status)
        {
          return '[IIROSE-Subscribe] 你已经取消订阅状态了哦~';
        } else if (userData.length > 0)
        {
          await ctx.database.set('iirose_subscribe', session.userId, {
            status: false
          });

          return `[IIROSE-Subscribe] 将 ${h.at(session.userId)} 设置为BOT取消订阅状态`;
        } else if (userData.length == 0)
        {
          ctx.database.create('iirose_subscribe', {
            uid: session.userId,
            status: false
          });

          return `[IIROSE-Subscribe] 将 ${h.at(session.userId)} 设置为BOT取消订阅状态`;
        }
      });

    ctx.on('message', async (session) =>
    {
      if (session.platform !== 'iirose')
      {
        return;
      }
      const userId = session.userId;
      const userInput = session.content;

      // 公屏消息处理
      if (!session.isDirect)
      {
        const listTemp = await ctx.database.get('iirose_subscribe', { status: true });
        const list = listTemp.map(v => v.uid);
        for (const v of list)
        {
          // 不把公屏消息发回给原始发送者
          if (v === userId) continue;
          await session.bot.sendMessage(`private:${v}`, `${h.at(userId)}：${userInput}`);
        }
      }
      // 私聊消息处理
      else
      {
        const userData = await ctx.database.get('iirose_subscribe', { uid: userId });
        // 检查用户是否订阅
        if (userData.length <= 0 || !userData[0].status)
        {
          return;
        }

        const botroom = session.bot.config.roomId;
        if (!botroom) return;

        // 将私聊消息转发到指定群聊
        await session.bot.sendMessage(`public:${botroom}`, `${h.at(userId)}：${userInput}`);
      }
    });

  });
}
