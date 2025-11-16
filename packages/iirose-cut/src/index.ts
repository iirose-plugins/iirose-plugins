import { Context, h, Schema, Session } from 'koishi';

export const name = 'iirose-cut';

export const inject = ['database'];

export const usage = `
---

BOT需要有房间成员的星标权限 / 管理权限。

如果你的bot没有权限，则可以发起cut投票，请使用 iirose-self-cut 插件。

---

也可以使用指令切歌：

- iirose.media.cut ： 终止当前歌曲
- iirose.media.cutall ： 终止所有歌曲

---

本插件需要调用者需要至少2级权限。

如果你的权限不够，请使用 change-auth-callme 插件来提权。

务必不要使用1级权限，否则可能会导致

---
`;

export interface Config
{
  commandAuthority: number;
}

export const Config: Schema<Config> = Schema.object({
  commandAuthority: Schema.number().role('slider').min(0).max(5).step(1).default(2).description("指令权限等级"),
});

export function apply(ctx: Context, config: Config)
{
  ctx
    .command('iirose.media.cut', '终止当前歌曲', { authority: config.commandAuthority })
    .action(async ({ session }) =>
    {
      if (session.platform !== "iirose")
      {
        return "暂不支持其他平台。";
      }
      await session.bot.internal.cutOne();
      return;
    });
  ctx
    .command('iirose.media.cutall', '终止所有歌曲', { authority: config.commandAuthority })
    .action(async ({ session }) =>
    {
      if (session.platform !== "iirose")
      {
        return "暂不支持其他平台。";
      }
      await session.bot.internal.cutAll();
      return;
    });

  // 用于存储用户和他们点播的歌曲，主要用于调试和记录
  const userSongs = new Map<string, Set<string>>(); // username -> Set<songTitle>
  // 用于存储已离开房间的用户
  const leftUsers = new Set<string>(); // Set<username>

  // 插件卸载时清空数据
  ctx.on('dispose', () =>
  {
    userSongs.clear();
    leftUsers.clear();
  });

  ctx.platform("iirose")
    .on('message', (session: Session) =>
    {
      // 监听消息，解析点歌信息
      if (session.content.startsWith("<json"))
      {
        try
        {
          const jsonData = h.parse(session.content)[0].attrs.data;
          // 确认是音乐点播消息
          if (jsonData?.type === 'iirose:music' && jsonData.name && session.username)
          {
            const username = session.username;
            const songTitle = jsonData.name;

            // 记录用户点播的歌曲
            if (!userSongs.has(username))
            {
              userSongs.set(username, new Set<string>());
            }
            userSongs.get(username).add(songTitle);
            // ctx.logger.info(`记录到用户 ${username} 点播了歌曲: ${songTitle}`);
          }
        } catch (e)
        {
          // JSON解析失败或格式不符，不是点歌消息，忽略
        }
      }
    });

  // 监听用户加入房间事件
  ctx.platform("iirose")
    .on('guild-member-added', (session: Session) =>
    {
      // 如果用户重新加入房间，则从“已离开”列表中移除
      if (session.username && leftUsers.has(session.username))
      {
        leftUsers.delete(session.username);
        // ctx.logger.info(`用户 ${session.username} 已重新加入房间。`);
      }
    });


  ctx.platform("iirose")
    .on('guild-member-removed', (session: Session) =>
    {
      // 记录离开房间的用户
      if (session.username)
      {
        leftUsers.add(session.username);
        ctx.logger.info(`用户 ${session.username} 已离开，其点播的歌曲将在播放时被切掉。`);
      }
    });

  ctx.platform("iirose")
    .on('iirose/music-play' as any, async (session: Session, data) =>
    {
      // 检查点播这首歌曲的用户是否已经离开
      if (data?.owner)
      {
        // ctx.logger.info(`正在播放歌曲: ${data.title}, 点播者: ${data.owner}`);
        // 如果点歌者在已离开用户列表中
        if (leftUsers.has(data.owner))
        {
          try
          {
            // 则切掉当前歌曲
            await session.bot.internal.cutOne();
            ctx.logger.info(`检测到点播者 ${data.owner} 已离开，已切掉歌曲: ${data.title}`);
          } catch (e)
          {
            ctx.logger.warn(`自动切歌失败: ${e}`);
          }
        }
      }
    });
}
