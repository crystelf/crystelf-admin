import ConfigControl from '../config/configControl.js';
import axios from 'axios';

const Meme = {
  /**
   * 获取随机表情
   * @param character 角色名称
   * @param status 角色状态
   * @returns {Promise<axios.AxiosResponse<any>>}
   */
  async getMeme(character, status) {
    const coreConfig = await ConfigControl.get()?.coreConfig;
    const coreUrl = coreConfig?.coreUrl;
    const token = coreConfig?.token;
    return await axios.get(`${coreUrl}/api/meme`, {
      params: {
        character: character,
        status: status,
        token: token,
      },
    });
  },
};

export default Meme;
