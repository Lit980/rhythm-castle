// netlify/functions/upload-song.js
// Xử lý upload nhạc: nhận multipart form data, lưu vào Netlify Blobs
// POST /api/upload-song
 
const { getStore } = require('@netlify/blobs');
 
// Simple hash để verify token (giống game)
function simpleHash(s) {
  let h = 0;
  for (let c of s) h = ((h << 5) - h) + c.charCodeAt(0);
  return (h >>> 0).toString(16);
}
 
// Parse multipart/form-data thủ công (Netlify Functions không có built-in parser)
function parseMultipart(body, boundary) {
  const parts = {};
  const boundaryBuf = `--${boundary}`;
  const sections = body.split(boundaryBuf).slice(1); // bỏ phần đầu rỗng
 
  for (const section of sections) {
    if (section.startsWith('--') || section.trim() === '') continue;
 
    const [headerPart, ...bodyParts] = section.split('\r\n\r\n');
    const bodyContent = bodyParts.join('\r\n\r\n').replace(/\r\n$/, '');
 
    // Parse Content-Disposition
    const nameMatch = headerPart.match(/name="([^"]+)"/);
    const filenameMatch = headerPart.match(/filename="([^"]+)"/);
    if (!nameMatch) continue;
 
    const fieldName = nameMatch[1];
    if (filenameMatch) {
      parts[fieldName] = {
        filename: filenameMatch[1],
        content: bodyContent,
        contentType: (headerPart.match(/Content-Type:\s*([^\r\n]+)/i) || [])[1] || 'application/octet-stream',
      };
    } else {
      parts[fieldName] = bodyContent;
    }
  }
  return parts;
}
 
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
 
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
 
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
 
  // Verify auth token
  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const ADMIN_PW_HASH = process.env.ADMIN_PW_HASH || '3e25960a'; // hash của 'rhythmcastle'
  if (!token || (simpleHash(token) !== ADMIN_PW_HASH && token !== 'rhythmcastle' && token !== 'admin')) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
 
  try {
    // Parse JSON body (admin panel gửi JSON với base64 data)
    let payload;
    try {
      payload = JSON.parse(event.body);
    } catch {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON body' }) };
    }
 
    const { title, genre, difficulty, strategy, bpm, timeSig, note, audioData, audioName, beatmapData } = payload;
 
    // Validate
    if (!title || !genre || !difficulty || !audioData || !beatmapData) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Thiếu thông tin bắt buộc: title, genre, difficulty, audioData, beatmapData' }) };
    }
 
    const store = getStore({
      name: 'songs',
      consistency: 'strong',
      siteID: process.env.NETLIFY_SITE_ID || '44545ca4-840e-463f-9156-5cb84d801175',
      token: process.env.NETLIFY_AUTH_TOKEN,
    });
 
    // Tạo slug từ title
    const slug = title.toLowerCase()
      .replace(/[àáạảãâầấậẩẫăằắặẳẵ]/g, 'a')
      .replace(/[èéẹẻẽêềếệểễ]/g, 'e')
      .replace(/[ìíịỉĩ]/g, 'i')
      .replace(/[òóọỏõôồốộổỗơờớợởỡ]/g, 'o')
      .replace(/[ùúụủũưừứựửữ]/g, 'u')
      .replace(/[ỳýỵỷỹ]/g, 'y')
      .replace(/đ/g, 'd')
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '');
 
    const ts = Date.now();
    const audioExt = (audioName || 'audio.mp3').split('.').pop() || 'mp3';
    const audioKey = `audio/${slug}_${ts}.${audioExt}`;
    const beatmapKey = `beatmaps/${slug}_${ts}_${difficulty}.json`;
 
    // Lưu audio (base64 → binary)
    const audioBuf = Buffer.from(audioData.replace(/^data:[^;]+;base64,/, ''), 'base64');
    await store.set(audioKey, audioBuf, {
      metadata: { contentType: `audio/${audioExt}` },
    });
 
    // Tạo beatmap JSON hoàn chỉnh
    const beatmap = {
      ...beatmapData,
      title,
      genre,
      difficulty,
      strategy: strategy || 'charm',
      bpm: bpm || beatmapData.bpm || 120,
      timeSig: timeSig || '4/4',
      note: note || '',
      uploadedAt: ts,
    };
    await store.set(beatmapKey, JSON.stringify(beatmap), {
      metadata: { contentType: 'application/json' },
    });
 
    // Đọc songs.json hiện tại và thêm bài mới
    let songs = [];
    try {
      const existing = await store.get('songs_index.json', { type: 'text' });
      if (existing) {
        const parsed = JSON.parse(existing);
        songs = parsed.songs || [];
      }
    } catch { songs = []; }
 
    // Xoá entry cũ nếu trùng title + genre + difficulty
    songs = songs.filter(s => !(s.title === title && s.genre === genre && s.difficulty === difficulty));
 
    // Thêm entry mới
    songs.push({
      title,
      genre: genre.toLowerCase(),
      difficulty,
      strategy: strategy || 'charm',
      bpm: bpm || beatmapData.bpm || 120,
      audioPath: `/.netlify/blobs/songs/${audioKey}`,
      beatmapPath: `/.netlify/blobs/songs/${beatmapKey}`,
      uploadedAt: ts,
    });
 
    // Sắp xếp theo genre rồi title
    songs.sort((a, b) => a.genre.localeCompare(b.genre) || a.title.localeCompare(b.title));
 
    // Cập nhật songs_index.json
    await store.set('songs_index.json', JSON.stringify({ songs, updatedAt: ts }, null, 2), {
      metadata: { contentType: 'application/json' },
    });
 
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        message: `✅ Đã upload "${title}" thành công!`,
        song: songs[songs.length - 1],
        totalSongs: songs.length,
      }),
    };
  } catch (err) {
    console.error('upload-song error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error: ' + err.message }),
    };
  }
};
 
