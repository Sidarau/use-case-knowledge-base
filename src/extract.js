import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { execSync } from 'child_process';
import { createRequire } from 'module';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const require = createRequire(import.meta.url);

function loadTranscriptApiKey() {
  if (process.env.TRANSCRIPTAPI_KEY) return process.env.TRANSCRIPTAPI_KEY;
  const envPath = join(homedir(), '.openclaw', 'private', 'transcriptapi.env');
  if (!existsSync(envPath)) return null;
  try {
    const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/);
    for (const raw of lines) {
      const s = String(raw || '').trim();
      if (!s || s.startsWith('#') || !s.includes('=')) continue;
      const [k, ...rest] = s.split('=');
      if (k.trim() === 'TRANSCRIPTAPI_KEY') {
        const v = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
        if (v) return v;
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchTranscriptFromApi(videoId) {
  const key = loadTranscriptApiKey();
  if (!key || !videoId) return null;
  const params = new URLSearchParams({ video_url: videoId });
  const res = await fetch(`https://transcriptapi.com/api/v2/youtube/transcript?${params.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const segments = data.transcript;
  if (Array.isArray(segments)) {
    return segments.map(seg => (typeof seg === 'string' ? seg : seg.text || '')).filter(Boolean).join(' ').trim();
  }
  if (typeof data.transcript === 'string') {
    return data.transcript.trim();
  }
  return null;
}

function extractVideoIdFromUrl(url) {
  if (!url) return null;
  const patterns = [
    /v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /embed\/([A-Za-z0-9_-]{11})/,
  ];
  for (const re of patterns) {
    const m = url.match(re);
    if (m) return m[1];
  }
  return null;
}

// ---------- helpers ----------

async function fetchWithRetry(url, opts = {}, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(30_000) });
      return res;
    } catch (err) {
      const transient = ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT']
        .some(c => err.message?.includes(c) || err.cause?.code === c);
      if (!transient || i === retries) throw err;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

function stripHtml(html) {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------- Twitter/X ----------

async function extractTweet(url) {
  // Extract tweet ID
  const m = url.match(/status\/(\d+)/);
  if (!m) throw new Error('Cannot parse tweet ID from URL');
  const tweetId = m[1];
  const username = url.match(/\.com\/([^/]+)\//)?.[1] || 'i';

  // Try FxTwitter API
  try {
    const res = await fetchWithRetry(`https://api.fxtwitter.com/${username}/status/${tweetId}`);
    if (res.ok) {
      const data = await res.json();
      const tweet = data.tweet;
      
      // Check for long-form article content first
      if (tweet?.article?.content?.blocks) {
        const article = tweet.article;
        const blocks = article.content.blocks;
        const articleText = blocks.map(b => b.text || '').filter(Boolean).join('\n\n');
        
        if (articleText.length > 100) {
          return {
            title: article.title || `Article by @${tweet.author?.screen_name || username}`,
            content: articleText,
            metadata: {
              author: tweet.author?.screen_name || username,
              author_name: tweet.author?.name,
              published_at: article.created_at,
              is_article: true,
              tweet_id: tweetId,
            }
          };
        }
      }
      
      const mainText = (tweet?.text || tweet?.raw_text?.text || '').trim();
      const quoteText = (tweet?.quote?.text || tweet?.quote?.raw_text?.text || '').trim();
      const body = [
        mainText,
        quoteText ? `\n\n[Quoted]\n${quoteText}` : '',
      ].filter(Boolean).join('');

      if (body.length > 0) {
        return {
          title: `Tweet by @${tweet.author?.screen_name || username}`,
          content: body,
          metadata: {
            author: tweet.author?.screen_name || username,
            author_name: tweet.author?.name,
            likes: tweet.likes,
            retweets: tweet.retweets,
            tweet_id: tweetId,
          }
        };
      }
    }
  } catch { /* fall through */ }

  // Fallback: try fetching via nitter or raw scrape
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot)' },
    });
    const html = await res.text();
    const text = stripHtml(html);
    if (text.length > 20) {
      return { title: `Tweet ${tweetId}`, content: text };
    }
  } catch { /* fall through */ }

  throw new Error('Failed to extract tweet content');
}

// ---------- YouTube ----------

