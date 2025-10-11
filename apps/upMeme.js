import plugin from '../../../lib/plugins/plugin.js';
import axios from 'axios';
import YunzaiUtils from '../lib/yunzai/utils.js';
import ConfigControl from '../lib/config/configControl.js';
import FormData from 'form-data';

const uploadSessions = new Map();

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
        const response = await axios.get(session.img, {
          responseType: 'arraybuffer',
        });

        const formData = new FormData();
        const buffer = Buffer.from(response.data);

        const isGif = buffer.slice(0, 3).toString() === 'GIF';
        const filename = isGif ? 'meme.gif' : 'meme.jpg';
        const contentType = isGif ? 'image/gif' : 'image/jpeg';

        formData.append('file', buffer, {
          filename: filename,
          contentType: contentType,
        });

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
        return e.reply('上传失败..', true);
      }
    }
  }
}
