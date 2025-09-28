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
      return e.reply(segment.img(img)); //都不在群里玩什么;[
    }
    const isAdmin = e.isAdmin;
    const userId = e.user_id;
    const match = e.msg.match(/^#登录(\d+)?$/);
    let targetQq = match[1];

    if (!targetQq) {
      const binds = config?.login?.userBinds[userId] || [];
      if (binds.length === 0) {
        if (isAdmin) {
          e.reply('你想登哪个qq?', true);
          loginSessions.set(userId, { step: 'askQq', admin: true });
        } else {
          return e.reply('管理员似乎没有给你分配可用账户,请联系管理员添加..', true);
        }
      } else if (binds.length === 1) {
        targetQq = binds[0];
      } else {
        e.reply(`你小子账号还挺多,选一个qq登录吧:\n${binds.join('\n')}`, true);
        loginSessions.set(userId, { step: 'chooseQq', options: binds });
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

  /** 管理员登录交互 */
  async startAdminLogin(e, qq) {
    loginSessions.set(e.user_id, {
      step: 'askNickname',
      qq,
      admin: true,
    });
    e.reply(`QQ[${qq}]的英文名叫什么?`, true);
  }

  /** 普通用户登录 */
  async startUserLogin(e, qq) {
    loginSessions.set(e.user_id, {
      step: 'askMethod',
      qq,
      admin: false,
    });
    e.reply(`请选择登录方式\nnc或lgr\n来登录 QQ[${qq}]`, true);
  }

  /** 绑定账号 */
  async bindAccount(e) {
    let config = await configControl.get()?.login;
    if (!e.isAdmin) return;
    const match = e.msg.match(/^#绑定账号\s+(\d+)$/);
    if (!match) return;
    const qq = match[1];
    const at = e.at || e.user_id;
    if (!config?.userBinds[at]) config.userBinds[at] = [];
    if (!config?.userBinds[at].includes(qq)) {
      config.userBinds[at].push(qq);
      await ConfigControl.set('login', config);
      e.reply(`已为 ${at} 绑定账号 ${qq}`, true);
    } else {
      e.reply(`该用户已绑定此账号`, true);
    }
  }

  /** 解绑账号 */
  async unbindAccount(e) {
    if (!e.isAdmin) return false;
    let config = await configControl.get()?.login;
    const match = e.msg.match(/^#解绑账号\s+(\d+)$/);
    if (!match) return;
    const qq = match[1];
    const at = e.at || e.user_id;
    if (!config?.userBinds[at]) {
      ``;
      e.reply('该用户没有绑定账号', true);
      return;
    }
    config.userBinds[at] = config.userBinds[at].filter((q) => q !== qq);
    await ConfigControl.set('login', config);
    e.reply(`已为 ${at} 解绑账号 ${qq}`, true);
  }

  /** 捕获消息继续交互 */
  async accept(e) {
    const session = loginSessions.get(e.user_id);
    if (!session) return;

    if (session.step === 'askQq') {
      session.qq = e.msg.trim();
      session.step = 'askNickname';
      e.reply(`QQ[${session.qq}]的英文名叫什么?`, true);
      return;
    }

    if (session.step === 'chooseQq') {
      if (!session.options.includes(e.msg.trim())) {
        e.reply('请选择列表中的 QQ', true);
        return;
      }
      session.qq = e.msg.trim();
      session.step = 'askMethod';
      e.reply(`请选择登录方式\n[nc]或[lgr]\n来登录 QQ[${session.qq}]`, true);
      return;
    }

    if (session.step === 'askNickname') {
      session.nickname = e.msg.trim();
      session.step = 'askMethod';
      e.reply(`请选择登录方式\n[nc]或[lgr]\n来登录 QQ[${session.qq}]`, true);
      return;
    }

    if (session.step === 'askMethod') {
      const method = e.msg.trim().toLowerCase();
      if (!['nc', 'lgr'].includes(method)) {
        e.reply('登录方式无效', true);
        return;
      }
      session.method = method;
      loginSessions.delete(e.user_id);
      await this.doLogin(e, session);
    }
  }

  /** 执行登录 */
  async doLogin(e, session) {
    const redis = global.redis | undefined;
    if (!redis) return e.reply('未找到全局redis服务..', true);
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
    redis.set(timerKey, 120, 'pending');

    const check = setInterval(async () => {
      const status = await loginInstance.checkStatus();
      if (status) {
        clearInterval(check);
        redis.del(timerKey);
        e.reply(`QQ[${qq}] 登录成功!`, true);
      }
      const ttl = await redis.ttl(timerKey);
      if (ttl <= 0) {
        clearInterval(check);
        await loginInstance.disconnect(nickname);
        e.reply(`QQ[${qq}] 登录超时,已断开,请重新发起登录..`, true);
      }
    }, 5000);
  }
}
