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
const reminderJobs = new Map(); // todoId -> reminder job (for repeated reminders)

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

// Schedule reminder with repeated notifications
function scheduleReminder(todoItem) {
  const job = schedule.scheduleJob(todoItem.reminderTime, async () => {
    try {
      const message = {
        type: 'text',
        text: `🔔😽 เมี๊ยวเตือน! -3- ด่วนๆ คุณทำสิ่งนี้รึยางงง 😽 \n📝 ${todoItem.task}\n\n💡 พิมพ์ "done ${todoItem.id}" เพื่อบอกหนูว่าคุณทำเสร็จแว้ว!`
      };
      
      await client.pushMessage(todoItem.userId, message);
      console.log(`✅ Initial reminder sent for: ${todoItem.task} at ${formatDate(new Date())}`);
      
      // Start repeated reminders every hour
      startRepeatedReminders(todoItem);
      
    } catch (error) {
      console.error('❌ Error sending reminder:', error);
    }
  });
  
  scheduledJobs.set(todoItem.id, job);
  console.log(`📅 Scheduled reminder for: ${todoItem.task} at ${formatDate(todoItem.reminderTime)}`);
}

// Start repeated reminders every hour
function startRepeatedReminders(todoItem) {
  const reminderInterval = setInterval(async () => {
    try {
      // Check if todo still exists and not completed
      const userTodos = todoList.get(todoItem.userId) || [];
      const todoExists = userTodos.find(todo => todo.id === todoItem.id && !todo.completed);
      
      if (!todoExists) {
        clearInterval(reminderInterval);
        reminderJobs.delete(todoItem.id);
        console.log(`🛑 Stopped hourly reminders for completed/deleted todo: ${todoItem.task}`);
        return;
      }
      
      const currentTime = getCurrentThailandTime();
      const timePassed = Math.floor((currentTime - todoItem.reminderTime) / (1000 * 60 * 60)); // hours
      
      const message = {
        type: 'text',
        text: `🔔😽 แจ้งเตือนซ้ำ! -3- คุณยังไม่ได้ทำรึ? คุณอย่าช้า \n📝 ${todoItem.task}\n⏰ เวลาที่กำหนด: ${formatDate(todoItem.reminderTime)}\n⏳ เลยเวลามาแล้ว: ${timePassed} ชั่วโมง\n\n💡 พิมพ์ "done ${todoItem.id}" เพื่อบอกหนูว่าคุณทำเสร็จแว้ว!`
      };
      
      await client.pushMessage(todoItem.userId, message);
      console.log(`🔄 Hourly reminder sent for: ${todoItem.task} at ${formatDate(currentTime)} (${timePassed} hours overdue)`);
      
    } catch (error) {
      console.error('❌ Error sending hourly reminder:', error);
    }
  }, 3600000); // 1 hour = 3600000 milliseconds
  
  reminderJobs.set(todoItem.id, reminderInterval);
  console.log(`🔄 Started hourly reminders for: ${todoItem.task} (every 1 hour)`);
}

// Parse date and time - Fixed timezone handling
function parseDateTime(dateTimeStr) {
  try {
    // Get current time in Thailand timezone
    const now = new Date();
    const thailandNow = new Date(now.toLocaleString("en-US", {timeZone: "Asia/Bangkok"}));
    
    if (dateTimeStr.includes(' ')) {
      const [datePart, timePart] = dateTimeStr.split(' ');
      const [hour, minute] = timePart.split(':').map(Number);
      
      // Validate time format
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
      }
      
      let date;
      if (datePart.includes('-')) {
        // Format: YYYY-MM-DD
        const [year, month, day] = datePart.split('-').map(Number);
        if (year < 2024 || month < 1 || month > 12 || day < 1 || day > 31) {
          return null;
        }
        date = new Date(year, month - 1, day, hour, minute);
      } else if (datePart.includes('/')) {
        // Format: DD/MM/YYYY
        const [day, month, year] = datePart.split('/').map(Number);
        if (year < 2024 || month < 1 || month > 12 || day < 1 || day > 31) {
          return null;
        }
        date = new Date(year, month - 1, day, hour, minute);
      } else {
        return null;
      }
      
      return date;
    } else if (dateTimeStr.includes(':')) {
      // Format: HH:MM (today)
      const [hour, minute] = dateTimeStr.split(':').map(Number);
      
      // Validate time format
      if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
        return null;
      }
      
      const date = new Date(thailandNow.getFullYear(), thailandNow.getMonth(), thailandNow.getDate(), hour, minute);
      
      // If time has passed today, schedule for tomorrow
      if (date <= thailandNow) {
        date.setDate(date.getDate() + 1);
      }
      
      return date;
    }
    
    return null;
  } catch (error) {
    console.error('Error parsing datetime:', error);
    return null;
  }
}

