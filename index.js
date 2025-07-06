const express = require('express');
const line = require('@line/bot-sdk');
const dotenv = require('dotenv');
const schedule = require('node-schedule');

dotenv.config();

const config = {
  channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.CHANNEL_SECRET,
};

const app = express();
const client = new line.Client(config);

// เก็บข้อมูล todo list และ scheduled jobs
const todoList = new Map(); // userId -> todos[]
const scheduledJobs = new Map(); // todoId -> job

// Todo item structure
class TodoItem {
  constructor(id, userId, task, reminderTime) {
    this.id = id;
    this.userId = userId;
    this.task = task;
    this.reminderTime = reminderTime;
    this.completed = false;
    this.createdAt = new Date();
  }
}

// Generate simple ID (auto-increment per user)
function generateId(userId) {
  const userTodos = todoList.get(userId) || [];
  return (userTodos.length + 1).toString();
}

// Schedule reminder
function scheduleReminder(todoItem) {
  const job = schedule.scheduleJob(todoItem.reminderTime, async () => {
    try {
      const message = {
        type: 'text',
        text: `🔔 แจ้งเตือน! -3- ด่วนๆๆๆๆ คุณทำสิ่งนี้รึยางงง \n📝 ${todoItem.task}\n\n💡 พิมพ์ "done ${todoItem.id}" เพื่อทำเครื่องหมายว่าเสร็จแว้ว`
      };
      
      await client.pushMessage(todoItem.userId, message);
      console.log(`✅ Reminder sent for: ${todoItem.task}`);
    } catch (error) {
      console.error('❌ Error sending reminder:', error);
    }
  });
  
  scheduledJobs.set(todoItem.id, job);
}

// Parse date and time
function parseDateTime(dateTimeStr) {
  try {
    // Support formats: "2024-12-25 14:30", "25/12/2024 14:30", "14:30" (today)
    const now = new Date();
    
    if (dateTimeStr.includes(' ')) {
      const [datePart, timePart] = dateTimeStr.split(' ');
      const [hour, minute] = timePart.split(':').map(Number);
      
      let date;
      if (datePart.includes('-')) {
        // Format: YYYY-MM-DD
        const [year, month, day] = datePart.split('-').map(Number);
        date = new Date(year, month - 1, day, hour, minute);
      } else if (datePart.includes('/')) {
        // Format: DD/MM/YYYY
        const [day, month, year] = datePart.split('/').map(Number);
        date = new Date(year, month - 1, day, hour, minute);
      }
      
      return date;
    } else if (dateTimeStr.includes(':')) {
      // Format: HH:MM (today)
      const [hour, minute] = dateTimeStr.split(':').map(Number);
      const date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hour, minute);
      
      // If time has passed today, schedule for tomorrow
      if (date < now) {
        date.setDate(date.getDate() + 1);
      }
      
      return date;
    }
    
    return null;
  } catch (error) {
    return null;
  }
}

// Format date for display
function formatDate(date) {
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok'
  };
  return date.toLocaleString('th-TH', options);
}

// LINE SDK middleware
app.use('/webhook', line.middleware(config));
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

app.get('/', (req, res) => {
  res.send('LINE Bot Todo List is running! 📝✅');
});

// Webhook handler
app.post('/webhook', (req, res) => {
  console.log('🚀 Webhook called!');
  res.status(200).send('OK');
  
  const events = req.body.events || [];
  console.log('📦 Events received:', events.length);
  
  events.forEach(async (event) => {
    if (event.type === 'message' && event.message.type === 'text') {
      await handleTextMessage(event);
    }
  });
});

async function handleTextMessage(event) {
  const userId = event.source.userId;
  const message = event.message.text.trim();
  
  console.log('💬 Message received:', message);
  
  try {
    // Initialize user's todo list if not exists
    if (!todoList.has(userId)) {
      todoList.set(userId, []);
    }
    
    const userTodos = todoList.get(userId);
    
    // Commands
    if (message.toLowerCase().startsWith('add ')) {
      await handleAddTodo(event, message.slice(4));
    } else if (message.toLowerCase().startsWith('done ')) {
      await handleCompleteTodo(event, message.slice(5));
    } else if (message.toLowerCase() === 'list' || message.toLowerCase() === 'รายการ') {
      await handleListTodos(event);
    } else if (message.toLowerCase() === 'help' || message.toLowerCase() === 'ช่วยเหลือ') {
      await handleHelp(event);
    } else if (message.toLowerCase() === 'clear' || message.toLowerCase() === 'ล้าง') {
      await handleClearTodos(event);
    } else {
      await handleUnknownCommand(event);
    }
  } catch (error) {
    console.error('❌ Error handling message:', error);
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง'
    });
  }
}

