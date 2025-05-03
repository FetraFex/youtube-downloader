const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const app = express();

const { exec } = require('child_process');

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
    if (!url) return res.status(400).json({ error: 'URL required' });

    const info = await runYtDlpCommand([
      url,
      '--dump-json',
      '--no-warnings',
      '--force-ipv4'
    ]);

    // Process formats with better merging detection
    const formats = info.formats.map(format => {
      const isCombined = format.acodec && format.acodec !== 'none' &&
        format.vcodec && format.vcodec !== 'none';
      const isVideo = format.vcodec && format.vcodec !== 'none';
      const isAudio = format.acodec && format.acodec !== 'none';

      let type;
      if (isCombined) type = 'video+audio';
      else if (isVideo) type = 'video only';
      else if (isAudio) type = 'audio only';

      return {
        itag: format.format_id,
        quality: format.height ? `${format.height}p` :
          format.abr ? `${format.abr}kbps` :
            format.format_note || format.ext.toUpperCase(),
        type,
        codec: {
          video: format.vcodec,
          audio: format.acodec
        },
        filesize: format.filesize ? `${(format.filesize / (1024 * 1024)).toFixed(2)}MB` : 'N/A'
      };
    }).filter(f => f.type); // Remove invalid formats

    // Add merge suggestions for higher quality videos
    const enhancedFormats = formats.map(format => {
      if (format.type === 'video only') {
        // Find compatible audio streams
        const compatibleAudio = formats.find(f =>
          f.type === 'audio only' &&
          !f.quality.includes('video') // Ensure it's pure audio
        );
        return {
          ...format,
          canMerge: !!compatibleAudio,
          mergeWith: compatibleAudio?.itag
        };
      }
      return format;
    });

    res.json({
      title: info.title,
      thumbnail: info.thumbnail,
      duration: info.duration_string,
      formats: enhancedFormats
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Download Endpoint
const activeDownloads = new Map(); // Track active downloads

// SSE endpoint for progress updates
app.get('/download/progress/:id', (req, res) => {
  const { id } = req.params;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(':heartbeat\n\n');
  }, 15000);

  // Add client to active downloads
  if (!activeDownloads.has(id)) {
    activeDownloads.set(id, new Set());
  }
  activeDownloads.get(id).add(res);

  // Cleanup on client disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    if (activeDownloads.has(id)) {
      activeDownloads.get(id).delete(res);
      if (activeDownloads.get(id).size === 0) {
        activeDownloads.delete(id);
      }
    }
  });
});

// Download endpoint
app.get('/download', async (req, res) => {
  const { url, itag, id } = req.query;
  if (!url || !itag) {
    return res.status(400).json({ error: 'URL and itag are required' });
  }

  const downloadId = id || Math.random().toString(36).substring(7);
  const ytdlpPath = path.join(__dirname, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');

  try {
    if (!fs.existsSync(ytdlpPath)) {
      throw new Error(`yt-dlp binary not found at ${ytdlpPath}`);
    }

    const childProcess = spawn(ytdlpPath, [
      url,
      '-f', itag,
      '--no-warnings',
      '--newline', // Important for progress parsing
      '--force-ipv4',
      '--socket-timeout', '30',
      '-o', '-'
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      windowsHide: true
    });

    // Set response headers for download
    res.header('Content-Disposition', 'attachment; filename="video.mp4"');
    res.header('Content-Type', 'video/mp4');
    childProcess.stdout.pipe(res);

    // Process progress updates
    childProcess.stderr.on('data', (data) => {
      const output = data.toString().trim();
      if (output.startsWith('[download]')) {
        console.log(output);
        // Send progress to all connected clients
        if (activeDownloads.has(downloadId)) {
          for (const clientRes of activeDownloads.get(downloadId)) {
            clientRes.write(`data: ${JSON.stringify({
              type: 'progress',
              data: output
            })}\n\n`);
          }
        }
      }
    });

    // Handle process completion
    childProcess.on('close', (code) => {
      if (activeDownloads.has(downloadId)) {
        for (const clientRes of activeDownloads.get(downloadId)) {
          clientRes.write(`data: ${JSON.stringify({
            type: 'complete',
            code: code
          })}\n\n`);
          clientRes.end();
        }
        activeDownloads.delete(downloadId);
      }
    });

    // Handle errors
    childProcess.on('error', (error) => {
      if (activeDownloads.has(downloadId)) {
        for (const clientRes of activeDownloads.get(downloadId)) {
          clientRes.write(`data: ${JSON.stringify({
            type: 'error',
            error: error.message
          })}\n\n`);
          clientRes.end();
        }
        activeDownloads.delete(downloadId);
      }
    });

  } catch (error) {
    console.error('Download error:', error);
    res.status(500).json({ error: 'Download failed', details: error.message });
  }
});

// SSE endpoint for progress updates
app.get('/download/stream/:id', (req, res) => {
  const { id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!activeStreams[id]) {
    activeStreams[id] = { clients: [] };
  }

  const clientId = Date.now();
  const newClient = {
    id: clientId,
    res
  };

  activeStreams[id].clients.push(newClient);

  req.on('close', () => {
    activeStreams[id].clients = activeStreams[id].clients.filter(c => c.id !== clientId);
  });
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

const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
const fs = require('fs');
const path = require('path');
const os = require('os');
const fileUpload = require('express-fileupload');

// Set ffmpeg path
app.use(fileUpload());
ffmpeg.setFfmpegPath(ffmpegPath);

app.post('/merge', async (req, res) => {
  try {
    // Check if files were uploaded
    if (!req.files || !req.files.video || !req.files.audio) {
      return res.status(400).json({
        success: false,
        error: 'Both video and audio files are required'
      });
    }

    // Create temporary directory
    const tempDir = path.join(os.tmpdir(), 'yt-merge');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Generate unique filenames
    const timestamp = Date.now();
    const videoPath = path.join(tempDir, `video_${timestamp}.mp4`);
    const audioPath = path.join(tempDir, `audio_${timestamp}.mp3`);
    const outputPath = path.join(tempDir, `merged_${timestamp}.mp4`);


    // Save files
    await req.files.video.mv(videoPath);
    await req.files.audio.mv(audioPath);

    // Merge files
    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(videoPath)
        .input(audioPath)
        .outputOptions([
          '-c:v copy',        // Copy video stream
          '-c:a aac',         // Convert audio to AAC
          '-movflags +faststart' // Enable streaming
        ])
        .output(outputPath)
        .on('start', (command) => console.log('FFmpeg command:', command))
        .on('progress', (progress) => console.log('Processing:', progress))
        .on('end', () => {
          console.log('Merge completed successfully');
          resolve();
        })
        .on('error', (err) => {
          console.error('FFmpeg error:', err);
          reject(new Error('Failed to merge files'));
        })
        .run();
    });

    // Respond with success
    res.json({
      success: true,
      filename: `merged_${timestamp}.mp4`
    });

  } catch (error) {
    console.error('Merge error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Merge failed'
    });
  }
});

// Download merged file endpoint
app.get('/download-merged', (req, res) => {
  const { filename } = req.query;
  if (!filename) {
    return res.status(400).send('Filename is required');
  }

  const tempDir = path.join(os.tmpdir(), 'yt-merge');
  const filePath = path.join(tempDir, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found');
  }

  res.download(filePath, 'merged_video.mp4', (err) => {
    if (err) {
      console.error('Download error:', err);
    }
    // Optionally clean up the file after download
    // fs.unlinkSync(filePath);
  });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});