// Format date for display - Fixed timezone
function formatDate(date) {
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bangkok',
    hour12: false
  };
  
  // Format in Thai locale with explicit timezone
  const formatted = new Intl.DateTimeFormat('th-TH', options).format(date);
  
  // Add day of week in Thai
  const dayOptions = { weekday: 'long', timeZone: 'Asia/Bangkok' };
  const dayName = new Intl.DateTimeFormat('th-TH', dayOptions).format(date);
  
  return `${dayName} ${formatted}`;
}

// Get current Thailand time
function getCurrentThailandTime() {
  return new Date(new Date().toLocaleString("en-US", {timeZone: "Asia/Bangkok"}));
}

// LINE SDK middleware
app.use('/webhook', line.middleware(config));
app.use(express.json());

// Logging middleware
app.use((req, res, next) => {
  const thailandTime = getCurrentThailandTime();
  console.log(`${thailandTime.toISOString()} (Thailand Time) - ${req.method} ${req.path}`);
  next();
});

app.get('/', (req, res) => {
  const currentTime = getCurrentThailandTime();
  res.send(`LINE Bot Todo List is running! 📝✅<br>Current Thailand Time: ${formatDate(currentTime)}`);
});

// Webhook handler
app.post('/webhook', (req, res) => {
  console.log('🚀 Webhook called at:', formatDate(getCurrentThailandTime()));
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
  
  console.log('💬 Message received at:', formatDate(getCurrentThailandTime()), 'Message:', message);
  
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
    } else if (message.toLowerCase() === 'time' || message.toLowerCase() === 'เวลา') {
      await handleCurrentTime(event);
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
      text: '❌ รูปแบบไม่ถูกต้อง\n\n✅ ใช้: add งาน | เวลา\n📝 ตัวอย่าง: add ประชุม | 14:30\n📝 หรือ: add ทำรายงาน | 25/12/2024 09:00\n\n🕐 เวลาปัจจุบัน: ' + formatDate(getCurrentThailandTime())
    });
    return;
  }
  
  const task = parts[0];
  const timeStr = parts[1];
  
  const reminderTime = parseDateTime(timeStr);
  
  if (!reminderTime) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '❌ รูปแบบเวลาไม่ถูกต้อง\n\n✅ รูปแบบที่รองรับ:\n• 14:30 (วันนี้)\n• 25/12/2024 14:30\n• 2024-12-25 14:30\n\n🕐 เวลาปัจจุบัน: ' + formatDate(getCurrentThailandTime())
    });
    return;
  }
  
  const currentTime = getCurrentThailandTime();
  if (reminderTime <= currentTime) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: `❌ ไม่สามารถกำหนดเวลาในอดีตได้\n\n🕐 เวลาปัจจุบัน: ${formatDate(currentTime)}\n⏰ เวลาที่ต้องการ: ${formatDate(reminderTime)}\n\n💡 กรุณาเลือกเวลาที่อยู่ในอนาคต`
    });
    return;
  }
  
  const todoId = generateId(userId);
  const todoItem = new TodoItem(todoId, userId, task, reminderTime);
  
  userTodos.push(todoItem);
  scheduleReminder(todoItem);
  
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: `✅ เพิ่มรายการสำเร็จแว้ว!\n\n📝 งาน: ${task}\n⏰ หนูจะมาแจ้งเตือนคุณตอน ${formatDate(reminderTime)}\n ID: ${todoId}\n🕐\n\n💡 พิมพ์ "list" เพื่อดูรายการทั้งหมด`
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
  
  // Cancel repeated reminder
  const reminderJob = reminderJobs.get(todoId);
  if (reminderJob) {
    clearInterval(reminderJob);
    reminderJobs.delete(todoId);
    console.log(`🛑 Stopped hourly reminders for: ${todoItem.task}`);
  }
  
  // Remove from active list
  userTodos.splice(todoIndex, 1);
  
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: `🎉 ทำเสร็จแว้วววว! -3- \n\n📝 งาน: ${todoItem.task}\n\n😽 คุณเก่งมากเบย`
  });
}

