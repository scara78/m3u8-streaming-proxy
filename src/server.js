const express = require('express');
const path = require('path');
require('dotenv').config();
const fetch = require('node-fetch');
const { fetchWithCustomReferer } = require('./fetchWithCustomReferer');
const { rewritePlaylistUrls } = require('./rewritePlaylistUrls');
const NodeCache = require('node-cache');
const morgan = require('morgan');
const helmet = require('helmet');
const { cleanEnv, str, num } = require('envalid');

// Validate environment variables
const env = cleanEnv(process.env, {
  PORT: num({ default: 3000 }),
  ALLOWED_ORIGINS: str({ default: "*" }), 
  REFERER_URL: str({ default: "https://streameeeeee.site/" })
});

const app = express();
const PORT = env.PORT;

const cache = new NodeCache({ stdTTL: 600 });

app.use(morgan('dev'));

// ==========================================
// MODIFICARE 1: CONFIGURARE HELMET AGRESIVĂ
// ==========================================
app.use(
  helmet({
    // Rezolvă eroarea NotSameOrigin permițând încărcarea resursei pe alte domenii
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Permite ferestrelor pop-up și playerelor să comunice
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
    // Dezactivăm CSP-ul restrictiv care bloca scripturile/media-urile externe
    contentSecurityPolicy: false,
  })
);

app.use(express.static(path.join(__dirname, '../public')));

// ==========================================
// MODIFICARE 2: CORS ȘI HEADERE CORP MANUALE
// ==========================================
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Origin, Accept, Range');
  
  // Forțăm browserul să accepte resursa chiar dacă e cerută cross-site
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  
  next();
});

app.options('*', (req, res) => {
  res.status(204).end();
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});



app.get('/api/v1/streamingProxy', async (req, res) => {
  try {
    const url = req.query.url;

    if (!url) {
      return res.status(400).json({ error: "URL parameter is required" });
    }

    const isM3U8 = url.endsWith(".m3u8");

    const cachedResponse = cache.get(url);
    if (cachedResponse) {
      console.log(`Serving from cache: ${url}`);
      
      // ==========================================
      // MODIFICARE 3: HEADERE CORP ÎN CACHE
      // ==========================================
      const commonHeaders = {
        "Access-Control-Allow-Origin": "*",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "Cache-Control": isM3U8 ? "public, max-age=600" : "public, max-age=31536000"
      };

      if (isM3U8) {
        res.set({ ...commonHeaders, "Content-Type": "application/vnd.apple.mpegurl" });
      } else {
        res.set({ ...commonHeaders, "Content-Type": "video/mp2t" });
      }
      return res.status(200).send(cachedResponse);
    }

    const response = await fetchWithCustomReferer(url, env.REFERER_URL);

    if (!response.ok) {
      return res.status(response.status).json({
        error: response.statusText,
        status: response.status
      });
    }

    // Headere comune pentru răspunsurile noi
    const responseHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Cross-Origin-Resource-Policy": "cross-origin"
    };

    if (isM3U8) {
      const playlistText = await response.text();
      const modifiedPlaylist = rewritePlaylistUrls(playlistText, url);

      cache.set(url, modifiedPlaylist);

      res.set({
        ...responseHeaders,
        "Content-Type": "application/vnd.apple.mpegurl",
        "Cache-Control": "public, max-age=600"
      });
      return res.send(modifiedPlaylist);
    } else {
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      cache.set(url, buffer);

      res.set({
        ...responseHeaders,
        "Content-Type": "video/mp2t",
        "Cache-Control": "public, max-age=31536000"
      });
      return res.send(buffer);
    }
  } catch (error) {
    console.error('Proxy error:', error);
    return res.status(500).json({
      error: "Failed to fetch data",
      details: error.message
    });
  }
});

app.use((err, req, res, next) => {
  console.error('Server error:', err.stack);
  res.status(500).json({
    error: "Something went wrong!",
    message: err.message
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