async function handleAddTodo(event, input) {
  const userId = event.source.userId;
  const userTodos = todoList.get(userId);
  
  // Parse input: "task | time"
  const parts = input.split('|').map(part => part.trim());
  
  if (parts.length < 2) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ รูปแบบไม่ถูกต้อง\n\n✅ ใช้: add งาน | เวลา\n📝 ตอวย่าง: add ประชุม | 14:30\n📝 หรือ: add ทำรายงาน | 25/12/2024 09:00'
    });
    return;
  }
  
  const task = parts[0];
  const timeStr = parts[1];
  
  const reminderTime = parseDateTime(timeStr);
  
  if (!reminderTime) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ รูปแบบเวลาไม่ถูกต้อง\n\n✅ รูปแบบที่รองรับ:\n• 14:30 (วันนี้)\n• 25/12/2024 14:30\n• 2024-12-25 14:30'
    });
    return;
  }
  
  if (reminderTime < new Date()) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ ไม่สามารถกำหนดเวลาในอดีตได้'
    });
    return;
  }
  
  const todoId = generateId(userId);
  const todoItem = new TodoItem(todoId, userId, task, reminderTime);
  
  userTodos.push(todoItem);
  scheduleReminder(todoItem);
  
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: `✅ เพิ่มรายการสำเร็จ!\n\n📝 งาน: ${task}\n⏰ แจ้งเตือน: ${formatDate(reminderTime)}\n🆔 ID: ${todoId}\n\n💡 พิมพ์ "list" เพื่อดูรายการทั้งหมด`
  });
}

async function handleCompleteTodo(event, todoId) {
  const userId = event.source.userId;
  const userTodos = todoList.get(userId);
  
  const todoIndex = userTodos.findIndex(todo => todo.id === todoId && !todo.completed);
  
  if (todoIndex === -1) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ ไม่พบรายการที่ต้องการทำเครื่องหมาย\n\n💡 พิมพ์ "list" เพื่อดูตัวเลข ID ของรายการทั้งหมด'
    });
    return;
  }
  
  const todoItem = userTodos[todoIndex];
  todoItem.completed = true;
  
  // Cancel scheduled reminder
  const job = scheduledJobs.get(todoId);
  if (job) {
    job.cancel();
    scheduledJobs.delete(todoId);
  }
  
  // Remove from active list
  userTodos.splice(todoIndex, 1);
  
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: `🎉 ทำเสร็จแว้วววว! -3- \n\n📝 งาน: ${todoItem.task}\n✅ ทำเครื่องหมายเสร็จเมื่อ: ${formatDate(new Date())}`
  });
}

async function handleListTodos(event) {
  const userId = event.source.userId;
  const userTodos = todoList.get(userId);
  
  if (userTodos.length === 0) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '📋 ไม่มีรายการ Todo\n\n💡 เพิ่มรายการใหม่ด้วย: add งาน | เวลา ได้่เลยจ้า -3-'
    });
    return;
  }
  
  let listText = '📋 รายการ Todo ของคุณ -3-:\n\n';
  userTodos.forEach((todo) => {
    listText += `${todo.id}. 📝 ${todo.task}\n`;
    listText += `   ⏰ ${formatDate(todo.reminderTime)}\n\n`;
  });
  
  listText += '💡 พิมพ์ "done <ตัวเลข>" เพื่อทำเครื่องหมายเสร็จ -3-';
  
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: listText
  });
}

async function handleHelp(event) {
  const helpText = `🤖 LINE Bot Todo List\n\n📝 คำสั่งที่ใช้ได้:\n\n• add งาน | เวลา\n  เพิ่มรายการใหม่\n  ตัวอย่าง: add ประชุม | 14:30\n\n• list หรือ รายการ\n  แสดงรายการทั้งหมด\n\n• done <ตัวเลข>\n  ทำเครื่องหมายว่าเสร็จแล้ว\n\n• clear หรือ ล้าง\n  ลบรายการทั้งหมด\n\n• help หรือ ช่วยเหลือ\n  แสดงคำสั่งทั้งหมด\n\n⏰ รูปแบบเวลา:\n• 14:30 (วันนี้)\n• 25/12/2024 14:30\n• 2024-12-25 14:30`;
  
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: helpText
  });
}

async function handleClearTodos(event) {
  const userId = event.source.userId;
  const userTodos = todoList.get(userId);
  
  // Cancel all scheduled jobs
  userTodos.forEach(todo => {
    const job = scheduledJobs.get(todo.id);
    if (job) {
      job.cancel();
      scheduledJobs.delete(todo.id);
    }
  });
  
  // Clear todo list
  todoList.set(userId, []);
  
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: '🗑️ ลบรายการทั้งหมดเรียบร้อย!'
  });
}

async function handleUnknownCommand(event) {
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: 'หนูไม่เข้าใจคำสั่ง งง -3-\n\n💡 พิมพ์ "help" เพื่อดูคำสั่งทั้งหมด'
  });
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Error occurred:', error);
  
  if (error instanceof line.SignatureValidationFailed) {
    console.error('❌ Signature validation failed');
    res.status(401).send('Signature validation failed');
  } else if (error instanceof line.JSONParseError) {
    console.error('❌ JSON parse error');
    res.status(400).send('JSON parse error');
  } else {
    res.status(500).send('Internal Server Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🌐 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log('📋 Make sure your .env file contains:');
  console.log('   CHANNEL_ACCESS_TOKEN=your_channel_access_token');
  console.log('   CHANNEL_SECRET=your_channel_secret');
  console.log('');
  console.log('🤖 LINE Bot Todo List Features:');
  console.log('   ✅ Add todos with reminders');
  console.log('   ⏰ Schedule notifications');
  console.log('   📝 List all todos');
  console.log('   🎉 Mark todos as done');
  console.log('   🗑️ Clear all todos');
});