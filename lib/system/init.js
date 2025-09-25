import configControl from '../config/configControl.js';
import wsClient from '../../modules/ws/wsClient.js';

export const crystelfInit = {
  async CSH() {
    await configControl.init();
    await wsClient.initialize();
  },
};
