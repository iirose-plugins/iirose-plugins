import { Context, Schema, Random, h, Session } from 'koishi';
import { } from 'koishi-plugin-adapter-iirose';

export const name = 'iirose-welcome';
export const inject = ['database', 'logger'];

export const usage = `
---

仅推荐搭配 adapter-iirose 食用。

---

可以使用指令【iirose.welcome.rf.set】、【iirose.welcome.wb.set】和【iirose.welcome.lr.set】设定属于自己的欢迎词，

不设定专属欢迎词，会随机从配置项获取一个欢迎词来欢迎。

此后机器人才能欢迎、欢送你哦~

---
`;
export interface Config
{
  bePrivate: boolean;
  onlyIIROSE: boolean;
  welcomeList: string[];
  exitList: string[];
  refreshList: string[]; // 刷新事件的欢迎语列表
  cooldown: number; // 冷却时间，单位秒
  enableAdd: boolean; // 是否开启进群欢迎
  enableRemove: boolean; // 是否开启退群欢送
  enableRefresh: boolean; // 是否开启刷新提示
}

declare module 'koishi' {
  interface Tables
  {
    iirose_welcome: iirose_welcome;
  }
}

export interface iirose_welcome
{
  uid: string;
  welcomeMsg: string;
  leaveMsg: string;
  refreshMsg: string; // 用户自定义的刷新提示
  addEnabled: boolean;
  removeEnabled: boolean;
  refreshEnabled: boolean;
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    enableAdd: Schema.boolean().description('是否开启【进群欢迎语】').default(true),
    enableRemove: Schema.boolean().description('是否开启【退群欢送语】').default(true),
    enableRefresh: Schema.boolean().description('是否开启【刷新提示语】').default(true),
  }).description('功能开关'),

  Schema.object({
    welcomeList: Schema.array(String).description('【进群欢迎语】 列表').default([
      "欢迎(@)的到来！",
      "诶~！欢迎(@)~~",
      "(@)来了，欢迎！",
      "(@)加入了此频道",
      "捕捉到一只野生的(@)！"
    ]).role('table'),
    exitList: Schema.array(String).description('【退群欢送语】 列表').default([
      "唔唔！灰灰！(@)",
      "啊呜，(@)下次再来哦~",
      "(@)悄悄地离开了，我们会想你的。",
      "期待与(@)的下一次相遇！",
    ]).role('table'),
    refreshList: Schema.array(String).description('【刷新提示语】 列表').default([
      '啊嘞嘞，(@)你怎么刷新了，网络不好吗？',
      '(@)重新连接到了我们的话题！',
      '哔哔————检测到(@)刷新了页面——',
      '(@)刷新了一下，是想换个心情吗？'
    ]).role('table'),
  }).description('欢迎词配置'),

  Schema.object({
    onlyIIROSE: Schema.boolean().description('是否仅处理IIROSE平台的 频道用户事件').default(true),
    cooldown: Schema.number().description('在指定秒数内，对于同一个用户只触发一次欢迎/送别。').min(0).step(1).default(0),
    bePrivate: Schema.boolean().description('是否私聊发送换欢迎语').default(false).hidden(),
  }).description('特殊配置'),
]);

