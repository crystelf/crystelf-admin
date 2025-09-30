import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import util from 'util';
import configControl from '../config/configControl.js';

const execAsync = util.promisify(exec);

export default class LgrService {
  constructor() {
    const config = configControl.get('config')?.lgr || {};
    this.basePath = config.basePath;
    if (!this.basePath) {
      logger.error('[crystelf-admin] 未检测到lgr配置..');
    }
  }

  /**
   * lgr登录方法
   * @param qq qq号
   * @param nickname 昵称
   * @returns {Promise<unknown>}
   */
  async login(qq, nickname) {
    if (!this.basePath) {
      logger.error('[crystelf-admin] 未配置 lgr.basePath');
    }
    const parentDir = path.dirname(this.basePath);
    const targetDir = path.join(path.join(parentDir, '..'), String(qq));
    if (!fs.existsSync(targetDir)) {
      try {
        await execAsync(`cp -r "${this.basePath}" "${targetDir}"`);
        logger.info(`[crystelf-admin] 已复制 ${this.basePath} 到 ${targetDir}..`);
      } catch (err) {
        logger.error(`[crystelf-admin] 复制文件夹失败: ${err.message}..`);
      }
    }
    const exeFile = path.join(targetDir, 'lgr');
    try {
      await execAsync(`chmod +777 "${exeFile}"`);
    } catch (err) {
      logger.error(`[crystelf-admin] chmod 失败: ${err.message}..`);
    }
    try {
      await execAsync(`tmux has-session -t ${nickname}`);
      await execAsync(`tmux kill-session -t ${nickname}`);
      await execAsync(`tmux new -s ${nickname} -d "cd '${targetDir}' && ./lgr"`);
    } catch {
      await execAsync(`tmux new -s ${nickname} -d "cd '${targetDir}' && ./lgr"`);
    }

    return await this.waitForQrUpdate(targetDir);
  }

  /**
   * 等待qr图片更新
   * @param targetDir 目标文件夹
   * @param timeout 最大等待时间 (默认 30s)
   * @returns {Promise<string|undefined>}
   */
  async waitForQrUpdate(targetDir, timeout = 30000) {
    const qrPath = path.join(targetDir, 'qr-0.png');
    if (!fs.existsSync(qrPath)) {
      return 'none';
    }
    let lastMtime = fs.statSync(qrPath).mtimeMs;
    return new Promise((resolve) => {
      let resolved = false;

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          watcher.close();
          resolve(undefined);
        }
      }, timeout);
      const watcher = fs.watch(qrPath, (eventType) => {
        if (eventType === 'change') {
          const stat = fs.statSync(qrPath);
          if (stat.mtimeMs !== lastMtime) {
            lastMtime = stat.mtimeMs;
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              watcher.close();
              resolve(qrPath);
            }
          }
        }
      });
    });
  }

  /**
   * 断开lgr连接
   * @param {string} nickname
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
