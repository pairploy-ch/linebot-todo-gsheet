// linebot-todo-gsheet/index.js

const express = require('express');
const line = require('@line/bot-sdk');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const dayjs = require('dayjs');
const dotenv = require('dotenv');
dotenv.config();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const doc = new GoogleSpreadsheet(process.env.GOOGLE_SHEET_ID);

const app = express();
app.use(express.json());

const client = new line.Client(config);

app.get('/', (req, res) => res.send('LINE Bot Todo is running.'));

app.post('/webhook', line.middleware(config), async (req, res) => {
  const events = req.body.events;

  for (const event of events) {
    if (event.type !== 'message' || event.message.type !== 'text') continue;

    const message = event.message.text.trim();

    if (message.startsWith('/add')) {
      const match = message.match(/^\/add\s+(.+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})$/);
      if (!match) {
        await client.replyMessage(event.replyToken, { type: 'text', text: '❌ ใช้รูปแบบ /add งาน YYYY-MM-DD HH:mm' });
        continue;
      }

      const task = match[1];
      const datetime = dayjs(match[2]);

      if (!datetime.isValid()) {
        await client.replyMessage(event.replyToken, { type: 'text', text: '❌ วันที่ไม่ถูกต้อง' });
        continue;
      }

      try {
        await doc.useServiceAccountAuth({
          client_email: process.env.GOOGLE_CLIENT_EMAIL,
          private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        });
        await doc.loadInfo();
        const sheet = doc.sheetsByIndex[0];
        await sheet.addRow({
          task,
          datetime: datetime.toISOString(),
          groupId: event.source.groupId || 'private_' + event.source.userId,
          status: 'pending',
          lastNotified: ''
        });

        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: `✅ เพิ่มงาน: ${task}\n🕒 เวลา: ${datetime.format('YYYY-MM-DD HH:mm')}`,
        });
      } catch (err) {
        console.error('Error adding row:', err);
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: '❌ เกิดข้อผิดพลาดในการบันทึกงาน',
        });
      }
    }

    if (message.startsWith('/done')) {
      const taskName = message.replace('/done', '').trim();
      await doc.useServiceAccountAuth({
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      });
      await doc.loadInfo();
      const sheet = doc.sheetsByIndex[0];
      const rows = await sheet.getRows();

      const row = rows.find(row => row.task === taskName && row.status === 'pending');
      if (row) {
        row.status = 'done';
        await row.save();
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: `✅ ทำงาน "${taskName}" เสร็จแล้ว`,
        });
      } else {
        await client.replyMessage(event.replyToken, {
          type: 'text',
          text: `❌ ไม่พบงานที่ชื่อ "${taskName}" หรือทำเสร็จไปแล้ว`,
        });
      }
    }
  }

  res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