export function apply(ctx: Context, config: Config)
{
  // 用于跟踪每个用户每种事件类型的时间戳的 Map
  // 键格式: `${userId}:${eventType}`，其中 eventType 为 'add' | 'remove' | 'refresh'
  const userEventTimestamps = new Map<string, number>();

  // 用于存储每个记录的自动清理定时器
  const cleanupTimers = new Map<string, NodeJS.Timeout>();

  // 插件卸载时清理所有定时器
  ctx.on('dispose', () =>
  {
    for (const timer of cleanupTimers.values())
    {
      clearTimeout(timer);
    }
    cleanupTimers.clear();
    userEventTimestamps.clear();
  });

  // 检查用户特定事件类型是否处于冷却时间内
  const isRateLimited = (userId: string, eventType: 'add' | 'remove' | 'refresh'): boolean =>
  {
    // 如果冷却时间设置为0或更小，则禁用此功能
    if (config.cooldown <= 0) return false;

    const now = Date.now();
    const key = `${userId}:${eventType}`;
    const lastEventTime = userEventTimestamps.get(key);

    // 检查自上次该类型事件以来是否经过了足够的时间
    if (lastEventTime && (now - lastEventTime) < config.cooldown * 1000)
    {
      return true; // 处于冷却中，阻止事件
    }

    // 更新当前事件类型的时间戳
    userEventTimestamps.set(key, now);

    // 清除该键的旧定时器（如果存在）
    const oldTimer = cleanupTimers.get(key);
    if (oldTimer)
    {
      clearTimeout(oldTimer);
    }

    // 设置新的定时器，在冷却时间后自动删除记录
    const newTimer = setTimeout(() =>
    {
      userEventTimestamps.delete(key);
      cleanupTimers.delete(key);
    }, config.cooldown * 1000);

    cleanupTimers.set(key, newTimer);

    return false; // 不在冷却中，允许事件
  };

  ctx.on('ready', async () =>
  {
    const logger = ctx.logger(name);

    // 数据库模型拓展
    ctx.model.extend('iirose_welcome', {
      uid: 'string',
      welcomeMsg: 'string',
      leaveMsg: 'string',
      refreshMsg: 'string',
      addEnabled: 'boolean',
      removeEnabled: 'boolean',
      refreshEnabled: 'boolean'
    }, {
      primary: 'uid'
    });

    // 渲染消息模板，将 (@) 替换为 at 元素
    const renderMessage = (template: string, userId: string, username: string) =>
    {
      if (!template.includes('(@)')) return template;
      // 使用 flatMap 来优雅地插入 h.at
      return template.split('(@)').flatMap((part, i, arr) =>
        i === arr.length - 1 ? [part] : [part, h.at(userId, { name: username })]
      ).filter(Boolean); // 过滤掉可能出现的空字符串
    };

    // 获取欢迎语
    const getWelcome = async (session: Session) =>
    {
      const { userId, username } = session;
      const dbData = await ctx.database.get('iirose_welcome', { uid: userId });

      if (dbData.length > 0)
      {
        const userMsg = dbData[0].welcomeMsg;
        // 检查用户是否在数据库中有明确的设置
        if (typeof userMsg === 'string')
        {
          // 如果设置为空字符串，则不发送任何消息
          if (userMsg === '')
          {
            return null;
          }
          // 否则，使用用户的自定义消息
          const rendered = renderMessage(userMsg, userId, username);
          return rendered;
        }
      }

      // 如果没有自定义消息，则检查默认列表
      if (config.welcomeList.length === 0)
      {
        return null;
      }

      // 使用默认列表中的随机一条
      const random = new Random(() => Math.random());
      const template = random.pick(config.welcomeList);
      const rendered = renderMessage(template, userId, username);
      return rendered;
    };

    // 获取送别语
    const getExit = async (session: Session) =>
    {
      const { userId, username } = session;
      const dbData = await ctx.database.get('iirose_welcome', { uid: userId });

      if (dbData.length > 0)
      {
        const userMsg = dbData[0].leaveMsg;
        // 检查用户是否在数据库中有明确的设置
        if (typeof userMsg === 'string')
        {
          // 如果设置为空字符串，则不发送任何消息
          if (userMsg === '')
          {
            return null;
          }
          // 否则，使用用户的自定义消息
          const rendered = renderMessage(userMsg, userId, username);
          return rendered;
        }
      }

      // 如果没有自定义消息，则检查默认列表
      if (config.exitList.length === 0)
      {
        return null;
      }

      // 使用默认列表中的随机一条
      const random = new Random(() => Math.random());
      const template = random.pick(config.exitList);
      const rendered = renderMessage(template, userId, username);
      return rendered;
    };

    // 获取刷新提示语
    const getRefresh = async (session: Session) =>
    {
      const { userId, username } = session;
      const dbData = await ctx.database.get('iirose_welcome', { uid: userId });

      if (dbData.length > 0)
      {
        const userMsg = dbData[0].refreshMsg;
        if (typeof userMsg === 'string')
        {
          if (userMsg === '') return null;
          return renderMessage(userMsg, userId, username);
        }
      }

      if (config.refreshList.length === 0) return null;

      const random = new Random(() => Math.random());
      const template = random.pick(config.refreshList);
      return renderMessage(template, userId, username);
    };

    // 监听成员增加事件
    ctx.platform("iirose").on('guild-member-added', async (session) =>
    {
      if (!config.enableAdd) return; // 检查是否开启了进群欢迎
      if (isRateLimited(session.userId, 'add')) return;
      if (config.onlyIIROSE && session.platform !== 'iirose') return;
      if (session.userId === session.selfId) return;

      // 检查用户个人开关
      const dbData = await ctx.database.get('iirose_welcome', { uid: session.userId });
      if (dbData.length > 0 && dbData[0].addEnabled === false) return;

      const message = await getWelcome(session);
      if (!message || (Array.isArray(message) && message.length === 0)) return;

      if (config.bePrivate)
      {
        try
        {
          await session.bot.sendPrivateMessage(session.userId, message);
        } catch (error)
        {
          logger.error('Error sending private message:', error);
        }
      } else
      {
        try
        {
          await session.bot.sendMessage(session.channelId, message);
        } catch (error)
        {
          logger.error('Error sending public message:', error);
        }
      }
    });

    // 监听成员离开事件 (仅限IIROSE)
    ctx.platform("iirose").on('guild-member-removed', async (session: Session) =>
    {
      if (!config.enableRemove) return; // 检查是否开启了退群欢送
      if (isRateLimited(session.userId, 'remove')) return;
      if (config.onlyIIROSE && session.platform !== 'iirose') return;
      if (session.userId === session.selfId) return;

      // 检查用户个人开关
      const dbData = await ctx.database.get('iirose_welcome', { uid: session.userId });
      if (dbData.length > 0 && dbData[0].removeEnabled === false) return;

      const message = await getExit(session);
      if (!message || (Array.isArray(message) && message.length === 0)) return;

      try
      {
        await session.bot.sendMessage(session.channelId, message);
      } catch (error)
      {
        logger.error('Error sending leave message:', error);
      }
    });

    // 监听IIROSE成员刷新事件
    ctx.platform("iirose").on('iirose/guild-member-refresh' as any, async (session: Session) =>
    {
      if (!config.enableRefresh) return; // 检查是否开启了刷新提示
      if (isRateLimited(session.userId, 'refresh')) return; // 刷新也走冷却
      if (config.onlyIIROSE && session.platform !== 'iirose') return;

      // 检查用户个人开关
      const dbData = await ctx.database.get('iirose_welcome', { uid: session.userId });
      if (dbData.length > 0 && dbData[0].refreshEnabled === false) return;

      const message = await getRefresh(session);
      if (!message || (Array.isArray(message) && message.length === 0)) return;
      try
      {
        await session.bot.sendMessage(session.channelId, message);
      } catch (error)
      {
        logger.error('Error sending refresh message:', error);
      }
    });

    // 指令注册
    //  ctx.command('iirose', '花园工具');
    //  防止撞指令。股票视检插件也有这个父级指令

    ctx.command("iirose.welcome.wb.set <message:text>", '设置自己的专属欢迎词')
      .action(async ({ session }, message) =>
      {
        if (config.onlyIIROSE)
        {
          if (session.platform !== 'iirose') return;
        }
        if (!message) return [h.at(session.userId), ' 你没有设置欢迎词'];

        await ctx.database.upsert('iirose_welcome', [{
          uid: session.userId,
          welcomeMsg: message,
        }]);

        return [h.at(session.userId), ' 设置成功'];
      });

    ctx.command("iirose.welcome.wb.rm", '清除自己设置的专属欢迎词')
      .action(async ({ session }) =>
      {
        if (config.onlyIIROSE)
        {
          if (session.platform !== 'iirose') return;
        }
        const data = await ctx.database.get('iirose_welcome', { uid: session.userId });
        if (!data.length || !data[0].welcomeMsg) return [h.at(session.userId), ' 你没有设置自己的欢迎词'];

        await ctx.database.upsert('iirose_welcome', [{
          uid: session.userId,
          welcomeMsg: '',
        }]);

        return [h.at(session.userId), ' 删除成功'];
      });

    ctx.command("iirose.welcome.lr.set <message:text>", '设置自己的专属送别词')
      .action(async ({ session }, message) =>
      {
        if (config.onlyIIROSE)
        {
          if (session.platform !== 'iirose') return;
        }
        if (!message) return [h.at(session.userId), ' 你没有设置送别词'];

        await ctx.database.upsert('iirose_welcome', [{
          uid: session.userId,
          leaveMsg: message,
        }]);

        return [h.at(session.userId), ' 设置成功'];
      });

    ctx.command("iirose.welcome.lr.rm", '清除自己设置的专属送别词')
      .action(async ({ session }) =>
      {
        if (config.onlyIIROSE)
        {
          if (session.platform !== 'iirose') return;
        }
        const data = await ctx.database.get('iirose_welcome', { uid: session.userId });
        if (!data.length || !data[0].leaveMsg) return [h.at(session.userId), ' 你没有设置自己的送别词'];

        await ctx.database.upsert('iirose_welcome', [{
          uid: session.userId,
          leaveMsg: '',
        }]);

        return [h.at(session.userId), ' 删除成功'];
      });

    ctx.command("iirose.welcome.rf.set <message:text>", '设置自己的专属刷新提示')
      .action(async ({ session }, message) =>
      {
        if (config.onlyIIROSE && session.platform !== 'iirose') return;
        if (!message) return [h.at(session.userId), ' 你没有设置刷新提示'];

        await ctx.database.upsert('iirose_welcome', [{
          uid: session.userId,
          refreshMsg: message,
        }]);

        return [h.at(session.userId), ' 设置成功'];
      });

    ctx.command("iirose.welcome.rf.rm", '清除自己设置的专属刷新提示')
      .action(async ({ session }) =>
      {
        if (config.onlyIIROSE && session.platform !== 'iirose') return;
        const data = await ctx.database.get('iirose_welcome', { uid: session.userId });
        if (!data.length || !data[0].refreshMsg) return [h.at(session.userId), ' 你没有设置自己的刷新提示'];

        await ctx.database.upsert('iirose_welcome', [{
          uid: session.userId,
          refreshMsg: '',
        }]);

        return [h.at(session.userId), ' 删除成功'];
      });

    ctx.command('iirose.welcome.toggle [event:string] [enable:boolean]', '开启/关闭自己特定事件的欢迎语')
      .example("iirose.welcome.toggle add true")
      .example("iirose.welcome.toggle remove false")
      .example("iirose.welcome.toggle refresh false")
      .action(async ({ session }, event, enable) =>
      {
        const { userId } = session;

        const eventMap = {
          add: 'addEnabled',
          remove: 'removeEnabled',
          refresh: 'refreshEnabled'
        };

        const dbData = await ctx.database.get('iirose_welcome', { uid: userId });
        const userData: Partial<iirose_welcome> = dbData.length > 0 ? dbData[0] : { uid: userId };

        // 默认未设置时为开启
        const currentState = {
          add: userData.addEnabled !== false,
          remove: userData.removeEnabled !== false,
          refresh: userData.refreshEnabled !== false,
        };

        if (!event)
        {
          return `您的个人欢迎语状态：\n- 进群欢迎 (add): ${currentState.add ? '开启' : '关闭'}\n- 退群欢送 (remove): ${currentState.remove ? '开启' : '关闭'}\n- 刷新提示 (refresh): ${currentState.refresh ? '开启' : '关闭'}\n\n使用 "toggle <事件> [true/false]" 来进行设置。`;
        }

        const key = event.toLowerCase();
        const dbKey = eventMap[key];
        if (!dbKey)
        {
          return '无效的事件名。请使用 "add", "remove", 或 "refresh"。';
        }

        let newState: boolean;
        if (typeof enable !== 'boolean')
        {
          // 如果没有提供 enable 参数，则切换当前状态
          newState = !currentState[key];
        } else
        {
          newState = enable;
        }

        await ctx.database.upsert('iirose_welcome', [{
          uid: userId,
          [dbKey]: newState,
        }]);

        return `您的 ${key} 事件欢迎语已${newState ? '开启' : '关闭'}。`;
      });
  });
}
