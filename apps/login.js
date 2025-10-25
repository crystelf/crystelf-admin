import plugin from '../../../lib/plugins/plugin.js';
import ConfigControl from '../lib/config/configControl.js';
import configControl from '../lib/config/configControl.js';
import NapcatService from '../lib/login/napcat.js';
import LgrService from '../lib/login/lgr.js';
import Meme from "../lib/core/meme.js";
const loginSessions = new Map(); //正在进行的登录会话
const bindSessions = new Map(); //正在进行的绑定会话
const activeLogins = new Map(); //在线登录实例

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
          reg: '^#绑定账号(\\s+\\d+)?$',
          fnc: 'bindAccount',
        },
        {
          reg: '^#解绑账号\\s+\\d+$',
          fnc: 'unbindAccount',
        },
        {
          reg: '^#退出登录\\s+\\d+$',
          fnc: 'logoutHandler',
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
        return e.reply('管理员似乎没有给你分配可用账户,请联系管理员添加..', true);
      } else if (binds.length === 1) {
        targetQq = binds[0].qq;
      } else {
        loginSessions.set(userId, { step: 'chooseQq', options: binds });
        return e.reply(
          `你小子账号还挺多,选一个qq登录吧:\n${binds.map((b) => b.qq).join('\n')}`,
          true
        );
      }
    }

    if (isAdmin) {
      await this.startAdminLogin(e, targetQq);
    } else {
      const binds = config?.login?.userBinds[userId] || [];
      const bind = binds.find((b) => b.qq === targetQq);
      if (!bind) {
        return e.reply('你没有权限登录该账号,请联系管理员分配..', true);
      }
      await this.startUserLogin(e, bind);
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
   * @param bind
   * @returns {Promise<*>}
   */
  async startUserLogin(e, bind) {
    loginSessions.set(e.user_id, {
      step: 'autoLogin',
      qq: bind.qq,
      nickname: bind.nickname,
      method: bind.method,
      admin: false,
    });
    return this.doLogin(e, {
      qq: bind.qq,
      nickname: bind.nickname,
      method: bind.method,
    });
  }

  /**
   * 绑定账号
   * @param e
   * @returns {Promise<*>}
   */
  async bindAccount(e) {
    if (!e.isMaster) {
      const img = await Meme.getMeme('zhenxun', 'default');
      return e.reply(segment.image(img));
    }
    const at = e.at || e.user_id;
    bindSessions.set(e.user_id, { step: 'askQq', targetUser: at });
    return e.reply('要绑定的QQ号是哪个?', true);
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
      return e.reply('该用户没有绑定账号..', true);
    }
    config.userBinds[at] = config.userBinds[at].filter((q) => q.qq !== qq);
    await ConfigControl.set('login', config);
    return e.reply(`已为 ${at} 解绑账号 ${qq}`, true);
  }

  /**
   * 退出登录
   * @param e
   * @returns {Promise<*>}
   */
  async logoutHandler(e) {
    const match = e.msg.match(/^#退出登录\s+(\d+)$/);
    if (!match) return;
    const qq = match[1];
    const instance = activeLogins.get(qq);
    if (!instance) {
      return e.reply(`QQ[${qq}] 没有活跃的登录会话..`, true);
    }
    let config = await configControl.get();
    const isAdmin = e.isMaster;
    const userId = e.user_id;
    const binds = config?.login?.userBinds[userId] || [];
    if (!isAdmin && !binds.includes(qq)) {
      return e.reply(`你没有权限退出 QQ[${qq}] 的会话..`, true);
    }
    await instance.disconnect();
    activeLogins.delete(qq);
    return e.reply(`QQ[${qq}] 已退出登录..`, true);
  }

  /**
   * 登录流程
   * @param e
   * @returns {Promise<*>}
   */
  async accept(e) {
    const session = loginSessions.get(e.user_id);
    const bindSession = bindSessions.get(e.user_id);
    if (!session && !bindSession) return;

    if (bindSession) {
      if (bindSession.step === 'askQq') {
        bindSession.qq = e.msg.trim();
        bindSession.step = 'askNickname';
        return e.reply(`QQ[${bindSession.qq}]的英文名叫什么?`, true);
      }
      if (bindSession.step === 'askNickname') {
        bindSession.nickname = e.msg.trim();
        bindSession.step = 'askMethod';
        return e.reply(`请选择登录方式\n[nc]或[lgr]\n来绑定 QQ[${bindSession.qq}]`, true);
      }
      if (bindSession.step === 'askMethod') {
        const method = e.msg.trim().toLowerCase();
        if (!['nc', 'lgr'].includes(method)) {
          return e.reply('登录方式无效', true);
        }
        bindSession.method = method;
        let config = await configControl.get()?.login;
        if (!config.userBinds[bindSession.targetUser])
          config.userBinds[bindSession.targetUser] = [];
        config.userBinds[bindSession.targetUser].push({
          qq: bindSession.qq,
          nickname: bindSession.nickname,
          method: bindSession.method,
        });
        await ConfigControl.set('login', config);
        bindSessions.delete(e.user_id);
        return e.reply(
          `已为 ${bindSession.targetUser} 绑定账号 ${bindSession.qq} (${bindSession.nickname}, ${bindSession.method})`,
          true
        );
      }
    }

    if (session) {
      let config = await configControl.get();
      if (!e.group_id || !config?.login?.allowGroups.includes(e.group_id)) return;

      if (session.step === 'chooseQq') {
        const chosen = e.msg.trim();
        const bind = session.options.find((b) => b.qq === chosen);
        if (!bind) {
          return e.reply('请选择列表中的 QQ', true);
        }
        loginSessions.delete(e.user_id);
        return this.doLogin(e, {
          qq: bind.qq,
          nickname: bind.nickname,
          method: bind.method,
        });
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
  }

  /**
   * 执行登录
   * @param e
   * @param session
   * @returns {Promise<*>}
   */
  async doLogin(e, session) {
    try {
      const { qq, method, nickname } = session;
      e.reply(`开始尝试使用 ${method} 登录 QQ[${qq}]`, true);
      let loginInstance;
      if (method === 'nc') {
        loginInstance = new NapcatService();
      } else {
        loginInstance = new LgrService();
      }
      activeLogins.set(qq, loginInstance);
      const qrPath = await loginInstance.login(qq, nickname);
      const loginTimers = new Map();
      if (qrPath && qrPath !== 'none') {
        await e.reply(
          [
            segment.image(`file:///${qrPath}`),
            '\n请使用手机qq摄像头扫码登录并勾选保存登录状态\n二维码有效期2分钟..',
          ],
          true,
          { recallMsg: 120 }
        );
        const timerKey = `login:timer:${qq}`;
        if (loginTimers.has(timerKey)) {
          clearTimeout(loginTimers.get(timerKey).timeout);
          clearInterval(loginTimers.get(timerKey).check);
          loginTimers.delete(timerKey);
        }
        const check = setInterval(async () => {
          const status = await loginInstance.checkStatus(qq);
          if (status) {
            clearInterval(check);
            clearTimeout(timerObj.timeout);
            loginTimers.delete(timerKey);
            return e.reply(`QQ[${qq}] 登录成功!`, true);
          }
        }, 5000);
        const timeout = setTimeout(async () => {
          clearInterval(check);
          loginTimers.delete(timerKey);
          await loginInstance.disconnect(nickname);
          activeLogins.delete(qq);
          return e.reply(`QQ[${qq}] 登录超时,已断开,请重新发起登录..`, true);
        }, 120 * 1000);
        const timerObj = { check, timeout };
        loginTimers.set(timerKey, timerObj);
      } else {
        const status = await loginInstance.checkStatus(qq);
        if (status) {
          return e.reply(`QQ[${qq}] 使用上次登录缓存登录成功!`, true);
        } else {
          return e.reply(`QQ[${qq}] 登录出现未知错误,请联系管理员操作..`, true);
        }
      }
    } catch (err) {
      logger.error('[crystelf-admin]登录流程出现错误', err);
      return e.reply(`出了点小问题，过会儿再来试试吧..`);
    }
  }
}