async function handleListTodos(event) {
  const userId = event.source.userId;
  const userTodos = todoList.get(userId);
  
  if (userTodos.length === 0) {
    await client.replyMessage(event.replyToken, {
      type: 'text',
      text: '📋 ไม่มีรายการ Todo\n\n💡 เพิ่มรายการใหม่ด้วย: add งาน | เวลา ได้เลยจ้า -3-\n\n🕐 เวลาปัจจุบัน: ' + formatDate(getCurrentThailandTime())
    });
    return;
  }
  
  let listText = '📋 รายการ Todo ของคุณที่หนูจดๆไว้ -3-\n\n';
  const currentTime = getCurrentThailandTime();
  
  userTodos.forEach((todo) => {
    const isOverdue = todo.reminderTime <= currentTime;
    let status = '🟢 รออยู่';
    
    if (isOverdue) {
      const hoursOverdue = Math.floor((currentTime - todo.reminderTime) / (1000 * 60 * 60));
      status = `🔴 เลยเวลาแล้ว ${hoursOverdue} ชั่วโมง รีบทำด่วน คุณรอไรอยู่รึ`;
    }
    
    listText += `${todo.id}. 📝 ${todo.task}\n`;
    listText += `   ⏰ ${formatDate(todo.reminderTime)}\n`;
    listText += `   ${status}\n\n`;
  });
  
  listText += `🕐 เวลาปัจจุบัน: ${formatDate(currentTime)}\n`;
  listText += '💡 พิมพ์ "done <ตัวเลข>" เพื่อบอกให้หนูรู้ว่าคุณทำเสร็จแว้ว -3-';
  
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: listText
  });
}

async function handleCurrentTime(event) {
  const currentTime = getCurrentThailandTime();
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: `🕐 เวลาปัจจุบัน: ${formatDate(currentTime)}\n\n💡 เวลาที่แสดงเป็นเวลาประเทศไทย (UTC+7)`
  });
}

async function handleHelp(event) {
  const helpText = `🤖 LINE Bot Todo List\n\n📝 คำสั่งที่ใช้ได้:\n\n• add งาน | เวลา\n  เพิ่มรายการใหม่\n  ตัวอย่าง: add ประชุม | 14:30\n\n• list หรือ รายการ\n  แสดงรายการทั้งหมด\n\n• done <ตัวเลข>\n  ทำเครื่องหมายว่าเสร็จแล้ว\n\n• clear หรือ ล้าง\n  ลบรายการทั้งหมด\n\n• time หรือ เวลา\n  แสดงเวลาปัจจุบัน\n\n• help หรือ ช่วยเหลือ\n  แสดงคำสั่งทั้งหมด\n\n⏰ รูปแบบเวลา:\n• 14:30 (วันนี้)\n• 25/12/2024 14:30\n• 2024-12-25 14:30\n\n🔔 การแจ้งเตือน:\n• แจ้งเตือนครั้งแรกตามเวลาที่กำหนด\n• แจ้งเตือนซ้ำทุกชั่วโมง จนกว่าจะ done\n\n🕐 เวลาปัจจุบัน: ${formatDate(getCurrentThailandTime())}`;
  
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
    
    // Cancel repeated reminders
    const reminderJob = reminderJobs.get(todo.id);
    if (reminderJob) {
      clearInterval(reminderJob);
      reminderJobs.delete(todo.id);
    }
  });
  
  // Clear todo list
  todoList.set(userId, []);
  
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: '🗑️ ลบรายการทั้งหมดเรียบร้อย!\n🔕 หยุดการแจ้งเตือนทั้งหมดแล้ว\n\n🕐 เวลาปัจจุบัน: ' + formatDate(getCurrentThailandTime())
  });
}

async function handleUnknownCommand(event) {
  await client.replyMessage(event.replyToken, {
    type: 'text',
    text: 'หนูไม่เข้าใจคำสั่ง งง คุณพิมพ์อะราย -3-\n\n💡 พิมพ์ "help" เพื่อให้คนอื่นช่วย กมรสน -3-'
  });
}

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('💥 Error occurred at:', formatDate(getCurrentThailandTime()), error);
  
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
  const currentTime = getCurrentThailandTime();
  console.log(`🚀 Server is running on port ${PORT}`);
  console.log(`🌐 Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`🕐 Server started at: ${formatDate(currentTime)}`);
  console.log('📋 Make sure your .env file contains:');
  console.log('   CHANNEL_ACCESS_TOKEN=your_channel_access_token');
  console.log('   CHANNEL_SECRET=your_channel_secret');
  console.log('');
  console.log('🤖 LINE Bot Todo List Features:');
  console.log('   ✅ Add todos with reminders');
  console.log('   ⏰ Schedule notifications');
  console.log('   🔄 Repeated reminders every 1 hour');
  console.log('   📝 List all todos');
  console.log('   🎉 Mark todos as done');
  console.log('   🗑️ Clear all todos');
  console.log('   🕐 Check current time');
});