async function extractYouTube(url) {
  const fallbackVideoId = extractVideoIdFromUrl(url);
  // Try yt-dlp first
  try {
    const result = execSync(
      `yt-dlp --write-auto-sub --sub-lang en --skip-download --print-json "${url}" 2>/dev/null`,
      { encoding: 'utf-8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
    );
    const info = JSON.parse(result);
    const title = info.title || 'YouTube Video';
    const metadata = {
      channel: info.uploader || info.channel,
      channel_id: info.channel_id,
      published_at: info.upload_date ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6, 8)}` : null,
      view_count: info.view_count,
      duration: info.duration,
      is_live: info.is_live || false,
    };

    // Try to get subtitles file
    let transcript = '';
    if (info.requested_subtitles?.en?.filepath) {
      transcript = readFileSync(info.requested_subtitles.en.filepath, 'utf-8');
    }

    // If no subtitle file, try auto-generated
    if (!transcript) {
      try {
        const subResult = execSync(
          `yt-dlp --write-auto-sub --sub-lang en --skip-download --sub-format vtt -o "/tmp/kb-yt-%(id)s" "${url}" 2>/dev/null && cat /tmp/kb-yt-*${info.id}*.vtt 2>/dev/null`,
          { encoding: 'utf-8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
        );
        transcript = subResult;
      } catch { /* no subs */ }
    }

    if (!transcript) {
      const apiTranscript = await fetchTranscriptFromApi(info.id || fallbackVideoId);
      if (apiTranscript) {
        transcript = apiTranscript;
      }
    }

    // Clean VTT format
    if (transcript) {
      const { readFileSync } = await import('fs');
      transcript = readFileSync(info.requested_subtitles.en.filepath, 'utf-8');
    }

    // If no subtitle file, try auto-generated
    if (!transcript) {
      try {
        const subResult = execSync(
          `yt-dlp --write-auto-sub --sub-lang en --skip-download --sub-format vtt -o "/tmp/kb-yt-%(id)s" "${url}" 2>/dev/null && cat /tmp/kb-yt-*${info.id}*.vtt 2>/dev/null`,
          { encoding: 'utf-8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024 }
        );
        transcript = subResult;
      } catch { /* no subs */ }
    }

    if (!transcript && info.id) {
      const apiTranscript = await fetchTranscriptFromApi(info.id);
      if (apiTranscript) {
        transcript = apiTranscript;
      }
    }

    // Clean VTT format
    if (transcript) {
      transcript = transcript
        .replace(/WEBVTT[\s\S]*?\n\n/, '')
        .replace(/\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}.*\n/g, '')
        .replace(/<[^>]+>/g, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
      // Remove duplicate consecutive lines (VTT often repeats)
      const lines = transcript.split('\n');
      const deduped = lines.filter((l, i) => i === 0 || l !== lines[i - 1]);
      transcript = deduped.join('\n');
    }

    if (transcript && transcript.length > 50) {
      metadata.has_transcript = true;
      metadata.transcript_source = metadata.transcript_source || 'yt-dlp';
      metadata.transcript_length = transcript.length;
      return { title, content: transcript, metadata };
    }

    // If we got info but no transcript, use description
    if (info.description && info.description.length > 50) {
      metadata.has_transcript = false;
      metadata.transcript_source = 'description';
      return { title, content: `[No transcript available]\n\n${info.description}`, metadata };
    }

    metadata.has_transcript = false;
    return { title, content: '', metadata }; // return metadata even if no content
  } catch (err) {
    if (err.message === 'No transcript found') throw err;
    const fallbackId = extractVideoIdFromUrl(url);
    const apiTranscript = await fetchTranscriptFromApi(fallbackId);
    if (apiTranscript) {
      return {
        title: 'YouTube Video',
        content: apiTranscript,
        metadata: {
          video_id: fallbackId || undefined,
          has_transcript: true,
          transcript_source: 'transcriptapi',
          transcript_length: apiTranscript.length,
        },
      };
    }
    // yt-dlp not available or failed
  }

  // Fallback: try to extract from page
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : 'YouTube Video';

    // Try to find captions in page data
    const capsMatch = html.match(/"captionTracks":\s*(\[[\s\S]*?\])/);
    if (capsMatch) {
      const tracks = JSON.parse(capsMatch[1]);
      const enTrack = tracks.find(t => t.languageCode === 'en') || tracks[0];
      if (enTrack?.baseUrl) {
        const capsRes = await fetchWithRetry(enTrack.baseUrl);
        const capsXml = await capsRes.text();
        const transcript = stripHtml(capsXml);
        if (transcript.length > 50) {
          return { title, content: transcript };
        }
      }
    }

    // Use description from meta
    const descMatch = html.match(/meta\s+name="description"\s+content="([^"]+)"/);
    if (descMatch && descMatch[1].length > 50) {
      return { title, content: descMatch[1] };
    }
  } catch { /* fall through */ }

  throw new Error('Failed to extract YouTube content');
}

// ---------- PDF ----------

async function extractPdf(url) {
  const res = await fetchWithRetry(url);
  const buffer = Buffer.from(await res.arrayBuffer());
  const pdfParse = require('pdf-parse');
  const data = await pdfParse(buffer);
  return {
    title: data.info?.Title || 'PDF Document',
    content: data.text || '',
  };
}

// ---------- Article ----------

async function extractArticle(url) {
  // Try Readability first
  try {
    const res = await fetchWithRetry(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    const contentType = res.headers.get('content-type') || '';

    // Check if this is actually a PDF
    if (contentType.includes('application/pdf')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(buffer);
      return { title: data.info?.Title || 'PDF Document', content: data.text || '' };
    }

    const html = await res.text();
    const { document } = parseHTML(html);
    const article = new Readability(document).parse();
    if (article?.textContent && article.textContent.trim().length > 100) {
      return {
        title: article.title || '',
        content: article.textContent.trim(),
      };
    }
  } catch { /* fall through to raw fetch */ }

  // Fallback: raw fetch + strip HTML
  try {
    const res = await fetchWithRetry(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; bot)' },
    });
    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const content = stripHtml(html);
    if (content.length > 50) {
      return { title, content };
    }
  } catch { /* fall through */ }

  throw new Error('Failed to extract article content');
}

// ---------- Main ----------

export async function extractContent(url, sourceType) {
  let result;
  switch (sourceType) {
    case 'tweet':   result = await extractTweet(url); break;
    case 'video':   result = await extractYouTube(url); break;
    case 'pdf':     result = await extractPdf(url); break;
    case 'article': result = await extractArticle(url); break;
    case 'text':    result = { title: 'Text note', content: url }; break;
    default:        result = await extractArticle(url); break;
  }
  return { metadata: {}, ...result };
}
