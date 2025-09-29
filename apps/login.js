import plugin from '../../../lib/plugins/plugin.js';
import path from 'path';
import ConfigControl from '../lib/config/configControl.js';
import config from '../../../lib/config/config.js';
import configControl from '../lib/config/configControl.js';
import axios from 'axios';
import Meme from '../lib/core/meme.js';
import NapcatService from '../lib/login/napcat.js';
import LgrService from '../lib/login/lgr.js';

const configPath = path.join(process.cwd(), 'data/crystelf/config');
const loginSessions = new Map(); //正在进行的登录会话

export default class LoginService extends plugin {
  constructor() {
    super({
      name: 'Onebot登录相关服务',
      dsc: '方便操作',
      event: 'message',
      priority: 50,
      rule: [
        {
          reg: '^#登录(\\d+)?$',
          fnc: 'loginHandler',
        },
        {
          reg: '^#绑定账号\\s+\\d+$',
          fnc: 'bindAccount',
        },
        {
          reg: '^#解绑账号\\s+\\d+$',
          fnc: 'unbindAccount',
        },
      ],
    });
  }

  /**
   * 登录命令入口
   * @param e
   * @returns {Promise<boolean>}
   */
  async loginHandler(e) {
    let config = await configControl.get();
    if (!config?.login?.allowGroups.includes(e.group_id)) {
      const img = await Meme.getMeme('zhenxun', 'default');
      return e.reply(segment.image(img)); //都不在群里玩什么;[
    }
    const isAdmin = e.isMaster;
    const userId = e.user_id;
    const match = e.msg.match(/^#登录(\d+)?$/);
    let targetQq = match[1];

    if (!targetQq) {
      const binds = config?.login?.userBinds[userId] || [];
      if (binds.length === 0) {
        if (isAdmin) {
          loginSessions.set(userId, { step: 'askQq', admin: true });
          return e.reply('你想登哪个qq?', true);
        } else {
          return e.reply('管理员似乎没有给你分配可用账户,请联系管理员添加..', true);
        }
      } else if (binds.length === 1) {
        targetQq = binds[0];
      } else {
        loginSessions.set(userId, { step: 'chooseQq', options: binds });
        return e.reply(`你小子账号还挺多,选一个qq登录吧:\n${binds.join('\n')}`, true);
      }
    }

    if (isAdmin) {
      await this.startAdminLogin(e, targetQq);
    } else {
      const binds = config?.login?.userBinds[userId] || [];
      if (!binds.includes(targetQq)) {
        return e.reply('你没有权限登录该账号,请联系管理员分配..', true);
      }
      await this.startUserLogin(e, targetQq);
    }
  }

  /**
   * 管理员登录
   * @param e
   * @param qq
   * @returns {Promise<*>}
   */
  async startAdminLogin(e, qq) {
    loginSessions.set(e.user_id, {
      step: 'askNickname',
      qq,
      admin: true,
    });
    return e.reply(`QQ[${qq}]的英文名叫什么?`, true);
  }

  /**
   * 普通用户
   * @param e
   * @param qq
   * @returns {Promise<*>}
   */
  async startUserLogin(e, qq) {
    loginSessions.set(e.user_id, {
      step: 'askMethod',
      qq,
      admin: false,
    });
    return e.reply(`请选择登录方式\nnc或lgr\n来登录 QQ[${qq}]`, true);
  }

  /**
   * 绑定账号
   * @param e
   * @returns {Promise<*>}
   */
  async bindAccount(e) {
    let config = await configControl.get()?.login;
    if (!e.isMaster) {
      const img = await Meme.getMeme('zhenxun', 'default');
      return e.reply(segment.image(img));
    }
    const match = e.msg.match(/^#绑定账号\s+(\d+)$/);
    if (!match) return;
    const qq = match[1];
    const at = e.at || e.user_id;
    if (!config?.userBinds[at]) config.userBinds[at] = [];
    if (!config?.userBinds[at].includes(qq)) {
      config.userBinds[at].push(qq);
      await ConfigControl.set('login', config);
      return e.reply(`已为 ${at} 绑定账号 ${qq}`, true);
    } else {
      return e.reply(`该用户已绑定此账号`, true);
    }
  }

  /**
   * 解绑账号
   * @param e
   * @returns {Promise<*|boolean>}
   */
  async unbindAccount(e) {
    if (!e.isMaster) {
      const img = await Meme.getMeme('zhenxun', 'default');
      return e.reply(segment.image(img));
    }
    let config = await configControl.get()?.login;
    const match = e.msg.match(/^#解绑账号\s+(\d+)$/);
    if (!match) return;
    const qq = match[1];
    const at = e.at || e.user_id;
    if (!config?.userBinds[at]) {
      ``;
      return e.reply('该用户没有绑定账号', true);
    }
    config.userBinds[at] = config.userBinds[at].filter((q) => q !== qq);
    await ConfigControl.set('login', config);
    return e.reply(`已为 ${at} 解绑账号 ${qq}`, true);
  }

  /**
   * 登录流程
   * @param e
   * @returns {Promise<*>}
   */
  async accept(e) {
    const session = loginSessions.get(e.user_id);
    if (
      !session ||
      !e.group_id ||
      !(await ConfigControl.get()?.login?.allowGroups.includes(e.group_id))
    )
      return;

    if (session.step === 'askQq') {
      session.qq = e.msg.trim();
      session.step = 'askNickname';
      return e.reply(`QQ[${session.qq}]的英文名叫什么?`, true);
    }

    if (session.step === 'chooseQq') {
      if (!session.options.includes(e.msg.trim())) {
        return e.reply('请选择列表中的 QQ', true);
      }
      session.qq = e.msg.trim();
      session.step = 'askMethod';
      return e.reply(`请选择登录方式\n[nc]或[lgr]\n来登录 QQ[${session.qq}]`, true);
    }

    if (session.step === 'askNickname') {
      session.nickname = e.msg.trim();
      session.step = 'askMethod';
      return e.reply(`请选择登录方式\n[nc]或[lgr]\n来登录 QQ[${session.qq}]`, true);
    }

    if (session.step === 'askMethod') {
      const method = e.msg.trim().toLowerCase();
      if (!['nc', 'lgr'].includes(method)) {
        return e.reply('登录方式无效', true);
      }
      session.method = method;
      loginSessions.delete(e.user_id);
      await this.doLogin(e, session);
    }
  }

  /**
   * 执行登录
   * @param e
   * @param session
   * @returns {Promise<*>}
   */
  async doLogin(e, session) {
    try {
      const redis = global.redis;
      //if (!redis) return e.reply('未找到全局redis服务..', true);
      const { qq, method, nickname } = session;
      e.reply(`开始使用 ${method} 登录 QQ[${qq}]`, true);

      let loginInstance;
      if (method === 'nc') {
        loginInstance = new NapcatService();
      } else {
        loginInstance = new LgrService();
      }

      const qrPath = await loginInstance.login(qq, nickname);
      e.reply(segment.image(qrPath), true);
      const timerKey = `login:timer:${qq}`;
      await redis.set(timerKey, 120, 'pending');

      const check = setInterval(async () => {
        const status = await loginInstance.checkStatus();
        if (status) {
          clearInterval(check);
          await redis.del(timerKey);
          return e.reply(`QQ[${qq}] 登录成功!`, true);
        }
        const ttl = await redis.ttl(timerKey);
        if (ttl <= 0) {
          clearInterval(check);
          await loginInstance.disconnect(nickname);
          return e.reply(`QQ[${qq}] 登录超时,已断开,请重新发起登录..`, true);
        }
      }, 5000);
    } catch (err) {
      logger.error('[crystelf-admin]登录流程出现错误', err);
      return e.reply(`出了点小问题，过会儿再来试试吧..`);
    }
  }
}
