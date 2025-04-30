const express = require('express');
const cors = require('cors');
const ytdlp = require('yt-dlp-wrap').default; // Correct import syntax
const app = express();
const path = require('path');
const fs = require('fs');

// Middleware
app.use(cors());
app.use(express.json());

// Initialize yt-dlp (correct initialization)
let ytdl;
try {
  // Try local binary first
  const ytdlPath = path.join(__dirname, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  
  if (fs.existsSync(ytdlPath)) {
    ytdl = new ytdlp(ytdlPath); // Note lowercase ytdlp
    console.log('Using local yt-dlp binary');
  } else {
    // Fallback to auto-download
    ytdl = new ytdlp(); // Note lowercase ytdlp
    console.log('Using auto-downloaded yt-dlp');
  }
} catch (err) {
  console.error('YT-DLP initialization failed:', err);
  process.exit(1);
}

// Video Info Endpoint
app.get('/videoInfo', async (req, res) => {
  try {
    const videoUrl = req.query.url;
    
    if (!videoUrl) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    console.log(`Fetching info for: ${videoUrl}`);
    const info = await ytdl.getVideoInfo(videoUrl);
    
    const formats = info.formats
      .filter(f => f.filesize && f.url)
      .map(format => ({
        quality: format.format_note || `${format.height}p` || format.ext.toUpperCase(),
        type: format.ext,
        url: format.url,
        itag: format.format_id,
        filesize: format.filesize ? `${(format.filesize / (1024 * 1024)).toFixed(2)} MB` : 'Unknown',
        hasAudio: !!format.acodec
      }));

    const result = {
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration_string,
      formats
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

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});