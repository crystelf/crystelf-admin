import plugin from '../../../lib/plugins/plugin.js';
import axios from 'axios';
import YunzaiUtils from '../lib/yunzai/utils.js';
import ConfigControl from '../lib/config/configControl.js';

const uploadSessions = new Map(); // 正在进行的上传会话

export default class MemeUploadService extends plugin {
  constructor() {
    super({
      name: '表情包上传服务',
      dsc: '通过引用消息或发送图片上传表情包',
      event: 'message',
      priority: 50,
      rule: [
        {
          reg: '^#上传表情$',
          fnc: 'startUpload',
        },
      ],
    });
  }

  /**
   * 上传入口
   * @param e
   */
  async startUpload(e) {
    if (!e.isMaster) return e.reply('不许你上传哦', true);
    const key = e.user_id;
    if (uploadSessions.has(key)) return e.reply('你已经在上传流程中了..', true);
    const imgs = await YunzaiUtils.getImages(e, 1);
    if (!imgs.length) return e.reply('你图片搁哪呢?', true);

    uploadSessions.set(key, { step: 'askCharacter', img: imgs[0] });
    return e.reply('这表情叫什么?', true);
  }

  async accept(e) {
    const key = e.user_id;
    const session = uploadSessions.get(key);
    if (!session) return;

    const text = (e.message || [])
      .filter((m) => m.type === 'text')
      .map((m) => m.text)
      .join('')
      .trim();

    if (session.step === 'askCharacter') {
      session.character = text;
      session.step = 'askStatus';
      return e.reply('表情处于什么状态?', true);
    }

    if (session.step === 'askStatus') {
      session.status = text;
      uploadSessions.delete(key);

      try {
        const token = await ConfigControl.get('config')?.coreConfig?.token;
        const coreUrl = await ConfigControl.get('config')?.coreConfig?.coreUrl;
        const res = await axios.get(session.img, { responseType: 'stream' });
        const formData = new FormData();
        formData.append('file', res.data, { filename: 'meme.jpg' });
        formData.append('character', session.character);
        formData.append('status', session.status);

        await axios.post(`${coreUrl}/api/meme/upload`, formData, {
          headers: {
            'x-token': token,
            ...formData.getHeaders(),
          },
          maxBodyLength: Infinity,
        });

        return e.reply('上传成功~', true);
      } catch (err) {
        console.error(err);
        return e.reply('上传失败..', true);
      }
    }
  }
}
