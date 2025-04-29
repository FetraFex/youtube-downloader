const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-wrap').default; // Note the .default here
const app = express();
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

// Security Middleware
app.use(helmet());
app.use(cors({
  origin: ['http://localhost:5173']
}));
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Initialize yt-dlp
let ytdl;
try {
  // Try to use local binary first
  const ytdlPath = path.join(__dirname, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  if (fs.existsSync(ytdlPath)) {
    ytdl = new ytdlp(ytdlPath);
    console.log('Using local yt-dlp binary');
  } else {
    // Fallback to auto-download
    ytdl = new ytdlp();
    console.log('Using auto-downloaded yt-dlp');
  }
} catch (err) {
  console.error('YT-DLP initialization failed:', err);
  process.exit(1);
}

// Validate YouTube URL
const isValidYouTubeUrl = (url) => {
  const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/;
  return pattern.test(url);
};

// Video info endpoint
app.get('/videoInfo', async (req, res) => {
  try {
    const videoUrl = req.query.url;
    
    if (!videoUrl) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }
    
    if (!isValidYouTubeUrl(videoUrl)) {
      return res.status(400).json({ error: 'Invalid YouTube URL' });
    }

    console.log(`Fetching info for: ${videoUrl}`);
    const info = await ytdl.getVideoInfo(videoUrl);
    
    const formats = info.formats
      .filter(f => f.filesize && f.url)
      .map(format => ({
        quality: format.format_note || `${format.ext.toUpperCase()}`,
        type: format.ext,
        url: format.url,
        itag: format.format_id,
        filesize: format.filesize
      }));

    const result = {
      title: info.title,
      thumbnail: info.thumbnail,
      formats: formats
    };

    res.json(result);
  } catch (error) {
    console.error('Video info error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch video information',
      details: error.message 
    });
  }
});

// Download endpoint
app.get('/download', async (req, res) => {
  try {
    const videoUrl = req.query.url;
    const itag = req.query.itag;
    
    if (!videoUrl || !itag) {
      return res.status(400).json({ error: 'URL and itag are required' });
    }

    console.log(`Processing download for: ${videoUrl} with itag: ${itag}`);
    const info = await ytdl.getVideoInfo(videoUrl);
    const format = info.formats.find(f => f.format_id === itag);
    
    if (!format) {
      return res.status(400).json({ error: 'Requested format not available' });
    }

    res.redirect(format.url);
    
  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ 
      error: 'Download failed',
      details: error.message 
    });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});