// netlify/functions/get-songs.js
// Trả về danh sách bài nhạc đã upload
// GET /api/get-songs  → { songs: [...] }
 
const { getStore } = require('@netlify/blobs');
 
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'public, max-age=30', // cache 30s
  };
 
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }
 
  try {
    const store = getStore({
      name: 'songs',
      consistency: 'strong',
      siteID: process.env.NETLIFY_SITE_ID || '44545ca4-840e-463f-9156-5cb84d801175',
      token: process.env.NETLIFY_AUTH_TOKEN,
    });
    const raw = await store.get('songs_index.json', { type: 'text' });
 
    if (!raw) {
      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ songs: [] }),
      };
    }
 
    return {
      statusCode: 200,
      headers,
      body: raw,
    };
  } catch (err) {
    console.error('get-songs error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ songs: [], error: err.message }),
    };
  }
};
 
