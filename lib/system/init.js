import configControl from '../config/configControl.js';
import wsClient from '../../modules/ws/wsClient.js';

export const crystelfInit = {
  async CSH() {
    await configControl.init();
    if (configControl.get('core')) {
      await wsClient.initialize();
    }
    logger.mark('crystelf-admin 完成初始化');
  },
};
