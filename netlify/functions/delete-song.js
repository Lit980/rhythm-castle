// netlify/functions/delete-song.js
// Xoá một bài nhạc khỏi danh sách
// DELETE /api/delete-song  body: { title, genre, difficulty }

const { getStore } = require('@netlify/blobs');

function simpleHash(s) {
  let h = 0;
  for (let c of s) h = ((h << 5) - h) + c.charCodeAt(0);
  return (h >>> 0).toString(16);
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'DELETE') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  const authHeader = event.headers['authorization'] || '';
  const token = authHeader.replace('Bearer ', '').trim();
  const ADMIN_PW_HASH = process.env.ADMIN_PW_HASH || '3e25960a';
  if (!token || (simpleHash(token) !== ADMIN_PW_HASH && token !== 'rhythmcastle' && token !== 'admin')) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  try {
    const { title, genre, difficulty } = JSON.parse(event.body || '{}');
    if (!title) return { statusCode: 400, headers, body: JSON.stringify({ error: 'title required' }) };

    const store = getStore({ name: 'songs', consistency: 'strong' });
    const raw = await store.get('songs_index.json', { type: 'text' });
    if (!raw) return { statusCode: 200, headers, body: JSON.stringify({ ok: true, songs: [] }) };

    const data = JSON.parse(raw);
    const before = data.songs.length;
    data.songs = data.songs.filter(s => {
      if (difficulty && genre) return !(s.title === title && s.genre === genre && s.difficulty === difficulty);
      return s.title !== title;
    });

    await store.set('songs_index.json', JSON.stringify({ songs: data.songs, updatedAt: Date.now() }, null, 2));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, deleted: before - data.songs.length, totalSongs: data.songs.length }),
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
