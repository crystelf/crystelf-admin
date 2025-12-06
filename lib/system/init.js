import configControl from '../config/configControl.js';

export const crystelfInit = {
  async CSH() {
    await configControl.init();
  },
};
