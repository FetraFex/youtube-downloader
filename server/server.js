const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const app = express();
const path = require('path');
const fs = require('fs');

// Middleware
app.use(cors());
app.use(express.json());

// Helper function to safely run yt-dlp
const runYtDlpCommand = (args, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      // Determine the correct binary path
      const ytdlpPath = path.join(
        __dirname,
        process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
      );

      // Verify binary exists
      if (!fs.existsSync(ytdlpPath)) {
        throw new Error(`yt-dlp binary not found at ${ytdlpPath}`);
      }

      // Create the process
      const childProcess = spawn(ytdlpPath, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
        windowsHide: true,
        ...options
      });

      let stdout = '';
      let stderr = '';

      childProcess.stdout.on('data', (data) => (stdout += data.toString()));
      childProcess.stderr.on('data', (data) => (stderr += data.toString()));

      childProcess.on('close', (code) => {
        if (code === 0) {
          try {
            resolve(stdout ? JSON.parse(stdout) : {});
          } catch (e) {
            resolve(stdout);
          }
        } else {
          reject(new Error(stderr || `Process failed with code ${code}`));
        }
      });

      childProcess.on('error', (err) => {
        reject(new Error(`Process error: ${err.message}`));
      });
    } catch (err) {
      reject(err);
    }
  });
};

// Video Info Endpoint
app.get('/videoInfo', async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'YouTube URL is required' });
    }

    const info = await runYtDlpCommand([
      url,
      '--dump-json',
      '--no-warnings',
      '--force-ipv4',
      '--socket-timeout', '30'
    ]);

    const formats = info.formats
      .filter((f) => f.vcodec || f.acodec) // Filter out formats without codec info
      .map((format) => {
        // Determine format type
        let type = '';
        if (format.vcodec && format.vcodec !== 'none' && format.acodec && format.acodec !== 'none') {
          type = 'video+audio';
        } else if (format.vcodec && format.vcodec !== 'none') {
          type = 'video only';
        } else if (format.acodec && format.acodec !== 'none') {
          type = 'audio only';
        }

        // Format quality label
        let quality = '';
        if (format.height) {
          quality = `${format.height}p`;
        } else if (format.abr) {
          quality = `${format.abr}kbps`;
        } else {
          quality = format.format_note || format.ext.toUpperCase();
        }

        return {
          itag: format.format_id,
          quality,
          type,
          filesize: format.filesize ? `${(format.filesize / (1024 * 1024)).toFixed(2)} MB` : 'Unknown',
          hasAudio: format.acodec && format.acodec !== 'none',
          hasVideo: format.vcodec && format.vcodec !== 'none',
          audioBitrate: format.abr,
          videoResolution: format.height,
          container: format.ext,
          codecs: {
            video: format.vcodec,
            audio: format.acodec
          }
        };
      })
      .filter(f => f.type); // Remove any formats we couldn't categorize

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration_string,
      formats
    });
  } catch (error) {
    console.error('Video info error:', error);
    res.status(500).json({ 
      error: 'Failed to fetch video info',
      details: error.message
    });
  }
});

// Download Endpoint
app.get('/download', async (req, res) => {
  let childProcess;
  try {
    const { url, itag } = req.query;
    if (!url || !itag) {
      return res.status(400).json({ error: 'URL and itag are required' });
    }

    const ytdlpPath = path.join(
      __dirname,
      process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    );

    if (!fs.existsSync(ytdlpPath)) {
      throw new Error(`yt-dlp binary not found at ${ytdlpPath}`);
    }

    // Create the download process
    childProcess = spawn(ytdlpPath, [
      url,
      '-f', itag,
      '--no-warnings',
      '--force-ipv4',
      '--socket-timeout', '30',
      '-o', '-'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true
    });

    // Set response headers
    res.header('Content-Disposition', 'attachment; filename="video.mp4"');
    res.header('Content-Type', 'video/mp4');

    // Pipe the download stream to response
    childProcess.stdout.pipe(res);

    // Error handling
    childProcess.stderr.on('data', (data) => {
      console.error('yt-dlp stderr:', data.toString());
    });

    childProcess.on('error', (error) => {
      console.error('Process error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed', details: error.message });
      }
    });

    childProcess.on('close', (code) => {
      if (code !== 0 && !res.headersSent) {
        res.status(500).json({ error: `Process exited with code ${code}` });
      }
    });

  } catch (error) {
    console.error('Download error:', error);
    if (childProcess) childProcess.kill();
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Download failed',
        details: error.message
      });
    }
  }
});

app.get('/download/audio', async (req, res) => {
  let childProcess;
  try {
    const { url, itag } = req.query;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const ytdlpPath = path.join(
      __dirname,
      process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
    );

    if (!fs.existsSync(ytdlpPath)) {
      throw new Error(`yt-dlp binary not found at ${ytdlpPath}`);
    }

    // Build the command arguments in correct order
    const args = [
      url,
      '--no-warnings',
      '--force-ipv4',
      '--socket-timeout', '30',
      '--extract-audio',
      '--audio-format', 'mp3',
      '-f', itag || 'bestaudio',
      '-o', '-'
    ];

    // Create the download process
    childProcess = spawn(ytdlpPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true
    });

    // Set response headers for audio
    res.header('Content-Disposition', 'attachment; filename="audio.mp3"');
    res.header('Content-Type', 'audio/mpeg');

    // Pipe the download stream to response
    childProcess.stdout.pipe(res);

    // Error handling
    childProcess.stderr.on('data', (data) => {
      console.error('yt-dlp stderr:', data.toString());
    });

    childProcess.on('error', (error) => {
      console.error('Process error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Download failed', details: error.message });
      }
    });

    childProcess.on('close', (code) => {
      if (code !== 0 && !res.headersSent) {
        res.status(500).json({ error: `Process exited with code ${code}` });
      }
    });

  } catch (error) {
    console.error('Audio download error:', error);
    if (childProcess) childProcess.kill();
    if (!res.headersSent) {
      res.status(500).json({ 
        error: 'Audio download failed',
        details: error.message
      });
    }
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});