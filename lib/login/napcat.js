import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import configControl from '../config/configControl.js';
import Path from '../../constants/path.js';

const execAsync = util.promisify(exec);

export default class NapcatService {
  constructor() {
    const config = configControl.get('config')?.napcat || {};
    this.basePath = config.basePath;
    this.userPath = config.userPath;
    if (!this.basePath || !this.userPath) {
      logger.error('[crystelf-admin] 未检测到napcat配置..');
    }
    this.qrPath = path.join(this.basePath, 'cache', 'qrcode.png');
    this.configPath = path.join(this.basePath, 'config');
  }

  /**
   * nc登录方法
   * @param qq qq号
   * @param nickname 昵称
   * @returns {Promise<unknown>}
   */
  async login(qq, nickname) {
    const shFile = path.join(this.userPath, `${qq}.sh`);
    if (!fs.existsSync(this.userPath)) {
      fs.mkdirSync(this.userPath, { recursive: true });
    }
    const userConfigFile = path.join(this.configPath, `onebot11_${qq}.json`);
    if (!fs.existsSync(userConfigFile)) {
      try {
        const defaultConfigFile = path.join(Path.config || '', 'napcat.json');
        if (!fs.existsSync(defaultConfigFile)) {
          logger.error(`[crystelf-admin] 默认配置文件不存在: ${defaultConfigFile}`);
        }
        fs.copyFileSync(defaultConfigFile, userConfigFile);
        logger.info(`[crystelf-admin] 已复制默认配置到 ${userConfigFile}`);
      } catch (err) {
        logger.error(`[crystelf-admin] 复制默认配置失败: ${err.message}`);
      }
    }
    if (!fs.existsSync(shFile)) {
      const scriptContent = `#!/bin/bash\nxvfb-run -a qq --no-sandbox -q ${qq}\n`;
      fs.writeFileSync(shFile, scriptContent, { mode: 0o755 });
      logger.info(`[crystelf-admin] 写入运行脚本,:${qq}.sh`);
    }
    try {
      await execAsync(`tmux has-session -t ${nickname}`);
      // 存在就先干掉
      logger.info('[crystelf-admin] 存在会话，将停止会话')
      await execAsync(`tmux kill-session -t ${nickname}`);
      await execAsync(`tmux new -s ${nickname} -d "bash '${shFile}'"`);
      logger.info('[crystelf-admin] 新建会话');
    } catch {
      // 不存在再新建
      await execAsync(`tmux new -s ${nickname} -d "bash '${shFile}'"`);
      logger.info('[crystelf-admin] 新建会话');
    }

    return await this.waitForQrUpdate();
  }

  /**
   * 等待qrcode图像更新
   * @param timeout
   * @returns {Promise<unknown>}
   */
  async waitForQrUpdate(timeout = 90000) {
    if (!fs.existsSync(this.qrPath)) {
      return 'none';
    }
    let lastMtime = fs.statSync(this.qrPath).mtimeMs;
    return new Promise((resolve) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          watcher.close();
          resolve(undefined);
        }
      }, timeout);
      const watcher = fs.watch(this.qrPath, (eventType) => {
        if (eventType === 'change') {
          const stat = fs.statSync(this.qrPath);
          if (stat.mtimeMs !== lastMtime) {
            lastMtime = stat.mtimeMs;
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              watcher.close();
              resolve(this.qrPath);
            }
          }
        }
      });
    });
  }

  /**
   * 断开nc连接
   * @param nickname 昵称
   * @returns {Promise<string>}
   */
  async disconnect(nickname) {
    try {
      await execAsync(`tmux kill-session -t ${nickname}`);
      return `已关闭会话: ${nickname}`;
    } catch (err) {
      return `关闭会话失败: ${err.message}`;
    }
  }

  /**
   * qq是否登录成功
   * @param qq
   * @returns {Promise<boolean>}
   */
  async checkStatus(qq) {
    return Bot.uin.includes(qq);
  }
}
